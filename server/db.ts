import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error(
    "⚠️  DATABASE_URL is not set. Database features will not work. " +
    "Add DATABASE_URL to your Railway environment variables."
  );
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Detect if this is a Neon database (needs WebSocket) or standard Postgres (Railway, etc.)
const isNeon = DATABASE_URL.includes("neon.tech") || DATABASE_URL.includes("neon.database");

let pool: any;
let db: any;

if (DATABASE_URL) {
  if (isNeon) {
    // Neon serverless — use WebSocket
    const { Pool, neonConfig } = require('@neondatabase/serverless');
    const ws = require('ws');
    const { drizzle } = require('drizzle-orm/neon-serverless');
    neonConfig.webSocketConstructor = ws;
    pool = new Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 30000 });
    db = drizzle({ client: pool, schema });
    console.log('🔌 DB: Using Neon serverless (WebSocket)');
  } else {
    // Standard Postgres (Railway, etc.) — use node-postgres
    const { Pool: PgPool } = require('pg');
    const { drizzle } = require('drizzle-orm/node-postgres');
    pool = new PgPool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 30000, ssl: { rejectUnauthorized: false } });
    db = drizzle(pool, { schema });
    console.log('🔌 DB: Using standard pg (node-postgres)');
  }
} else {
  pool = null;
  db = null;
}

export { pool, db };
