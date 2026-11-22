const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../lib/api-client.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText;
const apiModule = new Module(sourcePath, module);
apiModule.filename = sourcePath;
apiModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
apiModule._compile(compiled, sourcePath);
const { apiFetch } = apiModule.exports;

async function rejectsWithStatus(promise, status, expectedText) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, expectedText);
    return true;
  });
}

async function main() {
  const originalFetch = global.fetch;
  try {
    let requestInit;
    global.fetch = async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    assert.deepEqual(await apiFetch('/ok'), { ok: true });
    assert.equal(requestInit.credentials, 'include');
    global.fetch = async () => new Response(JSON.stringify('valid JSON string'), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(await apiFetch('/json-string'), 'valid JSON string');

    global.fetch = async () => new Response(null, { status: 200 });
    assert.equal(await apiFetch('/empty-post', { method: 'POST' }), null);
    global.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await apiFetch('/no-content'), null);
    global.fetch = async () => new Response(null, { status: 200 });
    await rejectsWithStatus(apiFetch('/empty-get'), 200, /GET \/empty-get returned an empty response/);
    assert.equal(await apiFetch('/empty-get-allowed', { allowEmptyResponse: true }), null);

    global.fetch = async () => new Response(JSON.stringify({ message: 'Invalid input' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    await rejectsWithStatus(apiFetch('/bad-request'), 400, /Invalid input/);

    global.fetch = async () => new Response(JSON.stringify({ message: 'Session expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
    await rejectsWithStatus(apiFetch('/unauthorized', { redirectOnUnauthorized: false }), 401, /Session expired/);

    global.fetch = async () => new Response(JSON.stringify({ message: 'Forbidden by policy' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    await rejectsWithStatus(apiFetch('/forbidden'), 403, /Forbidden by policy/);

    global.fetch = async () => new Response('Route does not exist', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
    await rejectsWithStatus(apiFetch('/missing'), 404, /Route does not exist/);

    global.fetch = async () => new Response(null, { status: 500 });
    await rejectsWithStatus(apiFetch('/server-error'), 500, /HTTP 500.*empty response/);

    global.fetch = async () => new Response('{"unfinished":', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await rejectsWithStatus(apiFetch('/invalid-json'), 200, /GET \/invalid-json returned invalid JSON/);

    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(apiFetch('/offline'), /GET \/offline: Network request failed: Failed to fetch/);

    console.log('API client tests passed: JSON, empty POST, 204, empty GET, 400, 401, 403, 404, 500, invalid JSON, network failure, and credentialed fetch.');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
