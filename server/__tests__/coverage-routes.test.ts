// Regression guard for the COI write path (server/coverage-routes.ts).
//
// THE ASSERT THAT MATTERS: a COI row must never carry a truck_id.
//
// server/dispatch-gate-service.ts:17 selects compliance_documents BY truck_id and
// returns RED on any expired row; validateBooking() then THROWS "Booking Blocked" on
// the booking path in server/ga-loads-router.ts:393. If sanitizeCoiInput ever lets a
// caller-supplied truckId through, an expired certificate silently hard-blocks that
// truck from booking any load. That is a live behaviour change to a working workflow
// and it is not what this feature is for.

import { describe, it, expect } from 'vitest';
import { sanitizeCoiInput } from '../coverage-routes';
import { REQUIRED_COI_TYPES } from '../coi-service';

const base = { driverId: 'd1', type: 'coi_auto_liability', expiryDate: '2027-01-01' };

describe('sanitizeCoiInput', () => {
  it('always forces truckId to null, even when the caller supplies one', () => {
    const out = sanitizeCoiInput({ ...base, truckId: 'truck-123' }) as any;
    expect(out.error).toBeUndefined();
    expect(out.truckId).toBeNull();
  });

  it('forces truckId to null on every accepted coverage type', () => {
    for (const type of REQUIRED_COI_TYPES) {
      const out = sanitizeCoiInput({ ...base, type, truckId: 'truck-123' }) as any;
      expect(out.truckId).toBeNull();
    }
  });

  it('accepts every required coverage type', () => {
    for (const type of REQUIRED_COI_TYPES) {
      expect(sanitizeCoiInput({ ...base, type })).not.toHaveProperty('error');
    }
  });

  it('rejects a coverage type outside the required set', () => {
    expect(sanitizeCoiInput({ ...base, type: 'coi_made_up' })).toHaveProperty('error');
  });

  it('rejects a missing driverId', () => {
    expect(sanitizeCoiInput({ ...base, driverId: '  ' })).toHaveProperty('error');
  });

  it('rejects a missing or unparseable expiry', () => {
    expect(sanitizeCoiInput({ ...base, expiryDate: undefined })).toHaveProperty('error');
    expect(sanitizeCoiInput({ ...base, expiryDate: 'not a date' })).toHaveProperty('error');
  });

  it('defaults status to active', () => {
    expect((sanitizeCoiInput(base) as any).status).toBe('active');
  });
});
