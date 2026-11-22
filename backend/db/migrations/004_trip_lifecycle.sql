-- Add a lifecycle while preserving existing trip history.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS status VARCHAR(20);

UPDATE trips
SET status = CASE
  WHEN ended_at IS NOT NULL THEN 'COMPLETED'
  WHEN started_at IS NOT NULL THEN 'IN_PROGRESS'
  ELSE 'ASSIGNED'
END
WHERE status IS NULL;

ALTER TABLE trips ALTER COLUMN status SET DEFAULT 'ASSIGNED';
ALTER TABLE trips ALTER COLUMN status SET NOT NULL;
ALTER TABLE trips ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE trips ALTER COLUMN started_at DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_status_check' AND conrelid = 'trips'::regclass) THEN
    ALTER TABLE trips ADD CONSTRAINT trips_status_check
      CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_trips_active_driver
  ON trips(user_id) WHERE status IN ('ASSIGNED', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS ix_trips_status_started
  ON trips(status, started_at DESC NULLS LAST);
