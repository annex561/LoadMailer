/**
 * Regression + functional tests for MMS BOL upload routing.
 *
 * The financial-safety guards (default-off flag, MessageSid dedup, per-load
 * rate cap) are load-bearing per the CLAUDE.md ABSOLUTE RULE — these tests
 * exist so a future refactor can't silently strip them.
 *
 * History: 9 PRs (#83-#93) tried to fix the browser-based BOL upload. The
 * MMS-reply path is the architectural replacement. See
 * ~/.claude/plans/mms-bol-upload-CONTEXT.md.
 *
 * DO NOT delete. If a test breaks, find the regression — don't delete the test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sequential-response mock for db.select. processMMSReply calls db.select
// four times in a fixed order:
//   1. dedup lookup by fulfilled_message_sid          → array of {id} or []
//   2. findPendingForPhone (via .orderBy().limit())   → array of pending row or []
//   3. countRecentForLoad (via select({c}).where())   → array of {c: number}
//   4. loads.loadNumber lookup for the user-facing reply → [{loadNumber: '...'}]
// Tests push expected return shapes into selectQueue before calling
// processMMSReply. The mock pops in order.
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
      limit: async (_n: number) => Array.isArray(result) ? result : [],
    };
    // For the count query: db.select({c}).from().where() is awaited directly.
    // .where() must return a thenable when followed by await.
    chain.where = (_w: any) => {
      const c: any = {
        ...chain,
        then: (resolve: any) => resolve(Array.isArray(result) ? result : []),
        orderBy: () => chain,
        limit: async (_n: number) => Array.isArray(result) ? result : [],
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
  uploadLoadPhoto: vi.fn(async (p: any) => {
    return { ok: true, url: `https://cloudinary.test/${p.stage}.jpg`, docId: 'd-' + p.stage };
  }),
}));

global.fetch = vi.fn(async () => ({
  ok: true,
  headers: { get: () => 'image/jpeg' },
  arrayBuffer: async () => new ArrayBuffer(16),
})) as any;

process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.TWILIO_AUTH_TOKEN = 'tok';

import * as svc from '../mms-upload-service';

describe('MMS BOL upload — financial safety guards', () => {
  beforeEach(() => {
    delete process.env.MMS_UPLOAD_ENABLED;
    selectQueue.length = 0;
    dbState.updates.length = 0;
    dbState.inserts.length = 0;
    vi.clearAllMocks();
  });

  describe('flag gate', () => {
    it('returns handled=false when MMS_UPLOAD_ENABLED is unset', async () => {
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM1',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });
      expect(r.handled).toBe(false);
    });

    it('returns handled=false when MMS_UPLOAD_ENABLED is "false"', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'false';
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM1',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });
      expect(r.handled).toBe(false);
    });

    it('isMMSUploadEnabled reflects env var exactly', () => {
      delete process.env.MMS_UPLOAD_ENABLED;
      expect(svc.isMMSUploadEnabled()).toBe(false);
      process.env.MMS_UPLOAD_ENABLED = 'true';
      expect(svc.isMMSUploadEnabled()).toBe(true);
      process.env.MMS_UPLOAD_ENABLED = 'false';
      expect(svc.isMMSUploadEnabled()).toBe(false);
    });
  });

  describe('media presence gate', () => {
    it('returns handled=false when numMedia is 0 (regular SMS, no photo)', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM1',
        numMedia: 0,
      });
      expect(r.handled).toBe(false);
    });
  });

  describe('routing + dedup', () => {
    it('routes to the pending stage and writes one document', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      // db.select calls in order: dedup, findPendingForPhone, countRecentForLoad, loadNumber-lookup
      selectQueue.push([]); // dedup miss
      selectQueue.push([{ id: 'p1', loadId: 'load-1', stage: 'pickup_bol' }]);
      selectQueue.push([{ c: 0 }]); // count under cap
      selectQueue.push([{ loadNumber: 'LD-1' }]); // user-facing load number

      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-new',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      // Fix A: reply must name the load number so the driver can verify.
      expect(r.reply).toMatch(/LD-1/);
      expect(r.reply).toMatch(/Securement/);
      expect(r.reply).toMatch(/WRONG/); // "Reply WRONG if this load number is incorrect"

      const { uploadLoadPhoto } = await import('../load-photos-service');
      const calls = (uploadLoadPhoto as any).mock.calls;
      expect(calls.length).toBe(1);
      const arg = calls[0][0];
      expect(arg.loadId).toBe('load-1');
      expect(arg.stage).toBe('pickup_bol');

      // markFulfilled was called → exactly one update with fulfilledMessageSid
      const fulfillUpdates = dbState.updates.filter((u) => u.fulfilledMessageSid === 'SM-new');
      expect(fulfillUpdates.length).toBe(1);
    });

    it('replaying the same MessageSid does NOT write a second document', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      // Second invocation: dedup-lookup returns a hit → short-circuits before
      // findPendingForPhone or count or upload.
      selectQueue.push([{ id: 'already-fulfilled-row' }]);

      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-dup',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/Already received/);

      const { uploadLoadPhoto } = await import('../load-photos-service');
      expect((uploadLoadPhoto as any).mock.calls.length).toBe(0);
      expect(dbState.updates.length).toBe(0);
    });
  });

  describe('per-load hourly cap', () => {
    it('rejects when PER_LOAD_HOURLY_CAP reached', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      selectQueue.push([]); // dedup miss
      selectQueue.push([{ id: 'p1', loadId: 'load-1', stage: 'pickup_bol' }]);
      selectQueue.push([{ c: svc.PER_LOAD_HOURLY_CAP }]); // at cap

      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-spam',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });
      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/Too many uploads/);

      const { uploadLoadPhoto } = await import('../load-photos-service');
      expect((uploadLoadPhoto as any).mock.calls.length).toBe(0);
    });

    it('PER_LOAD_HOURLY_CAP constant is exported and >= 1', () => {
      expect(svc.PER_LOAD_HOURLY_CAP).toBeGreaterThanOrEqual(1);
    });
  });

  describe('WRONG reply (Fix A — driver flags incorrect-load attachment)', () => {
    it('triggers WRONG handler on body="WRONG" with no media', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      // handleWrongReply selects: recent fulfilled row, then loadNumber.
      selectQueue.push([{
        id: 'p1', loadId: 'load-1', stage: 'pickup_bol',
        fulfilledMessageSid: 'SM-prev',
      }]);
      selectQueue.push([{ loadNumber: 'LD-1' }]);

      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-wrong',
        body: 'WRONG',
        numMedia: 0,
      });
      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/Flagged the last photo/);
      expect(r.reply).toMatch(/LD-1/);
      // Should have rejected the load_documents row and cleared pending.
      const rejections = dbState.updates.filter(
        (u) => u.approvalStatus === 'rejected',
      );
      expect(rejections.length).toBeGreaterThanOrEqual(1);
    });

    it('matches case-insensitive "wrong" and "wrong load" variants', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      selectQueue.push([{
        id: 'p1', loadId: 'load-1', stage: 'pickup_bol',
        fulfilledMessageSid: 'SM-prev',
      }]);
      selectQueue.push([{ loadNumber: 'LD-1' }]);
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-wrong2',
        body: 'wrong load',
        numMedia: 0,
      });
      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/Flagged the last photo/);
    });

    it('does NOT trigger WRONG handler on a regular reply containing "wrong" mid-sentence', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      // No queue entries needed — regex match fails fast, falls through.
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-x',
        body: 'something went wrong with the GPS',
        numMedia: 0,
      });
      // Body has no media AND no leading WRONG token, so returns false.
      expect(r.handled).toBe(false);
    });

    it('with no prior fulfilled upload, surfaces a helpful message', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      selectQueue.push([]); // no recent pending row for this phone
      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-wrong3',
        body: 'WRONG',
        numMedia: 0,
      });
      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/No recent upload found/);
    });
  });

  describe('no pending row → fall-through', () => {
    it('returns handled=false when no pending upload exists for the phone', async () => {
      process.env.MMS_UPLOAD_ENABLED = 'true';
      selectQueue.push([]); // dedup miss
      selectQueue.push([]); // no pending row

      const r = await svc.processMMSReply({
        from: '+15559999999',
        messageSid: 'SM-orphan',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });
      expect(r.handled).toBe(false);
    });
  });

  describe('phone normalization (regression: format-mismatch caused fall-through to legacy verifier)', () => {
    it('phoneVariants generates all common storage shapes for a US number', () => {
      const variants = svc.phoneVariants('+15551234567');
      expect(variants).toContain('+15551234567');
      expect(variants).toContain('15551234567');
      expect(variants).toContain('5551234567');
      expect(variants).toContain('(555) 123-4567');
      expect(variants).toContain('555-123-4567');
    });

    it('phoneVariants handles non-E.164 inputs (10-digit)', () => {
      const variants = svc.phoneVariants('5551234567');
      expect(variants).toContain('+15551234567');
      expect(variants).toContain('5551234567');
    });

    it('phoneVariants handles pretty inputs', () => {
      const variants = svc.phoneVariants('(555) 123-4567');
      expect(variants).toContain('+15551234567');
      expect(variants).toContain('5551234567');
    });

    it('toE164 normalizes any common US shape to +1XXXXXXXXXX', () => {
      expect(svc.toE164('+15551234567')).toBe('+15551234567');
      expect(svc.toE164('15551234567')).toBe('+15551234567');
      expect(svc.toE164('5551234567')).toBe('+15551234567');
      expect(svc.toE164('(555) 123-4567')).toBe('+15551234567');
      expect(svc.toE164('555-123-4567')).toBe('+15551234567');
    });

    it('toE164 leaves unrecognized inputs unchanged (no destruction)', () => {
      expect(svc.toE164('')).toBe('');
      expect(svc.toE164('not-a-phone')).toBe('not-a-phone');
    });
  });

  describe('stage progression', () => {
    it('nextStage walks the full chain', () => {
      expect(svc.nextStage('pickup_bol')).toBe('pickup_securement');
      expect(svc.nextStage('pickup_securement')).toBe('delivery_pod');
      expect(svc.nextStage('delivery_pod')).toBe('delivery_signed_bol');
      expect(svc.nextStage('delivery_signed_bol')).toBeNull();
    });

    it('STAGE_REPLY_LABEL covers all PhotoStage values', () => {
      expect(svc.STAGE_REPLY_LABEL.pickup_bol).toBeTruthy();
      expect(svc.STAGE_REPLY_LABEL.pickup_securement).toBeTruthy();
      expect(svc.STAGE_REPLY_LABEL.delivery_pod).toBeTruthy();
      expect(svc.STAGE_REPLY_LABEL.delivery_signed_bol).toBeTruthy();
    });
  });
});
