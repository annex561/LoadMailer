// Link to a driver's tokenized portal (/driver/:token, server/driver-portal.ts).
// drivers.trackingToken is the driver's only credential, so every SMS that sends
// a driver "their portal" must use this, never /mobile-driver-dashboard?driverId=.
// Kept db-free for server/__tests__/driver-portal-link.test.ts.

type TokenDriver = { id: string; trackingToken?: string | null; tracking_token?: string | null };
type TokenStore = { generateTrackingToken(driverId: string): Promise<{ token: string } | undefined> };

// The driver's existing token, minted only when the driver has none.
// generateTrackingToken overwrites, which kills every portal link and open
// /driver-tracker tab the driver already has. Reads tracking_token too:
// storage.getDriver/getAllDrivers fall back to raw SQL rows (snake_case).
export async function ensureTrackingToken(driver: TokenDriver, store: TokenStore): Promise<string> {
  const token =
    driver.trackingToken || driver.tracking_token || (await store.generateTrackingToken(driver.id))?.token;
  if (!token) throw new Error(`Could not mint tracking token for driver ${driver.id}`);
  return token;
}

export async function driverPortalUrl(baseUrl: string, driver: TokenDriver, store: TokenStore): Promise<string> {
  return `${baseUrl}/driver/${await ensureTrackingToken(driver, store)}`;
}
