-- Persistent registry metadata for virtual/physical IoT devices. Truck pairing
-- remains stored in trucks.iot_connection_number to avoid a second assignment
-- relationship and to preserve all existing pairings.
CREATE TABLE IF NOT EXISTS iot_devices (
  device_id VARCHAR(100) PRIMARY KEY,
  connection_number VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  product_type VARCHAR(150),
  battery NUMERIC(5,2),
  power_on BOOLEAN NOT NULL DEFAULT false,
  reported_status VARCHAR(30) NOT NULL DEFAULT 'offline',
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_iot_devices_active_connection
  ON iot_devices(active, connection_number);
