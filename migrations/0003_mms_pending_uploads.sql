CREATE TABLE IF NOT EXISTS pending_uploads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_phone TEXT NOT NULL,
  load_id VARCHAR NOT NULL REFERENCES loads(id),
  stage TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  fulfilled_at TIMESTAMP,
  fulfilled_message_sid TEXT UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_phone_unfulfilled
  ON pending_uploads (driver_phone, created_at DESC)
  WHERE fulfilled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_uploads_load_recent
  ON pending_uploads (load_id, created_at DESC);
