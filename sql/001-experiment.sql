CREATE SCHEMA IF NOT EXISTS experiment_data;

CREATE TABLE IF NOT EXISTS experiment_data.runs (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  task text NOT NULL,
  run_timestamp text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiment_data.events (
  run_id uuid NOT NULL REFERENCES experiment_data.runs(id),
  event_sequence integer NOT NULL CHECK (event_sequence > 0),
  included boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, event_sequence)
);
CREATE TABLE IF NOT EXISTS experiment_data.saves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES experiment_data.runs(id),
  save_key text NOT NULL,
  prefix text NOT NULL,
  payload_hash text NOT NULL,
  row_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, save_key)
);
CREATE TABLE IF NOT EXISTS experiment_data.save_rows (
  save_id bigint NOT NULL REFERENCES experiment_data.saves(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  payload jsonb NOT NULL,
  PRIMARY KEY (save_id, ordinal)
);
CREATE TABLE IF NOT EXISTS experiment_data.ingest_batches (
  batch_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES experiment_data.runs(id),
  payload_hash text NOT NULL,
  acknowledgement jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiment_data.import_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archive_sha256 text NOT NULL UNIQUE,
  archive_name text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}',
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiment_data.source_files (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_job_id bigint NOT NULL REFERENCES experiment_data.import_jobs(id),
  original_path text NOT NULL,
  sha256 text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('csv', 'backup', 'artifact')),
  user_id text,
  task text,
  run_timestamp text,
  header jsonb,
  row_count integer NOT NULL,
  bytes bytea NOT NULL,
  UNIQUE (import_job_id, original_path)
);
CREATE TABLE IF NOT EXISTS experiment_data.source_rows (
  source_file_id bigint NOT NULL REFERENCES experiment_data.source_files(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  payload jsonb NOT NULL,
  PRIMARY KEY (source_file_id, ordinal)
);
CREATE INDEX IF NOT EXISTS runs_user_task ON experiment_data.runs(user_id, task);
CREATE INDEX IF NOT EXISTS source_files_user_task ON experiment_data.source_files(user_id, task);
CREATE INDEX IF NOT EXISTS events_included ON experiment_data.events(run_id, event_sequence) WHERE included;

-- Original data keys stay inside payload. These aliases are database metadata only.
CREATE OR REPLACE VIEW experiment_data.recorded_rows AS
SELECT r.id AS run_id, r.user_id, r.task, e.event_sequence, e.payload
FROM experiment_data.runs r JOIN experiment_data.events e ON e.run_id = r.id
WHERE e.included AND coalesce(e.payload->>'manual_pause_interrupted', 'false') <> 'true';
