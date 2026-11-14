import express from "express";
import { query } from "./db.js";

const app = express();
app.disable("x-powered-by");

app.use("/api", (req, res, next) => {
  // Always read fresh rows, so a change in pgAdmin shows up on the next page load.
  res.set("Cache-Control", "no-store");
  next();
});

// Every endpoint that returns points builds its features with this, so the properties always match.
const FEATURE = `
  json_build_object(
    'type', 'Feature',
    'id', id,
    'geometry', ST_AsGeoJSON(geom, 6)::json,
    'properties', json_build_object(
      'id', id, 'name', name, 'bank', bank, 'facility_type', facility_type,
      'atm_on_site', atm_on_site, 'address', address, 'locality', locality, 'tehsil', tehsil,
      'phone', phone, 'opening_hours', opening_hours,
      'source', source, 'source_ref', source_ref, 'checked_on', to_char(checked_on, 'YYYY-MM-DD')
    )
  )`;

const featureCollection = features => ({ type: "FeatureCollection", features });

const TYPES = ["Branch", "ATM"];

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function textParam(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

app.get("/api/health", async (req, res) => {
  const { rows } = await query(`
    SELECT split_part(version(), ' ', 2) AS postgresql, PostGIS_Lib_Version() AS postgis,
           (SELECT COUNT(*)::int FROM banking_points) AS points`);
  res.json({ ok: true, ...rows[0] });
});

// GET /api/points?type=ATM&bank=HBL&tehsil=Lachi%20Tehsil&q=cantt
app.get("/api/points", async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  const type = textParam(req.query.type, 10);
  const bank = textParam(req.query.bank, 60);
  const tehsil = textParam(req.query.tehsil, 60);
  const q = textParam(req.query.q, 80);
  if (type === null || bank === null || tehsil === null || q === null) return badRequest(res, "A filter value is too long.");
  if (type && !TYPES.includes(type)) return badRequest(res, "type must be Branch or ATM.");

  if (type) add("facility_type = ?", type);
  if (bank) add("bank = ?", bank);
  if (tehsil) add("tehsil = ?", tehsil);
  if (q) {
    // Escape LIKE wildcards so "%" in the search box is matched literally.
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    params.push(pattern);
    where.push(`(name ILIKE $${params.length} OR locality ILIKE $${params.length} OR address ILIKE $${params.length})`);
  }

  const { rows } = await query(
    `SELECT ${FEATURE} AS feature FROM banking_points_view
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY bank, name`,
    params
  );
  res.json(featureCollection(rows.map(row => row.feature)));
});

app.get("/api/points/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, "id must be a positive whole number.");
  const { rows } = await query(`SELECT ${FEATURE} AS feature FROM banking_points_view WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: "No point with that id." });
  res.json(rows[0].feature);
});

// Nearest points to a clicked location. <-> uses the GiST index to sort by distance;
// the geography cast then gives the distance in metres.
app.get("/api/nearest", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const limit = req.query.limit === undefined ? 3 : Number(req.query.limit);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return badRequest(res, "lat and lng must be valid coordinates.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return badRequest(res, "limit must be between 1 and 10.");
  const type = textParam(req.query.type, 10);
  const bank = textParam(req.query.bank, 60);
  if (type === null || bank === null) return badRequest(res, "A filter value is too long.");
  if (type && !TYPES.includes(type)) return badRequest(res, "type must be Branch or ATM.");

  // Empty filters match everything, so one query covers "nearest point" and "nearest HBL ATM".
  const { rows } = await query(
    `WITH here AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326) AS g)
     SELECT ${FEATURE} AS feature,
            ROUND(ST_Distance(geom::geography, here.g::geography))::int AS metres,
            EXISTS (SELECT 1 FROM study_area d WHERE d.level = 'District' AND ST_Within(here.g, d.geom)) AS inside
     FROM banking_points_view, here
     WHERE ($4 = '' OR facility_type = $4) AND ($5 = '' OR bank = $5)
     ORDER BY geom <-> here.g
     LIMIT $3`,
    [lat, lng, limit, type, bank]
  );
  res.json({
    ...featureCollection(rows.map(row => {
      row.feature.properties.distance_m = row.metres;
      return row.feature;
    })),
    query: { lat, lng, type: type || null, bank: bank || null, inside_district: rows[0]?.inside ?? false }
  });
});

// District and tehsil outlines with population, area and a point count from a spatial join.
app.get("/api/study-area", async (req, res) => {
  const { rows } = await query(`
    SELECT json_build_object(
      'type', 'Feature',
      'id', a.id,
      'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(a.geom, 0.0002), 5)::json,
      'properties', json_build_object(
        'id', a.id, 'name', a.name, 'level', a.level, 'population_2023', a.population_2023,
        'area_km2', ROUND((ST_Area(a.geom::geography) / 1e6)::numeric, 1),
        'points', (SELECT COUNT(*)::int FROM banking_points p WHERE ST_Within(p.geom, a.geom))
      )
    ) AS feature
    FROM study_area a
    ORDER BY a.level, a.name`);
  res.json(featureCollection(rows.map(row => row.feature)));
});

app.get("/api/summary", async (req, res) => {
  const [totals, byBank, byTehsil] = await Promise.all([
    query(`SELECT COUNT(*)::int AS points,
                  COUNT(*) FILTER (WHERE facility_type = 'Branch')::int AS branches,
                  COUNT(*) FILTER (WHERE facility_type = 'ATM')::int AS atms,
                  COUNT(DISTINCT bank) FILTER (WHERE bank <> 'Not recorded')::int AS banks
           FROM banking_points`),
    query(`SELECT bank,
                  COUNT(*) FILTER (WHERE facility_type = 'Branch')::int AS branches,
                  COUNT(*) FILTER (WHERE facility_type = 'ATM')::int AS atms,
                  COUNT(*)::int AS total
           FROM banking_points GROUP BY bank
           ORDER BY bank = 'Not recorded', total DESC, bank`),
    query(`SELECT t.name AS tehsil, t.population_2023, COUNT(p.id)::int AS points
           FROM study_area t
           LEFT JOIN banking_points p ON ST_Within(p.geom, t.geom)
           WHERE t.level = 'Tehsil'
           GROUP BY t.name, t.population_2023
           ORDER BY points DESC, t.name`)
  ]);
  res.json({ ...totals.rows[0], byBank: byBank.rows, byTehsil: byTehsil.rows });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Express 5 forwards rejected promises here, so a database error returns JSON instead of crashing.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "The server could not read the database. Please try again." });
});

export default app;
