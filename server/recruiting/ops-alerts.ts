// Operator alerts for the recruiting funnel: tell LAMP when an applicant is
// waiting on us (passed pre-screening, or uploaded every document).
// Pure functions, zero side effects, so they are unit-testable without the
// DB / Twilio / Vite import chain. Imported by server/recruiting/notifications.ts.
// Regression test: server/__tests__/recruiting-ops-alerts.test.ts
import type { TemplateRender } from "./sms-templates";
import { screenFlags } from "@shared/driver-screen";

type Env = Record<string, string | undefined>;
export type OpsAlert = { channel: "SMS" | "EMAIL"; templateKey: string };

// Stages where the next move is LAMP's, not the driver's.
const ALERT_STAGES: Record<string, string> = {
  PRESCREENED_PASS: "OPS_PRESCREEN_PASS",
  DOCS_RECEIVED: "OPS_DOCS_RECEIVED",
};

// Default OFF: nothing is queued until RECRUITING_ALERT_PHONE and/or
// RECRUITING_ALERT_EMAIL is set. Unsetting either one is that channel's kill switch.
export function opsAlertsFor(toStage: string, env: Env): OpsAlert[] {
  const base = ALERT_STAGES[toStage];
  if (!base) return [];
  const alerts: OpsAlert[] = [];
  if (env.RECRUITING_ALERT_PHONE) alerts.push({ channel: "SMS", templateKey: `${base}_SMS` });
  if (env.RECRUITING_ALERT_EMAIL) alerts.push({ channel: "EMAIL", templateKey: `${base}_EMAIL` });
  return alerts;
}

// Only OPS_ templates go to the operator; applicant templates never do.
export function opsRecipient(templateKey: string, channel: "SMS" | "EMAIL", env: Env): string | null {
  if (!templateKey.startsWith("OPS_")) return null;
  return (channel === "SMS" ? env.RECRUITING_ALERT_PHONE : env.RECRUITING_ALERT_EMAIL) || null;
}

export function renderOpsAlert(templateKey: string, p: Record<string, any>): TemplateRender {
  const who = [p.first_name, p.last_name].filter(Boolean).join(" ") || "An applicant";
  const what = templateKey.startsWith("OPS_DOCS_RECEIVED") ? "uploaded all documents" : "passed pre-screening";
  const profile = [
    p.has_cdl ? "CDL" : "no CDL",
    p.years != null ? `${p.years} yrs` : null,
    p.owner_operator ? "owner-operator" : null,
  ].filter(Boolean).join(", ");
  const flags = screenFlags({
    anyViolations3yr: p.any_violations_3yr,
    anyDuiEver: p.any_dui_ever,
    okAwayWeeks: p.ok_away_weeks,
    experienceVehicle: p.experience_vehicle,
  });
  const flagText = flags.length ? ` FLAG: ${flags.join(", ")}.` : "";
  return {
    subject: `Driver ready: ${who} ${what}`,
    text: `LAMP driver alert: ${who} ${what} (${profile}).${flagText} Call ${p.phone || "no phone on file"}. Review: ${p.review_url}`,
  };
}
