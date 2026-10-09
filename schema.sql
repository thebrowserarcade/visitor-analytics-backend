-- Applied automatically at server start (idempotent). Can also be run manually with psql.
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id UUID PRIMARY KEY,            -- uniqueness enforced by the database
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Upgrades tables created before last_seen existed.
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors (last_seen);
