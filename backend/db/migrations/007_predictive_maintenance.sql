CREATE TABLE maintenance_sensor_samples (
    truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    device_id VARCHAR(100) NOT NULL,
    connection_number VARCHAR(50) NOT NULL,
    sample_minute TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperature_c NUMERIC(5,2) NOT NULL CHECK (temperature_c BETWEEN -80 AND 85),
    target_c NUMERIC(5,2) NOT NULL CHECK (target_c BETWEEN -30 AND 25),
    humidity_pct NUMERIC(5,2) NOT NULL CHECK (humidity_pct BETWEEN 0 AND 100),
    door_open BOOLEAN,
    PRIMARY KEY (truck_id, sample_minute)
);

CREATE INDEX ix_maintenance_samples_recent ON maintenance_sensor_samples (observed_at DESC);

CREATE TABLE maintenance_assessments (
    truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    window_end TIMESTAMPTZ NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    connection_number VARCHAR(50) NOT NULL,
    model_version TEXT NOT NULL,
    target_c NUMERIC(5,2) NOT NULL CHECK (target_c BETWEEN -30 AND 25),
    score SMALLINT CHECK (score BETWEEN 0 AND 100),
    severity TEXT NOT NULL CHECK (severity IN ('insufficient_data', 'normal', 'watch', 'warning', 'critical')),
    features JSONB,
    factors JSONB NOT NULL,
    baseline_windows SMALLINT NOT NULL CHECK (baseline_windows >= 0),
    PRIMARY KEY (truck_id, window_end),
    CHECK ((score IS NULL) = (severity = 'insufficient_data'))
);
