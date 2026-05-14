/**
 * Regression test for the Approve & Dispatch driverId-from-body bug.
 *
 * History: the client's onApprove handler sends `{ driverId: driverId || null }`.
 * When the reviewer hadn't picked anything in the dropdown, the body became
 * `{ driverId: null }`. The route used `if (driverIdFromBody !== undefined)`
 * which fired the update with `null`, wiping the previously matched driver
 * on the intake. dispatchFromIntake() then short-circuited with
 * "No driver assigned" and the test load never went out via SMS.
 *
 * This test locks down the predicate that decides whether the body's
 * driverId should overwrite the persisted matchedDriverId. Only a real,
 * non-empty string should trigger persistence — null, undefined, and ""
 * are all "no change requested."
 *
 * If this test ever starts failing, somebody has loosened the predicate
 * again and a regression is imminent. DO NOT relax the assertions
 * without reading the comment above and proposing an alternative
 * approach to preserving previously-matched drivers.
 */

import { describe, it, expect } from "vitest";
// Import the EXACT predicate the route uses. Previously this test had its
// own inline copy — if the route diverged, the test would silently pass
// against the stale copy. Per code review feedback, the predicate is now
// exported from the route module and imported here.
import { shouldPersistDriverIdFromBody } from "../ratecon-intake-routes";

describe("approve-and-dispatch — driverId-from-body persistence predicate", () => {
  it("does NOT persist when body driverId is undefined", () => {
    expect(shouldPersistDriverIdFromBody(undefined)).toBe(false);
  });

  it("does NOT persist when body driverId is null", () => {
    // This is the bug case — client default was `driverId || null` so
    // unselected dropdown sent null and wiped the matched driver.
    expect(shouldPersistDriverIdFromBody(null)).toBe(false);
  });

  it("does NOT persist when body driverId is an empty string", () => {
    expect(shouldPersistDriverIdFromBody("")).toBe(false);
  });

  it("does NOT persist on non-string types (number, object, boolean)", () => {
    expect(shouldPersistDriverIdFromBody(0)).toBe(false);
    expect(shouldPersistDriverIdFromBody(false)).toBe(false);
    expect(shouldPersistDriverIdFromBody({})).toBe(false);
    expect(shouldPersistDriverIdFromBody([])).toBe(false);
  });

  it("DOES persist when body driverId is a real UUID-shaped string", () => {
    expect(
      shouldPersistDriverIdFromBody("aff10da8-b040-4cf5-8c19-54a665583d70"),
    ).toBe(true);
  });

  it("DOES persist on any non-empty string (we don't validate UUID shape here)", () => {
    expect(shouldPersistDriverIdFromBody("any-id")).toBe(true);
  });
});
