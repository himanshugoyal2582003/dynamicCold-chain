import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import { neon } from '@neondatabase/serverless';

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  console.log('Running schema migrations on Neon Postgres...');

  // 1. Columns for trucks
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) DEFAULT 15.0;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) DEFAULT 'discounted';`;

  console.log('Trucks columns verified.');

  // 2. trip_telemetry_history table
  await sql`
    CREATE TABLE IF NOT EXISTS trip_telemetry_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
      truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
      device_id VARCHAR(50),
      connection_number VARCHAR(50),
      temperature NUMERIC(5,2) NOT NULL,
      target_temp NUMERIC(5,2) NOT NULL,
      humidity NUMERIC(5,2) NOT NULL,
      battery NUMERIC(5,2) NOT NULL,
      door_open BOOLEAN DEFAULT false,
      gps_lat NUMERIC(9,6),
      gps_lng NUMERIC(9,6),
      speed_kmh NUMERIC(5,2),
      spoilage_risk NUMERIC(5,2),
      spoilage_risk_level VARCHAR(20),
      rsl_hours NUMERIC(6,2),
      quality_retention_pct NUMERIC(5,2),
      route_recommendation TEXT,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  console.log('trip_telemetry_history table verified.');

  // 3. Set default connection numbers for demo trucks if null
  await sql`
    UPDATE trucks
    SET iot_connection_number = 'CONN-4821',
        base_insurance_price = 450.00,
        current_insurance_price = 410.00,
        insurance_risk_score = 12.0,
        insurance_status = 'discounted'
    WHERE plate_number = 'DL-01-AX-4821' AND iot_connection_number IS NULL;
  `;
  await sql`
    UPDATE trucks
    SET iot_connection_number = 'CONN-9042',
        base_insurance_price = 550.00,
        current_insurance_price = 490.00,
        insurance_risk_score = 18.0,
        insurance_status = 'discounted'
    WHERE plate_number = 'MH-04-BZ-9042' AND iot_connection_number IS NULL;
  `;
  await sql`
    UPDATE trucks
    SET iot_connection_number = 'CONN-1188',
        base_insurance_price = 350.00,
        current_insurance_price = 395.00,
        insurance_risk_score = 45.0,
        insurance_status = 'surcharged'
    WHERE plate_number = 'HR-26-CY-1188' AND iot_connection_number IS NULL;
  `;
  await sql`
    UPDATE trucks
    SET iot_connection_number = 'CONN-6620',
        base_insurance_price = 500.00,
        current_insurance_price = 460.00,
        insurance_risk_score = 15.0,
        insurance_status = 'discounted'
    WHERE plate_number = 'KA-05-EM-6620' AND iot_connection_number IS NULL;
  `;

  console.log('✅ Migrations completed successfully.');
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
