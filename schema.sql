-- Applied automatically at server start (idempotent). Can also be run manually with psql.
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id UUID PRIMARY KEY,            -- uniqueness enforced by the database
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
