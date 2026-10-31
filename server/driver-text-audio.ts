/**
 * Driver text audio — free TTS + Cloudinary hosting for MMS audio attachments.
 *
 * Generates an MP3 from the given text using Google Translate TTS (no API
 * key, no cost), uploads it to Cloudinary, and returns the public HTTPS URL
 * to attach as a Twilio MMS mediaUrl.
 *
 * Used by:
 *   - driver-load-texts.ts   (Text 1 / Text 2, flag DRIVER_TEXT_AUDIO_ENABLED)
 *   - owner-upload-alert.ts  (owner SMS alerts, flag OWNER_RELAY_AUDIO_ENABLED)
 *   - sms-communication-service.ts (inbound relay ack, same flag)
 *
 * Feature flags (all default OFF — only === "true" enables):
 *   DRIVER_TEXT_AUDIO_ENABLED         send Text 1/Text 2 with audio MMS
 *   OWNER_RELAY_AUDIO_ENABLED         attach audio to owner/dispatch alerts
 *   DRIVER_TEXT_VOICE_FALLBACK_ENABLED  if MMS send fails, fall back to Polly call
 *   DRIVER_INBOUND_RELAY_ENABLED      relay inbound driver texts to dispatcher
 *
 * Audio failures are non-blocking — callers always fall back to plain SMS.
 *
 * ponytail: Google Translate TTS is the free tier here. Ceiling: ~100k chars/day
 * before rate-limiting kicks in (load texts run at most a few dozen per day).
 * Upgrade path: swap generateAudioBuffer() for any provider that returns MP3 bytes.
 */

import * as https from 'https';

// ── Text chunking ────────────────────────────────────────────────────────────
// Google TTS rejects requests longer than ~200 chars; chunk at word boundaries.

function chunkText(text: string, maxLen = 190): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ── Google TTS fetch ─────────────────────────────────────────────────────────

function fetchGoogleTTS(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(text);
    const url =
      `https://translate.google.com/translate_tts` +
      `?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob&total=1&idx=0&prev=input`;
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TRAQ-IQ/1.0)' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Google TTS HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => resolve(Buffer.concat(parts)));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Google TTS timeout')); });
  });
}

/**
 * Generate an MP3 buffer for the given text.
 * Chunks long text and concatenates the raw MP3 frames.
 * Returns null on any error so callers can degrade gracefully.
 */
export async function generateAudioBuffer(text: string): Promise<Buffer | null> {
  try {
    const segments = chunkText(text.trim());
    if (!segments.length) return null;
    const buffers = await Promise.all(segments.map(fetchGoogleTTS));
    return Buffer.concat(buffers);
  } catch (err: any) {
    console.error('[driver-text-audio] TTS generation failed:', err?.message || err);
    return null;
  }
}

// ── Cloudinary upload ────────────────────────────────────────────────────────

/**
 * Upload an MP3 buffer to Cloudinary and return the secure_url.
 * Uses resource_type:'video' — Cloudinary categorises audio under video.
 * Requires CLOUDINARY_URL to be set (already configured in this repo).
 * Returns null on any error.
 */
async function uploadToCloudinary(buf: Buffer, publicId: string): Promise<string | null> {
  try {
    const { v2: cld } = await import('cloudinary');
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cld.uploader.upload_stream(
        {
          resource_type: 'video',
          public_id: publicId,
          format: 'mp3',
          overwrite: true,
        },
        (err, res) => (err ? reject(err) : resolve(res)),
      );
      stream.end(buf);
    });
    return (result?.secure_url as string) || null;
  } catch (err: any) {
    console.error('[driver-text-audio] Cloudinary upload failed:', err?.message || err);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate TTS audio for the given text and return a public Cloudinary URL.
 * label is used as the Cloudinary public_id suffix (snake_case, no slashes).
 * Returns null if TTS generation or upload fails — callers degrade to plain SMS.
 */
export async function audioUrlForText(
  text: string,
  label: string,
): Promise<string | null> {
  if (!process.env.CLOUDINARY_URL) {
    console.warn('[driver-text-audio] CLOUDINARY_URL not set — skipping audio');
    return null;
  }
  const buf = await generateAudioBuffer(text);
  if (!buf) return null;
  // Sanitize label to a safe Cloudinary public_id
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  const publicId = `lamp_sms_audio/${safeLabel}`;
  return uploadToCloudinary(buf, publicId);
}

// ── XML escaping for Polly <Say> ─────────────────────────────────────────────

/**
 * Escape text for safe use inside a TwiML <Say> element.
 */
export function escapeTwimlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
