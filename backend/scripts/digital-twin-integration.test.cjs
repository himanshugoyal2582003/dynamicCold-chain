const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { PGlite } = require('@electric-sql/pglite');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { AppModule } = require('../dist/app.module');
const { AuthService } = require('../dist/auth/auth.service');
const { NeonService } = require('../dist/neon/neon.service');
const { IotService } = require('../dist/iot/iot.service');
const { DigitalTwinController } = require('../dist/digital-twin/digital-twin.controller');
const { DigitalTwinService } = require('../dist/digital-twin/digital-twin.service');

test('digital twin HTTP contract and read-only integration with isolated PostgreSQL', async t => {
  const db = new PGlite();
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'digital-twin-local-test-session-key';
  let app;
  t.after(async () => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    try { if (app) await app.close(); } finally { await db.close(); }
  });
  const migrations = resolve(__dirname, '../db/migrations');
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(resolve(migrations, name), 'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  }
  const addUser = async role => {
    const sub = randomUUID();
    await db.query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$2)',
      [sub, role, sub + '@test.invalid', 'unused']);
    return { sub, role };
  };
  const owner = await addUser('owner');
  const outsider = await addUser('owner');
  const admin = await addUser('admin');
  const driver = await addUser('truckUser');
  const truck = randomUUID();
  await db.query(`INSERT INTO trucks(id,owner_id,plate_number,type,capacity_tons,iot_connection_number,target_temp_c)
    VALUES($1,$2,'TWIN-TRUCK','Box',5,'TWIN-PAIR',4)`, [truck, owner.sub]);
  const trip = randomUUID();
  await db.query(`INSERT INTO trips(id,user_id,truck_id,origin,destination,cargo_type,status,started_at,assigned_at)
    VALUES($1,$2,$3,'A','B','Dairy','IN_PROGRESS',now() AT TIME ZONE 'UTC' - interval '5 minutes',now())`,
    [trip, driver.sub, truck]);
  await db.query(`INSERT INTO maintenance_assessments VALUES($1,now(),now(),'FIELD-TWIN','TWIN-PAIR','fixture',4,85,'watch',null,'[]',0)`, [truck]);
  const facility = (await db.query(`INSERT INTO cold_storage_facilities(source_key,name,latitude,longitude)
    VALUES('twin-facility','Test storage',25,75) RETURNING id`)).rows[0].id;
  const rescue = (await db.query(`INSERT INTO rescue_events(trip_id,truck_id,original_destination,cargo_type,trigger_reason,
    spoilage_risk,remaining_shelf_life_hours,latitude,longitude,severity,gps_recorded_at,telemetry_recorded_at,valid_until,shelf_life_until)
    VALUES($1,$2,'B','Dairy','fixture',0.65,4,25,75,'HIGH',now(),now(),now()+interval '10 minutes',now()+interval '4 hours') RETURNING id`, [trip, truck])).rows[0].id;
  await db.query(`INSERT INTO rescue_candidates(rescue_event_id,facility_id,aerial_distance_km,estimated_duration_seconds,rank_position)
    VALUES($1,$2,10,1250,1)`, [rescue, facility]);

  const now = new Date().toISOString();
  const telemetry = { truck_id: truck, device_id: 'FIELD-TWIN', connection_number: 'TWIN-PAIR', source: 'sensor',
    timestamp: now, received_at: now, temperature: 5, target_temp: 4, device_target_temp: 4 };
  let reading = telemetry;
  let iotReads = 0;
  class TestModule { configure(consumer) { AppModule.prototype.configure(consumer); } }
  Module({
    controllers: [DigitalTwinController],
    providers: [AuthService, DigitalTwinService,
      { provide: NeonService, useValue: { getSql: () => async (statement, params) => {
        assert.match(statement.trim(), /^SELECT\b/i);
        return (await db.query(statement, params)).rows;
      } } },
      { provide: IotService, useValue: { getTelemetryForTruck: id => {
        assert.equal(id, truck);
        iotReads++;
        return reading;
      } } },
    ],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, '127.0.0.1');
  const host = await app.getUrl();
  const input = {
    plannedMinutes: 60, delayMinutes: 20, ambientC: 32, ambientRiseC: 0, ambientRiseStart: 0,
    failureStart: 0, failureMinutes: 30, powerLossStart: 0, powerLossMinutes: 0,
    doorStart: 0, doorMinutes: 0, initialShelfLifeHours: 12, cargoTimeConstantMinutes: 90,
    cargoValue: 15000, currency: 'INR',
  };
  async function request(path, actor, body, csrf = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (actor) headers.Cookie = 'coldchain_token=' + jwt.sign(actor, process.env.JWT_SECRET) + '; coldchain_csrf=fixture';
    if (csrf) headers['X-CSRF-Token'] = 'fixture';
    const response = await fetch(host + '/api/digital-twin/trucks' + path, {
      headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  const runPath = '/' + truck + '/simulate';

  await t.test('cookie and CSRF checks, role changes, tenant scope and strict validation', async () => {
    assert.equal((await request('', null)).status, 401);
    assert.equal((await request(runPath, owner, input, false)).status, 403);
    assert.equal((await request(runPath, driver, input)).status, 403);
    assert.equal((await request(runPath, outsider, input)).status, 404);
    assert.equal((await request('/bad-id/simulate', admin, input)).status, 400);
    assert.equal((await request('?page=0', admin)).status, 400);
    assert.equal((await request(runPath, owner, { ...input, source: 'sensor' })).status, 400);
    assert.equal((await request('', outsider)).body.trucks.length, 0);
    assert.deepEqual((await request('', owner)).body.trucks.map(item => item.id), [truck]);
    assert.deepEqual((await request('', admin)).body.trucks.map(item => item.id), [truck]);
    await db.query('UPDATE users SET active=false WHERE id=$1', [owner.sub]);
    assert.equal((await request(runPath, owner, input)).status, 404);
    await db.query('UPDATE users SET active=true WHERE id=$1', [owner.sub]);
    await db.query("UPDATE users SET role='owner' WHERE id=$1", [admin.sub]);
    assert.equal((await request(runPath, admin, input)).status, 404);
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.sub]);
    assert.equal(iotReads, 0);
  });

  await t.test('rejects fallback, simulation, stale, mismatched and out-of-range readings', async () => {
    for (const update of [
      { source: 'fallback' }, { device_id: 'SIM-TWIN' }, { timestamp: '2020-01-01T00:00:00Z' },
      { timestamp: new Date(Date.now() + 60000).toISOString() }, { connection_number: 'OTHER-PAIR' },
      { target_temp: 10 }, { device_target_temp: 10 }, { temperature: 999 }, { truck_id: randomUUID() },
    ]) {
      reading = { ...telemetry, ...update };
      assert.equal((await request(runPath, owner, input)).status, 409);
    }
    reading = telemetry;
  });

  await t.test('returns baseline, emergency and read-only recorded context', async () => {
    const before = JSON.stringify((await db.query('SELECT * FROM rescue_events')).rows);
    const { status, cache, body } = await request(runPath, owner, input);
    assert.equal(status, 200);
    assert.equal(cache, 'no-store');
    assert.equal(body.hypothetical, true);
    assert.deepEqual(body.seed, { airC: 5, targetC: 4, observedAt: now, source: 'paired_sensor' });
    assert.equal(body.truck.cargoType, 'Dairy');
    assert.equal(body.baseline.arrival.minute, 60);
    assert.equal(body.emergency.arrival.minute, 80);
    assert.ok(body.incrementalLoss > 0);
    assert.equal(body.maintenance.severity, 'watch');
    assert.equal(body.maintenance.stale, false);
    assert.equal(body.rescue.routeMinute, 21);
    assert.equal(body.rescue.remainingHoursAtEta, body.emergency.series[21].remainingHours);
    assert.equal(body.rescue.reserveAfterBuffer, body.emergency.series[36].remainingHours);
    assert.equal(JSON.stringify((await db.query('SELECT * FROM rescue_events')).rows), before);
    await db.query("UPDATE maintenance_assessments SET last_observed_at=now()-interval '20 minutes'");
    const short = await request(runPath, admin, { ...input, plannedMinutes: 10, delayMinutes: 0 });
    assert.equal(short.body.maintenance.stale, true);
    assert.equal(short.body.rescue.remainingHoursAtEta, null);
  });
});
