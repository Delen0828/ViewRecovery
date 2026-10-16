ALTER TABLE experiment_data.portal_preferences
  ADD COLUMN IF NOT EXISTS dashboard_stats jsonb NOT NULL
  DEFAULT '["sessions","trials","average_study_time"]';
