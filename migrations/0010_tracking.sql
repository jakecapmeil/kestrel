-- Cross-training, fueling and goals. All personal: read only for that person, never shown to teammates.
-- Cross-training synced from a watch stays in workouts (category 'crosstrain'); xtrain holds what the runner adds by hand.

CREATE TABLE xtrain (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  sport       TEXT NOT NULL,
  minutes     REAL NOT NULL,
  distance_mi REAL,
  rpe         INTEGER,
  notes       TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_xtrain_person_date ON xtrain(person_id, date);

-- meal: breakfast, lunch, dinner, snack, before, during, after (a run)
CREATE TABLE food_log (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  meal       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  carbs_g    REAL,
  protein_g  REAL,
  fat_g      REAL,
  kcal       REAL,
  fluid_ml   REAL,
  notes      TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_food_person_date ON food_log(person_id, date);

-- kind: race (event + target_sec + date), mileage (target = miles a week), consistency (target = runs a week), custom (progress 0-100 by hand)
CREATE TABLE goals (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  event       TEXT DEFAULT '',
  target      REAL,
  target_date TEXT DEFAULT '',
  start_value REAL,
  progress    INTEGER,
  priority    INTEGER NOT NULL DEFAULT 0,
  why         TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  done_at     INTEGER
);
CREATE INDEX idx_goals_person ON goals(person_id);
