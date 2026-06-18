import { describe, it, expect } from "vitest";
import { SMS_TEMPLATES } from "../recruiting/sms-templates";

// Regression guard for the "Thanks Annex to LAMP Logistics" copy bug.
// Old template: `Thanks ${first_name || "for applying"} to LAMP Logistics`
// rendered "Thanks Annex to LAMP Logistics" when a first name was present —
// grammatically broken, and it's the first message every applicant receives.
describe("recruiting LEAD_CAPTURE_SMS copy", () => {
  it("greets a named applicant grammatically", () => {
    const t = SMS_TEMPLATES.LEAD_CAPTURE_SMS({
      first_name: "Annex",
      app_url: "https://traqiq.app/apply/abc",
    }).text;
    expect(t).toContain("Hi Annex, thanks for applying to LAMP Logistics");
    expect(t).not.toContain("Annex to LAMP Logistics"); // the old bug
    expect(t).toContain("https://traqiq.app/apply/abc");
    expect(t).toContain("Reply STOP");
  });

  it("handles a missing first name without printing 'undefined'", () => {
    const t = SMS_TEMPLATES.LEAD_CAPTURE_SMS({}).text;
    expect(t).toContain("Hi there, thanks for applying to LAMP Logistics");
    expect(t).not.toContain("undefined");
  });
});
