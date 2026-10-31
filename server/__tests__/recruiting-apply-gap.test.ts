import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { insertRecruitingLeadSchema } from "@shared/schema";
import { screenFlags } from "@shared/driver-screen";
import { renderOpsAlert } from "../recruiting/ops-alerts";

// On 2026-10-30 Elijah Williams passed pre-screening with tickets on his
// record, and GEICO quoted +$9,128/yr to add him. The box-truck page told
// drivers "more than 2 moving violations" disqualifies, but Annex's rule is
// zero, the MVR was not a required upload, and nothing asked about DUIs or
// being out 2-3 weeks. These tests pin the fix end to end.

const lead = {
  firstName: "Test",
  lastName: "Driver",
  phone: "4235551234",
  email: "t@example.com",
  consentSms: true,
};

describe("lead schema screen answers", () => {
  it("accepts the four answers", () => {
    const r = insertRecruitingLeadSchema.safeParse({
      ...lead, anyViolations3yr: true, anyDuiEver: false, okAwayWeeks: true, experienceVehicle: "box_truck",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown vehicle", () => {
    expect(insertRecruitingLeadSchema.safeParse({ ...lead, experienceVehicle: "bus" }).success).toBe(false);
  });
  it("stays optional so the other landing pages still submit", () => {
    expect(insertRecruitingLeadSchema.safeParse(lead).success).toBe(true);
  });
});

describe("screenFlags", () => {
  it("flags each broken requirement", () => {
    expect(screenFlags({ anyViolations3yr: true, anyDuiEver: true, okAwayWeeks: false, experienceVehicle: "none" }))
      .toEqual(["violation in last 3 yrs", "DUI", "not OK 2-3 wks out", "no truck experience"]);
  });
  it("does not flag a clean driver or unanswered questions", () => {
    expect(screenFlags({ anyViolations3yr: false, anyDuiEver: false, okAwayWeeks: true, experienceVehicle: "semi" })).toEqual([]);
    expect(screenFlags({})).toEqual([]);
  });
});

describe("operator alert carries the flags", () => {
  const base = { first_name: "Elijah", last_name: "Williams", phone: "7065550000", has_cdl: true, years: 2, review_url: "https://traqiq.app/recruiting/x" };
  it("adds FLAG text when a requirement is broken", () => {
    const t = renderOpsAlert("OPS_DOCS_RECEIVED_SMS", { ...base, any_violations_3yr: true }).text;
    expect(t).toContain("FLAG: violation in last 3 yrs.");
  });
  it("is unchanged for applicants who never saw the questions", () => {
    expect(renderOpsAlert("OPS_DOCS_RECEIVED_SMS", base).text).not.toContain("FLAG");
  });
  it("stays plain ASCII so the SMS keeps 160-char segments", () => {
    const t = renderOpsAlert("OPS_PRESCREEN_PASS_SMS", {
      ...base, any_violations_3yr: true, any_dui_ever: true, ok_away_weeks: false, experience_vehicle: "none",
    }).text;
    expect(/^[\x20-\x7E]*$/.test(t)).toBe(true);
  });
});

describe("wiring (source-level)", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  it("MVR is a required document for company drivers and owner-operators", () => {
    const routes = read("../recruiting/routes.ts");
    for (const list of ["REQUIRED_DOCS_OWNER_OP", "REQUIRED_DOCS_COMPANY"]) {
      const block = routes.slice(routes.indexOf(`const ${list} = [`), routes.indexOf("];", routes.indexOf(`const ${list} = [`)));
      expect(block).toContain('"MVR"');
    }
    expect(read("../../client/src/pages/recruiting/documents.tsx")).toContain("MVR:");
  });
  it("boot-time schema adds the columns and the lead submit persists them", () => {
    const ensure = read("../ensure-schema.ts");
    for (const c of ["any_violations_3yr", "any_dui_ever", "ok_away_weeks", "experience_vehicle"]) {
      expect(ensure).toContain(`["${c}",`);
    }
    expect(read("../recruiting/routes.ts")).toContain("anyViolations3yr: anyViolations3yr ?? null");
  });
  it("the box-truck page states Annex's rules and asks the questions", () => {
    const src = read("../../client/src/pages/recruiting/landing.tsx");
    const block = src.slice(src.indexOf('"/box-truck-driver-jobs": {'), src.indexOf('"/lease-on-trucking-jobs"'));
    expect(block).toContain("screenQuestions: true");
    expect(block).toContain("No moving violations in the last 3 years");
    expect(block).toContain("2–3 weeks a month");
    expect(block).toContain("per loaded mile");
    expect(block).not.toMatch(/40–45¢ (a|per) mile/);
    expect(block).not.toContain("more than 2 moving violations");
  });
});
