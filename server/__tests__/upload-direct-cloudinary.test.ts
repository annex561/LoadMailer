/**
 * Regression tests for the direct-to-Cloudinary upload path.
 *
 * History: PRs #83-#96 patched the server-side multer-based upload
 * (server/routes.ts /api/loads/:id/photos) and the page kept hanging on
 * rural-LTE iPhones at "Starting upload (X KB)..." — bytes never left
 * the phone. Root-cause appeared to be in the server-side byte path
 * (proxy buffering / multer / Cloudinary upload stream). PR #97 replaces
 * the byte path: the browser POSTs the file directly to Cloudinary using
 * signed params, then POSTs just the resulting secure_url back to our
 * server. The server-side hop now writes a load_documents row from a
 * URL, no buffer, no multer.
 *
 * These tests pin the load-binding contract: the photo MUST land in
 * load_documents with the correct load_id, because the factoring/RateCon
 * pipeline queries by load_id. If the direct-upload path ever drops or
 * mis-binds the load_id, factoring breaks silently for every BOL.
 *
 * DO NOT delete. Regression source: the user explicitly called out the
 * load-binding requirement when reviewing the design.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertedDocs: any[] = [];
const insertedLocations: any[] = [];

vi.mock('../db', () => ({
  db: {
    query: {
      loads: {
        findFirst: vi.fn(async (_args: any) => ({
          id: 'load-42',
          loadNumber: 'LD-42',
          driverId: 'driver-1',
        })),
      },
    },
    insert: (_t: any) => ({
      values: (v: any) => {
        // Route by shape: a driver_locations row has `latitude`. The
        // load_documents path awaits `.returning()`; driver_locations
        // awaits `.values(v)` directly (no returning). The returned
        // object must be both thenable AND expose `.returning()`.
        const isLocation = 'latitude' in v;
        if (isLocation) {
          insertedLocations.push(v);
        } else {
          insertedDocs.push({ id: 'doc-' + insertedDocs.length, ...v });
        }
        const result = isLocation
          ? []
          : [insertedDocs[insertedDocs.length - 1]];
        return {
          returning: async () => result,
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve(result).then(onFulfilled, onRejected),
        };
      },
    }),
  },
}));

describe('direct-upload (Cloudinary) — load binding contract', () => {
  beforeEach(() => {
    insertedDocs.length = 0;
    insertedLocations.length = 0;
    vi.clearAllMocks();
  });

  it('recordExternalPhotoUpload writes load_documents tied to the specific load_id', async () => {
    const { recordExternalPhotoUpload } = await import('../load-photos-service');
    const result = await recordExternalPhotoUpload({
      loadId: 'load-42',
      stage: 'delivery_signed_bol',
      cloudinaryUrl: 'https://res.cloudinary.com/lamp/image/upload/v1234/traqiq/loads/LD-42/delivery_signed_bol_1234.jpg',
      cloudinaryPublicId: 'traqiq/loads/LD-42/delivery_signed_bol_1234',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      originalName: 'bol.jpg',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The URL we got back must be the Cloudinary URL, not some
      // server-side rewrite (factoring needs a stable public URL).
      expect(result.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
      expect(result.docId).toBeTruthy();
    }

    // Exactly one load_documents row, with the right load_id.
    expect(insertedDocs.length).toBe(1);
    expect(insertedDocs[0].loadId).toBe('load-42');
    expect(insertedDocs[0].documentType).toBe('delivery_signed_bol');
    expect(insertedDocs[0].fileUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    // Approval status defaults to pending so dispatch sees it in review.
    expect(insertedDocs[0].approvalStatus).toBe('pending');
  });

  it('records the location row when lat/lng provided', async () => {
    const { recordExternalPhotoUpload } = await import('../load-photos-service');
    await recordExternalPhotoUpload({
      loadId: 'load-42',
      stage: 'pickup_bol',
      cloudinaryUrl: 'https://res.cloudinary.com/lamp/image/upload/x.jpg',
      cloudinaryPublicId: 'x',
      lat: 32.5,
      lng: -96.5,
    });
    expect(insertedLocations.length).toBe(1);
    expect(insertedLocations[0].loadId).toBe('load-42');
    expect(insertedLocations[0].driverId).toBe('driver-1');
    expect(insertedLocations[0].source).toBe('photo-upload-direct');
  });

  it('refuses to record if no driver is assigned to the load (orphan prevention)', async () => {
    const dbMod = await import('../db');
    (dbMod.db.query.loads.findFirst as any).mockResolvedValueOnce({
      id: 'load-no-driver',
      loadNumber: 'LD-99',
      driverId: null,
    });
    const { recordExternalPhotoUpload } = await import('../load-photos-service');
    const result = await recordExternalPhotoUpload({
      loadId: 'load-no-driver',
      stage: 'pickup_bol',
      cloudinaryUrl: 'https://res.cloudinary.com/lamp/image/upload/x.jpg',
      cloudinaryPublicId: 'x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/No driver assigned/);
    }
    expect(insertedDocs.length).toBe(0);
  });
});

describe('direct-upload client/server wiring (source-text pins)', () => {
  // These tests don't exercise behavior — they catch a refactor that
  // silently rips out the load-binding mechanism. If a future change
  // removes the cloudinaryUrl JSON branch or the signature endpoint, the
  // direct upload reverts to the broken multer path and drivers hang
  // again. Cheap to verify, expensive to ship without.
  it('routes.ts contains the signature endpoint', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'routes.ts'),
      'utf8',
    );
    expect(src).toMatch(/\/api\/loads\/:id\/photos\/cloudinary-signature/);
    expect(src).toMatch(/api_sign_request/);
  });

  it('routes.ts contains the JSON branch on /api/loads/:id/photos', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'routes.ts'),
      'utf8',
    );
    expect(src).toMatch(/recordExternalPhotoUpload/);
    expect(src).toMatch(/cloudinaryUrl/);
  });

  it('upload.js client posts to Cloudinary directly and then back to our server', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'upload-page.client.js'),
      'utf8',
    );
    expect(src).toMatch(/api\.cloudinary\.com\/v1_1/);
    expect(src).toMatch(/cloudinaryUrl/);
    // The save-back POST must include the stage so the load_documents
    // row is correctly typed (pickup_bol vs delivery_signed_bol etc.).
    expect(src).toMatch(/stage:\s*stage/);
  });
});
