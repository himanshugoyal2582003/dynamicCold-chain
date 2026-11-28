CREATE TABLE insurance_signal_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    created_by UUID NOT NULL REFERENCES users(id),
    assessment JSONB NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','follow_up','explained','insufficient_evidence')),
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX ix_insurance_signal_case_trip ON insurance_signal_cases(trip_id);
CREATE INDEX ix_insurance_signal_recent ON insurance_signal_cases(assessed_at DESC,id DESC);
CREATE INDEX ix_insurance_started_trips ON trips(started_at DESC,id) WHERE started_at IS NOT NULL;

CREATE TABLE insurance_signal_review_log (
    case_id UUID NOT NULL REFERENCES insurance_signal_cases(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(24) NOT NULL CHECK (status IN ('follow_up','explained','insufficient_evidence')),
    note VARCHAR(1000) NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (case_id,revision)
);
