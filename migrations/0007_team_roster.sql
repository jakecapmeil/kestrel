-- Team roster details, team captains, and the plan brief behind a team's training plan.
--   leader: 1 = captain. Captains and the owner can edit the roster and build the team training plan.
--   jersey / age / events: optional, filled in by the athlete or a leader. Age is only shown to that person and to leaders.
--   team_plans.spec: the short plan description the leader refined with Kestrel AI (so it can be refined again).
--   Run before deploying code that reads it (npm run migrate:remote).
ALTER TABLE team_members ADD COLUMN leader INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN jersey TEXT NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN age INTEGER;
ALTER TABLE team_members ADD COLUMN events TEXT NOT NULL DEFAULT '';
ALTER TABLE team_plans ADD COLUMN spec TEXT NOT NULL DEFAULT '';
