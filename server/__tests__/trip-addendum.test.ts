// Regression guard for the per-load Trip Lease Addendum (server/trip-addendum-service.ts).
//
// The assert that protects existing dispatch: a driver who is NOT split-authority must
// never reach this path, even with TRIP_ADDENDUM_ENABLED=true. Every driver in the
// database defaults to split_authority_enabled=false, so if shouldCreateTripAddendum
// ever returns true on that input, the addendum fires on every ordinary dispatch.
//
// The assert that protects the interlock: the prefill keys must match the DocuSeal text
// tags in build/source.html verbatim. A renamed tag breaks prefill SILENTLY — DocuSeal
// ignores unknown field names rather than erroring — so `Coverage Verified` would ship
// blank and the Section 10.4 gate would look satisfied on paper when it was never
// evaluated.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  shouldCreateTripAddendum,
  templateIdForPowerUnit,
  addendumNumberForLoad,
  buildAddendumPrefill,
  type AddendumLoad,
  type SplitAuthorityDriver,
} from '../trip-addendum-service';

const driver: SplitAuthorityDriver = {
  id: 'd1',
  name: 'Marcus Webb',
  email: 'marcus@example.com',
  splitAuthorityEnabled: true,
  ownMcNumber: 'MC-1234567',
  ownDotNumber: '4123456',
  powerUnitType: 'box_truck',
};

const load: AddendumLoad = {
  id: 'l1',
  loadNumber: 'L-9042',
  brokerName: 'Coyote',
  originCity: 'Chattanooga',
  originState: 'TN',
  pickupAddress: '100 Wilcox Blvd, Chattanooga, TN',
  pickupDate: new Date('2026-09-10T00:00:00Z'),
  pickupTime: '08:00',
  deliveryAddress: 'Atlanta, GA',
  deliveryDate: new Date('2026-09-12T00:00:00Z'),
  deliveryTime: '15:00',
  commodity: 'Palletized dry goods',
  rate: 1500,
  driverId: 'd1',
};

describe('shouldCreateTripAddendum', () => {
  it('fires only when the env flag AND the driver flag are both on', () => {
    expect(shouldCreateTripAddendum({ splitAuthorityEnabled: true, envEnabled: 'true' })).toBe(true);
  });

  it('never fires for an ordinary driver, even with the feature enabled', () => {
    expect(shouldCreateTripAddendum({ splitAuthorityEnabled: false, envEnabled: 'true' })).toBe(
      false,
    );
  });

  it('never fires while the env flag is off, even for a split-authority driver', () => {
    expect(shouldCreateTripAddendum({ splitAuthorityEnabled: true, envEnabled: undefined })).toBe(
      false,
    );
    expect(shouldCreateTripAddendum({ splitAuthorityEnabled: true, envEnabled: 'false' })).toBe(
      false,
    );
    expect(shouldCreateTripAddendum({ splitAuthorityEnabled: true, envEnabled: '1' })).toBe(false);
  });
});

describe('templateIdForPowerUnit', () => {
  const env = {
    DOCUSEAL_TRIP_ADDENDUM_BOX_TEMPLATE_ID: '31',
    DOCUSEAL_TRIP_ADDENDUM_TRACTOR_TEMPLATE_ID: '32',
  } as any;

  it('defaults to the box truck template — the fleet is box trucks', () => {
    expect(templateIdForPowerUnit('box_truck', env)).toBe('31');
    expect(templateIdForPowerUnit(null, env)).toBe('31');
    expect(templateIdForPowerUnit('', env)).toBe('31');
    expect(templateIdForPowerUnit('anything_unknown', env)).toBe('31');
  });

  it('uses the tractor template only on an explicit tractor value', () => {
    expect(templateIdForPowerUnit('tractor', env)).toBe('32');
    expect(templateIdForPowerUnit('TRACTOR_TRAILER', env)).toBe('32');
    expect(templateIdForPowerUnit('semi', env)).toBe('32');
  });

  it('returns null when the template is not configured, so creation refuses', () => {
    expect(templateIdForPowerUnit('box_truck', {} as any)).toBeNull();
    expect(templateIdForPowerUnit('box_truck', { DOCUSEAL_TRIP_ADDENDUM_BOX_TEMPLATE_ID: '  ' } as any)).toBeNull();
  });
});

describe('addendumNumberForLoad', () => {
  it('is derived from the load number so a retry reuses it', () => {
    expect(addendumNumberForLoad('L-9042')).toBe('TLA-L-9042');
    expect(addendumNumberForLoad('L-9042')).toBe(addendumNumberForLoad('L-9042'));
  });
});

describe('buildAddendumPrefill', () => {
  it('carries the coverage verdict rather than a typed-in value', () => {
    expect(buildAddendumPrefill(load, driver, true, null)['Coverage Verified']).toBe(true);
    expect(buildAddendumPrefill(load, driver, false, null)['Coverage Verified']).toBe(false);
  });

  it('fills the load and lessor identity fields', () => {
    const v = buildAddendumPrefill(load, driver, true, new Date('2026-09-09T00:00:00Z'));
    expect(v['Addendum Number']).toBe('TLA-L-9042');
    expect(v['Lessor MC Number']).toBe('MC-1234567');
    expect(v['Origin City State']).toBe('Chattanooga, TN');
    expect(v['Pickup DateTime']).toBe('2026-09-10 08:00');
    expect(v['Master Agreement Date']).toBe('2026-09-09');
  });

  it('falls back to the pickup address when city and state are absent', () => {
    const v = buildAddendumPrefill({ ...load, originCity: null, originState: null }, driver, true, null);
    expect(v['Origin City State']).toBe('100 Wilcox Blvd, Chattanooga, TN');
  });

  it('every prefill key exists as a DocuSeal tag on BOTH addendum templates', () => {
    const src = readFileSync(
      join(__dirname, '../../docs/docuseal-templates/build/source.html'),
      'utf8',
    );
    const section = (marker: string) => {
      const start = src.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const next = src.indexOf('<!--DOC:', start + marker.length);
      return src.slice(start, next === -1 ? undefined : next);
    };
    const box = section('<!--DOC:16-trip-lease-addendum-->');
    const tractor = section('<!--DOC:17-trip-lease-addendum-tractor-->');

    for (const key of Object.keys(buildAddendumPrefill(load, driver, true, null))) {
      expect(box, `"${key}" missing from box truck template`).toContain(`{{${key};`);
      expect(tractor, `"${key}" missing from tractor template`).toContain(`{{${key};`);
    }
  });

  it('pins the box truck template to its box-specific fields', () => {
    const src = readFileSync(
      join(__dirname, '../../docs/docuseal-templates/build/source.html'),
      'utf8',
    );
    const start = src.indexOf('<!--DOC:16-trip-lease-addendum-->');
    const box = src.slice(start, src.indexOf('<!--DOC:', start + 40));
    for (const tag of ['Box Length', 'Has Liftgate', 'Has Ramp', 'Dock Height', 'License Class']) {
      expect(box).toContain(`{{${tag};`);
    }
    // A trailer field on a box truck lease is a drafting error.
    expect(box).not.toContain('{{Trailer VIN;');
  });
});
