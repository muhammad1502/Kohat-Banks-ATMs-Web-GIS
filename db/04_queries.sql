-- Queries for checking the data and for the demonstration.
-- Run them in pgAdmin's Query Tool or psql after loading 01 to 03.

-- PostGIS version
SELECT PostGIS_Full_Version();

-- All points with readable coordinates
SELECT id, name, bank, facility_type, tehsil,
       ROUND(ST_Y(geom)::numeric, 6) AS latitude,
       ROUND(ST_X(geom)::numeric, 6) AS longitude
FROM banking_points_view
ORDER BY tehsil, name;

-- Quality check: every point must lie inside the district outline (expects 0 rows)
SELECT p.id, p.name
FROM banking_points p
WHERE NOT EXISTS (
  SELECT 1 FROM study_area d
  WHERE d.level = 'District' AND ST_Within(p.geom, d.geom)
);

-- Quality check: possible duplicates, any two points closer than 60 m
SELECT a.name, b.name, ROUND(ST_Distance(a.geom::geography, b.geom::geography)) AS metres
FROM banking_points a
JOIN banking_points b ON a.id < b.id
WHERE ST_DWithin(a.geom::geography, b.geom::geography, 60);

-- Count by bank and type
SELECT bank,
       COUNT(*) FILTER (WHERE facility_type = 'Branch') AS branches,
       COUNT(*) FILTER (WHERE facility_type = 'ATM') AS atms,
       COUNT(*) AS total
FROM banking_points
GROUP BY bank
ORDER BY total DESC, bank;

-- Points per tehsil and people per banking point (spatial join)
SELECT t.name AS tehsil,
       t.population_2023,
       COUNT(p.id) AS points,
       ROUND(t.population_2023::numeric / NULLIF(COUNT(p.id), 0)) AS people_per_point
FROM study_area t
LEFT JOIN banking_points p ON ST_Within(p.geom, t.geom)
WHERE t.level = 'Tehsil'
GROUP BY t.name, t.population_2023
ORDER BY points DESC;

-- Area of each outline in square kilometres (geography gives metres on the ellipsoid)
SELECT name, level, ROUND((ST_Area(geom::geography) / 1e6)::numeric, 1) AS area_km2
FROM study_area
ORDER BY level, name;

-- Three nearest points to the south portal of Kohat Tunnel (KNN with the <-> operator)
SELECT name, bank, facility_type,
       ROUND(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(71.5364, 33.6308), 4326)::geography)) AS metres
FROM banking_points
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(71.5364, 33.6308), 4326)
LIMIT 3;

-- ATMs within 2 km of the HBL Kohat Cantt Branch
SELECT b.name, ROUND(ST_Distance(a.geom::geography, b.geom::geography)) AS metres
FROM banking_points a
JOIN banking_points b ON b.facility_type = 'ATM'
WHERE a.name = 'HBL Kohat Cantt Branch'
  AND ST_DWithin(a.geom::geography, b.geom::geography, 2000)
ORDER BY metres;

-- One record as GeoJSON, the format the API sends to the website
SELECT ST_AsGeoJSON(geom) FROM banking_points WHERE id = 1;
