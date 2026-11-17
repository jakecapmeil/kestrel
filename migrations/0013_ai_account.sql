-- What powers Kestrel AI, kept on the account so it follows the athlete to every browser and app, and so the server can
-- run jobs (run summaries after a sync, chat, plans, food photos) on the athlete's own model. Personal: read only by
-- that person. Keys are AES-GCM encrypted (train/aiconfig.js) and never sent back to a browser.

-- The chosen model: 'kestrel' (free default) or a provider id; tasks overrides it per job (chat, summary, food).
CREATE TABLE IF NOT EXISTS ai_choice (
  person_id  TEXT PRIMARY KEY,
  provider   TEXT NOT NULL DEFAULT 'kestrel',
  tasks      TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- One row per provider the athlete has set up: its model and its encrypted key (last4 is all a browser sees).
CREATE TABLE IF NOT EXISTS ai_keys (
  person_id  TEXT NOT NULL,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  key_enc    TEXT NOT NULL DEFAULT '',
  last4      TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, provider)
);
