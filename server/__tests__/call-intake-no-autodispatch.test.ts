/**
 * Regression guard for I-1: a call-sourced intake must NEVER auto-dispatch.
 *
 * History: the PATCH handler in ratecon-intake-routes.ts auto-dispatches an
 * intake when a driver is assigned and there are no error-severity validator
 * failures. A call-sourced intake (sourceType === "call") carries
 * `validatorFailures: null`, so the original `failures.some(...)` error check
 * passed and the intake slipped straight through to dispatchFromIntake() — which
 * fires real Twilio SMS. Call data comes from a phone transcript, not a
 * validated RateCon, so it must always stay in the review queue.
 *
 * isAutoDispatchEligible() is the route-level guard. This test pins it. The
 * dispatch-service early-return (sourceType === "call") is the defense-in-depth
 * backstop. Do NOT relax these assertions without reading I-1 in the PR.
 */

import { describe, it, expect } from "vitest";
import { isAutoDispatchEligible } from "../ratecon-intake-routes";

describe("isAutoDispatchEligible — call intakes never auto-dispatch (I-1 regression)", () => {
  it("returns false for a call-sourced intake even with null failures and a clean status", () => {
    expect(
      isAutoDispatchEligible({ sourceType: "call", status: "in_review", validatorFailures: null }),
    ).toBe(false);
  });

  it("returns false for a call-sourced intake even with zero failures and no status", () => {
    expect(isAutoDispatchEligible({ sourceType: "call", validatorFailures: [] })).toBe(false);
  });

  it("returns true for an email-sourced intake with no validator failures", () => {
    expect(
      isAutoDispatchEligible({ sourceType: "email", status: "in_review", validatorFailures: [] }),
    ).toBe(true);
  });

  it("returns true for an email-sourced intake with only a warning-severity failure", () => {
    expect(
      isAutoDispatchEligible({
        sourceType: "email",
        status: "in_review",
        validatorFailures: [{ severity: "warning" }],
      }),
    ).toBe(true);
  });

  it("returns false for an email-sourced intake that has an error-severity failure", () => {
    expect(
      isAutoDispatchEligible({
        sourceType: "email",
        status: "in_review",
        validatorFailures: [{ severity: "warning" }, { severity: "error" }],
      }),
    ).toBe(false);
  });

  it("returns false for an intake already auto_dispatched", () => {
    expect(
      isAutoDispatchEligible({ sourceType: "email", status: "auto_dispatched", validatorFailures: [] }),
    ).toBe(false);
  });

  it("returns false for an intake already dispatched", () => {
    expect(
      isAutoDispatchEligible({ sourceType: "email", status: "dispatched", validatorFailures: [] }),
    ).toBe(false);
  });

  it("returns true for an upload-sourced intake with null failures (unaffected by the call guard)", () => {
    expect(
      isAutoDispatchEligible({ sourceType: "upload", status: "in_review", validatorFailures: null }),
    ).toBe(true);
  });
});
