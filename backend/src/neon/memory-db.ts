import { newDb, DataType } from 'pg-mem';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

export async function createInMemoryPostgres() {
  const db = newDb();

  // Register uuid extension & function
  db.registerExtension('uuid-ossp', (schema) => {
    schema.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });
  });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  // Create tables
  db.public.none(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      owner_id UUID,
      truck_id UUID,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trucks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_id UUID NOT NULL,
      plate_number VARCHAR(50) UNIQUE NOT NULL,
      type VARCHAR(50) NOT NULL,
      capacity_tons NUMERIC(5,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'available',
      target_temp_c NUMERIC(4,1) DEFAULT 4.0,
      insurance_expiry DATE,
      permit_expiry DATE,
      fitness_expiry DATE,
      active BOOLEAN DEFAULT true,
      iot_connection_number VARCHAR(50),
      base_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      current_insurance_price NUMERIC(8,2) DEFAULT 450.00,
      insurance_risk_score NUMERIC(5,2) DEFAULT 15.0,
      insurance_status VARCHAR(20) DEFAULT 'discounted',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trips (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      truck_id UUID NOT NULL,
      user_id UUID NOT NULL,
      origin VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      cargo_type VARCHAR(100) NOT NULL,
      notes TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS issues (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      truck_id UUID NOT NULL,
      reported_by UUID NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      actor_id UUID,
      action VARCHAR(100) NOT NULL,
      entity VARCHAR(50) NOT NULL,
      entity_id UUID,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trip_telemetry_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      trip_id UUID,
      truck_id UUID NOT NULL,
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
  `);

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();

  const runner: any = async (stringsOrQuery: any, ...values: any[]) => {
    if (typeof stringsOrQuery === 'string') {
      const params = values[0] || [];
      const res = await pool.query(stringsOrQuery, params);
      return res.rows;
    }
    // Tagged template literal
    let query = '';
    const params: any[] = [];
    for (let i = 0; i < stringsOrQuery.length; i++) {
      query += stringsOrQuery[i];
      if (i < values.length) {
        params.push(values[i]);
        query += '$' + params.length;
      }
    }
    const res = await pool.query(query, params);
    return res.rows;
  };

  // Seed demo data
  const defaultPassword = 'password123';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  const adminRows = await runner(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
    ['Alexander Wright', 'admin@elitecold.com', passwordHash],
  );
  const adminId = adminRows[0].id;

  const owner1Rows = await runner(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner') RETURNING id`,
    ['Bespoke Reefer Logistics', 'owner1@elitecold.com', passwordHash],
  );
  const owner1Id = owner1Rows[0].id;

  const owner2Rows = await runner(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner') RETURNING id`,
    ['Apex Nordic Cold Transport', 'owner2@elitecold.com', passwordHash],
  );
  const owner2Id = owner2Rows[0].id;

  const driver1Rows = await runner(
    `INSERT INTO users (name, email, password_hash, role, owner_id) VALUES ($1, $2, $3, 'truckUser', $4) RETURNING id`,
    ['Marcus Vance', 'driver1@elitecold.com', passwordHash, owner1Id],
  );
  const driver1Id = driver1Rows[0].id;

  const driver2Rows = await runner(
    `INSERT INTO users (name, email, password_hash, role, owner_id) VALUES ($1, $2, $3, 'truckUser', $4) RETURNING id`,
    ['Elena Rostova', 'driver2@elitecold.com', passwordHash, owner1Id],
  );
  const driver2Id = driver2Rows[0].id;

  const driver3Rows = await runner(
    `INSERT INTO users (name, email, password_hash, role, owner_id) VALUES ($1, $2, $3, 'truckUser', $4) RETURNING id`,
    ['Devon Miller', 'driver3@elitecold.com', passwordHash, owner2Id],
  );
  const driver3Id = driver3Rows[0].id;

  // Trucks
  const truck1Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'DL-01-AX-4821', 'Refrigerated Semi 10T', 10.5, 'available', 3.5, '2027-04-15', '2027-06-20', '2027-08-10', 'IOT-DL01-AX') RETURNING id`,
    [owner1Id],
  );
  const truck1Id = truck1Rows[0].id;

  const truck2Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'MH-04-BZ-9042', 'Heavy Reefer 18T', 18.0, 'on_trip', -18.0, '2027-02-10', '2027-03-15', '2027-05-30', 'IOT-MH04-BZ') RETURNING id`,
    [owner1Id],
  );
  const truck2Id = truck2Rows[0].id;
  await runner(`UPDATE users SET truck_id = $1 WHERE id = $2`, [truck2Id, driver1Id]);

  const expiringDate = new Date();
  expiringDate.setDate(expiringDate.getDate() + 4);
  const expiringStr = expiringDate.toISOString().split('T')[0];

  const truck3Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'HR-26-CY-1188', 'Medium Van 4.5T', 4.5, 'available', 4.0, $2, '2027-01-20', '2027-09-12', 'IOT-HR26-CY') RETURNING id`,
    [owner1Id, expiringStr],
  );
  const truck3Id = truck3Rows[0].id;
  await runner(`UPDATE users SET truck_id = $1 WHERE id = $2`, [truck3Id, driver2Id]);

  const truck4Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'UP-16-DK-7733', 'Cold Box Truck 8T', 8.0, 'maintenance', 2.0, '2027-07-01', '2027-07-15', '2027-11-20', 'IOT-UP16-DK') RETURNING id`,
    [owner1Id],
  );
  const truck4Id = truck4Rows[0].id;

  const truck5Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'KA-05-EM-6620', 'Pharma Ultra-Cool Reefer', 6.0, 'on_trip', -25.0, '2027-05-18', '2027-06-30', '2027-08-25', 'IOT-KA05-EM') RETURNING id`,
    [owner2Id],
  );
  const truck5Id = truck5Rows[0].id;
  await runner(`UPDATE users SET truck_id = $1 WHERE id = $2`, [truck5Id, driver3Id]);

  const truck6Rows = await runner(
    `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, status, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, iot_connection_number)
     VALUES ($1, 'TN-09-FV-3301', 'Refrigerated Semi 12T', 12.0, 'available', 5.0, '2027-03-25', '2027-09-10', '2027-10-14', 'IOT-TN09-FV') RETURNING id`,
    [owner2Id],
  );

  // Trips
  await runner(
    `INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, started_at)
     VALUES ($1, $2, 'Mumbai Port Logistics Terminal 3', 'Delhi Northern Cold Hub', 'Frozen Seafood & Salmon', 'Keep continuous temperature lock at -18C.', CURRENT_TIMESTAMP)`,
    [truck2Id, driver1Id],
  );

  await runner(
    `INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, started_at)
     VALUES ($1, $2, 'Bangalore Biotech Hub', 'Hyderabad Medical Depot', 'Vaccines & Biological Reagents', 'Strict regulatory protocol: maintain below -20C.', CURRENT_TIMESTAMP)`,
    [truck5Id, driver3Id],
  );

  // Issues
  await runner(
    `INSERT INTO issues (truck_id, reported_by, description, status) VALUES ($1, $2, 'Reefer compressor cycling intermittently; scheduled diagnostic service.', 'investigating')`,
    [truck4Id, driver2Id],
  );

  await runner(
    `INSERT INTO issues (truck_id, reported_by, description, status) VALUES ($1, $2, 'Minor door gasket condensation observed during pre-trip inspection.', 'open')`,
    [truck2Id, driver1Id],
  );

  // Activity Log
  await runner(
    `INSERT INTO activity_log (actor_id, action, entity, entity_id, details) VALUES ($1, 'INITIALIZE_SYSTEM', 'PLATFORM', $1, '{"note": "Cold chain platform running"}'::jsonb)`,
    [adminId],
  );

  return runner;
}
