// REVERTED — was firing dispatcher SMS on every RateCon review and burning
// Twilio credits. The function is now a no-op until we redesign with throttling
// and explicit user opt-in. Keeping the export so all callers compile unchanged.
export async function notifyAdminReviewNeeded(_params: {
  companyId: string | null;
  intakeId: string;
  broker: string;
  reason: string;
}) {
  // Intentional no-op. See PR #62 (added) and the revert PR for context.
  return;
}
