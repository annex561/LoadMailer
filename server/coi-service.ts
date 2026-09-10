// Coverage verification for split-authority owner-operators on the Master Trip Lease
// (docs/agreements/master-trip-lease-lamp-to-owner-operator.md).
//
// Master Section 10.4: "Carrier shall not tender a Trip Addendum, and Owner shall not
// accept one, while any coverage required by Section 10.2 is lapsed or expired."
// This module is how that clause is enforced in code instead of by memory. It backs the
// `Coverage Verified` checkbox on DocuSeal template 16
// (docs/docuseal-templates/16-trip-lease-addendum.md).
//
// Everything here is a pure predicate plus one read. No outbound traffic, nothing
// billable, nothing that can fire twice.
//
// SCOPE NOTE — this deliberately does NOT gate ordinary dispatch. It is called only on
// the trip-addendum path, which exists only for drivers on the Master Trip Lease. A
// driver with no compliance_documents rows is unaffected by anything in this file
// unless something asks for a trip addendum on his behalf.
//
// The COI lapse monitor (docs/specs/coi-lapse-monitor-spec.md) consumes
// evaluateCoverage and daysUntil from here rather than reimplementing them.
//
// Regression guard: server/__tests__/coi-coverage.test.ts

import { db } from './db';
import { complianceDocuments } from '@shared/schema';
import { and, eq } from 'drizzle-orm';

/** Coverage a split-authority owner-operator must carry under Master Section 10.2. */
export const REQUIRED_COI_TYPES = [
  'coi_auto_liability',
  'coi_cargo',
  'coi_physical_damage',
  'coi_bobtail',
  'coi_occ_acc',
] as const;

export type CoiType = (typeof REQUIRED_COI_TYPES)[number];

export const COI_LABELS: Record<string, string> = {
  coi_auto_liability: 'auto liability',
  coi_cargo: 'cargo',
  coi_physical_damage: 'physical damage',
  coi_bobtail: 'bobtail / non-trucking liability',
  coi_occ_acc: 'occupational accident',
};

export function coiLabel(type: string): string {
  return COI_LABELS[type] ?? type;
}

export interface CoverageDoc {
  type: string;
  expiryDate: Date;
  status?: string | null;
}

export interface CoverageStatus {
  /** True only when every required coverage is on file and current through throughDate. */
  ok: boolean;
  /** Required types with no active document on file at all. */
  missing: string[];
  /** Active documents that expire on or before throughDate. */
  lapsed: Array<{ type: string; expiryDate: Date }>;
  /** Earliest expiry among the active required documents, or null if none on file. */
  soonestExpiry: Date | null;
}

export function daysUntil(expiry: Date, now: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((expiry.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * Evaluate a driver's coverage as of `throughDate`.
 *
 * `throughDate` is the LAST moment coverage must still be good — for a trip addendum
 * that is the scheduled delivery, NOT today. A certificate that expires tomorrow does
 * not cover a run that delivers Thursday, and checking against `now` would wave it
 * through. This is the case the test file pins hardest.
 *
 * Documents whose status is anything other than "active" are ignored, so revoking a
 * superseded certificate is a status flip rather than a delete.
 */
export function evaluateCoverage(
  docs: CoverageDoc[],
  throughDate: Date,
  required: readonly string[] = REQUIRED_COI_TYPES,
): CoverageStatus {
  const active = docs.filter((d) => (d.status ?? 'active') === 'active');

  const missing: string[] = [];
  const lapsed: Array<{ type: string; expiryDate: Date }> = [];
  let soonestExpiry: Date | null = null;

  for (const type of required) {
    const forType = active.filter((d) => d.type === type);
    if (forType.length === 0) {
      missing.push(type);
      continue;
    }
    // Multiple certificates on file for one coverage: the newest expiry wins, so a
    // renewal loaded alongside the expiring original counts as covered.
    const best = forType.reduce((a, b) => (b.expiryDate > a.expiryDate ? b : a));
    if (best.expiryDate <= throughDate) {
      lapsed.push({ type, expiryDate: best.expiryDate });
    }
    if (soonestExpiry === null || best.expiryDate < soonestExpiry) {
      soonestExpiry = best.expiryDate;
    }
  }

  return {
    ok: missing.length === 0 && lapsed.length === 0,
    missing,
    lapsed,
    soonestExpiry,
  };
}

/** Human-readable reason a coverage check failed. Empty string when it passed. */
export function coverageFailureReason(status: CoverageStatus): string {
  if (status.ok) return '';
  const parts: string[] = [];
  if (status.missing.length > 0) {
    parts.push(`no certificate on file for ${status.missing.map(coiLabel).join(', ')}`);
  }
  if (status.lapsed.length > 0) {
    parts.push(
      `expired or expiring before delivery: ${status.lapsed
        .map((l) => `${coiLabel(l.type)} (${l.expiryDate.toISOString().slice(0, 10)})`)
        .join(', ')}`,
    );
  }
  return parts.join('; ');
}

/**
 * Enforce Master Section 10.4. Throws when a trip addendum must not be tendered.
 * Call this BEFORE creating the DocuSeal submission, not after.
 */
export function assertCoverageCurrentForTripLease(status: CoverageStatus): void {
  if (status.ok) return;
  throw new Error(
    `Trip addendum blocked — Master Trip Lease Section 10.4: ${coverageFailureReason(status)}`,
  );
}

/** Read a driver's compliance documents and evaluate them as of `throughDate`. */
export async function getDriverCoverageStatus(
  driverId: string,
  throughDate: Date,
): Promise<CoverageStatus> {
  const rows = await db
    .select({
      type: complianceDocuments.type,
      expiryDate: complianceDocuments.expiryDate,
      status: complianceDocuments.status,
    })
    .from(complianceDocuments)
    .where(
      and(eq(complianceDocuments.driverId, driverId), eq(complianceDocuments.status, 'active')),
    );

  return evaluateCoverage(rows as CoverageDoc[], throughDate);
}

/**
 * The value for the `Coverage Verified` field on DocuSeal template 16.
 * DocuSeal checkbox fields take a boolean.
 */
export async function coverageVerifiedField(
  driverId: string,
  deliveryDate: Date,
): Promise<boolean> {
  const status = await getDriverCoverageStatus(driverId, deliveryDate);
  return status.ok;
}

// ---------------------------------------------------------------------------
// COI lapse monitor predicates — consumed by server/coi-monitor-cron.ts.
// Pure. No I/O. Guarded by server/__tests__/coi-monitor.test.ts.
// ---------------------------------------------------------------------------

/** Escalation ladder, most patient first. 0 means already expired. */
export const COI_THRESHOLDS = [30, 14, 7, 1, 0] as const;

/**
 * The most urgent threshold this document has crossed, or null when it is further out
 * than the widest threshold. Lower number = more urgent. Expired clamps to 0.
 */
export function thresholdBucket(daysLeft: number): number | null {
  if (daysLeft <= 0) return 0;
  let bucket: number | null = null;
  for (const t of COI_THRESHOLDS) {
    if (daysLeft <= t && (bucket === null || t < bucket)) bucket = t;
  }
  return bucket;
}

export type CoiDecision =
  | { action: 'baseline'; threshold: number | null }
  | { action: 'no-change'; threshold: null }
  | { action: 'dedup'; threshold: number }
  | { action: 'alert'; threshold: number };

/**
 * Monotonic ratchet. An alert fires ONLY when the current bucket is strictly more
 * urgent than the last one alerted.
 *
 *   - First sight of a document NEVER alerts, whatever its bucket. That is the deploy
 *     watermark: rolling this out against twelve already-expired certificates sends
 *     zero messages. The baseline write records the current bucket as alerted.
 *   - Equal or less urgent is a dedup, so a restart, a double tick, a re-detect, or a
 *     corrected expiry date moving the wrong way all send nothing.
 *   - Further out than 30 days is no-change.
 */
export function decideCoiAlert(
  prevThreshold: number | null,
  isFirstSight: boolean,
  currBucket: number | null,
): CoiDecision {
  if (isFirstSight) return { action: 'baseline', threshold: currBucket };
  if (currBucket === null) return { action: 'no-change', threshold: null };
  const prev = prevThreshold === null ? Number.POSITIVE_INFINITY : prevThreshold;
  if (currBucket < prev) return { action: 'alert', threshold: currBucket };
  return { action: 'dedup', threshold: currBucket };
}

/**
 * GSM-7 only. ASCII throughout — no em dash, no unicode arrow, no smart quotes. One
 * non-ASCII character flips the whole message to UCS-2 and halves the segment length.
 * Mirrors buildFmcsaAlertSms in server/fmcsa-service.ts.
 */
export function buildCoiAlertSms(
  driverName: string,
  docType: string,
  daysLeft: number,
  expiry: Date,
): string {
  const when = expiry.toISOString().slice(0, 10);
  const head =
    daysLeft <= 0
      ? `EXPIRED ${when}`
      : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${when})`;
  return (
    `LAMP Dispatch - insurance alert\n` +
    `${driverName}: ${coiLabel(docType)} ${head}.\n` +
    `He cannot be dispatched a trip addendum until it is renewed.`
  );
}
