const assert = require('assert');
const { AuthGuardMiddleware, extractJwtToken } = require('../dist/middlewares/auth.middleware');
const { CsrfMiddleware } = require('../dist/middlewares/csrf.middleware');
const { IotController } = require('../dist/iot/iot.controller');

async function run() {
  // 1. Cookie-only JWT extraction
  assert.strictEqual(extractJwtToken({ cookies: { coldchain_token: 'abc' } }), 'abc');
  assert.strictEqual(extractJwtToken({ headers: { authorization: 'Bearer xyz' }, cookies: {} }), null);

  // 2. AuthGuardMiddleware missing cookie message
  const fakeAuth = { verifyToken: () => ({ sub: 'u1', role: 'truckUser', truckId: 't1' }) };
  const fakeNeonUnavailable = { getSql: () => null };
  const guardUnavailable = new AuthGuardMiddleware(fakeAuth, fakeNeonUnavailable);

  await assert.rejects(
    () => guardUnavailable.use({ cookies: {} }, {}, () => {}),
    (err) => err.message.includes('coldchain_token cookie'),
  );

  // 3. truckUser fails closed when DB is unavailable (no stale JWT fallback)
  await assert.rejects(
    () => guardUnavailable.use({ cookies: { coldchain_token: 'tok' } }, {}, () => {}),
    (err) => err.status === 503,
  );

  // 4. truckUser fails closed when user is inactive/missing in DB
  const guardInactive = new AuthGuardMiddleware(fakeAuth, { getSql: () => async () => [] });
  await assert.rejects(
    () => guardInactive.use({ cookies: { coldchain_token: 'tok' } }, {}, () => {}),
    (err) => err.status === 401,
  );

  // 5. CsrfMiddleware rejects mismatched/missing CSRF token on POST
  const csrf = new CsrfMiddleware();
  assert.throws(
    () => csrf.use({ method: 'POST', cookies: { coldchain_csrf: 'c1' }, headers: { 'x-csrf-token': 'bad' } }, {}, () => {}),
    (err) => err.status === 403,
  );
  let nextCalled = false;
  csrf.use({ method: 'POST', cookies: { coldchain_csrf: 'c1' }, headers: { 'x-csrf-token': 'c1' } }, {}, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);

  // 6. IotController enforces IOT_INGEST_SECRET in production
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.IOT_INGEST_SECRET;
  try {
    const iotCtrl = new IotController({ syncDeviceRegistry: () => ({ success: true }), ingest: () => ({ success: true }) });
    process.env.NODE_ENV = 'production';
    delete process.env.IOT_INGEST_SECRET;
    assert.throws(() => iotCtrl.ingest({ connection_number: 'CONN-1' }, 'anything'), (err) => err.status === 401);

    process.env.IOT_INGEST_SECRET = 'prod_secret_value_123456';
    assert.throws(() => iotCtrl.ingest({ connection_number: 'CONN-1' }, 'wrong'), (err) => err.status === 401);
    assert.deepStrictEqual(iotCtrl.ingest({ connection_number: 'CONN-1' }, 'prod_secret_value_123456'), { success: true });
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSecret === undefined) delete process.env.IOT_INGEST_SECRET;
    else process.env.IOT_INGEST_SECRET = prevSecret;
  }

  console.log('ALL_BACKEND_SECURITY_TESTS_PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
