-- Kohat Banks and ATMs: database schema
-- Run in an empty database, e.g.  CREATE DATABASE kohat_banks;
-- Running it again drops and recreates both tables.

CREATE EXTENSION IF NOT EXISTS postgis;

DROP VIEW IF EXISTS banking_points_view;
DROP TABLE IF EXISTS banking_points;
DROP TABLE IF EXISTS study_area;

-- District and tehsil outlines. Used for the map boundaries and to work out
-- which tehsil each point falls in.
CREATE TABLE study_area (
  id              serial PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  level           text NOT NULL CHECK (level IN ('District', 'Tehsil')),
  population_2023 integer CHECK (population_2023 > 0),
  osm_relation    bigint UNIQUE,
  geom            geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE banking_points (
  id             serial PRIMARY KEY,
  name           text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  bank           text NOT NULL,
  facility_type  text NOT NULL CHECK (facility_type IN ('Branch', 'ATM')),
  -- NULL means the source does not say whether the branch has an ATM.
  atm_on_site    boolean,
  address        text,
  locality       text NOT NULL,
  phone          text,
  opening_hours  text,
  source         text NOT NULL,
  source_ref     text,
  checked_on     date NOT NULL,
  geom           geometry(Point, 4326) NOT NULL,
  CONSTRAINT atm_flag_only_on_branches CHECK (facility_type = 'Branch' OR atm_on_site IS NULL)
);

-- GiST indexes make the spatial joins and nearest-neighbour searches use the index.
CREATE INDEX study_area_geom_idx ON study_area USING gist (geom);
CREATE INDEX banking_points_geom_idx ON banking_points USING gist (geom);
CREATE INDEX banking_points_bank_idx ON banking_points (bank);

-- The tehsil is never typed in. It comes from a point-in-polygon join, so a
-- moved point always reports the right tehsil.
CREATE VIEW banking_points_view AS
SELECT p.*, t.name AS tehsil
FROM banking_points p
LEFT JOIN study_area t
  ON t.level = 'Tehsil' AND ST_Within(p.geom, t.geom);
