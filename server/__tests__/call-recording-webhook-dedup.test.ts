import { describe, it, expect } from "vitest";
import { shouldIngestRecording } from "../call-intake-service";

describe("recording dedup (regression)", () => {
  it("ingests when no existing row for the recordingSid", () => {
    expect(shouldIngestRecording(undefined)).toBe(true);
  });
  it("skips when a row already exists (idempotent on re-poll / Twilio retry)", () => {
    expect(shouldIngestRecording({ id: "existing" })).toBe(false);
  });
});
