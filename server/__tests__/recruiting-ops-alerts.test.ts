import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { opsAlertsFor, opsRecipient, renderOpsAlert } from "../recruiting/ops-alerts";

// Regression guard for the "silent pipeline" bug (2026-10-30): three applicants
// passed pre-screening and one uploaded every document, and the operator was
// never told. Elijah's docs sat untouched for 11 days. Nothing in the funnel
// notified LAMP; every recruiting template went to the applicant.

const ON = { RECRUITING_ALERT_PHONE: "+12055550100", RECRUITING_ALERT_EMAIL: "ops@example.com" };

describe("opsAlertsFor", () => {
  it("is OFF by default: no alerts without RECRUITING_ALERT_PHONE/EMAIL", () => {
    expect(opsAlertsFor("PRESCREENED_PASS", {})).toEqual([]);
    expect(opsAlertsFor("DOCS_RECEIVED", {})).toEqual([]);
  });

  it("alerts on the two stages where the applicant waits on LAMP", () => {
    expect(opsAlertsFor("PRESCREENED_PASS", ON)).toEqual([
      { channel: "SMS", templateKey: "OPS_PRESCREEN_PASS_SMS" },
      { channel: "EMAIL", templateKey: "OPS_PRESCREEN_PASS_EMAIL" },
    ]);
    expect(opsAlertsFor("DOCS_RECEIVED", ON).map((a) => a.templateKey)).toEqual([
      "OPS_DOCS_RECEIVED_SMS",
      "OPS_DOCS_RECEIVED_EMAIL",
    ]);
  });

  it("stays quiet on every other stage", () => {
    for (const s of ["LEAD", "APPLIED", "DOCS_REQUESTED", "PRESCREENED_FAIL", "BACKGROUND_RUNNING", "ACTIVE"]) {
      expect(opsAlertsFor(s, ON)).toEqual([]);
    }
  });

  it("each channel switches on alone", () => {
    expect(opsAlertsFor("DOCS_RECEIVED", { RECRUITING_ALERT_EMAIL: "a@b.co" })).toEqual([
      { channel: "EMAIL", templateKey: "OPS_DOCS_RECEIVED_EMAIL" },
    ]);
  });
});

describe("opsRecipient", () => {
  it("routes OPS_ templates to the operator", () => {
    expect(opsRecipient("OPS_DOCS_RECEIVED_SMS", "SMS", ON)).toBe("+12055550100");
    expect(opsRecipient("OPS_PRESCREEN_PASS_EMAIL", "EMAIL", ON)).toBe("ops@example.com");
  });

  it("never redirects an applicant template to the operator", () => {
    expect(opsRecipient("DOCS_REQUEST_SMS", "SMS", ON)).toBeNull();
    expect(opsRecipient("DOCS_REQUESTED_EMAIL", "EMAIL", ON)).toBeNull();
  });
});

describe("renderOpsAlert", () => {
  it("names the driver, profile, phone and review link", () => {
    const r = renderOpsAlert("OPS_DOCS_RECEIVED_SMS", {
      first_name: "Elijah",
      last_name: "Williams",
      phone: "7069960217",
      has_cdl: true,
      years: 2,
      review_url: "https://traqiq.app/recruiting/abc",
    });
    expect(r.text).toBe(
      "LAMP driver alert: Elijah Williams uploaded all documents (CDL, 2 yrs). Call 7069960217. Review: https://traqiq.app/recruiting/abc"
    );
    expect(r.subject).toBe("Driver ready: Elijah Williams uploaded all documents");
  });

  it("never prints undefined when fields are missing", () => {
    const r = renderOpsAlert("OPS_PRESCREEN_PASS_SMS", { review_url: "https://traqiq.app/recruiting/x" });
    expect(r.text).not.toContain("undefined");
    expect(r.text).toContain("An applicant passed pre-screening");
  });
});

describe("wiring (source-level)", () => {
  const routes = readFileSync(join(__dirname, "../recruiting/routes.ts"), "utf8");
  const notif = readFileSync(join(__dirname, "../recruiting/notifications.ts"), "utf8");

  it("every stage change goes through queueOpsAlerts", () => {
    const fn = routes.slice(routes.indexOf("async function transitionStage"), routes.indexOf("export function registerRecruitingRoutes"));
    expect(fn).toContain("await queueOpsAlerts(applicationId, toStage)");
  });

  it("the queue processor picks up OPS_ templates", () => {
    expect(notif).toContain("LIKE 'OPS_%'");
  });

  it("queueOpsAlerts returns before any DB read when alerts are off", () => {
    const fn = notif.slice(notif.indexOf("export async function queueOpsAlerts"));
    expect(fn.indexOf("if (alerts.length === 0) return;")).toBeLessThan(fn.indexOf("db\n"));
  });
});
