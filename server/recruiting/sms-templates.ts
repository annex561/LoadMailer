// Recruiting funnel SMS templates — pure functions, zero side effects, so they
// are unit-testable without the DB / Twilio / Vite import chain.
// Imported by server/recruiting/notifications.ts.
// Regression test: server/__tests__/recruiting-sms-copy.test.ts
export type TemplateRender = { subject?: string; html?: string; text: string };

export const SMS_TEMPLATES: Record<string, (p: Record<string, any>) => TemplateRender> = {
  LEAD_CAPTURE_SMS: (p) => ({
    text: `Hi ${p.first_name || "there"}, thanks for applying to LAMP Logistics. Open your application: ${p.app_url || "https://traqiq.app"}. Reply STOP to opt out.`,
  }),
  APP_RECEIVED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, application received. We'll text you when pre-screening completes — usually within 24 hours.`,
  }),
  DOCS_REQUEST_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, you passed pre-screening. Upload your documents here: ${p.docs_url || "https://traqiq.app"}.`,
  }),
  DOCS_RECEIVED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, docs received. Background check starting. We'll text you the result in 24-72 hrs.`,
  }),
  BACKGROUND_PASS_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, background check cleared. Drug test + DOT physical next. Check your email for the appointment.`,
  }),
  MEDICAL_PASS_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, medical cleared. Your contractor agreement is on the way for e-signature.`,
  }),
  AGREEMENT_SIGNED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, agreement signed. Orientation course unlocked: ${p.orientation_url || "https://traqiq.app"}.`,
  }),
  TRUCK_ASSIGNED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, your truck is ready. First load coming through TraqIQ shortly.`,
  }),
  ACTIVE_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, you're ACTIVE at LAMP. Open your driver portal: ${p.portal_url || "https://traqiq.app"}. First settlement Friday.`,
  }),
  DISQUALIFICATION_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, your LAMP application was not approved at this time. See your portal for details.`,
  }),
};
