import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import ws from "ws";
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
    neonConfig.webSocketConstructor = ws;
    pool = new NeonPool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 30000 });
    db = drizzleNeon({ client: pool, schema });
    console.log('🔌 DB: Using Neon serverless (WebSocket)');
  } else {
    // Standard Postgres (Railway, etc.) — use node-postgres
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 30000, ssl: { rejectUnauthorized: false } });
    db = drizzlePg(pool, { schema });
    console.log('🔌 DB: Using standard pg (node-postgres)');
  }
} else {
  pool = null;
  db = null;
}

export { pool, db };
