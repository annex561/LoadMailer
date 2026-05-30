/**
 * Regression tests for the DocuSeal integration.
 *
 * What this guards:
 *
 * 1. The webhook signature check is the only gate that prevents an attacker
 *    from forging "submission.completed" events and marking envelopes signed
 *    that were never signed. If somebody loosens webhookSecretIsValid, this
 *    test fails. The production environment MUST set DOCUSEAL_WEBHOOK_SECRET
 *    — and once set, ONLY requests with that exact value pass.
 *
 * 2. normalizeWebhook maps every observed DocuSeal event shape to one of
 *    our internal envelope statuses. A regression that breaks the
 *    "completed" mapping would leave signed envelopes stuck at "sent"
 *    forever — silently.
 *
 * 3. Dry-run mode does NOT call the network. This lets staging / dev
 *    work without burning DocuSeal quota and without the integration
 *    failing if the API token is absent. The test asserts that calling
 *    createSubmission in dry-run returns a synthetic ID without making
 *    any HTTP call.
 *
 * 4. Kill switch DOCUSEAL_ENABLED=false halts ALL sends immediately,
 *    no API call, no DB write. Operator can flip this in Railway in
 *    under a minute if DocuSeal goes haywire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeWebhook, createSubmission } from "../docuseal-service";
import { webhookSecretIsValid } from "../documents-routes";

describe("webhookSecretIsValid", () => {
  const ORIG = process.env.DOCUSEAL_WEBHOOK_SECRET;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.DOCUSEAL_WEBHOOK_SECRET;
    else process.env.DOCUSEAL_WEBHOOK_SECRET = ORIG;
  });

  it("returns true in development mode when no secret is configured", () => {
    delete process.env.DOCUSEAL_WEBHOOK_SECRET;
    expect(webhookSecretIsValid(undefined)).toBe(true);
    expect(webhookSecretIsValid("anything")).toBe(true);
  });

  it("rejects all non-matching values once a secret IS configured", () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = "correct-secret-abc123";
    expect(webhookSecretIsValid("wrong")).toBe(false);
    expect(webhookSecretIsValid("")).toBe(false);
    expect(webhookSecretIsValid(undefined)).toBe(false);
    expect(webhookSecretIsValid(null)).toBe(false);
    expect(webhookSecretIsValid(123)).toBe(false);
  });

  it("accepts the exact secret value", () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = "correct-secret-abc123";
    expect(webhookSecretIsValid("correct-secret-abc123")).toBe(true);
  });

  it("rejects an array header value (Express splits on duplicate headers)", () => {
    process.env.DOCUSEAL_WEBHOOK_SECRET = "correct-secret-abc123";
    expect(webhookSecretIsValid(["correct-secret-abc123"] as any)).toBe(false);
  });
});

describe("normalizeWebhook — DocuSeal event mapping", () => {
  it("maps submission.completed → completed", () => {
    const r = normalizeWebhook({
      event_type: "submission.completed",
      data: { id: 42, audit_log_url: "https://example.com/audit/42.pdf" },
    });
    expect(r.eventType).toBe("submission.completed");
    expect(r.submissionId).toBe("42");
    expect(r.envelopeStatus).toBe("completed");
    expect(r.signedPdfUrl).toBe("https://example.com/audit/42.pdf");
  });

  it("maps form.viewed → viewed", () => {
    const r = normalizeWebhook({
      event_type: "form.viewed",
      data: { submission_id: 42, email: "tony@example.com" },
    });
    expect(r.envelopeStatus).toBe("viewed");
    expect(r.signerEmail).toBe("tony@example.com");
  });

  it("maps form.declined → declined", () => {
    const r = normalizeWebhook({ event_type: "form.declined", data: { id: 42 } });
    expect(r.envelopeStatus).toBe("declined");
  });

  it("maps form.started → viewed (treat 'started' as engagement signal)", () => {
    const r = normalizeWebhook({ event_type: "form.started", data: { id: 42 } });
    expect(r.envelopeStatus).toBe("viewed");
  });

  it("returns null status for unknown event types — never silently invent a status", () => {
    const r = normalizeWebhook({ event_type: "something.weird", data: { id: 42 } });
    expect(r.envelopeStatus).toBeNull();
  });

  it("handles missing/empty payload gracefully (never throws)", () => {
    expect(() => normalizeWebhook(null)).not.toThrow();
    expect(() => normalizeWebhook({})).not.toThrow();
    expect(() => normalizeWebhook(undefined)).not.toThrow();
    const r = normalizeWebhook({});
    expect(r.submissionId).toBeNull();
    expect(r.envelopeStatus).toBeNull();
  });

  it("prefers data.id, falls back to top-level id, then submission_id", () => {
    expect(normalizeWebhook({ data: { id: 1 } }).submissionId).toBe("1");
    expect(normalizeWebhook({ id: 2 }).submissionId).toBe("2");
    expect(normalizeWebhook({ submission_id: 3 }).submissionId).toBe("3");
  });
});

describe("createSubmission — dry-run + kill switch", () => {
  const ORIG_DRY = process.env.DOCUSEAL_DRY_RUN;
  const ORIG_ENABLED = process.env.DOCUSEAL_ENABLED;
  const ORIG_TOKEN = process.env.DOCUSEAL_API_TOKEN;

  beforeEach(() => {
    // Mock fetch and assert it is NEVER called in dry-run or kill-switch paths.
    (globalThis as any).fetch = vi.fn(() => {
      throw new Error("fetch should NOT be called in dry-run or kill-switch mode");
    });
  });

  afterEach(() => {
    if (ORIG_DRY === undefined) delete process.env.DOCUSEAL_DRY_RUN;
    else process.env.DOCUSEAL_DRY_RUN = ORIG_DRY;
    if (ORIG_ENABLED === undefined) delete process.env.DOCUSEAL_ENABLED;
    else process.env.DOCUSEAL_ENABLED = ORIG_ENABLED;
    if (ORIG_TOKEN === undefined) delete process.env.DOCUSEAL_API_TOKEN;
    else process.env.DOCUSEAL_API_TOKEN = ORIG_TOKEN;
    vi.restoreAllMocks();
  });

  it("dry-run returns a synthetic submission ID without calling the network", async () => {
    process.env.DOCUSEAL_ENABLED = "true";
    process.env.DOCUSEAL_DRY_RUN = "true";
    process.env.DOCUSEAL_API_TOKEN = "fake";
    const result = await createSubmission({
      templateId: 1,
      signers: [{ name: "Tony", email: "tony@example.com" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submissionId).toMatch(/^dry_/);
      expect(result.signers.length).toBe(1);
      expect(result.signers[0].url).toContain("dry-run-sign");
    }
  });

  it("kill switch (DOCUSEAL_ENABLED=false) halts the send before any network call", async () => {
    process.env.DOCUSEAL_ENABLED = "false";
    process.env.DOCUSEAL_DRY_RUN = "false";
    process.env.DOCUSEAL_API_TOKEN = "fake";
    const result = await createSubmission({
      templateId: 1,
      signers: [{ name: "Tony", email: "tony@example.com" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/kill_switch/);
    }
  });

  it("returns ok:false when no API token is configured (graceful, never throws)", async () => {
    process.env.DOCUSEAL_ENABLED = "true";
    process.env.DOCUSEAL_DRY_RUN = "false";
    delete process.env.DOCUSEAL_API_TOKEN;
    const result = await createSubmission({
      templateId: 1,
      signers: [{ name: "Tony", email: "tony@example.com" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no_api_token/);
    }
  });
});

describe("documents-routes module — no surprise dependencies", () => {
  it("does not import Twilio (signing flow stays out of the SMS path)", () => {
    const src = readFileSync(
      join(__dirname, "..", "documents-routes.ts"),
      "utf-8"
    );
    expect(src).not.toMatch(/from\s+["']twilio["']/);
    expect(src).not.toMatch(/\.messages\.create\(/);
  });
});
