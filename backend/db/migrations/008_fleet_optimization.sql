CREATE TABLE fleet_dispatch_profiles (
    truck_id UUID PRIMARY KEY REFERENCES trucks(id) ON DELETE RESTRICT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    cargo_types TEXT[] NOT NULL CHECK (cardinality(cargo_types) BETWEEN 1 AND 12),
    usable_tons NUMERIC(5,2) NOT NULL CHECK (usable_tons > 0),
    target_c NUMERIC(5,2) NOT NULL CHECK (target_c BETWEEN -30 AND 25),
    cost_per_km NUMERIC(12,4) NOT NULL CHECK (cost_per_km > 0),
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    synthetic BOOLEAN NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fleet_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reference VARCHAR(80) NOT NULL,
    cargo_type VARCHAR(100) NOT NULL,
    weight_tons NUMERIC(5,2) NOT NULL CHECK (weight_tons > 0),
    origin VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    origin_lat NUMERIC(9,6) NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
    origin_lng NUMERIC(9,6) NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
    destination_lat NUMERIC(9,6) NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
    destination_lng NUMERIC(9,6) NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
    deadline TIMESTAMPTZ NOT NULL,
    shelf_life_until TIMESTAMPTZ NOT NULL,
    handling_minutes INTEGER NOT NULL CHECK (handling_minutes BETWEEN 0 AND 240),
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('critical', 'high', 'standard')),
    synthetic BOOLEAN NOT NULL,
    trip_id UUID UNIQUE REFERENCES trips(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(owner_id, reference)
);

CREATE INDEX ix_fleet_shipments_pending ON fleet_shipments(owner_id, deadline, id) WHERE trip_id IS NULL;
