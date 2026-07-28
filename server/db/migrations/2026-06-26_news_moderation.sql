-- Lightweight admin-managed rules for suppressing specific news items in the league-news feed.
CREATE TABLE IF NOT EXISTS news_moderation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(32) NOT NULL,
  value       TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT
);
