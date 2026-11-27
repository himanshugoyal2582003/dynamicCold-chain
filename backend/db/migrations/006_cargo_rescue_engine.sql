CREATE TABLE IF NOT EXISTS cold_storage_facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    state VARCHAR(100),
    district VARCHAR(100),
    capacity_tons NUMERIC(10,2) CHECK (capacity_tons > 0),
    min_temp_c NUMERIC(5,2),
    max_temp_c NUMERIC(5,2),
    supported_cargo_types TEXT[],
    contact_number VARCHAR(30),
    availability_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (availability_status IN ('AVAILABLE', 'FULL', 'CLOSED', 'UNKNOWN')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (min_temp_c <= max_temp_c)
);

CREATE TABLE IF NOT EXISTS rescue_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
    truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE RESTRICT,
    original_destination VARCHAR(255) NOT NULL,
    cargo_type VARCHAR(100) NOT NULL,
    trigger_reason TEXT NOT NULL,
    spoilage_risk NUMERIC(5,4) NOT NULL
        CHECK (spoilage_risk BETWEEN 0 AND 1),
    remaining_shelf_life_hours NUMERIC(10,2)
        CHECK (remaining_shelf_life_hours >= 0),
    latitude NUMERIC(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    severity VARCHAR(20) NOT NULL
        CHECK (severity IN ('HIGH', 'CRITICAL')),
    gps_recorded_at TIMESTAMPTZ NOT NULL,
    telemetry_recorded_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    shelf_life_until TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DETECTED'
        CHECK (status IN (
            'DETECTED',
            'RECOMMENDED',
            'PENDING_APPROVAL',
            'APPROVED',
            'REROUTING',
            'RESOLVED',
            'REJECTED',
            'CANCELLED'
        )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rescue_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rescue_event_id UUID NOT NULL
        REFERENCES rescue_events(id) ON DELETE CASCADE,
    facility_id UUID NOT NULL
        REFERENCES cold_storage_facilities(id) ON DELETE RESTRICT,
    aerial_distance_km NUMERIC(10,3) NOT NULL
        CHECK (aerial_distance_km >= 0),
    road_distance_km NUMERIC(10,3)
        CHECK (road_distance_km >= 0),
    estimated_duration_seconds INTEGER
        CHECK (estimated_duration_seconds >= 0),
    estimated_shelf_life_at_arrival NUMERIC(10,2),
    rescue_score NUMERIC(7,4)
        CHECK (rescue_score BETWEEN 0 AND 100),
    rank_position INTEGER CHECK (rank_position > 0),
    is_time_feasible BOOLEAN,
    route_coordinates JSONB,
    explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rescue_event_id, facility_id),
    UNIQUE (rescue_event_id, rank_position),
    UNIQUE (rescue_event_id, id)
);

CREATE TABLE IF NOT EXISTS rescue_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rescue_event_id UUID NOT NULL
        REFERENCES rescue_events(id) ON DELETE CASCADE,
    candidate_id UUID,
    actor_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,
    decision VARCHAR(30) NOT NULL
        CHECK (decision IN (
            'REQUESTED',
            'APPROVED',
            'REJECTED',
            'STARTED',
            'COMPLETED',
            'CANCELLED'
        )),
    reason TEXT,
    facility_confirmation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (rescue_event_id, candidate_id)
        REFERENCES rescue_candidates(rescue_event_id, id),
    CHECK (decision <> 'APPROVED' OR (candidate_id IS NOT NULL AND
        facility_confirmation IS NOT NULL AND btrim(facility_confirmation) <> ''))
);

ALTER TABLE rescue_events
    ADD COLUMN emergency_candidate_id UUID,
    ADD FOREIGN KEY (id, emergency_candidate_id)
        REFERENCES rescue_candidates(rescue_event_id, id);

CREATE INDEX IF NOT EXISTS ix_facilities_coordinates
    ON cold_storage_facilities(latitude, longitude);

CREATE INDEX IF NOT EXISTS ix_facilities_state_district
    ON cold_storage_facilities(state, district);

CREATE INDEX IF NOT EXISTS ix_rescue_events_trip
    ON rescue_events(trip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_rescue_events_truck_status
    ON rescue_events(truck_id, status);

CREATE INDEX IF NOT EXISTS ix_rescue_candidates_rank
    ON rescue_candidates(rescue_event_id, rank_position);

CREATE INDEX IF NOT EXISTS ix_rescue_decisions_event
    ON rescue_decisions(rescue_event_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rescue_active_trip
    ON rescue_events(trip_id)
    WHERE status IN (
        'DETECTED',
        'RECOMMENDED',
        'PENDING_APPROVAL',
        'APPROVED',
        'REROUTING'
    );
