import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldReplyToUnknownSender } from "../unknown-sender-limiter";

// 2026-10-05: TraqIQ's "I don't recognize you" auto-reply ping-ponged with Option Pit's opt-in bot
// (~1,590 texts, 09-22 → 10-05). One reply per unknown number per 24h ends any such loop.
describe("unknown-sender auto-reply is rate-limited", () => {
  it("replies once, then stays silent for 24h, then may reply again", () => {
    const t0 = 1_800_000_000_000;
    expect(shouldReplyToUnknownSender("+1 (555) 000-4824", t0)).toBe(true);
    expect(shouldReplyToUnknownSender("+15550004824", t0 + 60_000)).toBe(false);
    expect(shouldReplyToUnknownSender("5550004824", t0 + 23 * 3600_000)).toBe(false);
    expect(shouldReplyToUnknownSender("+15550004824", t0 + 24 * 3600_000 + 1)).toBe(true);
  });

  it("the unknown-sender reply goes through the limiter", () => {
    const src = readFileSync(join(__dirname, "..", "sms-communication-service.ts"), "utf8");
    const i = src.indexOf("I don't recognize you as a registered driver");
    expect(src.lastIndexOf("shouldReplyToUnknownSender(fromPhone)", i)).toBeGreaterThan(src.lastIndexOf("if (!driver) {", i));
  });
});
