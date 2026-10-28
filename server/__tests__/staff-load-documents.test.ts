/**
 * Guard tests for the staff /loads/:id/documents page (S12-E).
 *
 * Pattern: source-level tripwires (readFileSync + regex), same as
 * upload-photo-auth.test.ts and require-role.test.ts — no DB, no HTTP
 * server, no Twilio calls.
 *
 * Covers the three test requirements from the spec:
 *   1. Unauthenticated access to data/approve/reject endpoints → 401, no DB write.
 *   2. Approve and reject update approvalStatus.
 *   3. Page / API payload used by it contains no rate or pay fields.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const pageSrc = readFileSync(
  resolve(__dirname, "../../client/src/pages/load-documents.tsx"),
  "utf8",
);

// ─── 1. Auth guards ───────────────────────────────────────────────────────────

describe("PATCH /api/loads/:id/photos/:photoId — staff-only approve/reject", () => {
  it("is registered with isAuthenticated before the handler (no unauthenticated writes)", () => {
    // Tripwire: the route declaration must pass isAuthenticated (or requireRole)
    // as its first middleware argument, so the DB update never runs for anon calls.
    const guarded =
      /app\.patch\(\s*['"`]\/api\/loads\/:id\/photos\/:photoId['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      guarded,
      "PATCH /api/loads/:id/photos/:photoId must have isAuthenticated (or requireRole) " +
        "as its first middleware. Without it any caller who knows a load UUID and photo id " +
        "can set approvalStatus='approved' and push docs into the factoring packet.",
    ).toBe(true);
  });

  it("does not use an app.use('/api/loads') prefix guard (would block driver token routes)", () => {
    const prefixGuard =
      /app\.use\(\s*['"`]\/api\/loads['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      prefixGuard,
      "Do NOT gate /api/loads via app.use() prefix — it locks driver-facing token routes " +
        "(/photos/sign, /photos/record, /checkin) that auth by upload token, not session.",
    ).toBe(false);
  });
});

describe("GET /api/loads/:id/photos — staff session or upload token required", () => {
  function handlerBlock(): string {
    const marker = "app.get('/api/loads/:id/photos'";
    const start = routesSrc.indexOf(marker);
    if (start === -1) throw new Error("Cannot find GET /api/loads/:id/photos route");
    return routesSrc.slice(start, start + 900);
  }

  it("returns 401 when neither token nor staff session is present", () => {
    const block = handlerBlock();
    expect(
      /status\(401\)/.test(block),
      "GET /api/loads/:id/photos must return 401 when called with no ?token= and no session.",
    ).toBe(true);
  });

  it("checks req.isAuthenticated() for the staff-session path", () => {
    const block = handlerBlock();
    expect(
      /isAuthenticated\(\)|req\.isAuthenticated/.test(block),
      "GET /api/loads/:id/photos must check req.isAuthenticated() so staff can call it " +
        "without an upload token (as the documents page does).",
    ).toBe(true);
  });
});

// ─── 2. Approve / reject write approvalStatus ─────────────────────────────────

describe("PATCH handler writes approvalStatus to the DB row", () => {
  function patchBlock(): string {
    const marker = "app.patch('/api/loads/:id/photos/:photoId'";
    const start = routesSrc.indexOf(marker);
    if (start === -1) throw new Error("Cannot find PATCH /api/loads/:id/photos/:photoId route");
    return routesSrc.slice(start, start + 1200);
  }

  it("reads approvalStatus from req.body", () => {
    expect(
      /req\.body\.approvalStatus/.test(patchBlock()),
      "PATCH handler must read approvalStatus from req.body.",
    ).toBe(true);
  });

  it("accepts 'approved', 'rejected', and 'pending' as valid values", () => {
    const block = patchBlock();
    expect(
      /['"]approved['"]/.test(block) &&
        /['"]rejected['"]/.test(block) &&
        /['"]pending['"]/.test(block),
      "PATCH handler must validate that approvalStatus is one of approved|rejected|pending.",
    ).toBe(true);
  });

  it("calls db.update on loadDocuments to persist the status", () => {
    const block = patchBlock();
    expect(
      /db\.update\(loadDocuments\)/.test(block),
      "PATCH handler must call db.update(loadDocuments) to persist the new approvalStatus.",
    ).toBe(true);
  });

  it("returns 400 if approvalStatus is missing or invalid (no silent bad writes)", () => {
    const block = patchBlock();
    expect(
      /status\(400\)/.test(block),
      "PATCH handler must return 400 for an invalid approvalStatus value.",
    ).toBe(true);
  });

  it("returns 404 when the photo row does not exist", () => {
    const block = patchBlock();
    expect(
      /status\(404\)/.test(block),
      "PATCH handler must return 404 when the photo row is not found.",
    ).toBe(true);
  });
});

// ─── 3. No money fields on the documents page ─────────────────────────────────

describe("load-documents page contains no money/rate/pay fields", () => {
  const moneyPatterns: [string, RegExp][] = [
    ["rate", /\brate\b(?!con|Con|_con)/],
    ["driverPay", /driverPay|driver_pay/],
    ["brokerLineHaul", /brokerLineHaul|broker_line_haul/],
    ["lineHaul", /lineHaul|line_haul/],
    ["rpm", /\brpm\b/],
    ["carrierPay", /carrierPay|carrier_pay/],
    ["settlement", /\bsettlement\b/],
  ];

  for (const [label, pattern] of moneyPatterns) {
    it(`does not render or reference the "${label}" field`, () => {
      expect(
        pattern.test(pageSrc),
        `load-documents.tsx must not render or reference "${label}" — ` +
          "money fields must never appear on the staff documents page.",
      ).toBe(false);
    });
  }
});

// ─── 4. Route is registered before the /loads/:id catch-all ──────────────────

describe("wouter route ordering in App.tsx", () => {
  const appSrc = readFileSync(
    resolve(__dirname, "../../client/src/App.tsx"),
    "utf8",
  );

  it("/loads/:id/documents route exists", () => {
    expect(
      appSrc.includes("/loads/:id/documents"),
      "App.tsx must register a Route for /loads/:id/documents.",
    ).toBe(true);
  });

  it("/loads/:id/documents is registered before /loads/:id (more-specific first)", () => {
    const docsIdx = appSrc.indexOf("/loads/:id/documents");
    const detailIdx = appSrc.indexOf('"/loads/:id"');
    // Both must exist and docs route must come first
    expect(docsIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(-1);
    expect(
      docsIdx < detailIdx,
      "/loads/:id/documents must appear before /loads/:id in App.tsx — wouter matches " +
        "the first route that fits, so the more-specific path must come first.",
    ).toBe(true);
  });
});
