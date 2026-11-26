import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import { neon } from '@neondatabase/serverless';
import * as bcrypt from 'bcryptjs';

async function initDb() {
  console.log('--- Initializing Neon Postgres Schema & Seed Data ---');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL not set in environment.');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('1. Creating tables...');

  // Create extension for UUID generation if not present
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

  // Users table
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'owner', 'truckUser')),
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      truck_id UUID,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Trucks table
  await sql`
    CREATE TABLE IF NOT EXISTS trucks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plate_number VARCHAR(50) UNIQUE NOT NULL,
      type VARCHAR(50) NOT NULL,
      capacity_tons NUMERIC(5,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'on_trip', 'maintenance')),
      target_temp_c NUMERIC(4,1) DEFAULT 4.0,
      iot_connection_number VARCHAR(50),
      base_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      current_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      insurance_risk_score NUMERIC(5,2) DEFAULT 15.0,
      insurance_status VARCHAR(20) DEFAULT 'discounted',
      insurance_expiry DATE,
      permit_expiry DATE,
      fitness_expiry DATE,
      iot_connection_number VARCHAR(50),
      base_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      current_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      insurance_risk_score NUMERIC(5,2) DEFAULT 15.0,
      insurance_status VARCHAR(20) DEFAULT 'discounted',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Additive upgrades for databases initialized by older versions of db:init.
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) DEFAULT 15.0;`;
  await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) DEFAULT 'discounted';`;
  await sql`CREATE INDEX IF NOT EXISTS idx_trucks_iot_connection ON trucks(iot_connection_number);`;

  // Trips table
  await sql`
    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      origin VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      cargo_type VARCHAR(100) NOT NULL,
      notes TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP
    );
  `;

  // Trip telemetry history table (must be created after trips and trucks)
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
      good_env_rsl_hours NUMERIC(6,2),
      bad_env_rsl_hours NUMERIC(6,2),
      environment_condition VARCHAR(30),
      base_insurance_price NUMERIC(8,2),
      predicted_insurance_price NUMERIC(8,2),
      insurance_risk_score NUMERIC(5,2),
      model_type VARCHAR(50),
      route_recommendation TEXT,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // IoT Devices registry table
  await sql`
    CREATE TABLE IF NOT EXISTS iot_devices (
      device_id VARCHAR(50) PRIMARY KEY,
      connection_number VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(150) NOT NULL,
      product_type VARCHAR(120) DEFAULT 'Cold Cargo',
      battery NUMERIC(5,2),
      power_on BOOLEAN DEFAULT true,
      reported_status VARCHAR(30) DEFAULT 'online',
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      active BOOLEAN DEFAULT true,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Issues table
  await sql`
    CREATE TABLE IF NOT EXISTS issues (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
      reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Activity Log table
  await sql`
    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      entity VARCHAR(50) NOT NULL,
      entity_id UUID,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Real-time Truck GPS Locations table
  await sql`
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
  `;

  // Truck Location History (Breadcrumb trails) table
  await sql`
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
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_truck_loc_history_truck_time ON truck_location_history(truck_id, recorded_at DESC);
  `;

  if (process.env.SEED_DEMO_DATA !== 'true' || process.env.NODE_ENV === 'production') {
    console.log('Demo seeding disabled. Set SEED_DEMO_DATA=true in a non-production environment to seed a fresh development database.');
    return;
  }
  console.log('2. Seeding initial data (Skill S7)...');

  // Seed demo data only into a genuinely empty database. Never truncate or
  // replace existing production/application records during initialization.
  const existingData = await sql`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM trucks) AS trucks,
      (SELECT COUNT(*) FROM trips) AS trips,
      (SELECT COUNT(*) FROM issues) AS issues,
      (SELECT COUNT(*) FROM activity_log) AS activity_logs,
      (SELECT COUNT(*) FROM truck_locations) AS truck_locations,
      (SELECT COUNT(*) FROM truck_location_history) AS truck_location_history,
      (SELECT COUNT(*) FROM trip_telemetry_history) AS trip_telemetry_history
  `;
  const populatedTables = Object.entries(existingData[0] || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([table]) => table);
  if (populatedTables.length > 0) {
    console.log(`Existing records found in ${populatedTables.join(', ')}. Preserving all records; demo seeding skipped.`);
    return;
  }

  const defaultPassword = 'password123';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // 1 Admin
  const adminRows = await sql`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Alexander Wright', 'admin@elitecold.com', ${passwordHash}, 'admin')
    RETURNING id;
  `;
  const adminId = adminRows[0].id;

  // 2 Owners
  const owner1Rows = await sql`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Bespoke Reefer Logistics', 'owner1@elitecold.com', ${passwordHash}, 'owner')
    RETURNING id;
  `;
  const owner1Id = owner1Rows[0].id;

  const owner2Rows = await sql`
    INSERT INTO users (name, email, password_hash, role)
    VALUES ('Apex Nordic Cold Transport', 'owner2@elitecold.com', ${passwordHash}, 'owner')
    RETURNING id;
  `;
  const owner2Id = owner2Rows[0].id;

  // 3 Truck Users (Drivers)
  const driver1Rows = await sql`
    INSERT INTO users (name, email, password_hash, role, owner_id)
    VALUES ('Marcus Vance', 'driver1@elitecold.com', ${passwordHash}, 'truckUser', ${owner1Id})
    RETURNING id;
  `;
  const driver1Id = driver1Rows[0].id;

  const driver2Rows = await sql`
    INSERT INTO users (name, email, password_hash, role, owner_id)
    VALUES ('Elena Rostova', 'driver2@elitecold.com', ${passwordHash}, 'truckUser', ${owner1Id})
    RETURNING id;
  `;
  const driver2Id = driver2Rows[0].id;

  const driver3Rows = await sql`
    INSERT INTO users (name, email, password_hash, role, owner_id)
    VALUES ('Devon Miller', 'driver3@elitecold.com', ${passwordHash}, 'truckUser', ${owner2Id})
    RETURNING id;
  `;
  const driver3Id = driver3Rows[0].id;

  // 7 Trucks across multiple statuses & document expirations (Skill S7 requirement)
  // Truck 1: Available, good docs (Owner 1)
  const truck1Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner1Id}, 'DL-01-AX-4821', 'Refrigerated Semi 10T', 10.5, 'available', 3.5, '2027-04-15', '2027-06-20', '2027-08-10')
    RETURNING id;
  `;
  const truck1Id = truck1Rows[0].id;

  // Truck 2: On trip, assigned to driver1 (Owner 1)
  const truck2Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner1Id}, 'MH-04-BZ-9042', 'Heavy Reefer 18T', 18.0, 'on_trip', -18.0, '2027-02-10', '2027-03-15', '2027-05-30')
    RETURNING id;
  `;
  const truck2Id = truck2Rows[0].id;
  await sql`UPDATE users SET truck_id = ${truck2Id} WHERE id = ${driver1Id};`;

  // Truck 3: Expiring documents flag test (Owner 1) - Expiring insurance in 4 days!
  const expiringDate = new Date();
  expiringDate.setDate(expiringDate.getDate() + 4);
  const expiringStr = expiringDate.toISOString().split('T')[0];

  const truck3Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner1Id}, 'HR-26-CY-1188', 'Medium Van 4.5T', 4.5, 'available', 4.0, ${expiringStr}, '2027-01-20', '2027-09-12')
    RETURNING id;
  `;
  const truck3Id = truck3Rows[0].id;
  await sql`UPDATE users SET truck_id = ${truck3Id} WHERE id = ${driver2Id};`;

  // Truck 4: Maintenance status test (Owner 1)
  const truck4Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner1Id}, 'UP-16-DK-7733', 'Cold Box Truck 8T', 8.0, 'maintenance', 2.0, '2027-07-01', '2027-07-15', '2027-11-20')
    RETURNING id;
  `;
  const truck4Id = truck4Rows[0].id;

  // Truck 5: Available (Owner 2)
  const truck5Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner2Id}, 'KA-05-EM-6620', 'Pharma Ultra-Cool Reefer', 6.0, 'on_trip', -25.0, '2027-05-18', '2027-06-30', '2027-08-25')
    RETURNING id;
  `;
  const truck5Id = truck5Rows[0].id;
  await sql`UPDATE users SET truck_id = ${truck5Id} WHERE id = ${driver3Id};`;

  // Truck 6: Available (Owner 2)
  const truck6Rows = await sql`
    INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
    VALUES (${owner2Id}, 'TN-09-FV-3301', 'Refrigerated Semi 12T', 12.0, 'available', 5.0, '2027-03-25', '2027-09-10', '2027-10-14')
    RETURNING id;
  `;

  // Trips data
  // Active trip for truck 2 with driver 1
  await sql`
    INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, started_at)
    VALUES (${truck2Id}, ${driver1Id}, 'Mumbai Port Logistics Terminal 3', 'Delhi Northern Cold Hub', 'Frozen Seafood & Salmon', 'Keep continuous temperature lock at -18C.', NOW() - INTERVAL '6 hours');
  `;

  // Completed trip for truck 2
  await sql`
    INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, started_at, ended_at)
    VALUES (${truck2Id}, ${driver1Id}, 'Pune Distribution Center', 'Mumbai Port', 'Specialty Dairy Products', 'Delivered intact, temp steady at 3.8C.', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days 18 hours');
  `;

  // Active trip for truck 5 with driver 3
  await sql`
    INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, started_at)
    VALUES (${truck5Id}, ${driver3Id}, 'Bangalore Biotech Hub', 'Hyderabad Medical Depot', 'Vaccines & Biological Reagents', 'Strict regulatory protocol: maintain below -20C.', NOW() - INTERVAL '14 hours');
  `;

  // Sample Issues
  await sql`
    INSERT INTO issues (truck_id, reported_by, description, status)
    VALUES (${truck4Id}, ${driver2Id}, 'Reefer compressor cycling intermittently; scheduled diagnostic service.', 'investigating');
  `;

  await sql`
    INSERT INTO issues (truck_id, reported_by, description, status)
    VALUES (${truck2Id}, ${driver1Id}, 'Minor door gasket condensation observed during pre-trip inspection.', 'open');
  `;

  // Activity Log audit entries (Skill S2 requirement)
  await sql`
    INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
    VALUES 
      (${adminId}, 'INITIALIZE_SYSTEM', 'PLATFORM', ${null}::uuid, '{"note": "Initial cold chain platform deployment"}'::jsonb),
      (${adminId}, 'CREATE_OWNER', 'USER', ${owner1Id}::uuid, '{"name": "Bespoke Reefer Logistics"}'::jsonb),
      (${owner1Id}, 'ADD_TRUCK', 'TRUCK', ${truck1Id}::uuid, '{"plateNumber": "DL-01-AX-4821"}'::jsonb),
      (${owner1Id}, 'ADD_TRUCK', 'TRUCK', ${truck2Id}::uuid, '{"plateNumber": "MH-04-BZ-9042"}'::jsonb),
      (${owner1Id}, 'ASSIGN_DRIVER', 'USER', ${driver1Id}::uuid, '{"action": "Assigned driver"}'::jsonb),
      (${driver1Id}, 'START_TRIP', 'TRIP', ${truck2Id}::uuid, '{"origin": "Mumbai", "destination": "Delhi"}'::jsonb);
  `;

  console.log('✅ Database schema and demo dataset successfully initialized!');
}

initDb().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
