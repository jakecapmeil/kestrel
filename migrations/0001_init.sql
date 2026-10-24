-- Kestrel schema. Accounts live in Supabase; users.id is the Supabase user id.
-- Team tables carry team_id and are only read through a membership check.
-- Personal tables carry user_id and are only read by that user.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#c8922a',
  sex        TEXT NOT NULL DEFAULT '' CHECK (sex IN ('', 'f', 'm')),
  age_ok     INTEGER NOT NULL DEFAULT 0,
  -- JSON: { models: { race, short, marathon } } (model ids the user picked)
  settings   TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  school      TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL UNIQUE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

-- role 'owner' can rename the team, make a new invite code and remove members.
CREATE TABLE IF NOT EXISTS team_members (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'practice' CHECK (type IN ('practice', 'meet', 'other')),
  time        TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_team_date ON events(team_id, date);

CREATE TABLE IF NOT EXISTS rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status   TEXT NOT NULL CHECK (status IN ('going', 'not_going')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_team ON posts(team_id, created_at);

-- One row per day a user logged.
CREATE TABLE IF NOT EXISTS training_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  miles   REAL NOT NULL DEFAULT 0,
  minutes REAL NOT NULL DEFAULT 0,
  type    TEXT NOT NULL DEFAULT 'easy',
  feel    INTEGER,
  notes   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, date)
);

-- Personal bests. event is a key from src/events.js; surf is xc, track, indoor or road.
CREATE TABLE IF NOT EXISTS prs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event   TEXT NOT NULL,
  sec     REAL NOT NULL,
  date    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, event)
);

-- Model hub uploads. The built-in models ship in the code (models/*.json).
CREATE TABLE IF NOT EXISTS models (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  version     TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,
  task        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  license     TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  body        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS models_task ON models(task, visibility);

-- Kestrel AI (server-side default) calls per user per day.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL,
  date    TEXT NOT NULL,
  calls   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
