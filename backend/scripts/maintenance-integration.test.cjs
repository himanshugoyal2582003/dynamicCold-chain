const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { AppModule } = require('../dist/app.module');
const { AuthService } = require('../dist/auth/auth.service');
const { IotService } = require('../dist/iot/iot.service');
const { IotController } = require('../dist/iot/iot.controller');
const { NeonService } = require('../dist/neon/neon.service');
const { MaintenanceController } = require('../dist/maintenance/maintenance.controller');
const { MaintenanceService } = require('../dist/maintenance/maintenance.service');

test('maintenance capture, assessments and authenticated history in isolated PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const directory = resolve(__dirname, '../db/migrations');
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(resolve(directory, name), 'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  }

  const query = async (statement, ...params) => {
    if (typeof statement === 'string') return (await db.query(statement, params[0] ?? [])).rows;
    const text = statement.reduce((sql, part, index) => index ? sql + '$' + index + part : part, '');
    return (await db.query(text, params)).rows;
  };
  const previous = {};
  const environment = {
    MAINTENANCE_SENSOR_IDS: 'FIELD-FIXTURE,SIM-FIXTURE,DEV-ESP32-FIXTURE',
    JWT_SECRET: 'isolated-maintenance-test-session-key',
    IOT_INGEST_SECRET: 'isolated-maintenance-ingest',
  };
  for (const [key, value] of Object.entries(environment)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function addUser(role) {
    const id = randomUUID();
    await query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$2)',
      [id, role, id + '@test.invalid', 'unused']);
    return { sub: id, role };
  }
  const admin = await addUser('admin'), owner = await addUser('owner');
  const stranger = await addUser('owner'), driver = await addUser('truckUser');
  const truck = randomUUID(), otherTruck = randomUUID();
  await query(`INSERT INTO trucks(id,owner_id,plate_number,type,capacity_tons,iot_connection_number)
     VALUES($1,$2,'FIELD-TRUCK','Box',5,'FIELD-PAIR'),($3,$4,'OTHER-TRUCK','Box',5,'OTHER-PAIR')`,
    [truck, owner.sub, otherTruck, stranger.sub]);
  await query('UPDATE users SET truck_id=$1 WHERE id=$2', [truck, driver.sub]);

  class FixtureIot extends IotService {
    onModuleInit() {}
    async recalculateInsurance() { return null; }
  }
  class TestModule { configure(consumer) { AppModule.prototype.configure(consumer); } }
  Module({
    controllers: [IotController, MaintenanceController],
    providers: [
      AuthService, MaintenanceService,
      { provide: NeonService, useValue: { getSql: () => query } },
      { provide: IotService, useFactory: (neon, maintenance) => new FixtureIot(neon, maintenance),
        inject: [NeonService, MaintenanceService] },
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  t.after(() => app.close());
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
  const host = await app.getUrl();
  const maintenance = app.get(MaintenanceService);

  async function get(path, actor) {
    const cookies = actor ? { Cookie: 'coldchain_token=' + jwt.sign(actor, process.env.JWT_SECRET) } : {};
    const response = await fetch(host + '/api/maintenance' + path, { headers: cookies });
    return { status: response.status, body: await response.json() };
  }

  await t.test('cookie auth, live roles and tenant-scoped results', async () => {
    assert.equal((await get('')).status, 401);
    assert.equal((await get('', driver)).status, 403);
    assert.equal((await get('?page=-1', admin)).status, 400);
    assert.equal((await get('/trucks/bad/history', admin)).status, 400);
    assert.equal((await get('/trucks/' + truck + '/history', stranger)).status, 404);
    const fleet = await get('', owner);
    assert.equal(fleet.status, 200);
    assert.deepEqual(fleet.body.trucks.map(row => row.id), [truck]);
    assert.equal(fleet.body.trucks[0].data_status, 'no_data');
    assert.equal((await get('', admin)).body.trucks.length, 2);
    await query('UPDATE users SET active=false WHERE id=$1', [stranger.sub]);
    assert.equal((await get('', stranger)).body.trucks.length, 0);
  });

  await t.test('approved sensor metadata goes through authenticated IoT ingestion only', async () => {
    const now = new Date().toISOString();
    const sample = { observed_at: now, temperature_c: 7, humidity_pct: 61, door_open: null };
    await maintenance.recordSensor(truck, 'SIM-FIXTURE', 'FIELD-PAIR', sample);
    await maintenance.recordSensor(truck, 'DEV-ESP32-FIXTURE', 'FIELD-PAIR', sample);
    await maintenance.recordSensor(truck, 'FIELD-FIXTURE', 'WRONG-PAIR', sample);
    await maintenance.recordSensor(truck, 'FIELD-FIXTURE', 'FIELD-PAIR', { ...sample, humidity_pct: 101 });
    await maintenance.recordSensor(truck, 'FIELD-FIXTURE', 'FIELD-PAIR', {
      ...sample, observed_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    });
    assert.equal((await query('SELECT * FROM maintenance_sensor_samples')).length, 0);

    const payload = {
      connection_number: 'FIELD-PAIR', device_id: 'FIELD-FIXTURE', temperature: 7,
      target_temp: 4, humidity: 61, battery: 91, door_open: false, timestamp: now,
      spoilage_risk: 0.6, shelf_life_remaining_hours: 9, quality_retention_pct: 90,
      route_recommendation: 'fixture', maintenance_sensor: sample,
    };
    const ingest = secret => fetch(host + '/api/iot/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-iot-ingest-secret': secret },
      body: JSON.stringify(payload),
    });
    assert.equal((await ingest('wrong')).status, 401);
    assert.equal((await ingest(environment.IOT_INGEST_SECRET)).status, 201);
    assert.equal((await ingest(environment.IOT_INGEST_SECRET)).status, 201);
    let rows = [];
    for (let attempt = 0; attempt < 30 && !rows.length; attempt++) {
      rows = await query('SELECT device_id, temperature_c, target_c, humidity_pct, door_open FROM maintenance_sensor_samples');
      if (!rows.length) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0].device_id, 'FIELD-FIXTURE');
    assert.equal(Number(rows[0].temperature_c), 7);
    assert.equal(Number(rows[0].target_c), 4);
    assert.equal(rows[0].door_open, null);
    assert.equal(app.get(IotService).getTelemetryForTruck(truck).maintenance_sensor, undefined);
  });

  await t.test('historical baseline, current assessment, idempotency and pairing changes', async () => {
    const end = Math.floor(Date.now() / 300000) * 300000;
    for (let minute = 1; minute <= 320; minute++) {
      const observed = new Date(end - minute * 60000).toISOString();
      await query(`INSERT INTO maintenance_sensor_samples
          (truck_id,device_id,connection_number,sample_minute,observed_at,temperature_c,target_c,humidity_pct,door_open)
          VALUES($1,'FIELD-FIXTURE','FIELD-PAIR',$2,$2,$3,4,$4,false) ON CONFLICT DO NOTHING`,
        [truck, observed, minute <= 30 ? 4 + (31 - minute) * 0.2 : 4 + (minute % 3) * 0.05, 60 + minute % 3]);
    }
    await Promise.all([maintenance.runAssessmentCycle(end), maintenance.runAssessmentCycle(end)]);
    await maintenance.runAssessmentCycle(end);
    const history = (await get('/trucks/' + truck + '/history', owner)).body;
    assert.equal(history.assessments.length, 1);
    assert.ok(history.assessments[0].score <= 75, JSON.stringify(history));
    assert.ok(history.assessments[0].baseline_windows >= 8);
    assert.equal(history.daily[0].warnings, 1);
    assert.ok(history.assessments[0].factors.some(f => f.code === 'closed_warming_trend'));
    assert.equal((await get('', owner)).body.trucks[0].data_status, 'current');
    await query('UPDATE trucks SET target_temp_c=5 WHERE id=$1', [truck]);
    assert.equal((await get('', owner)).body.trucks[0].data_status, 'no_data');
    await query('UPDATE trucks SET target_temp_c=4 WHERE id=$1', [truck]);
    await query("UPDATE maintenance_assessments SET last_observed_at = now() - interval '20 minutes'");
    assert.equal((await get('', owner)).body.trucks[0].data_status, 'stale');
    await query("UPDATE trucks SET iot_connection_number='NEW-PAIR' WHERE id=$1", [truck]);
    assert.equal((await get('', owner)).body.trucks[0].data_status, 'no_data');
    assert.equal((await get('/trucks/' + truck + '/history', admin)).body.assessments.length, 1);
  });

  await t.test('bounded assessments prioritize unserved trucks and skip outdated setpoints', async () => {
    const end = Math.floor(Date.now() / 300000) * 300000 + 300000;
    const start = new Date(end - 60000).toISOString();
    const previous = new Date(end - 300000).toISOString();
    const window = new Date(end).toISOString();
    const first = '00000000-0000-4000-8000-000000000001';
    const last = '00000000-0000-4000-8000-000000000052';
    await query(`INSERT INTO trucks (id, owner_id, plate_number, type, capacity_tons, iot_connection_number, target_temp_c)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
             $1, 'BATCH-' || n, 'Box', 5, 'BATCH-PAIR-' || n, CASE n WHEN 2 THEN 5 ELSE 4 END
      FROM generate_series(1, 52) n`, [owner.sub]);
    await query(`INSERT INTO maintenance_sensor_samples
      (truck_id, device_id, connection_number, sample_minute, observed_at, temperature_c, target_c, humidity_pct)
      SELECT id, 'FIELD-FIXTURE', iot_connection_number, $1, $1, 4, 4, 60
      FROM trucks WHERE plate_number LIKE 'BATCH-%'`, [start]);
    await query(`INSERT INTO maintenance_assessments
      (truck_id, window_end, last_observed_at, device_id, connection_number, model_version, target_c,
       severity, factors, baseline_windows)
      VALUES ($1, $2, $2, 'FIELD-FIXTURE', 'BATCH-PAIR-1', 'fixture', 4, 'insufficient_data', '[]', 0)`,
    [first, previous]);

    const assessed = async () => (await query(`SELECT a.truck_id
      FROM maintenance_assessments a JOIN trucks t ON t.id = a.truck_id
      WHERE a.window_end = $1 AND t.plate_number LIKE 'BATCH-%' ORDER BY a.truck_id`, [window]))
      .map(row => row.truck_id);
    await maintenance.runAssessmentCycle(end);
    const firstBatch = await assessed();
    assert.equal(firstBatch.length, 50);
    assert.equal(firstBatch.at(-1), last);
    assert.ok(!firstBatch.includes(first));
    await maintenance.runAssessmentCycle(end);
    const completed = await assessed();
    assert.equal(completed.length, 51);
    assert.equal(completed[0], first);
    assert.ok(!completed.includes('00000000-0000-4000-8000-000000000002'));
  });
});
