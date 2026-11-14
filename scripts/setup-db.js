// Loads the schema and data into the database in DATABASE_URL.
// Same result as running the files in pgAdmin, for machines without psql.
import { readFile } from "node:fs/promises";
import { pool } from "../src/db.js";

for (const file of ["db/01_schema.sql", "db/02_study_area.sql", "db/03_banking_points.sql"]) {
  await pool.query(await readFile(file, "utf8"));
  console.log(`Ran ${file}`);
}
const { rows } = await pool.query("SELECT COUNT(*)::int AS points FROM banking_points");
console.log(`banking_points has ${rows[0].points} rows`);
await pool.end();
