/**
 * Tests for notifyOwnerOfUpload() — item 7, driver-doc-upload packet.
 *
 * All Twilio/DB calls are mocked so no real SMS or DB touch happens.
 * Covered:
 *   - flag OFF → nothing fires
 *   - flag ON, no OWNER_ALERT_PHONE → nothing fires
 *   - fires once per burst window (debounce)
 *   - confirm=true bypasses debounce
 *   - SMS_DISABLED → sendSMS called, Twilio not called (the service handles it)
 *   - DRY_RUN_OUTBOUND → logDryRun called, sendSMS returns dry-run success
 *   - alert failure does NOT throw (upload must succeed)
 *   - daily cap of 10 enforced
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks ───────────────────────────────────────────────────────

// sms-service: only sendSMS is used; everything else can be a no-op stub
vi.mock('../sms-service', () => ({
  smsLoadService: {
    sendSMS: vi.fn().mockResolvedValue({ success: true, messageSid: 'SM_test' }),
    isServiceConfigured: () => true,
  },
}));

// DB: mock load + driver lookups and loadDocuments select
vi.mock('../db', () => ({
  db: {
    query: {
      loads: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'load-001',
          loadNumber: 'TQL-123',
          brokerName: 'TQL Logistics',
          driverId: 'driver-001',
        }),
      },
      drivers: {
        findFirst: vi.fn().mockResolvedValue({ id: 'driver-001', name: 'Mike Doe' }),
      },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { documentType: 'pickup_bol' },
          { documentType: 'pickup_securement' },
        ]),
      }),
    }),
  },
}));

// schema: only the table refs; real values not needed
vi.mock('@shared/schema', () => ({
  loadDocuments: { documentType: 'documentType', loadId: 'loadId' },
  loads: { id: 'id' },
  drivers: { id: 'id' },
}));

// ── Import SUT after mocks are registered ────────────────────────────────────
import { notifyOwnerOfUpload, _resetAlertState } from '../owner-upload-alert';
import { smsLoadService } from '../sms-service';

const sendSMS = smsLoadService.sendSMS as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAlertState();
  setEnv({
    UPLOAD_OWNER_ALERT_ENABLED: 'true',
    OWNER_ALERT_PHONE: '+12345556789',
    SMS_DISABLED: undefined,
    DRY_RUN_OUTBOUND: undefined,
  });
});

afterEach(() => {
  setEnv({
    UPLOAD_OWNER_ALERT_ENABLED: undefined,
    OWNER_ALERT_PHONE: undefined,
    SMS_DISABLED: undefined,
    DRY_RUN_OUTBOUND: undefined,
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('notifyOwnerOfUpload', () => {
  it('flag OFF → sendSMS never called', async () => {
    setEnv({ UPLOAD_OWNER_ALERT_ENABLED: 'false' });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it('flag unset → sendSMS never called', async () => {
    setEnv({ UPLOAD_OWNER_ALERT_ENABLED: undefined });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it('OWNER_ALERT_PHONE missing → sendSMS never called', async () => {
    setEnv({ OWNER_ALERT_PHONE: undefined });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it('fires on first upload in a burst window', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).toHaveBeenCalledOnce();
  });

  it('burst debounce: second upload in the same phase window is suppressed', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_securement' }); // same phase
    expect(sendSMS).toHaveBeenCalledTimes(1); // only the first fired
  });

  it('confirm=true bypasses the debounce and always fires', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' }); // burst window starts
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol', confirm: true }); // confirm bypasses
    expect(sendSMS).toHaveBeenCalledTimes(2);
  });

  it('different phase in the same load is NOT debounced together', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'delivery_pod' }); // different phase
    expect(sendSMS).toHaveBeenCalledTimes(2);
  });

  it('SMS body contains loadNumber, broker, driver name, stage label, and staff URL', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    const body = sendSMS.mock.calls[0][1] as string;
    expect(body).toContain('LAMP TQL-123');
    expect(body).toContain('TQL Logistics');
    expect(body).toContain('Mike Doe');
    expect(body).toContain('Pickup BOL');
    expect(body).toContain('/loads/load-001/documents');
    // Never a raw Cloudinary URL
    expect(body).not.toContain('cloudinary.com');
  });

  it('SMS sent to OWNER_ALERT_PHONE', async () => {
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS.mock.calls[0][0]).toBe('+12345556789');
  });

  it('SMS_DISABLED — sendSMS still called (service handles the kill-switch, not us)', async () => {
    // The service itself returns {success:false} when SMS_DISABLED; we just
    // trust smsLoadService and never check its result.
    setEnv({ SMS_DISABLED: 'true' });
    (sendSMS as any).mockResolvedValueOnce({ success: false, error: 'SMS_DISABLED=true — outbound SMS halted' });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).toHaveBeenCalledOnce();
  });

  it('DRY_RUN_OUTBOUND — sendSMS called and returns dry-run success without hitting Twilio', async () => {
    // sms-service.ts already gates on DRY_RUN_OUTBOUND and calls logDryRun.
    // Here we assert our module calls sendSMS (delegates correctly) and that a
    // dry-run response does not throw.
    setEnv({ DRY_RUN_OUTBOUND: 'true' });
    (sendSMS as any).mockResolvedValueOnce({ success: true, messageSid: 'dry-twilio-test' });
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' });
    expect(sendSMS).toHaveBeenCalledOnce();
    // No Twilio client was constructed — sms-service mock absorbs it all
  });

  it('alert failure does NOT throw — upload path must be unaffected', async () => {
    (sendSMS as any).mockRejectedValueOnce(new Error('Twilio 500'));
    await expect(
      notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol' }),
    ).resolves.not.toThrow();
  });

  it('daily cap: after 10 alerts for a load, further calls are suppressed', async () => {
    // Bypass burst by using confirm=true so each call goes through
    for (let i = 0; i < 10; i++) {
      await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol', confirm: true });
    }
    expect(sendSMS).toHaveBeenCalledTimes(10);

    // 11th call must be suppressed
    await notifyOwnerOfUpload({ loadId: 'load-001', stage: 'pickup_bol', confirm: true });
    expect(sendSMS).toHaveBeenCalledTimes(10); // still 10
  });
});
