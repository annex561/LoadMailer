/**
 * Regression test for the pending_uploads table being missing in production.
 *
 * History: PR #94 shipped the MMS-upload feature with a Drizzle migration
 * (migrations/0003_mms_pending_uploads.sql) but the project doesn't run
 * Drizzle migrations at deploy time — it uses a runtime ensureSchema()
 * function that bootstraps tables idempotently on every boot. The
 * pending_uploads block was missing from ensureSchema, so the table never
 * existed in production. Every inbound MMS hit processMMSReply, the dedup
 * lookup against pending_uploads.fulfilled_message_sid threw a
 * DrizzleQueryError ("relation pending_uploads does not exist"), the
 * try/catch in /api/sms/webhook logged "MMS branch error (falling through
 * to legacy)", and the driver's BOL got routed to the old verifier path
 * which then rejected it with a Twilio 400 download error.
 *
 * This test asserts the source contains the CREATE TABLE for
 * pending_uploads. If a future refactor removes it (e.g., "Drizzle handles
 * migrations now"), this fails before the next driver loses 30 minutes.
 *
 * DO NOT delete.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("ensure-schema — pending_uploads regression", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "ensure-schema.ts"),
    "utf8",
  );

  it("contains CREATE TABLE IF NOT EXISTS pending_uploads", () => {
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS pending_uploads/);
  });

  it("declares the columns processMMSReply queries against", () => {
    // The dedup lookup hits fulfilled_message_sid (UNIQUE).
    expect(source).toMatch(/fulfilled_message_sid\s+TEXT\s+UNIQUE/);
    // findPendingForPhone reads driver_phone, expires_at, fulfilled_at.
    expect(source).toMatch(/driver_phone\s+TEXT\s+NOT\s+NULL/);
    expect(source).toMatch(/expires_at\s+TIMESTAMP\s+NOT\s+NULL/);
    expect(source).toMatch(/fulfilled_at\s+TIMESTAMP/);
    // createPendingUpload writes load_id, stage.
    expect(source).toMatch(/load_id\s+VARCHAR\s+NOT\s+NULL\s+REFERENCES\s+loads/);
    expect(source).toMatch(/stage\s+TEXT\s+NOT\s+NULL/);
  });

  it("creates the partial index used by findPendingForPhone", () => {
    expect(source).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_pending_uploads_phone_unfulfilled/,
    );
  });
});
