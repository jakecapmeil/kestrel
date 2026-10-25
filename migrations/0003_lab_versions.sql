-- Kestrel Lab: versions, and where a model was imported from.
--   models.body stays the latest version, so picking and predicting never look at model_versions.
--   Lineage needs no table: models.base_model already names the parent, children are a query on it.
--   Run before deploying code that reads these (npm run migrate:remote).

ALTER TABLE models ADD COLUMN source_url TEXT NOT NULL DEFAULT '';

CREATE TABLE model_versions (
  id         TEXT PRIMARY KEY,
  model_id   TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_model_versions_model ON model_versions(model_id, created_at);

-- Every existing model starts with one version: itself.
INSERT INTO model_versions (id, model_id, version, body, size, note, created_at)
  SELECT 'v_' || id, id, version, body, size, 'First version', created_at FROM models;
