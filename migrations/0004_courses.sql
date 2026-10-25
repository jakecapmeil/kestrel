-- Courses and GPS routes.
--   Built-in courses ship in code (src/train/courses.js); this table holds the ones people add. They are shared:
--   any signed-in user can pick one, so the catalogue grows as people use Kestrel. created_by is never sent to other users.
--   workouts.course_id is the course a run was on: set by hand, or 'vc' by the Van Cortlandt GPS check.
--   run_tracks is the GPS route of a run, fetched from the watch provider the first time the run is opened and cached.
--   Routes are private to their owner and never appear in team views.
--   Run before deploying code that reads these (npm run migrate:remote).

CREATE TABLE courses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  place      TEXT NOT NULL DEFAULT '',
  -- JSON array of metres: the distances raced on this course ([5000, 4023]).
  distances  TEXT NOT NULL DEFAULT '[5000]',
  created_by TEXT REFERENCES people(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_courses_name ON courses(name);

ALTER TABLE workouts ADD COLUMN course_id TEXT DEFAULT '';
CREATE INDEX idx_workouts_course ON workouts(course_id, date);

CREATE TABLE run_tracks (
  person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  strava_id  TEXT NOT NULL,
  -- JSON: { pts: [[lat, lon, altitude_m, seconds], ...] } downsampled to a few hundred points.
  points     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, strava_id)
);
