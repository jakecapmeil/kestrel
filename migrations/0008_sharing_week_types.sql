-- Teammates can see each other's activities (like Strava) unless someone turns it off, and a captain can say
-- what kind of week an athlete is on.
--   people.share_activities: 1 = recent activities show on teammates' Activities tab. On by default.
--   week_types: a captain's choice for one athlete's Monday-to-Sunday week: 'normal', 'race' or 'taper'.
--     No row means automatic (race week when a meet is on the calendar that week, otherwise normal).
--   Everyone who exists now is switched on for sharing miles and activities; people can turn either off afterwards.
--   Run before deploying code that reads it (npm run migrate:remote).
ALTER TABLE people ADD COLUMN share_activities INTEGER NOT NULL DEFAULT 1;
UPDATE people SET share_miles = 1, share_activities = 1;
CREATE TABLE IF NOT EXISTS week_types (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  week_of    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('normal', 'race', 'taper')),
  set_by     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, week_of)
);
