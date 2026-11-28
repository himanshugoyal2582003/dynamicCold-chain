-- A durable watermark per authenticated pairing. No telemetry payload or credential is retained here.
CREATE TABLE telemetry_delivery_heads (
  connection_number VARCHAR(50) PRIMARY KEY,
  observed_at TIMESTAMPTZ NOT NULL,
  event_id CHAR(64) NOT NULL,
  projected BOOLEAN NOT NULL DEFAULT FALSE
);
