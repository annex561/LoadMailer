/**
 * Driver welcome SMS — isolated so it is testable without booting the full
 * Express app or a real DB.
 *
 * Gate: DRIVER_WELCOME_SMS_ENABLED must be the literal string "true".
 * Anything else (unset, "1", "True", "false") → no SMS, driver creation
 * still succeeds. This is the same pattern used by FACTORING_AUTO_SUBMIT
 * and DRY_RUN_OUTBOUND: default-OFF, opt-in only.
 */

export type SmsSender = (opts: { to: string; body: string }) => Promise<{ success: boolean; error?: string }>;

/**
 * Send the driver-welcome message if and only if the feature flag is on.
 * Returns true when the send was attempted, false when the flag is off
 * or the phone is empty (safe to fire-and-forget; errors are swallowed
 * by the caller's try/catch).
 */
export async function sendDriverWelcomeSms(
  driverName: string,
  normalizedPhone: string | null | undefined,
  portalLink: string,
  sendSms: SmsSender,
): Promise<boolean> {
  if (process.env.DRIVER_WELCOME_SMS_ENABLED !== "true") return false;
  if (!normalizedPhone) return false;

  const body =
    `🚛 TRAQ IQ\n\n` +
    `Welcome, ${driverName}!\n\n` +
    `Your driver portal is ready. Tap to access:\n` +
    `${portalLink}\n\n` +
    `💡 Add to home screen for quick access\n\n` +
    `Questions? Reply to this message.`;

  await sendSms({ to: normalizedPhone, body });
  return true;
}
