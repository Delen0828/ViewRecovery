-- Portal settings and schedules are separate from immutable experiment rows.
CREATE TABLE IF NOT EXISTS experiment_data.portal_retired_users (
  user_id text PRIMARY KEY,
  retired_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiment_data.portal_preferences (
  user_id text PRIMARY KEY REFERENCES portal_auth."user"(username) ON UPDATE CASCADE ON DELETE CASCADE,
  setup jsonb,
  dashboard_charts jsonb NOT NULL DEFAULT '["accuracy","duration"]',
  schedule_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiment_data.portal_schedule (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES portal_auth."user"(username) ON UPDATE CASCADE ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('study','break')),
  task_type text NOT NULL CHECK (task_type IN ('Motion','Orientation','Centrality','Bar')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS portal_schedule_user_time ON experiment_data.portal_schedule(user_id, starts_at);
