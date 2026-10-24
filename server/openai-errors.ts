// OpenAI answers 429 for two different things: a rate limit (retry in a few
// seconds) and an empty prepaid balance (nothing works until someone adds
// credits). Only the second one needs a human. Both texts below were stored in
// ratecon_intake.parse_error during the 2026-07-06 to 2026-10-24 outage:
//   "429 You exceeded your current quota, please check your plan and billing details..."
//   "429 You have no credits remaining. Add credits to continue using the API..."
export function isOpenAiCreditError(message: string | null | undefined): boolean {
  if (!message || !/\b429\b/.test(message)) return false;
  return /credit|quota|billing/i.test(message);
}
