import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { insertRecruitingApplicationSchema } from "@shared/schema";
import { fmtCdlSince } from "@shared/cdl-tenure";

// GEICO asks "when was the CDL first issued?" for every CDL driver. On
// 2026-10-30 the application had no such field, so the answer had to be
// guessed from the card issue date on the driver's MVR. These tests pin the
// field end to end: validator, boot-time column, persist, and display.

const base = {
  dob: "1996-11-21",
  ssn: "123-45-6789",
  currentAddress: "1 Main St",
  currentCity: "Chattanooga",
  currentState: "TN",
  currentZip: "37421",
  driverLicenseNumber: "X1",
  driverLicenseState: "TN",
  driverLicenseClass: "CDL-A",
  driverLicenseExpiration: "2032-03-14",
  employmentHistory: [
    { employer: "Acme", position: "Driver", fromDate: "2024-03-01", toDate: "2026-10-01", reasonForLeaving: "Moved", wasDOT: true },
  ],
  accidents3yr: [],
  violations3yr: [],
  licenseSuspensionRevocation: false,
  licenseDenialEver: false,
  felonyConviction: false,
  failedDotDrugTestEver: false,
  failedDotAlcoholTestEver: false,
  authorizedToWorkInUs: true,
  isOwnerOperator: false,
  consentMvr: true,
  consentDrugTest: true,
  consentBackground: true,
  consentClearinghouse: true,
  consentPriorEmployerContact: true,
  applicantSignature: "Test Driver",
};

function parse(extra: Record<string, unknown>) {
  return insertRecruitingApplicationSchema.safeParse({ ...base, ...extra });
}

describe("cdlFirstIssued validator", () => {
  it("accepts YYYY-MM", () => {
    const r = parse({ cdlFirstIssued: "2024-03" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cdlFirstIssued).toBe("2024-03");
  });

  it("rejects other formats", () => {
    for (const bad of ["2024-13", "March 2024", "2024-3", "03/2024"]) {
      expect(parse({ cdlFirstIssued: bad }).success).toBe(false);
    }
  });

  it("stays optional so an older cached form still submits", () => {
    expect(parse({}).success).toBe(true);
  });
});

describe("fmtCdlSince", () => {
  it("shows month, year and time held", () => {
    expect(fmtCdlSince("2024-03", new Date(2026, 9, 30))).toBe("Mar 2024 · 2 yrs 7 mo");
  });
  it("returns null for missing or malformed input", () => {
    expect(fmtCdlSince(null)).toBeNull();
    expect(fmtCdlSince("2024-13")).toBeNull();
  });
});

describe("wiring (source-level)", () => {
  const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
  it("boot-time schema adds the column", () => {
    expect(read("../ensure-schema.ts")).toContain('["cdl_first_issued", "TEXT"]');
  });
  it("the application submit persists it", () => {
    expect(read("../recruiting/routes.ts")).toContain("cdlFirstIssued: app.cdlFirstIssued ?? null");
  });
  it("the form asks CDL drivers for it and blocks submit without it", () => {
    const form = read("../../client/src/pages/recruiting/application.tsx");
    expect(form).toContain('id="cdlFirstIssued"');
    expect(form).toContain("Add the month and year your CDL was first issued");
  });
});
