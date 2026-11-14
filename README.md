# Kohat Banks and ATMs

A dynamic Web GIS of bank branches and ATMs in Kohat District, Khyber Pakhtunkhwa. The locations are stored in PostgreSQL with PostGIS, served by an Express API as GeoJSON, and drawn on a Leaflet map.

- **Course:** Web GIS Application, midterm project (Fall 2026)
- **Student:** Muhammad Abdullah (FA23-BRG-040), Department of Remote Sensing and GIS, COMSATS University Islamabad
- **Study area:** Kohat District (Kohat, Lachi, Gumbat and Dara Adam Khel tehsils)
- **Feature:** bank branches and ATMs, 24 points
- **Stack:** PostgreSQL 18, PostGIS 3.6, Node.js with Express 5 and node-postgres, Leaflet 1.9.4

## What it does

- Stores 24 points as `geometry(Point, 4326)` with bank, type, address, locality, phone, hours and source
- Stores the district and tehsil outlines as `geometry(MultiPolygon, 4326)` with 2023 census population
- Works out each point's tehsil with a point-in-polygon join (`ST_Within`) in a view, so it is never typed by hand
- Express API with filters by type, bank, tehsil and name, plus a nearest-point search (`<->` KNN with distances from the geography type)
- Leaflet map with street and satellite basemaps, a legend, pop-ups for every point and tehsil, and a result list
- Light and dark themes

## Project layout

```
data/kohat-banks-atms.csv         the collected dataset (24 rows)
data/kohat-boundaries.geojson     district and tehsil outlines
db/01_schema.sql                  tables, constraints, indexes and the view
db/02_study_area.sql              loads the outlines
db/03_banking_points.sql          loads the 24 points
db/04_queries.sql                 checks and example spatial queries
src/app.js                        the API
src/db.js                         PostgreSQL connection pool
server.js                         local server for the API and the website
public/                           the website (HTML, CSS, JavaScript, Leaflet)
api/index.js                      entry point if deployed on Vercel
```

## Run it locally

1. In pgAdmin or psql, create the database and run the SQL files in order:

   ```sql
   CREATE DATABASE kohat_banks;
   \c kohat_banks
   \i db/01_schema.sql
   \i db/02_study_area.sql
   \i db/03_banking_points.sql
   ```

   `01_schema.sql` runs `CREATE EXTENSION postgis`, so PostGIS must be installed with PostgreSQL (Stack Builder on Windows).

2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your database, for example
   `postgresql://postgres:your-password@localhost:5432/kohat_banks`.
3. Run `npm install`, then `npm run dev`, and open http://localhost:3000.

`npm run db:setup` loads the three SQL files through Node instead of psql.

## API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/points?type=&bank=&tehsil=&q=` | Points as a GeoJSON FeatureCollection. `type` is `Branch` or `ATM`. |
| GET | `/api/points/:id` | One point as a GeoJSON Feature |
| GET | `/api/nearest?lat=&lng=&limit=&type=&bank=` | The closest points with `distance_m`, and whether the location is inside the district |
| GET | `/api/study-area` | District and tehsil outlines with population, area in km² and point count |
| GET | `/api/summary` | Totals and counts by bank and tehsil |
| GET | `/api/health` | PostgreSQL and PostGIS versions and the row count |

All queries use numbered parameters (`$1`, `$2`), so text from the browser is never pasted into SQL.

## Data

Collected on 13 November 2026.

| Source | Used for | Points |
| --- | --- | --- |
| HBL branch locator (hbl.com) | Branch names and coordinates | 12 |
| Allied Bank locator (abl.com) | Branches and off-site ATMs with address, phone and hours | 7 |
| OpenStreetMap, Overpass API | `amenity=bank` and `amenity=atm` features | 5 |
| OpenStreetMap boundary relations | District and tehsil outlines | 5 polygons |
| Pakistan Bureau of Statistics | 2023 census population by tehsil | |

Checks before loading:

- Every point was tested with `ST_Within` against the district outline. Two Allied Bank listings (Bannu Road and Hangu Road branches) were left out because their published coordinates fall outside Kohat District.
- Three HBL banks mapped in OpenStreetMap were within 60 m of HBL locator points and were merged with them.
- Empty fields mean the source did not give that detail.

OpenStreetMap data © OpenStreetMap contributors, available under the Open Database Licence. Satellite imagery © Esri. Leaflet is BSD-2-Clause licensed (`public/vendor/leaflet/LICENSE.txt`).
