# In-Portal Outbound Recorded Dialer (SP3) — Design

**Date:** 2026-06-08
**Status:** Draft for review
**Owner:** AL
**Project:** LAMP Logistics phone system → TRAQ-IQ (SP3)

## Why

SP1/SP2 record **inbound** calls. SP3 records the calls drivers **make** — appointment confirmations, detention/TONU disputes, check-calls to receivers and brokers — which is where most freight money is won or lost. A driver opens the TRAQ-IQ portal on their phone, taps "Call" on a load (or a dialpad), and the call goes out over the app: recorded, presenting the company line, and flowing into the same `/calls` layer as everything else. This completes the system: every company call, inbound and outbound, recorded and searchable.

## Scope

**In scope (SP3):**
- A WebRTC softphone inside the driver portal: "Call" buttons on a load's contacts + a general dialpad + an in-call overlay (timer, mute, hang up).
- A per-driver Twilio Voice access-token endpoint.
- A TwiML App + outbound voice handler that dials the destination with caller ID = company `833`, records, and announces the recording to the called party.
- Recording attribution: outbound portal recordings tagged `direction:'outbound'`, `source:'twilio_portal'`, `driverId` and fed into the existing transcript + AI pipeline.
- A poller guard so inbound polling never mis-tags an outbound portal call.
- Default-OFF gating, per-driver rate ceiling, destination validation.

**Out of scope:**
- Inbound (done in SP1/SP2).
- Advanced softphone features: hold, transfer, conference, call-waiting, in-app call history beyond `/calls`.
- Number porting; desktop/native apps.
- Per-driver caller ID (decided: always `833`).

## Decisions (locked)

- **Scope = Both:** load-contact "Call" buttons AND a general dialpad.
- **Caller ID = company `833` always.** One company front; callbacks land on the recorded office line. SP3 therefore does NOT require a driver to have an SP2 line.
- **Recording attribution = recordingStatusCallback** (real-time, carries `driverId`), not the poller (which can't attribute an outbound call whose called number isn't a driver line).
- **Poller skips outbound** recordings (handled by the callback) to avoid mis-tagging + a race.
- **Two-party-consent notice** plays to the called party before bridging (toggle `PORTAL_DIALER_RECORDING_NOTICE`, default on).
- **Default OFF** behind `PORTAL_DIALER_ENABLED`; the token endpoint refuses when off, so no call is possible.
- **Portal is server-rendered HTML** → the dialer is vanilla JS + the Twilio Voice SDK from CDN, injected into the portal pages (not a React component).

## Architecture

```
Driver opens /driver/:token (portal, mobile browser)
  → dialer JS fetches GET /driver/:token/voice-token  (token-gated; mints AccessToken+VoiceGrant, identity driver-<id>)
  → new Twilio.Device(token); driver taps Call (load contact or dialpad)
  → device.connect({ params: { To, driverId } })
  → Twilio POSTs the TwiML App Voice URL: POST /api/twilio/voice/portal-outbound (sig-validated)
      → validate To (destination allowlist) ; returns:
        <Dial callerId="+18333629813" record="record-from-answer"
              recordingStatusCallback="/api/twilio/voice/portal-recording?driverId=<id>">
          <Number url="/api/twilio/voice/portal-callee-notice">{To}</Number>   <!-- plays "recorded" to callee -->
        </Dial>
  → recording completes → Twilio POSTs /api/twilio/voice/portal-recording?driverId=<id>
      → processRecording({ source:'twilio_portal', direction:'outbound', driverId, companyId, … })
  → /calls shows it (outbound, tagged to the driver) + transcript + AI (same pipeline)
```

### Components (the build)
1. **Access-token endpoint** (`server/portal-dialer-routes.ts`, new) — `GET /driver/:token/voice-token`. Token-gated via `driverFromToken`. Refuses (403) if `PORTAL_DIALER_ENABLED !== 'true'`. Mints `twilio.jwt.AccessToken` (identity `driver-<id>`, short TTL ~1h) + `VoiceGrant{ outgoingApplicationSid: TWIML_APP_SID }`. Returns `{ token, identity }`.
2. **Outbound TwiML handler** — `POST /api/twilio/voice/portal-outbound` (the TwiML App Voice URL; under `/api/twilio/*`, public, Twilio-sig-validated). Reads `To` + `driverId` params, validates `To` against `isDialableDestination` (NANP/E.164, blocks short codes / premium / non-US for v1), and returns the Dial TwiML above. **Always uses `res.end` for TwiML** (the global `/api` middleware force-jsons `res.send` — same gotcha SP2 hit).
3. **Callee notice** — `POST /api/twilio/voice/portal-callee-notice` → `<Say>` "This call is recorded for quality and training." Played to the called party before bridging (skipped if the notice toggle is off).
4. **Recording callback** — `POST /api/twilio/voice/portal-recording` → looks up the driver's `companyId` from the `driverId` query param, calls `processRecording({ recordingSid, recordingUrl, callSid, durationSec, legType:'call', source:'twilio_portal', direction:'outbound', driverId, companyId })`.
5. **Poller guard** — `pollNewRecordings` / `resolveCallParties` extended to read the Twilio call `direction`; the poller **skips** recordings whose direction is outbound (those are owned by the callback). Dedup-on-`recordingSid` remains the backstop.
6. **Dialer UI** — vanilla JS + CSS injected by `server/driver-portal.ts` into the load-detail page (Call buttons on contacts) and globally (floating dialpad + in-call overlay). Loads `@twilio/voice-sdk` from CDN. Requests mic permission on first call.
7. **TwiML App + API key/secret** — created in the Twilio account via API as part of the build. Env: `TWILIO_TWIML_APP_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `PORTAL_DIALER_ENABLED` (default OFF), `PORTAL_DIALER_RECORDING_NOTICE` (default on).

## Data model

No new tables — `callRecord` already carries `source`, `direction`, `driverId`. A **per-driver rate ceiling** is in-memory (a `Map<driverId, timestamps[]>` in the token/outbound path; default 20 calls/hour/driver) — no schema change. (If multi-instance accuracy is ever needed, move to a DB counter; YAGNI for now.)

## Recording attribution + no double-tag

The recordingStatusCallback fires on completion with `driverId` in the URL and tags the call correctly. The poller would otherwise list the same recording and, finding the called number isn't a driver line, mis-tag it `twilio_main`/`inbound`; the **poller skip-outbound guard** prevents that, and `recordingSid` dedup prevents any double row.

## Financial guards

- **New paid path:** outbound voice (~$0.03/min) + recording (~$0.0075/min) + transcription (existing SP1 guards).
- `PORTAL_DIALER_ENABLED` default **OFF** — the token endpoint returns 403, so the SDK can't initialize and no call can be placed. Master kill switch.
- **Per-driver rate ceiling** (default 20/hr) blocks a runaway/abusive loop.
- **Destination validation** (`isDialableDestination`) blocks short codes, premium (900/976), and non-NANP numbers for v1 → bounds per-call cost and abuse.
- **Rollback:** `PORTAL_DIALER_ENABLED=false` halts everything instantly.

## Security

- Access-token endpoint is token-gated (`driverFromToken`) and short-TTL; identity is server-set (`driver-<id>`), never client-supplied.
- The outbound + notice + recording webhooks are Twilio-signature-validated (`/api/twilio/*`, public but signed; `trust proxy` is set so the URL matches).
- Destination validation prevents the authenticated driver's device from being used to dial arbitrary/abuse numbers.
- Mic permission requested in-browser; calls only initiate on explicit driver tap.

## No-regression / Testing

Additive except the one poller change (skip-outbound), which only *prevents* mis-tagging. Inbound (SP1/SP2), dispatch SMS, and the call-data layer are untouched. Tests in `server/__tests__/`:
1. **`portal-dialer-twiml.test.ts`** — `buildPortalOutboundTwiml` always sets `callerId="+18333629813"` and `record="record-from-answer"`; routes TwiML via `res.end` (content-type tripwire, like SP2).
2. **`portal-dialer-destination.test.ts`** — `isDialableDestination` allows a normal +1 number, blocks short codes / 900 / non-NANP.
3. **`portal-dialer-gate.test.ts`** — the token endpoint refuses when `PORTAL_DIALER_ENABLED` is off; the per-driver rate predicate blocks past the ceiling.
4. **Poller** — `resolveCallParties`/the skip predicate marks outbound recordings as skip.

## Migrations

None (no schema change). New env vars documented in `.env.example`. The TwiML App + API key are created via the Twilio API at build time (a one-shot script), not a DB migration.

## Open questions (resolved)

- *Scope?* → Both (load Call buttons + dialpad). ✔
- *Caller ID?* → Company `833` always. ✔
- *Consent on outbound?* → brief recorded notice to the called party, toggleable. ✔
- *Attribution?* → recordingStatusCallback + poller skip-outbound. ✔
- *Default on/off?* → off, `PORTAL_DIALER_ENABLED`. ✔
- *Portal tech?* → vanilla JS + Voice SDK CDN (portal is server-rendered HTML). ✔

## Success criteria

- A driver with the portal open taps "Call" on a load (or dials a number), grants mic once, and is connected — the called party hears a recorded-line notice, then the driver.
- The called party's caller ID shows `833-362-9813`.
- The call records and appears in `/calls` within ~2 min, tagged `outbound` / `twilio_portal` / the right `driverId`, transcribed + AI-classified.
- With `PORTAL_DIALER_ENABLED` off, the dialer can't initialize (token endpoint 403) — no spend possible.
- The poller never creates a duplicate or mis-tagged row for an outbound portal call.
