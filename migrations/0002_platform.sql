-- Kestrel v2: the Hawks data model (one row per athlete in people, personal tables keyed by person_id)
-- with teams on top. 0001's tables held no data and are replaced.
--   people.id is the Supabase user id. Personal tables are only read for that person.
--   Team tables (events, posts, comments, locations, team_plans) carry team_id and are read after a membership check.
--   availability_overrides and rsvps are personal rows that teammates on a shared team can see.

DROP TABLE IF EXISTS ai_usage;
DROP TABLE IF EXISTS models;
DROP TABLE IF EXISTS prs;
DROP TABLE IF EXISTS training_days;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS rsvps;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS users;

CREATE TABLE people (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  color             TEXT NOT NULL DEFAULT '#e1371a',
  email             TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  age_ok            INTEGER NOT NULL DEFAULT 0,
  sex               TEXT NOT NULL DEFAULT '' CHECK (sex IN ('', 'f', 'm')),
  class_year        TEXT NOT NULL DEFAULT '',
  -- JSON: { models: { race, short, marathon } }
  settings          TEXT NOT NULL DEFAULT '{}',
  share_miles       INTEGER NOT NULL DEFAULT 0,
  default_status    TEXT NOT NULL DEFAULT 'available' CHECK (default_status IN ('available', 'unavailable')),
  health_status     TEXT NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'injured', 'sick')),
  health_updated_at INTEGER,
  training_status   TEXT NOT NULL DEFAULT 'running' CHECK (training_status IN ('resting', 'running', 'crosstraining')),
  plan_rank         INTEGER,
  coach_rank        INTEGER,
  coach_token       TEXT,
  ics_token         TEXT,
  five_k_time       TEXT DEFAULT '',
  five_k_set_at     INTEGER,
  prs               TEXT DEFAULT '{}',
  icu_athlete       TEXT DEFAULT '',
  icu_key_enc       TEXT DEFAULT '',
  icu_synced_at     INTEGER,
  icu_status        TEXT DEFAULT '',
  icu_import_cursor TEXT DEFAULT '',
  icu_import_done   INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX idx_people_coach_token ON people(coach_token);
CREATE UNIQUE INDEX idx_people_ics_token ON people(ics_token);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  school      TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES people(id),
  created_at  INTEGER NOT NULL
);

-- 'owner' manages the team (name, invite code, members, the weekly practice rhythm, the team plan). Not a coach view: owners see no one's training.
CREATE TABLE team_members (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, person_id)
);
CREATE INDEX idx_team_members_person ON team_members(person_id);

-- A team's training plan template (the PLANS format: six levels by weekly miles). Absent = Kestrel's built-in plans.
CREATE TABLE team_plans (
  team_id    TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE locations (
  id      TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  address TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('practice', 'meet')),
  lat     REAL,
  lng     REAL
);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  time        TEXT DEFAULT '',
  end_time    TEXT DEFAULT '',
  description TEXT DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'practice' CHECK (type IN ('practice', 'meet', 'other')),
  kind        TEXT NOT NULL DEFAULT '' CHECK (kind IN ('', 'easy', 'workout', 'long_run')),
  auto        INTEGER NOT NULL DEFAULT 0,
  location    TEXT DEFAULT '',
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  checklist   TEXT DEFAULT '',
  results     TEXT DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_events_team_date ON events(team_id, date);

CREATE TABLE rsvps (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  PRIMARY KEY (event_id, person_id)
);

CREATE TABLE posts (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  header     TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_posts_team ON posts(team_id, created_at);

-- Day notes on the team calendar ("can only stay till 5").
CREATE TABLE comments (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text      TEXT NOT NULL,
  PRIMARY KEY (team_id, date, person_id)
);

CREATE TABLE availability_overrides (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  PRIMARY KEY (person_id, date)
);

CREATE TABLE body_marks (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  part       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sore', 'pain')),
  updated_at INTEGER,
  PRIMARY KEY (person_id, part)
);

CREATE TABLE workouts (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  strava_id       TEXT NOT NULL,
  date            TEXT NOT NULL,
  name            TEXT DEFAULT '',
  sport           TEXT DEFAULT 'Run',
  category        TEXT NOT NULL,
  distance_mi     REAL,
  moving_sec      INTEGER,
  elapsed_sec     INTEGER,
  avg_hr          INTEGER,
  max_hr          INTEGER,
  avg_cadence     INTEGER,
  elev_gain_ft    INTEGER,
  planned_type    TEXT DEFAULT '',
  planned_miles   REAL,
  effort          INTEGER,
  plan_score      INTEGER,
  load            INTEGER,
  rating          TEXT DEFAULT '',
  summary         TEXT DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  library_id      TEXT DEFAULT '',
  start_local     TEXT DEFAULT '',
  laps            TEXT DEFAULT '',
  surface         TEXT DEFAULT '',
  raw_distance_mi REAL,
  raw_elev_ft     INTEGER,
  temp_f          REAL,
  dew_point_f     REAL,
  weather_checked INTEGER DEFAULT 0,
  hr_effort       INTEGER,
  metrics         TEXT DEFAULT '',
  course          TEXT DEFAULT '',
  gps_vc          INTEGER,
  UNIQUE (person_id, strava_id)
);
CREATE INDEX idx_workouts_person_date ON workouts(person_id, date);

CREATE TABLE training_days (
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  manual_miles REAL,
  minutes      REAL,
  runs         INTEGER,
  difficulty   INTEGER,
  types        TEXT DEFAULT '[]',
  status       TEXT DEFAULT '',
  planned      TEXT DEFAULT '',
  library_id   TEXT DEFAULT '',
  splits       TEXT DEFAULT '',
  summary      TEXT DEFAULT '',
  coach_note   TEXT DEFAULT '',
  load_note    TEXT DEFAULT '',
  feel         INTEGER,
  sleep_hours  REAL,
  strength     INTEGER DEFAULT 0,
  notes        TEXT DEFAULT '',
  updated_at   INTEGER NOT NULL,
  surface      TEXT DEFAULT '',
  split_reps   TEXT DEFAULT '',
  day_line     TEXT DEFAULT '',
  PRIMARY KEY (person_id, date)
);

CREATE TABLE ai_usage (
  person_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  calls     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, date)
);

CREATE TABLE fitness_states (
  person_id   TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  computed_at INTEGER NOT NULL,
  data        TEXT NOT NULL
);

CREATE TABLE fitness_history (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  vdot       REAL,
  five_k_sec INTEGER,
  mpw        REAL,
  PRIMARY KEY (person_id, date)
);

CREATE TABLE plan_changes (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,
  miles      REAL,
  detail     TEXT DEFAULT '',
  reason     TEXT DEFAULT '',
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plan_changes_person_date ON plan_changes(person_id, date);

CREATE TABLE level_changes (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  from_rank  INTEGER,
  to_rank    INTEGER,
  reason     TEXT DEFAULT '',
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE wellness (
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  resting_hr  REAL,
  hrv         REAL,
  sleep_hours REAL,
  sleep_score REAL,
  vo2max      REAL,
  ctl         REAL,
  atl         REAL,
  PRIMARY KEY (person_id, date)
);

CREATE TABLE best_efforts (
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  meters      INTEGER NOT NULL,
  sec         REAL NOT NULL,
  date        TEXT,
  activity_id TEXT,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (person_id, meters)
);

CREATE TABLE pace_models (
  person_id  TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  cs         REAL NOT NULL,
  d_prime    REAL NOT NULL,
  r2         REAL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE prediction_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  race_date   TEXT NOT NULL,
  model       TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  raw_sec     REAL NOT NULL,
  raw_lo      REAL NOT NULL,
  raw_hi      REAL NOT NULL,
  adj_sec     REAL,
  adj_lo      REAL,
  adj_hi      REAL,
  hr_delta    REAL,
  created_at  INTEGER NOT NULL,
  actual_sec  REAL,
  UNIQUE (person_id, event, race_date, model)
);

-- Kestrel Lab: published models. Built-in models ship in the code (models/*.json).
CREATE TABLE models (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,
  task        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  license     TEXT NOT NULL DEFAULT '',
  readme      TEXT NOT NULL DEFAULT '',
  base_model  TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  body        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_models_task ON models(task, visibility);

-- Lab API keys for the public predict API. Only a SHA-256 of the key is stored.
CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  key_hash   TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used  INTEGER
);

CREATE TABLE api_usage (
  key_id TEXT NOT NULL,
  date   TEXT NOT NULL,
  calls  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);
