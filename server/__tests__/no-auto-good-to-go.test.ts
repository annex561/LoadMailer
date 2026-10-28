/**
 * Regression guard: no automatic good-to-go paths.
 *
 * PR fix/no-auto-good-to-go removed four auto-GTG paths:
 *   A. Legacy MMS BOL photo handler (sms-communication-service.ts)
 *   B. DELIVERED keyword reply (ratecon-dispatch-service.ts)
 *   C. Lifecycle cron Phase 4B auto-release (load-lifecycle-service.ts)
 *   D. POST /api/lifecycle/release-driver/:loadId was already auth-gated
 *
 * The ONLY permitted good-to-go paths are:
 *   - POST /api/lifecycle/release-driver/:loadId (delivery GO, admin-only)
 *   - POST /api/loads/:id/go                     (pickup or delivery GO, admin-only)
 *
 * All tripwires are source-level (file reads) so they run with no DB/Twilio.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const smsSrc = readFileSync(
  resolve(__dirname, "../sms-communication-service.ts"),
  "utf8",
);
const dispatchSrc = readFileSync(
  resolve(__dirname, "../ratecon-dispatch-service.ts"),
  "utf8",
);
const lifecycleSrc = readFileSync(
  resolve(__dirname, "../load-lifecycle-service.ts"),
  "utf8",
);
const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

// ── String tripwires: GTG strings must not appear in non-authed code ─────────

describe("GTG strings appear only in authed handlers", () => {
  it("sms-communication-service.ts does NOT contain 'Good to Go' or 'GOOD TO GO' as a sent text", () => {
    // The file may have a comment mentioning it, but must not send it.
    // Extract all sendReply / sendSMS calls and assert none contain the phrase.
    const sendCallMatches = smsSrc.match(/sendReply\([^)]*\)|sendSMS\([^)]*\)/g) || [];
    const hasBadSend = sendCallMatches.some((call) =>
      /good to go/i.test(call),
    );
    expect(
      hasBadSend,
      "sms-communication-service.ts must not sendReply/sendSMS with 'Good to Go' — driver waits for dispatch manual GO",
    ).toBe(false);
  });

  it("sms-communication-service.ts does NOT set goodToGoSentAt", () => {
    // goodToGoSentAt writes must only appear in authed routes
    const sets = smsSrc.match(/goodToGoSentAt\s*:/g) || [];
    expect(
      sets.length,
      "sms-communication-service.ts must not assign goodToGoSentAt — only authed /go and release-driver handlers may",
    ).toBe(0);
  });

  it("sms-communication-service.ts does NOT set factoringStatus = 'ready' automatically", () => {
    // factoringStatus:'ready' used to be set alongside goodToGoSentAt
    const autoReady = /factoringStatus\s*:\s*['"]ready['"]/.test(smsSrc);
    expect(
      autoReady,
      "sms-communication-service.ts must not set factoringStatus='ready' automatically",
    ).toBe(false);
  });

  it("ratecon-dispatch-service.ts DELIVERED step does NOT contain 'Good to go' or 'good to go'", () => {
    // Find the delivered-step return block in the source
    const deliveredMatch = dispatchSrc.match(/step === ['"]delivered['"][\s\S]*?(?=\n\/\*\*|\nexport|\nfunction|$)/);
    const deliveredBlock = deliveredMatch ? deliveredMatch[0] : dispatchSrc;
    expect(
      /good to go/i.test(deliveredBlock),
      "ratecon-dispatch-service.ts DELIVERED block must not say 'Good to go' — driver waits for dispatch GO",
    ).toBe(false);
  });

  it("load-lifecycle-service.ts Phase 4B does NOT send a 'GOOD TO GO' SMS", () => {
    // Find the Phase 4B block
    const phase4bMatch = lifecycleSrc.match(/PHASE 4B[\s\S]*?(?=PHASE 4C|PHASE 5|$)/);
    expect(phase4bMatch, "Could not find Phase 4B block").toBeTruthy();
    const phase4bBlock = phase4bMatch![0];
    expect(
      /GOOD TO GO/i.test(phase4bBlock),
      "Phase 4B must not send 'GOOD TO GO' — auto-release removed; driver waits for manual GO",
    ).toBe(false);
  });

  it("load-lifecycle-service.ts Phase 4B does NOT call sendSMS", () => {
    const phase4bMatch = lifecycleSrc.match(/PHASE 4B[\s\S]*?(?=PHASE 4C|PHASE 5|$)/);
    expect(phase4bMatch, "Could not find Phase 4B block").toBeTruthy();
    const phase4bBlock = phase4bMatch![0];
    expect(
      /sendSMS\s*\(/.test(phase4bBlock),
      "Phase 4B must not call sendSMS — auto-release removed",
    ).toBe(false);
  });
});

// ── Auth tripwires: the two permitted GO routes must be gated ────────────────

describe("authed GO routes require isAuthenticated + requireRole('admin')", () => {
  it("POST /api/lifecycle/release-driver/:loadId has isAuthenticated as first middleware", () => {
    const gated =
      /app\.post\(\s*['"`]\/api\/lifecycle\/release-driver\/:loadId['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      gated,
      "release-driver must be gated — it is the delivery GO path",
    ).toBe(true);
  });

  it("POST /api/loads/:id/go has isAuthenticated as first middleware", () => {
    const gated =
      /app\.post\(\s*['"`]\/api\/loads\/:id\/go['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      gated,
      "POST /api/loads/:id/go must be gated — it sends the driver GO and must never be anonymous",
    ).toBe(true);
  });

  it("POST /api/loads/:id/go has requireRole('admin')", () => {
    // The route registration must include requireRole('admin') nearby
    const routeBlock = routesSrc.match(
      /app\.post\(\s*['"`]\/api\/loads\/:id\/go['"`][\s\S]*?(?=\n\s*\/\/ |app\.(get|post|put|patch|delete)\()/,
    );
    expect(routeBlock, "Could not find /go route block").toBeTruthy();
    const block = routeBlock![0];
    expect(
      /requireRole\s*\(\s*['"]admin['"]/.test(block),
      "POST /api/loads/:id/go must call requireRole('admin')",
    ).toBe(true);
  });
});

// ── /go route validation: phase must be pickup or delivery ───────────────────
// These check the whole routesSrc — the identifiers are unique to the /go route.

describe("POST /api/loads/:id/go validates phase field", () => {
  it("rejects phase values other than 'pickup' and 'delivery'", () => {
    // Must have a check that rejects if phase is neither pickup nor delivery
    const hasPhaseCheck =
      /phase\s*!==\s*['"]pickup['"]/.test(routesSrc) &&
      /phase\s*!==\s*['"]delivery['"]/.test(routesSrc);
    expect(
      hasPhaseCheck,
      "routes.ts must validate the phase field and return 400 for invalid values",
    ).toBe(true);
  });

  it("is idempotent — the /go route returns alreadySent when the phase was already GO'd", () => {
    // alreadySent is unique to the /go route
    expect(
      /alreadySent/.test(routesSrc),
      "POST /api/loads/:id/go must be idempotent — repeated calls for the same phase return alreadySent:true",
    ).toBe(true);
  });

  it("writes pickupGoAt for pickup phase and deliveryGoAt for delivery phase", () => {
    expect(/pickupGoAt/.test(routesSrc), "routes.ts must write pickupGoAt").toBe(true);
    expect(/deliveryGoAt/.test(routesSrc), "routes.ts must write deliveryGoAt").toBe(true);
    expect(/goByUserId/.test(routesSrc), "routes.ts must record goByUserId").toBe(true);
  });
});

// ── MMS reply does not say Good to Go ───────────────────────────────────────

describe("MMS photo handler sends dispatch-reviewing reply, not Good to Go", () => {
  it("sms-communication-service.ts contains 'dispatch is reviewing' reply for verified MMS photos", () => {
    const hasReviewReply = /dispatch is reviewing/i.test(smsSrc);
    expect(
      hasReviewReply,
      "The MMS BOL path must reply 'dispatch is reviewing' instead of 'Good to Go'",
    ).toBe(true);
  });
});
