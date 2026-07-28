const { Pool } = require('pg');

// DATABASE_URL is provided automatically by Render when you attach a Postgres
// instance to a service. Locally, put it in a .env file (see .env.example).
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('[DB] Missing DATABASE_URL environment variable.');
}

// Render Postgres requires SSL, but its cert chain isn't in most default
// trust stores, so we relax verification rather than fail every connection.
// This is standard practice for Render/Heroku-style managed Postgres.
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

module.exports = { pool };
