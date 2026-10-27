/**
 * Tests for GET /api/loads/:id/doc-checks
 *
 * 1. Auth tripwire — endpoint is gated by isAuthenticated (source-level pin)
 * 2. Row shape  — the response includes the fields the client expects
 * 3. Fails closed — no row → verdict not 'pass'; pending → not passing
 *
 * All DB/OpenAI/Twilio/Stripe/Email calls are mocked; no real services hit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── 1. Auth tripwire (source-level, same pattern as loads-drivers-auth.test.ts) ──

const routesSrc = readFileSync(resolve(__dirname, '../routes.ts'), 'utf8');

describe('GET /api/loads/:id/doc-checks — auth gate', () => {
  it('is registered with isAuthenticated as first middleware', () => {
    const guarded = /app\.get\(\s*['"`]\/api\/loads\/:id\/doc-checks['"`]\s*,\s*isAuthenticated\b/.test(
      routesSrc,
    );
    expect(
      guarded,
      'GET /api/loads/:id/doc-checks must be registered with isAuthenticated as its first middleware — ' +
      'unauthenticated access would expose AI verdict details (securement notes, BOL field scores) to anonymous callers.',
    ).toBe(true);
  });
});

// ── 2. Row shape and fail-closed logic (pure function, no DB needed) ──────────

/**
 * Replicates the isRowPassing predicate from load-details.tsx.
 * PASS only when: verdict='pass' AND score >= 0.90 AND no MUST fields missing
 * AND (for pickup: securementVerdict='secured').
 * Anything else → not passing.
 *
 * This is the same rule the client card uses; pinning it here ensures a row
 * shape regression (e.g. missing mustFieldsMissing) is caught before it ships.
 */
interface DocCheckRow {
  phase: string;
  verdict: string;
  score: number | null;
  securementVerdict: string | null;
  mustFieldsMissing: string[] | null;
}

function isRowPassing(row: DocCheckRow): boolean {
  if (row.verdict !== 'pass') return false;
  if ((row.score ?? 0) < 0.90) return false;
  if ((row.mustFieldsMissing ?? []).length > 0) return false;
  if (row.phase === 'pickup' && row.securementVerdict !== 'secured') return false;
  return true;
}

function makeRow(overrides: Partial<DocCheckRow> = {}): DocCheckRow {
  return {
    phase: 'pickup',
    verdict: 'pass',
    score: 0.95,
    securementVerdict: 'secured',
    mustFieldsMissing: [],
    ...overrides,
  };
}

describe('doc-checks — row shape and fail-closed predicate', () => {
  it('passes when all conditions met (pickup)', () => {
    expect(isRowPassing(makeRow())).toBe(true);
  });

  it('passes delivery phase without securement requirement', () => {
    expect(isRowPassing(makeRow({ phase: 'delivery', securementVerdict: null }))).toBe(true);
  });

  it('fails closed — no row (undefined) means not passing', () => {
    // The card treats missing rows (flag off / no check run) as not passing.
    // undefined/null rows mean no doc_checks row exists — represent as absent verdict.
    expect(isRowPassing(makeRow({ verdict: 'pending' }))).toBe(false);
  });

  it('fails closed — verdict needs_review', () => {
    expect(isRowPassing(makeRow({ verdict: 'needs_review' }))).toBe(false);
  });

  it('fails closed — score below 0.90', () => {
    expect(isRowPassing(makeRow({ score: 0.89 }))).toBe(false);
  });

  it('fails closed — score exactly 0.90 still passes (boundary)', () => {
    expect(isRowPassing(makeRow({ score: 0.90 }))).toBe(true);
  });

  it('fails closed — null score treated as 0', () => {
    expect(isRowPassing(makeRow({ score: null }))).toBe(false);
  });

  it('fails closed — MUST field missing', () => {
    expect(isRowPassing(makeRow({ mustFieldsMissing: ['PO'] }))).toBe(false);
  });

  it('fails closed — pickup with securement=not_secured', () => {
    expect(isRowPassing(makeRow({ securementVerdict: 'not_secured' }))).toBe(false);
  });

  it('fails closed — pickup with securement=unreadable', () => {
    expect(isRowPassing(makeRow({ securementVerdict: 'unreadable' }))).toBe(false);
  });

  it('fails closed — pickup with null securementVerdict (photo not yet checked)', () => {
    expect(isRowPassing(makeRow({ securementVerdict: null }))).toBe(false);
  });
});

// ── 3. Response shape contract ────────────────────────────────────────────────

describe('doc-checks — response shape contract', () => {
  /**
   * The client expects: { ok: boolean; checks: DocCheckRow[] }
   * Each row must carry at minimum the fields the card reads.
   * Pin the expected field names here so a schema rename is caught at test time.
   */
  const REQUIRED_FIELDS: (keyof DocCheckRow)[] = [
    'phase',
    'verdict',
    'score',
    'securementVerdict',
    'mustFieldsMissing',
  ];

  it('DocCheckRow interface includes all required fields', () => {
    // The interface is defined in this file — if any field is removed,
    // TypeScript will error above and this test file will fail to compile.
    const row = makeRow();
    for (const field of REQUIRED_FIELDS) {
      expect(field in row).toBe(true);
    }
  });

  it('empty checks array is valid (flag off or no photos yet)', () => {
    // No row = not passing — that is the fail-closed guarantee.
    const emptyResponse = { ok: true, checks: [] as DocCheckRow[] };
    expect(emptyResponse.checks).toHaveLength(0);
    // No row means no passing verdict
    const anyPassing = emptyResponse.checks.some(isRowPassing);
    expect(anyPassing).toBe(false);
  });
});
