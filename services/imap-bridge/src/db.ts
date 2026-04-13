import pg from 'pg';

import { config } from './config.js';

// Single shared pool. Explicitly disable SSL — host Postgres does not
// terminate TLS, and pg otherwise negotiates it.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: false,
  max: 5,
});
