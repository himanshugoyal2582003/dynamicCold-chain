CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','owner','truckUser')),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL, truck_id UUID,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trucks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plate_number VARCHAR(50) UNIQUE NOT NULL, type VARCHAR(50) NOT NULL,
  capacity_tons NUMERIC(5,2) NOT NULL CHECK (capacity_tons > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','maintenance')),
  target_temp_c NUMERIC(4,1) NOT NULL DEFAULT 4.0 CHECK (target_temp_c BETWEEN -30 AND 25),
  insurance_expiry DATE, permit_expiry DATE, fitness_expiry DATE, active BOOLEAN NOT NULL DEFAULT true,
  iot_connection_number VARCHAR(50) UNIQUE, base_insurance_price NUMERIC(8,2) NOT NULL DEFAULT 450,
  current_insurance_price NUMERIC(8,2) NOT NULL DEFAULT 450, insurance_risk_score NUMERIC(5,2) NOT NULL DEFAULT 15,
  insurance_status VARCHAR(20) NOT NULL DEFAULT 'discounted', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Keep this initial migration safe for databases that were initialized by an
-- earlier CREATE TABLE IF NOT EXISTS script. These additions preserve rows.
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) NOT NULL DEFAULT 450;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) NOT NULL DEFAULT 450;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) NOT NULL DEFAULT 15;
ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) NOT NULL DEFAULT 'discounted';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_truck_id_fk' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_truck_id_fk
      FOREIGN KEY (truck_id) REFERENCES trucks(id) ON DELETE SET NULL NOT VALID;
  END IF;
END
$$;
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, origin VARCHAR(255) NOT NULL,
  destination VARCHAR(255) NOT NULL, cargo_type VARCHAR(100) NOT NULL, notes TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at TIMESTAMP,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL, entity VARCHAR(50) NOT NULL, entity_id UUID, details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS truck_locations (
  truck_id UUID PRIMARY KEY REFERENCES trucks(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  speed_kmh NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (speed_kmh >= 0), heading NUMERIC(5,2) NOT NULL DEFAULT 0,
  accuracy_m NUMERIC(8,2), recorded_at TIMESTAMP NOT NULL, received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS truck_location_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180), speed_kmh NUMERIC(5,2) NOT NULL DEFAULT 0,
  heading NUMERIC(5,2) NOT NULL DEFAULT 0, accuracy_m NUMERIC(8,2), recorded_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trip_telemetry_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE, device_id VARCHAR(50), connection_number VARCHAR(50),
  temperature NUMERIC(5,2) NOT NULL, target_temp NUMERIC(5,2) NOT NULL, humidity NUMERIC(5,2) NOT NULL,
  battery NUMERIC(5,2) NOT NULL, door_open BOOLEAN NOT NULL DEFAULT false, gps_lat NUMERIC(9,6), gps_lng NUMERIC(9,6),
  speed_kmh NUMERIC(5,2), spoilage_risk NUMERIC(5,2), spoilage_risk_level VARCHAR(20), rsl_hours NUMERIC(6,2),
  quality_retention_pct NUMERIC(5,2), route_recommendation TEXT, recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trips_active_truck ON trips(truck_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_trucks_owner_active_status ON trucks(owner_id, active, status);
CREATE INDEX IF NOT EXISTS ix_users_owner_truck ON users(owner_id, truck_id);
CREATE INDEX IF NOT EXISTS ix_trips_truck_started ON trips(truck_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_issues_truck_created ON issues(truck_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_location_history_truck_time ON truck_location_history(truck_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ix_telemetry_history_truck_time ON trip_telemetry_history(truck_id, recorded_at DESC);
