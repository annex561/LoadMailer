/**
 * Regression test for the loads_customer_company_fk violation in
 * dispatchFromIntake (caught during the 2026-05-31 full-run production test).
 *
 * THE BUG:
 *   loads has a composite FK: loads_customer_company_fk → customers(id, company_id).
 *   dispatchFromIntake resolved the customer by broker NAME only:
 *       .where(eq(customers.name, brokerName))
 *   When a same-named customer (e.g. "TQL") already existed under a DIFFERENT
 *   company, the load was built as (thatCustomerId, loadCompanyId) — a pair
 *   that does not exist in customers — and the INSERT failed with:
 *       insert or update on table "loads" violates foreign key constraint
 *       "loads_customer_company_fk"
 *   So NO load was created and the whole dispatch silently failed. TQL is one
 *   of the most common brokers, so this bit real loads, not just the test.
 *
 *   Second bug: auto-created customers used intake.companyId instead of the
 *   load's canonical company, so even a fresh customer could mismatch.
 *
 * THE FIX (server/ratecon-dispatch-service.ts):
 *   - look up the customer scoped to the load's company
 *     (name AND company_id IS NOT DISTINCT FROM loadCompanyId)
 *   - create the customer under that same company
 *   - the load insert uses the identical loadCompanyId
 *
 * This test asserts the source enforces company-scoped customer resolution.
 * It FAILS on the old name-only code and PASSES on the fixed code.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "ratecon-dispatch-service.ts"),
  "utf8",
);

describe("dispatchFromIntake — customer/company FK consistency", () => {
  it("scopes the customer lookup by company, not name alone", () => {
    // The dangerous old pattern: a customers query filtered ONLY by name.
    // We assert the company column participates in the customer WHERE clause.
    const hasCompanyScopedLookup =
      /customers\.companyId\s*\}\s*IS NOT DISTINCT FROM/.test(SRC) ||
      /eq\(\s*customers\.companyId/.test(SRC);
    expect(
      hasCompanyScopedLookup,
      "customer lookup must be scoped to the load's company to satisfy loads_customer_company_fk",
    ).toBe(true);
  });

  it("does NOT look up a customer by name only", () => {
    // The exact old line was:
    //   .where(eq(customers.name, brokerName))
    // with no company predicate. If that bare pattern reappears as the sole
    // filter, the FK bug is back.
    const nameOnly = /\.where\(\s*eq\(customers\.name,\s*brokerName\)\s*\)/.test(SRC);
    expect(nameOnly, "customer lookup must not filter by name alone").toBe(false);
  });

  it("creates new customers under the load's company (loadCompanyId)", () => {
    // The fix introduces a single loadCompanyId used for BOTH the customer
    // and the load, so the pair always exists in customers.
    expect(SRC).toMatch(/const loadCompanyId\s*=/);
    // The customer insert must use loadCompanyId, not intake.companyId.
    const insertBlock = SRC.slice(SRC.indexOf(".insert(customers)"));
    expect(insertBlock).toMatch(/companyId:\s*loadCompanyId/);
  });

  it("inserts the load under the same loadCompanyId as the customer", () => {
    const loadValuesBlock = SRC.slice(SRC.indexOf("const loadValues"));
    expect(loadValuesBlock).toMatch(/companyId:\s*loadCompanyId/);
  });
});
