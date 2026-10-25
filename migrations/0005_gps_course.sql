-- The course a run's GPS start was inside ('vc', 'franklin-park', ...), or '' when it started outside every course
-- Kestrel has bounds for. NULL means the run has no GPS. A course the runner picks (workouts.course_id) wins over it.
--   Run before deploying code that reads it (npm run migrate:remote).
ALTER TABLE workouts ADD COLUMN gps_course TEXT;
