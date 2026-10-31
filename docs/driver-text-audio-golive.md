# Driver Text Audio — Go-Live Notes

Feature branch: `feat/driver-text-audio`
PR base: `main`

## What this ships

| Flag | What it enables |
|---|---|
| `DRIVER_TEXT_AUDIO_ENABLED=true` | Text 1 and Text 2 SMS carry an MP3 audio attachment (MMS) |
| `OWNER_RELAY_AUDIO_ENABLED=true` | Owner/dispatch alert SMS (upload alerts, confirm alerts) carry MP3 audio |
| `DRIVER_TEXT_VOICE_FALLBACK_ENABLED=true` | If an audio MMS send fails, Twilio calls the driver and reads the text via Polly |
| `DRIVER_INBOUND_RELAY_ENABLED=true` | Inbound driver texts (and their MMS media) are relayed to `DISPATCHER_PHONE_NUMBER` or `OWNER_ALERT_PHONE`; ack is truthful |

All flags default **OFF**. The existing SMS flows are unchanged when all flags are off.

## How audio is generated (free, no new secrets)

1. Text is chunked at ≤ 190 chars (word boundaries).
2. Each chunk is fetched from Google Translate TTS (`translate.google.com/translate_tts`, no API key).
3. MP3 frames are concatenated and uploaded to Cloudinary (`resource_type: video`) via the existing `CLOUDINARY_URL` secret.
4. The resulting `secure_url` is passed as Twilio `mediaUrl`.

**No paid TTS provider is used.** Any change to use OpenAI TTS, ElevenLabs, or any other paid voice API requires explicit Money Mike + Annex approval before the flag is touched.

## Merge interaction with PR #164 (fix/driver-text-segments)

PR #164 splits Text 1 / Text 2 into labeled parts (1/N) to avoid Twilio 30019.

- **This PR merges first, #164 merges after:** When #164 modifies `sendDriverLoadText1` to loop over N parts, it must pass `mediaUrls` **only on the first iteration** (part 1/N). The audio variable is generated from `renderText1(fields)` before any splitting, so it represents the whole message.
- **#164 merges first, this PR merges after:** Rebase this branch onto the updated `sendDriverLoadText1`. Ensure the `audioUrlForText` call and `mediaUrls` attachment appear before the split loop, not inside it.

## Go-live procedure (agent flips flags after Annex merges)

**Step 1 — Merge the PR.** Annex reviews and merges via the normal process. Claude Code does NOT merge, push to main, or touch Railway.

**Step 2 — Migrate the schema.** The `ensure-schema.ts` startup migration adds `num_media` and `kind` columns to `sms_delivery_log` automatically on the next Railway deploy. No manual SQL needed.

**Step 3 — Verify test send (optional but recommended).**
```bash
TEST_TO=+1XXXXXXXXXX \
TWILIO_ACCOUNT_SID=... \
TWILIO_AUTH_TOKEN=... \
TWILIO_MESSAGING_SERVICE_SID=... \
CLOUDINARY_URL=... \
npx tsx scripts/test-driver-text-audio.ts
```
Check your phone for 2 MMS with audio. Do NOT run without `TEST_TO`.

**Step 4 — Enable flags one at a time in Railway Variables.**

Start with inbound relay (safest, no outbound cost):
```
DRIVER_INBOUND_RELAY_ENABLED=true
```

Then audio for owner alerts (low volume):
```
OWNER_RELAY_AUDIO_ENABLED=true
```

Then driver text audio (fires on every Text 1 / Text 2 send):
```
DRIVER_TEXT_AUDIO_ENABLED=true
```

Optionally, voice fallback (only kicks in on MMS failure):
```
DRIVER_TEXT_VOICE_FALLBACK_ENABLED=true
```

**Step 5 — Monitor.**
- Check `GET /api/sms/status/:sid` (staff auth) — now returns `numMedia` from Twilio live data.
- Query the delivery log for audio-flag-on sends with `num_media = 0`:
  ```sql
  SELECT sid, to_phone, kind, num_media, updated_at
  FROM sms_delivery_log
  WHERE kind IN ('driver_text', 'owner_alert', 'inbound_relay')
    AND num_media = 0
  ORDER BY updated_at DESC LIMIT 20;
  ```
  A `num_media = 0` row while the audio flag is on means the MMS delivered without the audio attachment — investigate Cloudinary or TTS logs.

## Kill switches

| What | How |
|---|---|
| Stop all audio | Set all four S-audio flags to `false` in Railway Variables |
| Stop all SMS | `SMS_DISABLED=true` (existing global kill switch) |
| Stop voice fallback only | `DRIVER_TEXT_VOICE_FALLBACK_ENABLED=false` |
| Stop inbound relay only | `DRIVER_INBOUND_RELAY_ENABLED=false` |

## Cost profile

- **Google Translate TTS**: Free, unofficial API. ~100 k chars/day before rate limits. Each load text is ~500 chars, so headroom is ~200 loads/day. Upgrade path: swap `generateAudioBuffer()` in `server/driver-text-audio.ts` for any provider returning MP3 bytes.
- **Cloudinary**: Audio uploads count against the media storage quota (same account as photos). MP3 per load text is typically 30–60 KB.
- **Twilio MMS**: Each MMS costs slightly more than SMS (carrier MMS rates). Budget impact: 1 MMS per Text 1, 1 per Text 2, 1 per owner alert that has audio. Current volume: low (< 50/day).
- **Twilio voice fallback**: Only fires on MMS failure. Billed per-minute at voice rates. Expected near-zero.
