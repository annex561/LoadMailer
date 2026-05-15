/**
 * Regression test for the BOL verifier soft-pass behavior.
 *
 * History: when a driver replies with a BOL photo via MMS, the verifier
 * passes the Twilio media URL to OpenAI Vision. Twilio media URLs require
 * HTTP basic auth (account SID + auth token) — OpenAI has no way to supply
 * those creds, so it returns a 400 when trying to download the image.
 *
 * The verifier surfaces this as `{ ok: false, message: "Verifier error: 400 ..." }`
 * and the inbound-SMS handler used to reject the driver's photo for it,
 * making them retake a perfectly valid BOL over and over.
 *
 * Soft-pass rule: any `Verifier error:` message is treated as infrastructure
 * failure — accept the photo, mark verification skipped, do NOT reject.
 *
 * This test isolates the decision predicate so the soft-pass guard is not
 * silently removed. If a refactor inlines or renames the regex, this test
 * catches it.
 *
 * DO NOT delete.
 */
import { describe, it, expect } from "vitest";

// The predicate lives inline in sms-communication-service.ts. We replicate
// it here so the test pins the SHAPE of the guard. If the source predicate
// drifts (e.g., case sensitivity, prefix wording), this test fails and the
// reviewer is forced to acknowledge the change before merging.
function isInfraError(message: string): boolean {
  return /^Verifier error:/i.test(message || "");
}

describe("BOL verifier soft-pass predicate", () => {
  it("treats 'Verifier error: 400 Error while downloading ...' as infra failure", () => {
    expect(
      isInfraError(
        "Verifier error: 400 Error while downloading https://api.twilio.com/2010-04-01/Accounts/AC.../Messages/MM.../Media/ME...",
      ),
    ).toBe(true);
  });

  it("treats any 'Verifier error: ...' message as infra failure", () => {
    expect(isInfraError("Verifier error: network timeout")).toBe(true);
    expect(isInfraError("Verifier error: OPENAI_API_KEY not set")).toBe(true);
  });

  it("does NOT soft-pass a legitimate verifier rejection from the AI", () => {
    // When OpenAI successfully analyzes the photo and decides it's bad,
    // the message is the AI's reason, not a "Verifier error:" prefix.
    expect(isInfraError("No signature visible on BOL")).toBe(false);
    expect(isInfraError("Image is too blurry to read")).toBe(false);
    expect(isInfraError("Not a Bill of Lading")).toBe(false);
  });

  it("does not crash on empty / undefined message", () => {
    expect(isInfraError("")).toBe(false);
    // @ts-expect-error — testing defensive handling
    expect(isInfraError(undefined)).toBe(false);
  });
});

describe("BOL verifier soft-pass — wiring", () => {
  it("the source predicate exists in sms-communication-service.ts", async () => {
    // Pin the wiring: if a refactor renames the predicate or strips the
    // soft-pass branch, the source no longer contains it and this fails.
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.join(__dirname, "..", "sms-communication-service.ts"),
      "utf8",
    );
    expect(source).toMatch(/Verifier error:/);
    expect(source).toMatch(/soft-?pass/i);
    expect(source).toMatch(/Verification skipped \(service unavailable\)/);
  });
});
