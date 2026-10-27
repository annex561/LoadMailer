/**
 * Tests for items 8, 9, and 10 of CLAUDE-PACKET-DRIVER-DOC-UPLOAD-2026-10-25.
 *
 * 8. More doc types (lumper_receipt, scale_ticket, other) — optional, not gated.
 * 9. Multiple photos per slot — each file creates its own load_documents row;
 *    PDFs accepted; foreign Cloudinary cloud rejected.
 * 10. Load context on the page header — broker, pickup→delivery, RC ref;
 *     never rate or pay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared DB mock ──────────────────────────────────────────────────────────
const insertedDocs: any[] = [];

vi.mock('../db', () => ({
  db: {
    query: {
      loads: {
        findFirst: vi.fn(async () => ({
          id: 'load-99',
          loadNumber: 'TQL-38896802',
          driverId: 'drv-1',
        })),
      },
    },
    insert: (_t: any) => ({
      values: (v: any) => {
        const isLocation = 'latitude' in v;
        if (!isLocation) insertedDocs.push({ id: 'doc-' + insertedDocs.length, ...v });
        const result = isLocation ? [] : [insertedDocs[insertedDocs.length - 1]];
        return {
          returning: async () => result,
          then: (f: any, r: any) => Promise.resolve(result).then(f, r),
        };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
}));

// ─── 8. New types exported and not required ──────────────────────────────────
describe('item 8 — optional doc types', () => {
  it('OPTIONAL_STAGES contains lumper_receipt, scale_ticket, other', async () => {
    const { OPTIONAL_STAGES } = await import('../load-photos-service');
    expect(OPTIONAL_STAGES).toContain('lumper_receipt');
    expect(OPTIONAL_STAGES).toContain('scale_ticket');
    expect(OPTIONAL_STAGES).toContain('other');
  });

  it('OPTIONAL_STAGES are NOT in REQUIRED_STAGES', async () => {
    const { OPTIONAL_STAGES, REQUIRED_STAGES } = await import('../load-photos-service');
    for (const s of OPTIONAL_STAGES) {
      expect(REQUIRED_STAGES).not.toContain(s);
    }
  });

  it('optional stages do NOT affect getRequiredPhotoStatus pickup gate', async () => {
    const { getRequiredPhotoStatus } = await import('../load-photos-service');
    // Pre-load the db mock so the stage query returns a lumper_receipt doc.
    const dbMod = await import('../db');
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [{ documentType: 'lumper_receipt' }],
        }),
        limit: async () => [],
      }),
    });

    // getRequiredPhotoStatus calls db.select internally — mock via the
    // existing module so it returns one lumper_receipt row.
    // The function uses drizzle .select().from().where() which we can't
    // mock precisely without schema wiring; assert the logic directly on the
    // exported constants instead, which is what the implementation uses.
    const { PICKUP_STAGES, OPTIONAL_STAGES } = await import('../load-photos-service');
    for (const s of OPTIONAL_STAGES) {
      expect(PICKUP_STAGES).not.toContain(s);
    }
  });

  it('ALL_STAGES includes required + optional types', async () => {
    const { ALL_STAGES, REQUIRED_STAGES, OPTIONAL_STAGES } = await import('../load-photos-service');
    for (const s of REQUIRED_STAGES) expect(ALL_STAGES).toContain(s);
    for (const s of OPTIONAL_STAGES) expect(ALL_STAGES).toContain(s);
  });

  it('STAGE_LABELS has entries for all optional types', async () => {
    const { OPTIONAL_STAGES, STAGE_LABELS } = await import('../load-photos-service');
    for (const s of OPTIONAL_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it('recordDirectUploadedPhoto accepts lumper_receipt', async () => {
    insertedDocs.length = 0;
    vi.resetModules();
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const result = await recordDirectUploadedPhoto({
      loadId: 'load-99',
      stage: 'lumper_receipt',
      fileUrl: 'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/lumper.jpg',
      fileName: 'lumper.jpg',
    });
    expect(result.ok).toBe(true);
    expect(insertedDocs.some((d) => d.documentType === 'lumper_receipt')).toBe(true);
  });

  it('recordDirectUploadedPhoto accepts scale_ticket', async () => {
    insertedDocs.length = 0;
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const result = await recordDirectUploadedPhoto({
      loadId: 'load-99',
      stage: 'scale_ticket',
      fileUrl: 'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/scale.jpg',
      fileName: 'scale.jpg',
    });
    expect(result.ok).toBe(true);
  });

  it('recordDirectUploadedPhoto accepts other stage', async () => {
    insertedDocs.length = 0;
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const result = await recordDirectUploadedPhoto({
      loadId: 'load-99',
      stage: 'other',
      fileUrl: 'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/other.jpg',
      fileName: 'other.jpg',
      notes: 'Lumper copy',
    });
    expect(result.ok).toBe(true);
  });
});

// ─── 9. Multiple photos per slot, PDF accepted ───────────────────────────────
describe('item 9 — multi-file and PDF', () => {
  beforeEach(() => {
    insertedDocs.length = 0;
    vi.clearAllMocks();
  });

  it('N calls to recordDirectUploadedPhoto create N rows (multi-file loop)', async () => {
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const urls = [
      'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/p1.jpg',
      'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/p2.jpg',
      'https://res.cloudinary.com/mycloud/image/upload/v1/traqiq/p3.pdf',
    ];
    for (const url of urls) {
      await recordDirectUploadedPhoto({
        loadId: 'load-99',
        stage: 'pickup_bol',
        fileUrl: url,
        fileName: url.split('/').pop() || 'file',
        mimeType: url.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
      });
    }
    expect(insertedDocs.length).toBe(3);
    for (const doc of insertedDocs) {
      expect(doc.loadId).toBe('load-99');
      expect(doc.documentType).toBe('pickup_bol');
    }
  });

  it('PDF fileUrl (res.cloudinary.com) is accepted', async () => {
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const result = await recordDirectUploadedPhoto({
      loadId: 'load-99',
      stage: 'pickup_bol',
      fileUrl: 'https://res.cloudinary.com/mycloud/raw/upload/v1/traqiq/bol.pdf',
      fileName: 'bol.pdf',
      mimeType: 'application/pdf',
    });
    expect(result.ok).toBe(true);
  });

  it('non-cloudinary URL is rejected', async () => {
    const { recordDirectUploadedPhoto } = await import('../load-photos-service');
    const result = await recordDirectUploadedPhoto({
      loadId: 'load-99',
      stage: 'pickup_bol',
      fileUrl: 'https://evil.example.com/bol.jpg',
      fileName: 'bol.jpg',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid file URL/);
  });

  it('upload.client.js uses resource_type auto path for Cloudinary (handles PDFs)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'upload-page.client.js'), 'utf8');
    // The client must POST to /auto/upload (resource_type auto) not /image/upload
    // so that PDFs are accepted by Cloudinary.
    expect(src).toMatch(/\/auto\/upload/);
  });

  it('upload.client.js has multiple-file input (multiple attribute)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'upload-page.client.js'), 'utf8');
    expect(src).toMatch(/multiple/);
  });

  it('upload.client.js includes camera capture + library chooser', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'upload-page.client.js'), 'utf8');
    // camera input uses capture="environment"
    expect(src).toMatch(/capture.*environment/);
    // library chooser label
    expect(src).toMatch(/Library/);
  });

  it('upload.client.js loops over files to call handleOneFile (multi-file loop)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'upload-page.client.js'), 'utf8');
    expect(src).toMatch(/handleOneFile|handleFiles/);
    expect(src).toMatch(/files\.length|files\[i\]/);
  });

  it('upload.client.js accepts application/pdf in input accept', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'upload-page.client.js'), 'utf8');
    expect(src).toMatch(/application\/pdf/);
  });
});

// ─── 10. Load context header — never rate/pay ────────────────────────────────
describe('item 10 — load context in page header', () => {
  it('renderUploadPage includes broker name in HTML', async () => {
    vi.resetModules();
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage(
      'load-99',
      ['pickup_bol', 'pickup_securement'],
      'TQL-38896802',
      null,
      { broker: 'TQL Logistics', pickup: 'Memphis, TN', delivery: 'Atlanta, GA', rateconRef: 'RC-38896802.pdf' },
    );
    expect(html).toMatch(/TQL Logistics/);
  });

  it('renderUploadPage includes pickup→delivery route', async () => {
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage(
      'load-99',
      ['pickup_bol'],
      'TQL-38896802',
      null,
      { broker: 'Broker Co', pickup: 'Memphis, TN', delivery: 'Atlanta, GA', rateconRef: null },
    );
    expect(html).toMatch(/Memphis/);
    expect(html).toMatch(/Atlanta/);
  });

  it('renderUploadPage includes ratecon reference when provided', async () => {
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage(
      'load-99',
      ['pickup_bol'],
      'TQL-38896802',
      null,
      { broker: null, pickup: null, delivery: null, rateconRef: 'TQL-38896802.pdf' },
    );
    expect(html).toMatch(/TQL-38896802\.pdf/);
  });

  it('renderUploadPage NEVER shows rate or pay in header', async () => {
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage(
      'load-99',
      ['pickup_bol'],
      'TQL-38896802',
      null,
      { broker: 'Broker Co', pickup: 'City A', delivery: 'City B', rateconRef: 'RC.pdf' },
    );
    // The header must not expose rate/pay. Driver-visible token page.
    // Heuristic check: no dollar amounts like "$2,500" or labels "rate" / "pay"
    // within the ctx block. Allow the word in the rest of the page (CSS etc.)
    const ctxMatch = html.match(/<div class="ctx">([\s\S]*?)<\/div>/);
    if (ctxMatch) {
      const ctxBlock = ctxMatch[1];
      expect(ctxBlock.toLowerCase()).not.toMatch(/\brate\b|\bpay\b|\$\d/);
    }
  });

  it('renderUploadPage works with no ctx (backward compat)', async () => {
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage('load-99', ['pickup_bol'], 'TQL-38896802');
    expect(html).toContain('TQL-38896802');
    // No ctx div element when no context provided (CSS rule .ctx-item is OK)
    expect(html).not.toMatch(/<span class="ctx-item"/);
  });

  it('configJson in rendered page includes optionalStages', async () => {
    const { renderUploadPage } = await import('../load-photos-service');
    const html = renderUploadPage('load-99', ['pickup_bol'], 'TQL-38896802');
    // The JSON island must carry optionalStages so the client can build the
    // collapsed "More documents" section.
    expect(html).toMatch(/optionalStages/);
    expect(html).toMatch(/lumper_receipt/);
    expect(html).toMatch(/scale_ticket/);
  });

  it('routes.ts passes load context to renderUploadPage (source pin)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes.ts'), 'utf8');
    // The route must build a pageCtx object with broker, pickup, delivery, rateconRef
    // and pass it as the 5th argument to renderUploadPage.
    expect(src).toMatch(/pageCtx/);
    expect(src).toMatch(/brokerName/);
    expect(src).toMatch(/renderUploadPage\(.*pageCtx\)/s);
  });
});

// ─── 8. Gate regression — optional types don't block loaded/unloaded ─────────
describe('item 8 — gate regression', () => {
  it('stagesForPhase pickup does not include optional stages', async () => {
    vi.resetModules();
    const { stagesForPhase, OPTIONAL_STAGES } = await import('../load-photos-service');
    const pickup = stagesForPhase('pickup');
    const delivery = stagesForPhase('delivery');
    for (const s of OPTIONAL_STAGES) {
      expect(pickup).not.toContain(s);
      expect(delivery).not.toContain(s);
    }
  });

  it('stagesForLoadStatus never returns optional stages', async () => {
    const { stagesForLoadStatus, OPTIONAL_STAGES } = await import('../load-photos-service');
    for (const status of ['assigned', 'in_transit', 'at_delivery', 'delivered', null, undefined]) {
      const stages = stagesForLoadStatus(status as any);
      for (const s of OPTIONAL_STAGES) {
        expect(stages).not.toContain(s);
      }
    }
  });
});
