-- Estimate calibration: keep what Kestrel estimated every day, and what happened when an athlete then raced a PR,
-- so the fitness model can be checked and tuned against real results.
--   fitness_history.estimates: that day's whole Fitness State as JSON (every event's estimate and 80% range, the course
--     estimates, the models used, and the race results the estimate was built from). Only days after this migration have it.
--   pr_checks: one row per PR (a person's event + date). Holds the estimate from the last day BEFORE the race (the race
--     itself is an input to every later estimate), the race time, and how far off the estimate was.
--     No snapshot within 14 days before the race leaves the pred_* columns empty: the PR is noted but not scored.
--   Run before deploying code that reads it (npm run migrate:remote); the preview database needs it too.
ALTER TABLE fitness_history ADD COLUMN estimates TEXT;
CREATE TABLE IF NOT EXISTS pr_checks (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,           -- the PR key: '5K', '1600', '2000 SC', 'course:vc:5000'
  pr_date    TEXT NOT NULL,
  pr_sec     REAL NOT NULL,
  auto       INTEGER NOT NULL DEFAULT 0, -- 1 = Kestrel found it in a run; 0 = the athlete typed it
  snap_date  TEXT,                    -- the estimate used: the latest snapshot before pr_date
  pred_sec   REAL,
  pred_lo    REAL,
  pred_hi    REAL,
  error_pct  REAL,                    -- (race - estimate) / estimate * 100: negative = raced faster than estimated
  in_range   INTEGER,                 -- 1 = the race fell inside the 80% range (track events only)
  model      TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, event, pr_date)
);
