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
// three times in a fixed order:
//   1. dedup lookup by fulfilled_message_sid          → array of {id} or []
//   2. findPendingForPhone (via .orderBy().limit())   → array of pending row or []
//   3. countRecentForLoad (via select({c}).where())   → array of {c: number}
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
      // db.select calls in order: dedup-lookup, findPendingForPhone, countRecentForLoad
      selectQueue.push([]); // dedup miss
      selectQueue.push([{ id: 'p1', loadId: 'load-1', stage: 'pickup_bol' }]);
      selectQueue.push([{ c: 0 }]); // count under cap

      const r = await svc.processMMSReply({
        from: '+15551110000',
        messageSid: 'SM-new',
        mediaUrl: 'https://api.twilio.test/m/1',
        numMedia: 1,
      });

      expect(r.handled).toBe(true);
      expect(r.reply).toMatch(/Got it/);
      expect(r.reply).toMatch(/Securement/);

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
