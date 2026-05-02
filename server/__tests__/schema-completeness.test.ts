import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression preventer for the bug that hit production on 2026-05-01:
 *
 *   PR #39 added 4 columns to the drivers Drizzle schema (sms_consent_at,
 *   sms_consent_source, sms_consent_ip, sms_opted_out_at). The schema file
 *   was correct, but ensure-schema.ts wasn't updated to ALTER TABLE for the
 *   new columns. After deploy, every SELECT * FROM drivers failed in prod
 *   with "column does not exist" because the boot-time migration never ran
 *   the ADD COLUMN statements.
 *
 * Fix shipped in PR #41. This test is the guardrail: it asserts that every
 * snake_case column declared on the drivers table in shared/schema.ts is
 * also present in server/ensure-schema.ts. Adding a new driver column
 * without registering it in ensure-schema.ts will now break CI.
 *
 * The test parses both files as text instead of importing them — that
 * keeps it dependency-free (no Drizzle runtime, no DB) and means it
 * works in any environment.
 */

const SCHEMA_PATH = resolve(__dirname, "../../shared/schema.ts");
const ENSURE_SCHEMA_PATH = resolve(__dirname, "../ensure-schema.ts");

/**
 * Extract snake_case column names from the `drivers` pgTable block in
 * shared/schema.ts. Looks for patterns like:
 *   varchar("company_id"), text("name"), boolean("is_onboarded"),
 *   timestamp("sms_consent_at"), integer("max_length"), etc.
 */
function extractColumnsFromTableBlock(tableName: string): string[] {
  const src = readFileSync(SCHEMA_PATH, "utf8");
  // pgTable definitions end with either `\n});` (no indexes) OR
  // `\n}, (table) => [...indexes...]);`. We want the body of the columns
  // object only — match up to the first `\n}` followed by either `)` or `,`.
  const re = new RegExp(
    `export const ${tableName}\\s*=\\s*pgTable\\("${tableName}", \\{([\\s\\S]*?)\\n\\}(?:,|\\))`,
  );
  const tableMatch = src.match(re);
  if (!tableMatch) {
    throw new Error(`Could not locate \`${tableName}\` pgTable block in shared/schema.ts`);
  }
  const block = tableMatch[1];
  const columnRegex = /(?:varchar|text|integer|boolean|timestamp|real|jsonb|serial|bigint|date|numeric|pgEnum|[A-Za-z_]+Enum)\s*\(\s*"([a-z_][a-z0-9_]*)"/g;
  const cols = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = columnRegex.exec(block))) {
    cols.add(m[1]);
  }
  return Array.from(cols);
}

function extractDriverColumnsFromSchema(): string[] {
  return extractColumnsFromTableBlock("drivers");
}

function extractLoadColumnsFromSchema(): string[] {
  return extractColumnsFromTableBlock("loads");
}

/**
 * Extract column names from the `columns` array in server/ensure-schema.ts.
 * Lines look like:    ['sms_consent_at', 'TIMESTAMP'],
 */
function extractColumnArrayFromEnsureSchema(constName: string): string[] {
  const src = readFileSync(ENSURE_SCHEMA_PATH, "utf8");
  const re = new RegExp(
    `const ${constName}:\\s*\\[string,\\s*string\\]\\[\\]\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`,
  );
  const block = src.match(re);
  if (!block) {
    throw new Error(`Could not locate \`const ${constName}\` array in server/ensure-schema.ts`);
  }
  const lineRegex = /\[\s*'([a-z_][a-z0-9_]*)'\s*,/g;
  const cols = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(block[1]))) {
    cols.add(m[1]);
  }
  return Array.from(cols);
}

function extractDriverColumnsFromEnsureSchema(): string[] {
  return extractColumnArrayFromEnsureSchema("columns");
}

function extractLoadColumnsFromEnsureSchema(): string[] {
  return extractColumnArrayFromEnsureSchema("loadsColumns");
}

/**
 * Columns that don't need to be in ensure-schema.ts because they exist on
 * the original CREATE TABLE (the table was created with these from day 1).
 * If you add a NEW column to drivers in schema.ts, it MUST appear in
 * ensure-schema.ts — that's what this test enforces.
 */
const ORIGINAL_DRIVER_COLUMNS = new Set([
  "id",
  "name",
  "email",
  "phone",
  "status",
  "license_number",
  "emergency_phone", // declared as `emergency_phone` from the start
  "is_onboarded",
  "created_at",
  "updated_at",
]);

// Columns that have always existed on the loads table since CREATE TABLE.
// Anything else added in the Drizzle schema MUST also appear in
// server/ensure-schema.ts loadsColumns array, or INSERT INTO loads will
// fail in production with "column does not exist".
const ORIGINAL_LOAD_COLUMNS = new Set([
  "id",
  "load_number",
  "customer_id",
  "driver_id",
  "status",
  "created_at",
  "updated_at",
  "lifecycle_status", // pgEnum — created via CREATE TYPE during initial migration
]);

describe("schema completeness — drivers table", () => {
  it("every column added to drivers schema.ts is registered in ensure-schema.ts", () => {
    const schemaCols = extractDriverColumnsFromSchema();
    const ensureCols = extractDriverColumnsFromEnsureSchema();
    const ensureSet = new Set(ensureCols);

    const missing = schemaCols.filter(
      (c) => !ORIGINAL_DRIVER_COLUMNS.has(c) && !ensureSet.has(c),
    );

    if (missing.length > 0) {
      throw new Error(
        `\n❌ The following drivers columns are declared in shared/schema.ts but NOT registered\n` +
          `   in server/ensure-schema.ts. After deploy, queries against the drivers table will fail\n` +
          `   in production with "column does not exist" — exactly the bug PR #41 fixed.\n\n` +
          `   Missing columns: ${missing.join(", ")}\n\n` +
          `   FIX: add each missing column to the \`columns\` array in server/ensure-schema.ts\n` +
          `   with an appropriate type, e.g. ['my_new_column', 'TEXT'] or ['my_ts', 'TIMESTAMP'].\n`,
      );
    }

    expect(missing).toEqual([]);
  });

  it("the four A2P 10DLC consent columns from PR #39 are present in ensure-schema (sanity check)", () => {
    const ensureCols = extractDriverColumnsFromEnsureSchema();
    expect(ensureCols).toContain("sms_consent_at");
    expect(ensureCols).toContain("sms_consent_source");
    expect(ensureCols).toContain("sms_consent_ip");
    expect(ensureCols).toContain("sms_opted_out_at");
  });
});

describe("schema completeness — loads table", () => {
  it("every column added to loads schema.ts is registered in ensure-schema.ts loadsColumns", () => {
    const schemaCols = extractLoadColumnsFromSchema();
    const ensureCols = extractLoadColumnsFromEnsureSchema();
    const ensureSet = new Set(ensureCols);

    const missing = schemaCols.filter(
      (c) => !ORIGINAL_LOAD_COLUMNS.has(c) && !ensureSet.has(c),
    );

    if (missing.length > 0) {
      throw new Error(
        `\n❌ The following loads columns are declared in shared/schema.ts but NOT registered\n` +
          `   in server/ensure-schema.ts loadsColumns. INSERT INTO loads will fail in production\n` +
          `   with "column does not exist".\n\n` +
          `   Missing columns: ${missing.join(", ")}\n\n` +
          `   FIX: add each missing column to the \`loadsColumns\` array in server/ensure-schema.ts\n` +
          `   with an appropriate type, e.g. ['my_new_column', 'TEXT'] or ['my_ts', 'TIMESTAMP'].\n`,
      );
    }

    expect(missing).toEqual([]);
  });

  it("critical loads columns from prod-error are registered in ensure-schema (sanity check)", () => {
    // The user hit "Failed query: insert into loads (..., pickup_address, pickup_date,
    // pickup_time, delivery_address, delivery_date, delivery_time, special_instructions,
    // status, load_type, length, equipment_type, ...)" in production. Each of these
    // must be present in the loadsColumns array.
    const ensureCols = extractLoadColumnsFromEnsureSchema();
    const required = [
      "description", "priority", "pickup_address", "pickup_date", "pickup_time",
      "delivery_address", "delivery_date", "delivery_time", "special_instructions",
      "load_type", "length", "equipment_type", "temperature_required",
      "min_temperature", "max_temperature", "temperature_unit", "expires_at",
      "is_expired", "rate", "miles", "weight", "company", "broker_name",
    ];
    for (const col of required) {
      expect(ensureCols, `Missing critical loads column: ${col}`).toContain(col);
    }
  });
});
