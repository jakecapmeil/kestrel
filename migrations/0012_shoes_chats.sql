-- Shoes worn on a run, when the runner picked a pair by hand. Runs without a row here get a pair from the kind of run
-- each pair is for (settings.shoes[].uses). Personal: read only by that person.
CREATE TABLE IF NOT EXISTS run_shoes (
  person_id  TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  shoe_id    TEXT NOT NULL, -- '' = no shoes counted for this run
  PRIMARY KEY (person_id, workout_id)
);

-- Kestrel AI chats, so past conversations can be reopened on any device. Personal: read only by that person.
CREATE TABLE IF NOT EXISTS kai_chats (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  turns      TEXT NOT NULL DEFAULT '[]', -- [{ role: 'user' | 'kai', text, model? }]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kai_chats_person ON kai_chats(person_id, updated_at);
