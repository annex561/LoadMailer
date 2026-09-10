# The DAT scraper map

Traced against `origin/main` on 2026-09-10, because "there are eleven DAT scrapers, keep the one
that works and delete the rest" turned out to be wrong and acting on it would have broken live
routes. This file records what is actually wired, so nobody pays for the tracing twice.

## What is live

Fourteen `dat-*` modules exist under `server/`. **Nine are reachable.** They are not
duplicates of one job; they are wired into different endpoints and different callers.

| Module | Reached by | Notes |
|---|---|---|
| `dat-api-service.ts` | `server/routes.ts` | |
| `dat-load-poster.ts` | `server/routes.ts` | posts trucks back to the board |
| `dat-puppeteer-scraper.ts` | `server/routes.ts` | |
| `dat-scraper-service.ts` | `server/routes.ts` | |
| `dat-website-scraper.ts` | `server/routes.ts` | |
| `real-dat-scraper.ts` | `server/routes.ts` (2 sites) | |
| `dat-scraper.ts` | `load-board-service.ts`, `scheduler-service.ts` | the scheduled path |
| `session-based-dat-scraper.ts` | **`server/index.ts:430`, dynamic `await import()`** | invisible to a static import grep |
| `dat-login-monitor.ts` | `dat-loads-direct.ts` | pulls in `proven-dat-scraper` + `simplified-dat-scraper` |

`proven-dat-scraper.ts` and `simplified-dat-scraper.ts` are reachable only through
`dat-login-monitor.ts`, which is reachable only through `dat-loads-direct.ts` — which is itself
never imported. See the bug below.

**Deleted in this branch** (zero references by any mechanism, exported symbols never used):
`manual-dat-login.ts`, `simple-dat-connector.ts`.

## Do NOT

- **Do not trust a static grep for `from './dat-…'` to tell you what is dead.**
  `session-based-dat-scraper` has zero static importers and is loaded at boot by a dynamic
  `await import()` in `server/index.ts`. Grep for the bare module name across `server/` and
  `client/src`, not just for import statements.
- **Do not delete a module because nothing imports it.** `dat-loads-direct.ts` has zero
  importers and still owns a route path three client components call by URL.
- **Do not "consolidate" the remaining nine behind one interface as a cleanup task.** Six of
  them hang off distinct `routes.ts` endpoints. Changing that is a live-route refactor and needs
  a plan the operator confirms first (Production Stability rule 17), not a tidy-up commit.

## Open bug — `/api/dat-loads-direct` is never registered

`server/dat-loads-direct.ts:109` exports `setupDirectDATLoads(app)`. **Nothing calls it.** The
route it would register, `GET /api/dat-loads-direct`, therefore does not exist, and three client
surfaces query it:

- `client/src/components/dat-loads-display.tsx:40`
- `client/src/pages/google-sheets-import.tsx:117` (cache invalidation)
- `client/src/pages/manual-load-entry.tsx:94` (cache invalidation)

**This was deliberately not fixed here.** Calling `setupDirectDATLoads(app)` converts dead code
into live code, and among the routes it registers is one that initiates a DAT login through
Puppeteer using real credentials. The project's own history says exactly what that costs: PR #62
turned a no-op into a live path and burned 1,000+ Twilio messages on the backlog before it was
killed. Same class of change, same scrutiny.

If the DAT loads display is meant to work, wiring it is a deliberate, approval-gated decision:
decide whether the Puppeteer login route should be exposed at all, and if so ship it default-OFF
behind an env var with the credentials handling reviewed. If the display is not meant to work,
delete the component and the three client references instead.
