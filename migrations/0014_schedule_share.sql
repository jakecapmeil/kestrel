-- Anyone-with-the-link view of a team's schedule (like a Google Docs "anyone with the link" share).
--   teams.share_token: NULL = sharing off. A captain or the owner turns it on, makes a new one (the old link stops
--   working) or turns it off. The public page shows only the schedule: no roster, RSVPs, notes, posts or training.
--   Run before deploying code that reads it (npm run migrate:remote).
ALTER TABLE teams ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS teams_share_token ON teams(share_token) WHERE share_token IS NOT NULL;
