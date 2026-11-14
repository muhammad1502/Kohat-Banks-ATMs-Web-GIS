import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

// TLS is set below, so an sslmode in a hosted provider's URL is dropped to keep the two from disagreeing.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);

export const pool = new pg.Pool({
  connectionString: url.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000
});

export const query = (text, params) => pool.query(text, params);
