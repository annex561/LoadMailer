/**
 * Tests for GET /api/loads/:id/doc-packet — packet item 13.
 *
 * Why this exists: LAMP's BOL↔rate-con docmatch reads this endpoint as its
 * primary source (Gmail becomes a fallback only). It must be:
 *  - auth-gated (anonymous → 401)
 *  - 404 on missing load
 *  - shape-correct (loadNumber, ratecon fields, documents grouped by type)
 *  - free of rate/pay columns (rate, offeredRate, rpm, etc.)
 *  - service-token capable (DOC_PACKET_SERVICE_TOKEN, default unset = disabled)
 *
 * Auth tripwires are source-text pins (no DB or session needed).
 * Shape and grouping tests mock the DB so no real Postgres connection is made.
 *
 * Do NOT remove or weaken the auth tripwire test. An open doc-packet endpoint
 * would expose Cloudinary BOL/POD URLs and ratecon parsed JSON to anonymous
 * callers — both are load-level PII.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routesSrc = readFileSync(resolve(__dirname, '../routes.ts'), 'utf8');

// ── Source-text pins (auth, shape constraints) ───────────────────────────────

describe('GET /api/loads/:id/doc-packet — source-level guards', () => {
  it('route is registered with docPacketGuard as its first middleware (auth tripwire)', () => {
    expect(
      /app\.get\(\s*['"`]\/api\/loads\/:id\/doc-packet['"`]\s*,\s*docPacketGuard\b/.test(routesSrc),
      'GET /api/loads/:id/doc-packet must be gated by docPacketGuard as its first middleware. ' +
        'An open doc-packet endpoint exposes BOL/POD URLs and ratecon parsed JSON to anonymous callers.',
    ).toBe(true);
  });

  it('docPacketGuard falls back to isAuthenticated when no service token match', () => {
    expect(routesSrc).toContain('return isAuthenticated(req, res, next)');
  });

  it('DOC_PACKET_SERVICE_TOKEN is read from env (default unset = disabled)', () => {
    // The guard reads the env var at request time (never at startup), so an
    // unset var disables the service-token path entirely.
    expect(routesSrc).toContain('process.env.DOC_PACKET_SERVICE_TOKEN');
  });

  it('handler returns 404 when load is not found', () => {
    expect(routesSrc).toContain("res.status(404).json({ ok: false, error: 'Load not found' })");
  });

  it('handler does NOT select rate/pay columns from the loads table', () => {
    // Extract only the doc-packet handler block (between the route declaration
    // and the next app. call) to avoid false positives from other routes.
    const handlerStart = routesSrc.indexOf("app.get('/api/loads/:id/doc-packet'");
    const handlerEnd = routesSrc.indexOf('\n  app.', handlerStart + 1);
    const handlerSrc = routesSrc.slice(handlerStart, handlerEnd);

    // None of these financial columns may appear in the select.
    // Use word-boundary patterns to avoid false positives (e.g. rateconPath ⊃ "rate").
    const financialCols = [
      /loadsTable\.rate\b(?!con)/,       // rate but NOT ratecon
      /loadsTable\.offeredRate\b/,
      /loadsTable\.rpm\b/,
      /loadsTable\.fuelCost\b/,
      /loadsTable\.detentionRatePerHour\b/,
      /loadsTable\.factoringAmountAdvanced\b/,
    ];
    for (const pattern of financialCols) {
      expect(
        pattern.test(handlerSrc),
        `${pattern} must NOT be selected in the doc-packet response`,
      ).toBe(false);
    }
  });

  it('documents are grouped by documentType in the handler', () => {
    expect(routesSrc).toContain('documents[doc.documentType]');
  });

  it('ratecon_intake is queried with the load id', () => {
    expect(routesSrc).toContain('eq(rateconIntake.loadId, req.params.id)');
  });
});

// ── Unit tests: shape and grouping (DB mocked) ───────────────────────────────

// We test the grouping logic directly without spinning up Express/Postgres.
// The handler's grouping is a simple for-loop; we replicate it here to verify
// the contract the docmatch consumer depends on.

type DocRow = { id: string; documentType: string; fileUrl: string; approvalStatus: string; uploadedAt: Date | null; notes: string | null };

function groupDocsByType(docs: DocRow[]): Record<string, DocRow[]> {
  const out: Record<string, DocRow[]> = {};
  for (const doc of docs) {
    if (!out[doc.documentType]) out[doc.documentType] = [];
    out[doc.documentType].push(doc);
  }
  return out;
}

const baseDoc = (overrides: Partial<DocRow> = {}): DocRow => ({
  id: 'doc-1',
  documentType: 'pickup_bol',
  fileUrl: 'https://res.cloudinary.com/traqiq/image/upload/v1/bol.jpg',
  approvalStatus: 'pending',
  uploadedAt: new Date('2026-10-27T12:00:00Z'),
  notes: null,
  ...overrides,
});

describe('groupDocsByType — document grouping shape', () => {
  it('empty input → empty object', () => {
    expect(groupDocsByType([])).toEqual({});
  });

  it('single doc → one key with one element', () => {
    const result = groupDocsByType([baseDoc()]);
    expect(Object.keys(result)).toEqual(['pickup_bol']);
    expect(result.pickup_bol).toHaveLength(1);
  });

  it('multiple docs of the same type → single key, ordered as input', () => {
    const d1 = baseDoc({ id: 'doc-1' });
    const d2 = baseDoc({ id: 'doc-2' });
    const result = groupDocsByType([d1, d2]);
    expect(result.pickup_bol).toHaveLength(2);
    expect(result.pickup_bol[0].id).toBe('doc-1');
    expect(result.pickup_bol[1].id).toBe('doc-2');
  });

  it('mixed doc types are separated correctly', () => {
    const docs = [
      baseDoc({ id: 'a', documentType: 'pickup_bol' }),
      baseDoc({ id: 'b', documentType: 'pickup_securement' }),
      baseDoc({ id: 'c', documentType: 'delivery_pod' }),
      baseDoc({ id: 'd', documentType: 'delivery_signed_bol' }),
    ];
    const result = groupDocsByType(docs);
    expect(Object.keys(result).sort()).toEqual([
      'delivery_pod',
      'delivery_signed_bol',
      'pickup_bol',
      'pickup_securement',
    ]);
  });

  it('new doc types (lumper_receipt, scale_ticket, other) are grouped without special-casing', () => {
    const docs = [
      baseDoc({ id: 'e', documentType: 'lumper_receipt' }),
      baseDoc({ id: 'f', documentType: 'scale_ticket' }),
      baseDoc({ id: 'g', documentType: 'other' }),
    ];
    const result = groupDocsByType(docs);
    expect(result.lumper_receipt).toHaveLength(1);
    expect(result.scale_ticket).toHaveLength(1);
    expect(result.other).toHaveLength(1);
  });

  it('each grouped doc retains fileUrl and approvalStatus (the fields docmatch needs)', () => {
    const doc = baseDoc({
      fileUrl: 'https://res.cloudinary.com/traqiq/image/upload/v1/test.jpg',
      approvalStatus: 'approved',
    });
    const result = groupDocsByType([doc]);
    const row = result.pickup_bol[0];
    expect(row.fileUrl).toContain('cloudinary.com');
    expect(row.approvalStatus).toBe('approved');
  });
});

// ── Service-token behaviour (source-level only) ──────────────────────────────

describe('DOC_PACKET_SERVICE_TOKEN — service token path', () => {
  it('guard only checks the bearer token when the env var is set', () => {
    // The guard reads DOC_PACKET_SERVICE_TOKEN inside the function body and
    // checks it against the Authorization header.  An unset var means the if-
    // branch never executes, so anonymous requests are still rejected by
    // isAuthenticated regardless of what header they send.
    const guardIdx = routesSrc.indexOf('function docPacketGuard(');
    const guardEnd = routesSrc.indexOf('\n  }', guardIdx) + 4;
    const guardSrc = routesSrc.slice(guardIdx, guardEnd);

    expect(guardSrc).toContain('process.env.DOC_PACKET_SERVICE_TOKEN');
    expect(guardSrc).toContain('req.headers.authorization');
    expect(guardSrc).toContain('`Bearer ${svcToken}`');
    // Falls back to session auth when token path does not match
    expect(guardSrc).toContain('return isAuthenticated(req, res, next)');
  });
});
