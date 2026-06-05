// Example load shown to brand-new drivers with zero active loads.
// Extracted from driver-portal.ts so it can be unit-tested without pulling in
// the db connection. Regression-tested in
// server/__tests__/driver-portal-example-load.test.ts.

export const EXAMPLE_LOAD = {
  id: 'example',
  loadNumber: 'EXAMPLE-1042',
  originCity: 'Atlanta', originState: 'GA',
  destCity: 'Nashville', destState: 'TN',
  pickupAddress: '1100 Fulton Industrial Blvd SW, Atlanta, GA 30336',
  deliveryAddress: '400 Davidson St, Nashville, TN 37213',
  miles: 250,
  rate: 875,
} as const;

/**
 * A new driver with zero active loads sees the example card. The moment they
 * have a real active load (count > 0), the example disappears.
 *
 * Tripwire: if this predicate or EXAMPLE_LOAD.id ('example') changes, the
 * renderLoadDetail short-circuit (loadId === 'example') and the home/loads
 * empty-state must change too — the test guards that contract.
 */
export function shouldShowExampleLoad(activeLoadCount: number): boolean {
  return activeLoadCount === 0;
}
