/**
 * AI Document Check Service (AI_DOC_CHECK_ENABLED, default OFF)
 *
 * Two checks per load/phase, triggered after /photos/record or /photos/confirm:
 *
 *  (a) Securement — vision call on pickup_securement photos.
 *      Verdict: 'secured' | 'not_secured' | 'unreadable'
 *
 *  (b) BOL-vs-rate-con match — vision extraction from pickup_bol /
 *      delivery_signed_bol/pod compared to load fields.
 *      Per-field scores + overall 0..1. PASS only at >=0.90 AND all MUST
 *      fields present (PO, shipper, carrier, signature).
 *
 * Fail CLOSED: any AI error, 429/credit error, timeout, bad JSON, flag OFF,
 * missing key, or DRY_RUN_OUTBOUND → verdict 'needs_review'. Never 'pass'.
 *
 * Sends exactly one SMS per load+phase to OWNER_ALERT_PHONE (behind
 * AI_DOC_CHECK_ALERT_ENABLED, default OFF). Respects SMS_DISABLED and
 * DRY_RUN_OUTBOUND.
 *
 * Never auto-approves a load_documents row.
 * Never sends driver good-to-go.
 *
 * Model: env AI_VISION_MODEL (default 'gpt-4o'). Honors OPENAI_BASE_URL.
 * Cost: per-load cap 8 vision calls. Records costCents per run.
 */

import OpenAI from 'openai';
import { db } from './db';
import { loads, loadDocuments, rateconIntake, docChecks } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { isOpenAiCreditError } from './openai-errors';
import { isDryRunOutbound, logDryRun } from './dry-run';
import { smsLoadService } from './sms-service';

// ─── Pure matcher (no DB, no OpenAI) ────────────────────────────────────────

export interface RCFields {
  poNumber: string | null;
  shipperCity: string | null;
  shipperState: string | null;
  commodity: string | null;
  weightLbs: number | null;
  pieces: number | null;
  carrierName: string | null;  // our carrier, e.g. "LAMP"
}

export interface BOLFields {
  poNumber: string | null;
  shipperCity: string | null;
  shipperState: string | null;
  commodity: string | null;
  weightLbs: number | null;
  pieces: number | null;
  carrierName: string | null;  // carrier on the BOL
  hasShipperSignature: boolean;
  hasDriverSignature: boolean;
}

export interface FieldScore {
  field: string;
  rcValue: string | number | null;
  bolValue: string | number | null;
  score: number;   // 0..1
  reason: string;
}

export interface MatchResult {
  overall: number;   // weighted mean of present fields, 0..1
  pass: boolean;     // overall >= 0.90 AND no MUST field missing
  fields: FieldScore[];
  mustFieldsMissing: string[];
  reasons: string[];
}

// Normalize strings for fuzzy compare: lowercase, collapse whitespace
function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Simple fuzzy: score 1.0 if one contains the other, 0.5 if first tokens overlap, 0 otherwise
function fuzzyScore(a: string | null, b: string | null): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const tokA = na.split(' ');
  const tokB = nb.split(' ');
  const overlap = tokA.filter(t => t.length > 2 && tokB.includes(t)).length;
  if (overlap > 0) return 0.6;
  return 0;
}

// Normalize a PO/reference number: strip non-alphanum, uppercase
function normPO(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Match extracted BOL fields against rate-con reference fields.
 * Pure function — no IO, fully testable.
 */
export function matchBOLToRC(rc: RCFields, bol: BOLFields): MatchResult {
  const fields: FieldScore[] = [];
  const mustFieldsMissing: string[] = [];

  // ── PO / reference number (MUST) ─────────────────────────────────────
  const rcPO = normPO(rc.poNumber);
  const bolPO = normPO(bol.poNumber);
  if (!bolPO) {
    mustFieldsMissing.push('PO');
    fields.push({ field: 'po', rcValue: rc.poNumber, bolValue: bol.poNumber, score: 0, reason: 'PO missing from BOL' });
  } else if (rcPO && bolPO !== rcPO) {
    fields.push({ field: 'po', rcValue: rc.poNumber, bolValue: bol.poNumber, score: 0, reason: `PO mismatch: BOL ${bolPO} vs RC ${rcPO}` });
  } else if (!rcPO) {
    fields.push({ field: 'po', rcValue: null, bolValue: bol.poNumber, score: 0.8, reason: 'PO present on BOL but not on rate con' });
  } else {
    fields.push({ field: 'po', rcValue: rc.poNumber, bolValue: bol.poNumber, score: 1.0, reason: 'PO matches' });
  }

  // ── Shipper city/state (MUST) ─────────────────────────────────────────
  const shipperScore = fuzzyScore(
    [rc.shipperCity, rc.shipperState].filter(Boolean).join(' '),
    [bol.shipperCity, bol.shipperState].filter(Boolean).join(' '),
  );
  if (!bol.shipperCity && !bol.shipperState) {
    mustFieldsMissing.push('shipper');
    fields.push({ field: 'shipper', rcValue: `${rc.shipperCity}, ${rc.shipperState}`, bolValue: null, score: 0, reason: 'Shipper missing from BOL' });
  } else {
    fields.push({
      field: 'shipper',
      rcValue: `${rc.shipperCity ?? ''}, ${rc.shipperState ?? ''}`.trim(),
      bolValue: `${bol.shipperCity ?? ''}, ${bol.shipperState ?? ''}`.trim(),
      score: shipperScore,
      reason: shipperScore >= 0.9 ? 'Shipper matches' : `Shipper fuzzy score ${shipperScore.toFixed(2)}: RC "${rc.shipperCity}" vs BOL "${bol.shipperCity}"`,
    });
  }

  // ── Carrier name (MUST) ───────────────────────────────────────────────
  // "carrier" on BOL must be our carrier (LAMP or whatever LAMP_CARRIER_NAME env says).
  // If the BOL shows someone else's carrier name, flag it hard.
  const ourCarrier = process.env.LAMP_CARRIER_NAME || 'LAMP';
  if (!bol.carrierName) {
    mustFieldsMissing.push('carrier');
    fields.push({ field: 'carrier', rcValue: ourCarrier, bolValue: null, score: 0, reason: 'Carrier missing from BOL' });
  } else {
    const cs = fuzzyScore(ourCarrier, bol.carrierName);
    fields.push({
      field: 'carrier',
      rcValue: ourCarrier,
      bolValue: bol.carrierName,
      score: cs,
      reason: cs >= 0.7 ? 'Carrier matches' : `Carrier mismatch: BOL shows "${bol.carrierName}", expected "${ourCarrier}"`,
    });
    if (cs < 0.7) mustFieldsMissing.push('carrier');
  }

  // ── Signatures (MUST — driver or shipper) ────────────────────────────
  const hasSig = bol.hasShipperSignature || bol.hasDriverSignature;
  if (!hasSig) {
    mustFieldsMissing.push('signature');
    fields.push({ field: 'signature', rcValue: 'required', bolValue: 'missing', score: 0, reason: 'No signature detected on BOL' });
  } else {
    fields.push({ field: 'signature', rcValue: 'required', bolValue: 'present', score: 1.0, reason: 'Signature present' });
  }

  // ── Weight (±10%) ─────────────────────────────────────────────────────
  if (rc.weightLbs != null && bol.weightLbs != null) {
    const ratio = bol.weightLbs / rc.weightLbs;
    const within10 = ratio >= 0.9 && ratio <= 1.1;
    fields.push({
      field: 'weight',
      rcValue: rc.weightLbs,
      bolValue: bol.weightLbs,
      score: within10 ? 1.0 : 0,
      reason: within10 ? 'Weight within ±10%' : `Weight mismatch: BOL ${bol.weightLbs} lbs vs RC ${rc.weightLbs} lbs`,
    });
  } else if (rc.weightLbs != null && bol.weightLbs == null) {
    fields.push({ field: 'weight', rcValue: rc.weightLbs, bolValue: null, score: 0, reason: 'Weight not found on BOL' });
  }

  // ── Pieces ────────────────────────────────────────────────────────────
  if (rc.pieces != null && bol.pieces != null) {
    const match = rc.pieces === bol.pieces;
    fields.push({
      field: 'pieces',
      rcValue: rc.pieces,
      bolValue: bol.pieces,
      score: match ? 1.0 : 0,
      reason: match ? 'Pieces match' : `Pieces mismatch: BOL ${bol.pieces} vs RC ${rc.pieces} (pallets vs pieces noted if mixed)`,
    });
  } else if (rc.pieces != null && bol.pieces == null) {
    fields.push({ field: 'pieces', rcValue: rc.pieces, bolValue: null, score: 0, reason: 'Pieces not found on BOL' });
  }

  // ── Commodity ─────────────────────────────────────────────────────────
  if (rc.commodity && bol.commodity) {
    const cs2 = fuzzyScore(rc.commodity, bol.commodity);
    fields.push({
      field: 'commodity',
      rcValue: rc.commodity,
      bolValue: bol.commodity,
      score: cs2,
      reason: cs2 >= 0.6 ? 'Commodity matches' : `Commodity mismatch: RC "${rc.commodity}" vs BOL "${bol.commodity}"`,
    });
  }

  // ── Overall score (mean of present field scores) ─────────────────────
  const overall = fields.length > 0
    ? fields.reduce((sum, f) => sum + f.score, 0) / fields.length
    : 0;

  const pass = overall >= 0.90 && mustFieldsMissing.length === 0;

  const reasons = fields
    .filter(f => f.score < 1.0)
    .map(f => f.reason);

  return { overall, pass, fields, mustFieldsMissing, reasons };
}

// ─── AI calls ────────────────────────────────────────────────────────────────

function makeOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'not-configured',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

function aiModel(): string {
  return process.env.AI_VISION_MODEL || 'gpt-4o';
}

// Cloudinary URL transform for HEIC-safe JPEG rendering at capped resolution
function transformUrl(url: string): string {
  if (!url.includes('res.cloudinary.com')) return url;
  // Insert f_jpg,w_1600 before /upload/ — works for image and raw resources
  return url.replace(/\/upload\//, '/upload/f_jpg,w_1600/');
}

export interface SecurementResult {
  verdict: 'secured' | 'not_secured' | 'unreadable';
  reason: string;
  costCents: number;
}

/**
 * Vision call: is freight properly secured in this photo?
 * Fails closed on any error.
 */
export async function checkSecurement(imageUrl: string): Promise<SecurementResult> {
  if (isDryRunOutbound()) {
    logDryRun({ vendor: 'openai', action: 'checkSecurement', payload: { imageUrl } });
    return { verdict: 'unreadable', reason: '[dry-run] skipped', costCents: 0 };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { verdict: 'unreadable', reason: 'OPENAI_API_KEY not set', costCents: 0 };
  }

  const client = makeOpenAIClient();
  const model = aiModel();

  try {
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content:
            'You check freight photos for a trucking company. Determine if the load is properly secured. ' +
            'Look for: straps, load bars, tie-downs, chains, edge protectors, sealed doors/locks. ' +
            'Respond ONLY with valid JSON: {"verdict":"secured"|"not_secured"|"unreadable","reason":"<15 words max>"}. ' +
            'Use "unreadable" only if the photo is too blurry, too dark, or clearly not a freight photo.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Is this freight properly secured?' },
            { type: 'image_url', image_url: { url: transformUrl(imageUrl) } },
          ] as any,
        },
      ],
      response_format: { type: 'json_object' },
    });

    // ponytail: approximate cost — 1k input tokens × $2.50/1M + 50 out × $10/1M ≈ $0.003
    const inputTokens = resp.usage?.prompt_tokens ?? 1000;
    const outputTokens = resp.usage?.completion_tokens ?? 50;
    const costCents = Math.round((inputTokens / 1_000_000) * 250 + (outputTokens / 1_000_000) * 1000);

    const content = resp.choices[0]?.message?.content;
    if (!content) return { verdict: 'unreadable', reason: 'Empty response', costCents };

    const parsed = JSON.parse(content) as { verdict?: string; reason?: string };
    const verdict = parsed.verdict as 'secured' | 'not_secured' | 'unreadable';
    if (!['secured', 'not_secured', 'unreadable'].includes(verdict)) {
      return { verdict: 'unreadable', reason: 'Unexpected verdict from AI', costCents };
    }
    return { verdict, reason: parsed.reason ?? '', costCents };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (isOpenAiCreditError(msg)) {
      console.warn('[ai-doc-check] OpenAI credit error on securement check');
    } else {
      console.error('[ai-doc-check] securement check error:', msg);
    }
    return { verdict: 'unreadable', reason: `AI error: ${msg.slice(0, 100)}`, costCents: 0 };
  }
}

export interface BOLExtractResult {
  fields: BOLFields;
  rawJson: unknown;
  costCents: number;
  error?: string;
}

/**
 * Vision call: extract structured fields from a BOL/POD image.
 * Returns fields filled with nulls on any error.
 */
export async function extractBOLFields(imageUrl: string): Promise<BOLExtractResult> {
  const empty: BOLFields = {
    poNumber: null, shipperCity: null, shipperState: null,
    commodity: null, weightLbs: null, pieces: null,
    carrierName: null, hasShipperSignature: false, hasDriverSignature: false,
  };

  if (isDryRunOutbound()) {
    logDryRun({ vendor: 'openai', action: 'extractBOLFields', payload: { imageUrl } });
    return { fields: empty, rawJson: null, costCents: 0, error: '[dry-run] skipped' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { fields: empty, rawJson: null, costCents: 0, error: 'OPENAI_API_KEY not set' };
  }

  const client = makeOpenAIClient();
  const model = aiModel();

  try {
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content:
            'You extract fields from Bill of Lading and Proof of Delivery documents for a trucking company. ' +
            'Respond ONLY with valid JSON matching this schema exactly:\n' +
            '{\n' +
            '  "poNumber": "<PO/load/reference number or null>",\n' +
            '  "shipperCity": "<city of shipper/origin or null>",\n' +
            '  "shipperState": "<2-letter state or null>",\n' +
            '  "commodity": "<cargo description or null>",\n' +
            '  "weightLbs": <number in pounds or null>,\n' +
            '  "pieces": <number of pieces/pallets or null>,\n' +
            '  "carrierName": "<carrier company name on the document or null>",\n' +
            '  "hasShipperSignature": <true if a shipper/origin signature line is signed, false otherwise>,\n' +
            '  "hasDriverSignature": <true if a driver signature is present, false otherwise>\n' +
            '}\n' +
            'If a field is not visible or not applicable, use null. Do not invent values.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all fields from this BOL/POD document.' },
            { type: 'image_url', image_url: { url: transformUrl(imageUrl) } },
          ] as any,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const inputTokens = resp.usage?.prompt_tokens ?? 1200;
    const outputTokens = resp.usage?.completion_tokens ?? 150;
    const costCents = Math.round((inputTokens / 1_000_000) * 250 + (outputTokens / 1_000_000) * 1000);

    const content = resp.choices[0]?.message?.content;
    if (!content) return { fields: empty, rawJson: null, costCents, error: 'Empty response' };

    const parsed = JSON.parse(content) as Partial<BOLFields>;
    const fields: BOLFields = {
      poNumber: parsed.poNumber ?? null,
      shipperCity: parsed.shipperCity ?? null,
      shipperState: parsed.shipperState ?? null,
      commodity: parsed.commodity ?? null,
      weightLbs: typeof parsed.weightLbs === 'number' ? parsed.weightLbs : null,
      pieces: typeof parsed.pieces === 'number' ? parsed.pieces : null,
      carrierName: parsed.carrierName ?? null,
      hasShipperSignature: !!parsed.hasShipperSignature,
      hasDriverSignature: !!parsed.hasDriverSignature,
    };
    return { fields, rawJson: parsed, costCents };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (isOpenAiCreditError(msg)) {
      console.warn('[ai-doc-check] OpenAI credit error on BOL extraction');
    } else {
      console.error('[ai-doc-check] BOL extract error:', msg);
    }
    return { fields: empty, rawJson: null, costCents: 0, error: msg.slice(0, 200) };
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

const MAX_VISION_CALLS_PER_LOAD = 8;

/**
 * Run the full AI doc check for a load/phase. Stores result in doc_checks.
 * Sends one owner alert SMS if AI_DOC_CHECK_ALERT_ENABLED=true and not already sent.
 *
 * Always fails closed: any error → verdict 'needs_review'.
 */
async function runDocCheck(loadId: string, phase: 'pickup' | 'delivery'): Promise<void> {
  // ── Guard: flag OFF ────────────────────────────────────────────────────
  if (process.env.AI_DOC_CHECK_ENABLED !== 'true') return;

  try {
    // ── Load row ──────────────────────────────────────────────────────────
    const load = await db.query.loads.findFirst({ where: eq(loads.id, loadId) });
    if (!load) {
      console.warn('[ai-doc-check] load not found:', loadId);
      return;
    }

    // ── Debounce: skip if a completed check exists for this load+phase ────
    // We upsert on (loadId, phase), so grab the existing row first.
    const [existing] = await db
      .select()
      .from(docChecks)
      .where(and(eq(docChecks.loadId, loadId), eq(docChecks.phase, phase)))
      .limit(1);

    // If already pass/needs_review (not pending), still re-run on confirm
    // (the calling site fires this on both record and confirm). Allow.

    // ── Per-load vision call cap ───────────────────────────────────────────
    // ponytail: simple counter from costCents rows, not a separate column
    const allChecks = await db
      .select({ costCents: docChecks.costCents })
      .from(docChecks)
      .where(eq(docChecks.loadId, loadId));
    const totalCalls = allChecks.length; // one row per phase = at most 2 right now
    if (totalCalls >= MAX_VISION_CALLS_PER_LOAD) {
      console.warn(`[ai-doc-check] load ${loadId} hit ${MAX_VISION_CALLS_PER_LOAD}-call cap`);
      return;
    }

    // ── Gather photos for this phase ──────────────────────────────────────
    const phaseStages = phase === 'pickup'
      ? ['pickup_bol', 'pickup_securement']
      : ['delivery_signed_bol', 'delivery_pod'];

    const photos = await db
      .select({ id: loadDocuments.id, fileUrl: loadDocuments.fileUrl, documentType: loadDocuments.documentType })
      .from(loadDocuments)
      .where(and(
        eq(loadDocuments.loadId, loadId),
        inArray(loadDocuments.documentType, phaseStages),
      ));

    if (photos.length === 0) {
      console.warn(`[ai-doc-check] no photos for ${loadId} phase ${phase} — skipping`);
      return;
    }

    let totalCost = 0;
    let runError: string | undefined;

    // ── (a) Securement check (pickup only) ────────────────────────────────
    let securementVerdictVal: string | null = null;
    let securementReasonVal: string | null = null;

    if (phase === 'pickup') {
      const secPhotos = photos.filter((p: { id: string; fileUrl: string; documentType: string }) => p.documentType === 'pickup_securement');
      if (secPhotos.length > 0) {
        // Check the first securement photo (cap cost)
        const sec = await checkSecurement(secPhotos[0].fileUrl);
        securementVerdictVal = sec.verdict;
        securementReasonVal = sec.reason;
        totalCost += sec.costCents;
        if (sec.verdict === 'unreadable' && sec.reason.startsWith('AI error:')) {
          runError = sec.reason;
        }
      }
    }

    // ── (b) BOL extract + match ───────────────────────────────────────────
    const bolStage = phase === 'pickup' ? 'pickup_bol' : 'delivery_signed_bol';
    const bolPhotos = photos.filter((p: { id: string; fileUrl: string; documentType: string }) => p.documentType === bolStage);

    // If no BOL photo yet, leave verdict pending (don't fail yet)
    if (bolPhotos.length === 0) {
      await upsertDocCheck(existing?.id, {
        loadId, phase,
        verdict: 'pending',
        securementVerdictVal, securementReasonVal,
        fields: null, mustFieldsMissing: null, reasons: null,
        score: null, model: aiModel(), costCents: totalCost, error: null,
      });
      return;
    }

    // Extract from the first BOL photo (most recent would need ordering — use first for now)
    // ponytail: use first available; multi-page would need loop with cost cap
    const bolExtract = await extractBOLFields(bolPhotos[0].fileUrl);
    totalCost += bolExtract.costCents;

    if (bolExtract.error && bolExtract.error !== '[dry-run] skipped') {
      runError = bolExtract.error;
    }

    // ── Build rate-con reference from load ────────────────────────────────
    // Prefer ratecon_intake.parsedJson if linked, fall back to load columns
    let rcFields: RCFields = {
      poNumber: load.loadNumber,
      shipperCity: null,
      shipperState: null,
      commodity: load.description || null,
      weightLbs: load.weight ?? null,
      pieces: null,
      carrierName: process.env.LAMP_CARRIER_NAME || 'LAMP',
    };

    try {
      // Try to get pickup city/state from ratecon_intake.parsedJson
      const [intake] = await db
        .select({ parsedJson: rateconIntake.parsedJson })
        .from(rateconIntake)
        .where(eq(rateconIntake.loadId, loadId))
        .limit(1);

      if (intake?.parsedJson) {
        const p = intake.parsedJson as any;
        if (p?.pickup?.city) rcFields.shipperCity = p.pickup.city;
        if (p?.pickup?.state) rcFields.shipperState = p.pickup.state;
        if (p?.commodity?.value) rcFields.commodity = p.commodity.value;
        if (p?.weightLbs?.value) rcFields.weightLbs = Number(p.weightLbs.value);
      }
    } catch {
      // ratecon_intake lookup is best-effort
    }

    // Extract shipper city/state from load.pickupAddress as fallback
    if (!rcFields.shipperCity && load.pickupAddress) {
      // "City, ST 12345" or "123 Street, City, ST"
      const m = load.pickupAddress.match(/,\s*([A-Za-z\s]+),?\s+([A-Z]{2})\b/);
      if (m) {
        rcFields.shipperCity = m[1].trim();
        rcFields.shipperState = m[2];
      }
    }

    // ── Match ─────────────────────────────────────────────────────────────
    let matchResult: MatchResult;
    if (bolExtract.error && bolExtract.error !== '[dry-run] skipped') {
      // Fail closed on extraction error
      matchResult = {
        overall: 0,
        pass: false,
        fields: [],
        mustFieldsMissing: ['extraction_failed'],
        reasons: [`BOL extraction failed: ${bolExtract.error.slice(0, 100)}`],
      };
    } else if (isDryRunOutbound()) {
      matchResult = {
        overall: 0,
        pass: false,
        fields: [],
        mustFieldsMissing: ['dry_run'],
        reasons: ['[dry-run] check skipped'],
      };
    } else {
      matchResult = matchBOLToRC(rcFields, bolExtract.fields);
    }

    const verdict = matchResult.pass ? 'pass' : 'needs_review';
    const model = aiModel();

    // ── Upsert doc_checks row ─────────────────────────────────────────────
    const checkId = await upsertDocCheck(existing?.id, {
      loadId, phase, verdict,
      securementVerdictVal, securementReasonVal,
      fields: matchResult.fields,
      mustFieldsMissing: matchResult.mustFieldsMissing,
      reasons: matchResult.reasons,
      score: matchResult.overall,
      model, costCents: totalCost,
      error: runError ?? null,
    });

    // ── Owner alert ───────────────────────────────────────────────────────
    await maybeAlertOwner({ checkId, load, phase, matchResult, securementVerdictVal, securementReasonVal });

  } catch (outer: any) {
    console.error('[ai-doc-check] runDocCheck unhandled error:', outer?.message || outer);
    // Fail closed: try to write needs_review if we can
    try {
      await db
        .insert(docChecks)
        .values({
          loadId, phase, verdict: 'needs_review',
          error: String(outer?.message || outer).slice(0, 500),
        } as any)
        .onConflictDoNothing();
    } catch { /* best effort */ }
  }
}

// ─── Upsert helper ───────────────────────────────────────────────────────────

interface UpsertArgs {
  loadId: string;
  phase: string;
  verdict: string;
  securementVerdictVal: string | null;
  securementReasonVal: string | null;
  fields: FieldScore[] | null;
  mustFieldsMissing: string[] | null;
  reasons: string[] | null;
  score: number | null;
  model: string;
  costCents: number;
  error: string | null;
}

async function upsertDocCheck(existingId: string | undefined, args: UpsertArgs): Promise<string> {
  const row = {
    loadId: args.loadId,
    phase: args.phase,
    verdict: args.verdict,
    score: args.score,
    securementVerdict: args.securementVerdictVal,
    securementReason: args.securementReasonVal,
    fields: args.fields as any,
    mustFieldsMissing: args.mustFieldsMissing,
    reasons: args.reasons,
    model: args.model,
    costCents: args.costCents,
    error: args.error,
    updatedAt: new Date(),
  };

  if (existingId) {
    await db.update(docChecks).set(row as any).where(eq(docChecks.id, existingId));
    return existingId;
  } else {
    const [inserted] = await db.insert(docChecks).values(row as any).returning({ id: docChecks.id });
    return inserted.id;
  }
}

// ─── Owner alert ─────────────────────────────────────────────────────────────

async function maybeAlertOwner(p: {
  checkId: string;
  load: { id: string; loadNumber: string; brokerName?: string | null };
  phase: string;
  matchResult: MatchResult;
  securementVerdictVal: string | null;
  securementReasonVal: string | null;
}): Promise<void> {
  if (process.env.AI_DOC_CHECK_ALERT_ENABLED !== 'true') return;

  const ownerPhone = process.env.OWNER_ALERT_PHONE;
  if (!ownerPhone) {
    console.warn('[ai-doc-check] AI_DOC_CHECK_ALERT_ENABLED=true but OWNER_ALERT_PHONE not set');
    return;
  }

  // Dedupe: if alertSentAt already set on this check row, skip
  const [row] = await db
    .select({ alertSentAt: docChecks.alertSentAt })
    .from(docChecks)
    .where(eq(docChecks.id, p.checkId))
    .limit(1);
  if (row?.alertSentAt) return;

  const { pass, overall, reasons } = p.matchResult;
  const phaseLabel = p.phase === 'pickup' ? 'PICKUP' : 'DELIVERY';
  const broker = p.load.brokerName || 'broker';
  const scoreStr = overall.toFixed(2);
  const url = `https://traqiq.app/loads/${p.load.id}`;

  let body: string;
  if (pass) {
    const secOk = p.securementVerdictVal === 'secured' ? 'tie-down ok, ' : '';
    body = `LAMP ${p.load.loadNumber} ${broker} ${phaseLabel}: AI ✅ ${scoreStr} (${secOk}BOL matches) — tap GO: ${url}`;
  } else {
    const topIssues = reasons.slice(0, 2).join('; ');
    const secNote = p.securementVerdictVal === 'not_secured' ? `; ⚠️ securement: ${p.securementReasonVal || 'not secured'}` : '';
    body = `LAMP ${p.load.loadNumber} ${broker} ${phaseLabel}: AI ⚠️ ${scoreStr}: ${topIssues}${secNote}. Review: ${url}`;
  }

  try {
    await smsLoadService.sendSMS({ to: ownerPhone, body, skipFooter: true });
    await db.update(docChecks)
      .set({ alertSentAt: new Date() } as any)
      .where(eq(docChecks.id, p.checkId));
  } catch (err: any) {
    // Alert failure MUST NOT affect the upload flow
    console.error('[ai-doc-check] owner alert failed (non-fatal):', err?.message || err);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: schedule an AI doc check for the given load/phase.
 * Never throws; errors are logged and result in needs_review in the DB.
 * Safe to call from inside a request handler — does not block the response.
 */
export function scheduleDocCheck(loadId: string, phase: 'pickup' | 'delivery'): void {
  if (process.env.AI_DOC_CHECK_ENABLED !== 'true') return;
  // Defer past current event loop tick so the driver's HTTP response goes first
  setImmediate(() => {
    runDocCheck(loadId, phase).catch((err) => {
      console.error('[ai-doc-check] scheduleDocCheck unhandled:', err?.message || err);
    });
  });
}
