/**
 * Tests for the three open code issues from the BOL upload health check
 * (BOL-UPLOAD-HEALTHCHECK-2026-10-25.md):
 *
 * 1. getAllDocuments (db-storage.ts) — was selecting imageUrl / uploadedBy /
 *    resolution which don't exist in the loadDocuments schema, and omitting
 *    fileUrl. Drizzle throws on unknown columns and the catch returns [].
 *
 * 2. DocumentCount (loads.tsx) — only counted legacy "bol" / "freight_photo" /
 *    "delivery_photo" types. The upload path writes pickup_bol, pickup_securement,
 *    delivery_signed_bol, delivery_pod — so the count showed 0.
 *
 * 3. sms-service status-callback URL — default domain was "traqiqs.io" (typo);
 *    status callbacks went to the wrong host.
 */

import { describe, it, expect } from 'vitest';

// ── 1. getAllDocuments field mapping ─────────────────────────────────────────
// We test the shape by importing and inspecting the DB query definition.
// The real fix is checked by verifying that imageUrl / uploadedBy / resolution
// are NOT referenced on schema.loadDocuments (which would throw at import
// time with strict Drizzle types), and that fileUrl IS referenced.

describe('getAllDocuments field mapping', () => {
  it('references fileUrl on loadDocuments schema, not imageUrl', async () => {
    const schema = await import('../../shared/schema');
    expect(schema.loadDocuments.fileUrl).toBeDefined();
    // These three columns must NOT exist on the schema object (they were the bad refs)
    expect((schema.loadDocuments as any).imageUrl).toBeUndefined();
    expect((schema.loadDocuments as any).uploadedBy).toBeUndefined();
    expect((schema.loadDocuments as any).resolution).toBeUndefined();
    // Dimension fields that replaced "resolution"
    expect(schema.loadDocuments.imageWidth).toBeDefined();
    expect(schema.loadDocuments.imageHeight).toBeDefined();
  });

  it('db-storage getAllDocuments selects fileUrl in its db.select call (source check)', async () => {
    // Read the source text and assert the bad field names are gone
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../db-storage.ts'), 'utf8');

    // Verify the fix is in place: fileUrl is selected, bad names are not
    expect(src).toContain('fileUrl: schema.loadDocuments.fileUrl');
    expect(src).not.toContain('imageUrl: schema.loadDocuments.imageUrl');
    expect(src).not.toContain('uploadedBy: schema.loadDocuments.uploadedBy');
    expect(src).not.toContain('resolution: schema.loadDocuments.resolution');
  });
});

// ── 2. DocumentCount type coverage ──────────────────────────────────────────
// The component logic is pure JS — extract and test the predicate directly.

const BOL_TYPES = ['bol', 'pickup_bol', 'delivery_signed_bol'];
const PHOTO_TYPES = ['freight_photo', 'delivery_photo', 'pickup_securement', 'delivery_pod'];

function bolCount(docs: { documentType: string }[]) {
  return docs.filter(d => BOL_TYPES.includes(d.documentType)).length;
}
function photoCount(docs: { documentType: string }[]) {
  return docs.filter(d => PHOTO_TYPES.includes(d.documentType)).length;
}

describe('DocumentCount type coverage', () => {
  it('counts pickup_bol as a BOL', () => {
    expect(bolCount([{ documentType: 'pickup_bol' }])).toBe(1);
  });

  it('counts delivery_signed_bol as a BOL', () => {
    expect(bolCount([{ documentType: 'delivery_signed_bol' }])).toBe(1);
  });

  it('still counts legacy bol type', () => {
    expect(bolCount([{ documentType: 'bol' }])).toBe(1);
  });

  it('counts pickup_securement as a photo', () => {
    expect(photoCount([{ documentType: 'pickup_securement' }])).toBe(1);
  });

  it('counts delivery_pod as a photo', () => {
    expect(photoCount([{ documentType: 'delivery_pod' }])).toBe(1);
  });

  it('mixed upload-path set gives correct totals', () => {
    const docs = [
      { documentType: 'pickup_bol' },
      { documentType: 'pickup_securement' },
      { documentType: 'delivery_signed_bol' },
      { documentType: 'delivery_pod' },
    ];
    expect(bolCount(docs)).toBe(2);
    expect(photoCount(docs)).toBe(2);
  });

  it('loads.tsx source uses the upload-path types in bolCount', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../../client/src/pages/loads.tsx'), 'utf8');
    expect(src).toContain('"pickup_bol"');
    expect(src).toContain('"delivery_signed_bol"');
    expect(src).toContain('"pickup_securement"');
    expect(src).toContain('"delivery_pod"');
  });
});

// ── 3. SMS status-callback domain typo ──────────────────────────────────────

describe('sms-service status-callback domain', () => {
  it('default fallback domain is traqiq.app, not traqiqs.io', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../sms-service.ts'), 'utf8');
    expect(src).not.toContain("'traqiqs.io'");
    expect(src).toContain("'traqiq.app'");
  });
});
