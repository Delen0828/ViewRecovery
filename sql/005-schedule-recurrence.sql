-- Keep existing timestamps and add the editable daily recurrence definition.
ALTER TABLE experiment_data.portal_schedule
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS scheduled_time time,
  ADD COLUMN IF NOT EXISTS duration_minutes numeric;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'experiment_data.portal_schedule'::regclass
      AND conname = 'portal_schedule_recurrence_check'
  ) THEN
    ALTER TABLE experiment_data.portal_schedule
      ADD CONSTRAINT portal_schedule_recurrence_check CHECK (
        (start_date IS NULL AND end_date IS NULL AND scheduled_time IS NULL AND duration_minutes IS NULL)
        OR
        (start_date IS NOT NULL AND end_date IS NOT NULL AND scheduled_time IS NOT NULL
         AND duration_minutes IS NOT NULL AND end_date >= start_date AND duration_minutes > 0)
      );
  END IF;
END $$;
