import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.error(
    "⚠️  DATABASE_URL is not set. Database features will not work. " +
    "Add DATABASE_URL to your Railway environment variables."
  );
}

// Pool will only be used when DATABASE_URL is present
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    })
  : (null as unknown as Pool);

export const db = process.env.DATABASE_URL
  ? drizzle({ client: pool, schema })
  : (null as unknown as ReturnType<typeof drizzle>);
