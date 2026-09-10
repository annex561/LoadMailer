import { describe, it, expect } from "vitest";
import { assertTemplateConfigSafe, isDemoTemplateName } from "../recruiting/vendors";

// Regression guard for the DocuSeal template misconfiguration.
//
// Original failure: DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID and DOCUSEAL_OWNER_OP_TEMPLATE_ID
// were BOTH set to 8, which is DocuSeal's shipped sample "Independent Contractor
// Agreement (DEMO)" — three unnamed fields and one generic signer. Stage 7 would have sent
// a real driver a demo document, and it looks plausible enough that he would have signed
// it. Nothing in the code objected.
//
// These tests fail on the old code (no guard existed) and pass on the new.
// See docs/FIX-LEDGER.md, "Recruiting Stage 7 points both driver types at a DocuSeal
// demo template".

describe("isDemoTemplateName", () => {
  it("flags DocuSeal's shipped sample templates", () => {
    expect(isDemoTemplateName("Independent Contractor Agreement (DEMO)")).toBe(true);
    expect(isDemoTemplateName("Real Estate Purchase Agreement (DEMO)")).toBe(true);
    expect(isDemoTemplateName("sample lease")).toBe(true);
    expect(isDemoTemplateName("Test Template")).toBe(true);
  });

  it("leaves the real packets alone", () => {
    expect(isDemoTemplateName("LAMP Driver Onboarding — 1099 Contractor")).toBe(false);
    expect(isDemoTemplateName("LAMP Owner-Operator Onboarding — Lease-On")).toBe(false);
    expect(isDemoTemplateName("Road Test Certificate or CDL in Lieu (carrier)")).toBe(false);
  });

  it("does not false-positive on words that merely contain 'demo'", () => {
    expect(isDemoTemplateName("Demographic Data Release")).toBe(false);
    expect(isDemoTemplateName("Attestation of Demolition Haul")).toBe(false);
  });

  it("tolerates a missing name rather than throwing", () => {
    expect(isDemoTemplateName(null)).toBe(false);
    expect(isDemoTemplateName(undefined)).toBe(false);
    expect(isDemoTemplateName("")).toBe(false);
  });
});

describe("assertTemplateConfigSafe", () => {
  const good = {
    companyDriverTemplateId: "11",
    ownerOpTemplateId: "13",
    templateId: "11",
    templateName: "LAMP Driver Onboarding — 1099 Contractor",
  };

  it("passes the current, correct production configuration", () => {
    expect(() => assertTemplateConfigSafe(good)).not.toThrow();
  });

  it("throws when both driver types point at the same template", () => {
    // The exact original bug: both env vars were 8.
    expect(() =>
      assertTemplateConfigSafe({
        companyDriverTemplateId: "8",
        ownerOpTemplateId: "8",
        templateId: "8",
        templateName: "Independent Contractor Agreement (DEMO)",
      })
    ).toThrow(/both/i);
  });

  it("throws when the resolved template is a demo, even if the ids differ", () => {
    expect(() =>
      assertTemplateConfigSafe({
        companyDriverTemplateId: "8",
        ownerOpTemplateId: "13",
        templateId: "8",
        templateName: "Independent Contractor Agreement (DEMO)",
      })
    ).toThrow(/sample template/i);
  });

  it("still sends when the template name could not be looked up", () => {
    // A DocuSeal read failure must not block a legitimate signature request.
    expect(() => assertTemplateConfigSafe({ ...good, templateName: null })).not.toThrow();
  });

  it("does not fire on collision when only one driver type is configured", () => {
    expect(() =>
      assertTemplateConfigSafe({
        companyDriverTemplateId: "11",
        ownerOpTemplateId: "",
        templateId: "11",
        templateName: "LAMP Driver Onboarding — 1099 Contractor",
      })
    ).not.toThrow();
  });

  it("treats whitespace-padded env values as equal", () => {
    expect(() =>
      assertTemplateConfigSafe({
        companyDriverTemplateId: " 11 ",
        ownerOpTemplateId: "11",
        templateId: "11",
        templateName: "LAMP Driver Onboarding — 1099 Contractor",
      })
    ).toThrow(/both/i);
  });
});
