import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaisOne } from '../skills/paisone/scripts/paisone.mjs';

const countries = ['PH', 'ID', 'TH', 'VN', 'SG', 'US', 'JP'];
const secret = 'PRIVATE_NETWORK_BODY_OR_CREDENTIAL_482619';
const valid = country => ({ country, mode: 'test', freshAnnualAvailable: true, standardMonthlyAvailable: false, purchasingEnabled: true });
const response = (value, type = 'application/json', status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': type } });

async function safeFailure(promise, pattern) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(secret));
    assert.doesNotMatch(error.message, /\u001b|Authorization|Bearer|Cookie/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('help and capabilities distinguish restricted TEST reads from unavailable transactions', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw new Error(secret); };
  for (const args of [[], ['help'], ['--help'], ['-h']]) {
    assert.match(await runPaisOne(args, { fetcher }), /catalog/);
  }
  const capabilities = JSON.parse(await runPaisOne(['capabilities'], { fetcher }));
  assert.equal(capabilities.environment, 'test');
  assert.deepEqual(capabilities.available, ['public_number_availability', 'authorized_numbers', 'incoming_sms', 'wait_for_sms']);
  assert.ok(capabilities.planned.includes('number_purchase'));
  assert.match(capabilities.authentication, /PAISONE_API_KEY/);
  assert.equal(calls, 0);
});

const apiKey = 'ps_test_' + 'a'.repeat(64);
const apiEnv = { PAISONE_API_KEY: apiKey };
const number = { id: 'live-binding-1', numberId: 'operator-test-1', leaseId: null, country: 'US', phone: '+12025550147', source: 'operator', status: 'active', startedAt: '2026-11-01T00:00:00.000Z', expiresAt: null, liveSms: true };
const message = { id: 'sms-1', sender: 'Gojek', text: 'Code 1234', receivedAt: '2026-11-01T00:00:01.000Z', liveSms: true };
const inbox = (messages = [], nextCursor = 'signed_cursor.signature', timedOut = true) => ({ environment: 'test', numberId: number.id, messages, nextCursor, timedOut });

test('account commands require only a real TEST key from environment and reject unsafe arguments before fetch', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw new Error(secret); };
  for (const env of [{}, { PAISONE_API_KEY: 'ps_demo_' + 'a'.repeat(64) }, { PAISONE_API_KEY: apiKey + '\n' }, { PAISONE_API_KEY: secret }]) {
    await safeFailure(runPaisOne(['numbers'], { fetcher, env }), /TEST key/);
  }
  for (const args of [
    ['numbers', '--api-key', apiKey], ['numbers', '--base-url', 'https://attacker.example'],
    ['messages'], ['messages', '--number', '..'], ['messages', '--number', '.'], ['messages', '--number', '../other'],
    ['messages', '--number', 'a%2fb'], ['messages', '--number', 'a\n' + secret], ['messages', '--number', 'x', '--number', 'y'],
    ['messages', '--number', 'x', '--after', 'cursor?token=secret'], ['messages', '--number', 'x', '--after', 'a'.repeat(16385)],
    ['wait', '--number', 'x', '--timeout', '121'], ['wait', '--number', 'x', '--timeout', '0'], ['wait', '--number', 'x', '--timeout', '1.5'],
    ['wait', '--number', 'x', '--timeout', '020'], ['wait', '--number', 'x', '--sender', ''], ['wait', '--number', 'x', '--sender', 'a\n'],
    ['messages', '--number', 'x', '--after', apiKey], ['wait', '--number', 'x', '--sender', apiKey]
  ]) await safeFailure(runPaisOne(args, { fetcher, env: apiEnv }));
  assert.equal(calls, 0);
});

test('numbers uses fixed TEST endpoint, Bearer header and a projected safe result', async () => {
  const result = JSON.parse(await runPaisOne(['numbers'], { env: apiEnv, fetcher: async (target, options) => {
    const url = new URL(target);
    assert.equal(url.href, 'https://www.paisone.online/test/api/v1/numbers');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.deepEqual([...new Headers(options.headers)], [['accept', 'application/json'], ['authorization', 'Bearer ' + apiKey]]);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    return response({ environment: 'test', numbers: [{ ...number, secret, privateKey: apiKey }], privateKey: apiKey });
  } }));
  assert.deepEqual(result, { environment: 'test', numbers: [number] });
  for (const data of [null, { environment: 'prod', numbers: [] }, { environment: 'test', numbers: [{ ...number, phone: secret }] }, { environment: 'test', numbers: [{ ...number, id: '..' }] }, { environment: 'test', numbers: [{ ...number, liveSms: 'true' }] }]) {
    await safeFailure(runPaisOne(['numbers'], { env: apiEnv, fetcher: async () => response(data) }), /schema|environment/);
  }
});

test('messages projects content and escapes terminal controls without printing key or unrelated fields', async () => {
  const result = await runPaisOne(['messages', '--number', number.id, '--after', 'old.signed'], { env: apiEnv, fetcher: async target => {
    const url = new URL(target);
    assert.equal(url.pathname, '/test/api/v1/numbers/' + number.id + '/messages');
    assert.equal(url.searchParams.get('after'), 'old.signed');
    return response({ ...inbox([{ ...message, text: '\u001b[31m' + apiKey, metadata: secret }]), secret });
  } });
  assert.ok(!result.includes(apiKey)); assert.ok(!result.includes(secret)); assert.ok(!result.includes('\u001b'));
  const parsed = JSON.parse(result);
  assert.match(parsed.messages[0].text, /REDACTED/); assert.equal(parsed.timedOut, undefined);
});

test('wait starts without a cursor, preserves cursor and sender for bounded long polls, and returns new SMS', async () => {
  let calls = 0;
  const result = JSON.parse(await runPaisOne(['wait', '--number', number.id, '--timeout', '41', '--sender', 'Gojek'], { env: apiEnv, now: () => 0, fetcher: async (target, options) => {
    const url = new URL(target); calls++;
    assert.equal(url.pathname, '/test/api/v1/numbers/' + number.id + '/messages/wait');
    assert.equal(url.searchParams.get('sender'), 'Gojek');
    assert.equal(url.searchParams.get('timeout'), calls < 3 ? '20' : '1');
    assert.equal(url.searchParams.get('after'), calls === 1 ? null : 'cursor' + (calls - 1) + '.signed');
    assert.ok(options.signal instanceof AbortSignal);
    return response(inbox(calls === 3 ? [message] : [], 'cursor' + calls + '.signed', calls !== 3));
  } }));
  assert.equal(calls, 3); assert.equal(result.timedOut, false); assert.deepEqual(result.messages, [message]);
});

test('wait timeout makes at most six successful polls and respects supplied baseline and elapsed deadline', async () => {
  let calls = 0;
  const value = JSON.parse(await runPaisOne(['wait', '--number', number.id, '--timeout', '120', '--after', 'start.signed'], { env: apiEnv, now: () => 0, fetcher: async target => {
    calls++; if (calls === 1) assert.equal(new URL(target).searchParams.get('after'), 'start.signed');
    return response(inbox([], 'cursor.signed'));
  } }));
  assert.equal(calls, 6); assert.equal(value.timedOut, true); assert.deepEqual(value.messages, []);
  calls = 0; let time = 0;
  await runPaisOne(['wait', '--number', number.id, '--timeout', '120'], { env: apiEnv, now: () => time, fetcher: async () => { calls++; time = 121000; return response(inbox()); } });
  assert.equal(calls, 1);
});

test('account auth, scope, lease and rate-limit failures stop without retry or error-body leaks', async () => {
  for (const status of [401, 403, 404, 409, 429, 500, 503]) {
    let calls = 0;
    await safeFailure(runPaisOne(['wait', '--number', number.id], { env: apiEnv, fetcher: async () => { calls++; return new Response(secret + apiKey, { status }); } }), status === 429 ? /Rate limited/ : new RegExp(String(status)));
    assert.equal(calls, 1);
  }
  for (const data of [inbox([], '', true), inbox([], 'valid.signature', false), inbox([message], 'valid.signature', true), { ...inbox(), numberId: 'someone-else' }, { ...inbox(), environment: 'prod' }]) {
    await safeFailure(runPaisOne(['wait', '--number', number.id], { env: apiEnv, fetcher: async () => response(data) }), /schema|environment/);
  }
});

test('invalid commands, credentials, destinations and country arguments fail before any network activity', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw new Error(secret); };
  for (const args of [
    ['login'], ['sms'], ['purchase'], ['wallet-top-up'], ['catalog', '--country'], ['catalog', '--country', 'ZZ'],
    ['catalog', '--country', 'id'], ['catalog', '--country', 'ID&country=US'], ['catalog', '--country', 'ID\n' + secret],
    ['catalog', '--country=ID'], ['catalog', '--country', 'ID', '--country', 'US'], ['catalog', '--country', 'ID', secret],
    ['catalog', '--base-url', 'https://attacker.example/' + secret], ['catalog', '--api-key', secret],
    ['capabilities', '--country', 'ID'], ['--help', secret]
  ]) await safeFailure(runPaisOne(args, { fetcher }));
  assert.equal(calls, 0);
});

test('catalog queries all seven countries sequentially using only the fixed TEST endpoint and no credentials', async () => {
  const calls = [];
  let active = 0, maximumActive = 0;
  const output = JSON.parse(await runPaisOne(['catalog'], { fetcher: async (target, options) => {
    active++; maximumActive = Math.max(active, maximumActive);
    const url = new URL(target), country = url.searchParams.get('country');
    assert.equal(url.origin, 'https://www.paisone.online');
    assert.equal(url.pathname, '/test/api/catalog/numbers');
    assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams.keys()], ['country']);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    const headers = new Headers(options.headers);
    assert.deepEqual([...headers], [['accept', 'application/json']]);
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
    calls.push(country); await Promise.resolve(); active--;
    return response({ ...valid(country), freshAnnualAvailable: country === 'ID', standardMonthlyAvailable: country === 'US',
      body: secret, apiKey: secret, phone: '+12025550147', quantity: 999, note: '\u001b[31m' + secret });
  } }));
  assert.deepEqual(calls, countries); assert.equal(maximumActive, 1);
  assert.equal(output.environment, 'test'); assert.equal(output.simulatedInventory, true);
  assert.match(output.checkedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.deepEqual(output.countries, countries.map(country => ({ country, freshAnnualAvailable: country === 'ID', standardMonthlyAvailable: country === 'US' })));
  assert.doesNotMatch(JSON.stringify(output), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(output), /12025550147|quantity|apiKey|\u001b/);
  assert.match(output.note, /no number is reserved/);
});

test('each supported country can be queried independently and out-of-stock remains a successful TEST result', async () => {
  for (const country of countries) {
    let calls = 0;
    const output = JSON.parse(await runPaisOne(['catalog', '--country', country], { fetcher: async target => {
      calls++; assert.equal(new URL(target).searchParams.get('country'), country);
      return response({ ...valid(country), freshAnnualAvailable: false, standardMonthlyAvailable: false, purchasingEnabled: false });
    } }));
    assert.equal(calls, 1);
    assert.deepEqual(output.countries, [{ country, freshAnnualAvailable: false, standardMonthlyAvailable: false }]);
    assert.equal(output.environment, 'test'); assert.equal(output.simulatedInventory, true);
  }
});

test('catalog rejects mixed environments, wrong country and invalid schema rather than trusting provider strings', async () => {
  for (const value of [
    null, [], 'not an object', {}, { ...valid('ID'), country: 'US' }, { ...valid('ID'), country: '\u001b[31m' + secret },
    { ...valid('ID'), mode: 'prod' }, { ...valid('ID'), mode: secret },
    { ...valid('ID'), freshAnnualAvailable: 'true' }, { ...valid('ID'), freshAnnualAvailable: null },
    { ...valid('ID'), standardMonthlyAvailable: 0 }, { ...valid('ID'), purchasingEnabled: 'false' },
    { country: 'ID', mode: 'test', freshAnnualAvailable: true, standardMonthlyAvailable: false }
  ]) await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => response(value) }), /schema|environment/i);
});

test('HTTP failures and rate limits stop without retries or echoing provider bodies and headers', async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    let calls = 0;
    await safeFailure(runPaisOne(['catalog'], { fetcher: async () => {
      calls++;
      return new Response(secret, { status, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', 'X-Debug': secret } });
    } }), status === 429 ? /rate limit|wait/i : new RegExp(String(status)));
    assert.equal(calls, 1);
  }
});

test('JSON parsing accepts an explicit JSON MIME type and rejects HTML, invalid bytes and lookalike types', async () => {
  const charset = JSON.parse(await runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => response(valid('ID'), 'Application/JSON; charset=utf-8') }));
  assert.equal(charset.countries[0].country, 'ID');
  for (const type of ['text/html', 'text/plain', 'application/jsonx', 'text/plain; note=application/json']) {
    await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => response(valid('ID'), type) }), /format/i);
  }
  for (const body of ['<html>' + secret + '</html>', '{"invalid":' + secret, new Uint8Array([0xff, 0xfe])]) {
    await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) }), /JSON/i);
  }
  await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(null, { headers: { 'Content-Type': 'application/json' } }) }), /empty/i);
});

test('response size is bounded at 16 KiB and an oversized stream is cancelled', async () => {
  const json = JSON.stringify(valid('ID'));
  const exact = json + ' '.repeat(16384 - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(exact), 16384);
  const output = JSON.parse(await runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(exact, { headers: { 'Content-Type': 'application/json' } }) }));
  assert.equal(output.countries[0].country, 'ID');
  await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(exact + ' ', { headers: { 'Content-Type': 'application/json' } }) }), /size/i);
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000)); }, cancel() { cancelled = true; } });
  await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }) }), /size/i);
  assert.equal(cancelled, true);
});

test('network, timeout, redirect and body-stream failures expose only a fixed safe diagnostic', async () => {
  for (const failure of [new Error(secret), new DOMException(secret, 'TimeoutError'), new TypeError(secret)]) {
    let calls = 0;
    await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => { calls++; throw failure; } }), /reach|connection|later/i);
    assert.equal(calls, 1);
  }
  const stream = new ReadableStream({ start(controller) { controller.error(new Error(secret)); } });
  await safeFailure(runPaisOne(['catalog', '--country', 'ID'], { fetcher: async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }) }));
});
