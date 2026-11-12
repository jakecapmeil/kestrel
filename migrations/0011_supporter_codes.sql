-- Supporter codes are single-use: the first account to redeem one keeps it. See src/train/support.js.
CREATE TABLE IF NOT EXISTS supporter_codes (
  code        TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL,
  tier        TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL
);
