// Link to a driver's tokenized portal (/driver/:token, server/driver-portal.ts).
// drivers.trackingToken is the driver's only credential, so every SMS that sends
// a driver "their portal" must use this, never /mobile-driver-dashboard?driverId=.
//
// Mints a token only when the driver has none: generateTrackingToken overwrites,
// which would kill every portal link the driver already has. Reads tracking_token
// too: storage.getDriver/getAllDrivers fall back to raw SQL rows (snake_case).
// Kept db-free for server/__tests__/driver-portal-link.test.ts.
export async function driverPortalUrl(
  baseUrl: string,
  driver: { id: string; trackingToken?: string | null; tracking_token?: string | null },
  store: { generateTrackingToken(driverId: string): Promise<{ token: string } | undefined> },
): Promise<string> {
  let token = driver.trackingToken || driver.tracking_token;
  if (!token) {
    token = (await store.generateTrackingToken(driver.id))?.token;
    if (!token) throw new Error(`Could not mint portal token for driver ${driver.id}`);
  }
  return `${baseUrl}/driver/${token}`;
}
