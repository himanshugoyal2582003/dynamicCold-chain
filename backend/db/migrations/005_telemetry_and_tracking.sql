-- 005: Ensure LSTM telemetry columns, tracking tables, and completed trip status normalization

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) DEFAULT 450.00;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) DEFAULT 450.00;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) DEFAULT 15.0;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) DEFAULT 'discounted';

ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS good_env_rsl_hours NUMERIC(6,2);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS bad_env_rsl_hours NUMERIC(6,2);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS environment_condition VARCHAR(30);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS predicted_insurance_price NUMERIC(8,2);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2);
ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS model_type VARCHAR(50);

CREATE TABLE IF NOT EXISTS truck_locations (
  truck_id UUID PRIMARY KEY REFERENCES trucks(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  speed_kmh NUMERIC(5,2) DEFAULT 0,
  heading NUMERIC(5,2) DEFAULT 0,
  accuracy_m NUMERIC(8,2),
  recorded_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS truck_location_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL,
  longitude NUMERIC(10,7) NOT NULL,
  speed_kmh NUMERIC(5,2) DEFAULT 0,
  heading NUMERIC(5,2) DEFAULT 0,
  accuracy_m NUMERIC(8,2),
  recorded_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_truck_loc_history_truck_time ON truck_location_history(truck_id, recorded_at DESC);

UPDATE trips
SET status = CASE WHEN ended_at IS NULL THEN 'IN_PROGRESS' ELSE 'COMPLETED' END
WHERE status IS NULL OR (ended_at IS NOT NULL AND status IN ('ASSIGNED', 'IN_PROGRESS'));
