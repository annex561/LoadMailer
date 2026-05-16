/**
 * Phase 2 OCR address verification — end-to-end integration tests for
 * processMMSReply with the OCR step wired in. Mocks OpenAI (cheap) and
 * exercises all five outcomes plus the OVERRIDE handler.
 *
 * What these tests are guarding:
 *   - The right SMS goes back to the driver for each OCR outcome.
 *   - ocr_status is persisted correctly on load_documents.
 *   - The OpenAI call only fires when ADDRESS_VERIFY_ENABLED=true AND
 *     the per-driver hourly cap hasn't been hit.
 *   - OVERRIDE never sets approvalStatus='approved' — the wrong-load-to-
 *     factoring risk stays gated behind dispatcher review (Phase 1 gate).
 *
 * If a test here fails after a refactor, the failure mode is one of:
 *   - silent wrong-load attachment (Phase 1+2 gate broken)
 *   - silent OpenAI cost when flag is off (cap broken)
 *   - silent driver SMS regression
 * All three are user-facing problems — don't delete the test, find the
 * regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const selectQueue: any[] = [];
const dbState = {
  updates: [] as any[],
  inserts: [] as any[],
};

vi.mock('../db', () => {
  const makeSelectChain = (result: any) => {
    const chain: any = {
      from: () => chain,
      where: (_w: any) => chain,
      orderBy: () => chain,
      limit: async (_n: number) => (Array.isArray(result) ? result : []),
    };
    chain.where = (_w: any) => {
      const c: any = {
        ...chain,
        then: (resolve: any) => resolve(Array.isArray(result) ? result : []),
        orderBy: () => chain,
        limit: async (_n: number) => (Array.isArray(result) ? result : []),
      };
      return c;
    };
    return chain;
  };

  return {
    db: {
      select: (_cols?: any) => {
        const next = selectQueue.length > 0 ? selectQueue.shift() : [];
        return makeSelectChain(next);
      },
      insert: (_t: any) => ({
        values: (v: any) => ({
          returning: async (_cols?: any) => {
            const row = { id: 'p' + (dbState.inserts.length + 1), ...v };
            dbState.inserts.push(row);
            return [row];
          },
        }),
      }),
      update: (_t: any) => ({
        set: (patch: any) => ({
          where: async (_w: any) => {
            dbState.updates.push(patch);
          },
        }),
      }),
    },
  };
});

vi.mock('../load-photos-service', () => ({
  uploadLoadPhoto: vi.fn(async (p: any) => ({
    ok: true,
    url: `https://cloudinary.test/${p.stage}.jpg`,
    docId: 'doc-' + p.stage,
  })),
}));

// Mockable OpenAI vision extractor. Tests override the implementation
// per-case to simulate matched / mismatch / unreadable / error.
const mockExtract = vi.fn();
vi.mock('../factoring-bol-address-verify', () => ({
  isAddressVerifyEnabled: () => process.env.ADDRESS_VERIFY_ENABLED === 'true',
  extractBolAddresses: (...args: any[]) => mockExtract(...args),
}));

global.fetch = vi.fn(async () => ({
  ok: true,
  headers: { get: () => 'image/jpeg' },
  arrayBuffer: async () => new ArrayBuffer(16),
})) as any;

process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'tok';

import * as svc from '../mms-upload-service';

// Standard select queue for the happy-path processMMSReply flow:
//   1. dedup lookup (miss)
//   2. findPendingForPhone
//   3. countRecentForLoad (under cap)
//   4. loads row with loadNumber + pickupAddress + deliveryAddress
function queueHappyPath(opts: {
  loadId?: string;
  stage?: 'pickup_bol' | 'delivery_signed_bol';
  loadNumber?: string;
  pickupAddress?: string;
  deliveryAddress?: string;
}) {
  selectQueue.push([]); // dedup miss
  selectQueue.push([{ id: 'p1', loadId: opts.loadId ?? 'load-1', stage: opts.stage ?? 'pickup_bol' }]);
  selectQueue.push([{ c: 0 }]);
  selectQueue.push([
    {
      loadNumber: opts.loadNumber ?? 'LD-1',
      pickupAddress: opts.pickupAddress ?? '608 Salem Rd, Rossville, GA 30741',
      deliveryAddress: opts.deliveryAddress ?? '1200 County Road 4162, Springerville, AZ 85938',
    },
  ]);
}

describe('Phase 2 OCR — integration with processMMSReply', () => {
  beforeEach(() => {
    process.env.MMS_UPLOAD_ENABLED = 'true';
    delete process.env.ADDRESS_VERIFY_ENABLED;
    selectQueue.length = 0;
    dbState.updates.length = 0;
    dbState.inserts.length = 0;
    vi.clearAllMocks();
    mockExtract.mockReset();
  });

  describe('ADDRESS_VERIFY_ENABLED=false (default OFF)', () => {
    it('does NOT call OpenAI; saves ocrStatus=disabled; normal ✅ reply', async () => {
      queueHappyPath({});
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-off',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });
      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/✅/);
      expect(r.reply).toMatch(/LD-1/);
      // No mismatch SMS, no "Address verified", no extraction call.
      expect(r.reply).not.toMatch(/Address verified/);
      expect(r.reply).not.toMatch(/OVERRIDE/);
      expect(mockExtract).not.toHaveBeenCalled();
      // ocrStatus='disabled' was written exactly once.
      const ocrUpdates = dbState.updates.filter((u) => u.ocrStatus === 'disabled');
      expect(ocrUpdates.length).toBe(1);
    });
  });

  describe('ADDRESS_VERIFY_ENABLED=true — matched outcome', () => {
    it('saves ocrStatus=matched and appends "Address verified" to the ✅ reply', async () => {
      process.env.ADDRESS_VERIFY_ENABLED = 'true';
      queueHappyPath({
        stage: 'pickup_bol',
        pickupAddress: '608 Salem Rd, Rossville, GA 30741',
      });
      // OCR returns the exact pickup address — should match.
      mockExtract.mockResolvedValueOnce({
        ok: true,
        shipFrom: { street: '608 Salem Rd', city: 'Rossville', state: 'GA', zip: '30741' },
        shipTo: { street: '1200 County Rd', city: 'Springerville', state: 'AZ', zip: '85938' },
      });

      const r = await svc.processMMSReply({
        from: '+15551110001',
        messageSid: 'SM-match',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/✅/);
      expect(r.reply).toMatch(/Address verified \(Rossville, GA 30741\)/);
      // ocrStatus=matched persisted.
      const matched = dbState.updates.find((u) => u.ocrStatus === 'matched');
      expect(matched).toBeTruthy();
      expect(matched?.ocrExtractedPickup).toBe('Rossville, GA 30741');
      // CRITICAL: matched does NOT auto-approve for factoring. Dispatcher
      // review is still required (Phase 1 gate).
      expect(dbState.updates.some((u) => u.approvalStatus === 'approved')).toBe(false);
    });
  });

  describe('ADDRESS_VERIFY_ENABLED=true — mismatch outcome (the screenshot scenario)', () => {
    it('saves ocrStatus=mismatch and sends the OVERRIDE SMS with both addresses', async () => {
      process.env.ADDRESS_VERIFY_ENABLED = 'true';
      queueHappyPath({
        stage: 'pickup_bol',
        loadNumber: 'LD36529625',
        pickupAddress: '1200 County Road 4162, Springerville, AZ 85938',
      });
      // OCR returns the WRONG load's BOL — exactly the user's screenshot:
      // driver sent the Rossville BOL when prompted for the Springerville pickup.
      mockExtract.mockResolvedValueOnce({
        ok: true,
        shipFrom: { street: '608 Salem Rd', city: 'Rossville', state: 'GA', zip: '30741' },
        shipTo: { street: '1200 County Road 4162', city: 'Springerville', state: 'AZ', zip: '85938' },
      });

      const r = await svc.processMMSReply({
        from: '+15551110002',
        messageSid: 'SM-mismatch',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      // Driver-facing mismatch SMS — names both sides + OVERRIDE option +
      // payment-delay warning (the exact wording the user requested).
      expect(r.reply).toMatch(/⚠️/);
      expect(r.reply).toMatch(/Rossville/); // extracted
      expect(r.reply).toMatch(/Springerville/); // expected
      expect(r.reply).toMatch(/Load #LD36529625/);
      expect(r.reply).toMatch(/OVERRIDE/);
      expect(r.reply).toMatch(/payment for Load #LD36529625 will be delayed/);
      // ocrStatus=mismatch persisted.
      const mismatch = dbState.updates.find((u) => u.ocrStatus === 'mismatch');
      expect(mismatch).toBeTruthy();
      // CRITICAL: mismatch does NOT auto-approve. Photo stays
      // approvalStatus=pending so factoring can't pull it.
      expect(dbState.updates.some((u) => u.approvalStatus === 'approved')).toBe(false);
    });
  });

  describe('ADDRESS_VERIFY_ENABLED=true — unreadable (OCR returned incomplete address)', () => {
    it('saves ocrStatus=unreadable and falls back to ✅ reply with "dispatch will verify"', async () => {
      process.env.ADDRESS_VERIFY_ENABLED = 'true';
      queueHappyPath({ stage: 'pickup_bol' });
      // OCR returns shipFrom with no zip — handwritten BOL, blurry photo, etc.
      mockExtract.mockResolvedValueOnce({
        ok: true,
        shipFrom: { street: '608 Salem Rd', city: 'Rossville', state: 'GA', zip: null },
        shipTo: { street: 'somewhere', city: 'somewhere', state: 'XX', zip: '00000' },
      });

      const r = await svc.processMMSReply({
        from: '+15551110003',
        messageSid: 'SM-unread',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/✅/);
      expect(r.reply).toMatch(/Address auto-check incomplete — dispatch will verify/);
      // No false-positive mismatch SMS — that would frustrate drivers
      // who sent the right BOL but with a hard-to-read zip.
      expect(r.reply).not.toMatch(/OVERRIDE/);
      const unread = dbState.updates.find((u) => u.ocrStatus === 'unreadable');
      expect(unread).toBeTruthy();
    });
  });

  describe('ADDRESS_VERIFY_ENABLED=true — OpenAI error/timeout', () => {
    it('saves ocrStatus=error and falls back to plain ✅ reply (no driver-facing failure)', async () => {
      process.env.ADDRESS_VERIFY_ENABLED = 'true';
      queueHappyPath({ stage: 'pickup_bol' });
      mockExtract.mockResolvedValueOnce({ ok: false, error: 'OpenAI vision call exceeded 5000ms' });

      const r = await svc.processMMSReply({
        from: '+15551110004',
        messageSid: 'SM-err',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/✅/);
      // Driver never sees the OpenAI error — they just get a normal ✅.
      expect(r.reply).not.toMatch(/OpenAI/);
      expect(r.reply).not.toMatch(/error/i);
      const err = dbState.updates.find((u) => u.ocrStatus === 'error');
      expect(err).toBeTruthy();
    });
  });

  describe('per-driver hourly cap (defense in depth)', () => {
    it('skips OpenAI after PER_DRIVER_OCR_PER_HOUR calls; saves ocrStatus=disabled', async () => {
      process.env.ADDRESS_VERIFY_ENABLED = 'true';
      const phone = '+15559990000';
      // Burn the cap with stubs (matched outcomes keep it cheap to set up).
      for (let i = 0; i < 10; i++) {
        svc.recordOcrAttempt(phone);
      }
      expect(svc.canRunOcrForDriver(phone)).toBe(false);

      queueHappyPath({ stage: 'pickup_bol' });
      const r = await svc.processMMSReply({
        from: phone,
        messageSid: 'SM-cap',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/✅/);
      expect(mockExtract).not.toHaveBeenCalled();
      const dis = dbState.updates.find((u) => u.ocrStatus === 'disabled');
      expect(dis).toBeTruthy();
    });
  });
});

describe('Phase 2 OCR — OVERRIDE handler', () => {
  beforeEach(() => {
    process.env.MMS_UPLOAD_ENABLED = 'true';
    selectQueue.length = 0;
    dbState.updates.length = 0;
    dbState.inserts.length = 0;
    vi.clearAllMocks();
    mockExtract.mockReset();
  });

  it('stamps ocrStatus=override + acknowledgement columns, does NOT touch approvalStatus', async () => {
    // OVERRIDE handler select sequence:
    //   1. recent fulfilled pendingUploads row
    //   2. matching load_documents row in 'mismatch' state
    //   3. loads.loadNumber lookup
    selectQueue.push([
      { loadId: 'load-x', stage: 'pickup_bol', fulfilledMessageSid: 'SM-original-photo' },
    ]);
    selectQueue.push([{ id: 'doc-x', ocrStatus: 'mismatch' }]);
    selectQueue.push([{ loadNumber: 'LD-X' }]);

    const r = await svc.processMMSReply({
      from: '+15551110005',
      messageSid: 'SM-override',
      body: 'OVERRIDE',
      numMedia: 0,
    });

    expect(r.handled).toBe(true);
    expect(r.reply).toMatch(/Override recorded for Load #LD-X/);
    expect(r.reply).toMatch(/dispatcher approval/);

    // The single update on load_documents must set ocrStatus + override
    // columns and MUST NOT include approvalStatus.
    const overrideUpdate = dbState.updates.find((u) => u.ocrStatus === 'override');
    expect(overrideUpdate).toBeTruthy();
    expect(overrideUpdate?.overrideAcknowledgedAt).toBeInstanceOf(Date);
    expect(overrideUpdate?.overrideMessageSid).toBe('SM-override');
    expect(overrideUpdate?.approvalStatus).toBeUndefined();
    // CRITICAL regression guard: no update anywhere in this flow can
    // set approvalStatus='approved'. Phase 1's factoring gate must
    // stay binding.
    expect(dbState.updates.some((u) => u.approvalStatus === 'approved')).toBe(false);
  });

  it('rejects when there is no recent fulfilled upload for this phone', async () => {
    selectQueue.push([]); // no recent pending

    const r = await svc.processMMSReply({
      from: '+15551110006',
      messageSid: 'SM-noop-override',
      body: 'OVERRIDE',
      numMedia: 0,
    });

    expect(r.handled).toBe(true);
    expect(r.reply).toMatch(/No recent BOL upload found/);
    // No load_documents writes at all.
    expect(dbState.updates.length).toBe(0);
  });

  it('rejects when the most recent upload is NOT in mismatch state', async () => {
    selectQueue.push([
      { loadId: 'load-y', stage: 'pickup_bol', fulfilledMessageSid: 'SM-good' },
    ]);
    selectQueue.push([{ id: 'doc-y', ocrStatus: 'matched' }]);

    const r = await svc.processMMSReply({
      from: '+15551110007',
      messageSid: 'SM-pointless-override',
      body: 'OVERRIDE',
      numMedia: 0,
    });

    expect(r.handled).toBe(true);
    expect(r.reply).toMatch(/not flagged for mismatch/);
    expect(dbState.updates.length).toBe(0);
  });

  it('returns handled=false when MMS_UPLOAD_ENABLED is off (falls through to legacy)', async () => {
    delete process.env.MMS_UPLOAD_ENABLED;
    const r = await svc.processMMSReply({
      from: '+15551110008',
      messageSid: 'SM-flag-off-override',
      body: 'OVERRIDE',
      numMedia: 0,
    });
    expect(r.handled).toBe(false);
  });
});
