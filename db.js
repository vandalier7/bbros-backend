const { Pool } = require('pg');
require('dotenv').config();

console.log('[db] DEBUG - loaded config:', {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  passwordLength: (process.env.DB_PASSWORD || '').length,
  database: process.env.DB_NAME,
});

// One shared connection pool for the whole app. Routes/stores import this
// instead of each opening their own connection.
//
// Supabase's Postgres requires SSL for external connections; `rejectUnauthorized:
// false` is the standard approach for Supabase specifically since their cert
// chain isn't always in Node's default trust store. This is fine for a
// trusted-server-to-managed-db connection like this one.
// Discrete fields instead of a single connectionString — avoids an issue
// where pg's URL parser can mishandle the dotted pooler username
// (postgres.<project-ref>) depending on encoding/version.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('[db] unexpected error on idle client', err);
});

module.exports = pool;