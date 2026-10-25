-- A tag the runner picked for a run ("tempo", "time_trial", or one of their own). While it is set, syncs no longer
-- overwrite the run's category; auto_category remembers what Kestrel guessed so the tag can be cleared.
--   Run before deploying code that reads it (npm run migrate:remote).
ALTER TABLE workouts ADD COLUMN tag TEXT DEFAULT '';
ALTER TABLE workouts ADD COLUMN auto_category TEXT DEFAULT '';
CREATE TABLE IF NOT EXISTS run_tags (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  base      TEXT NOT NULL,
  PRIMARY KEY (person_id, name)
);
