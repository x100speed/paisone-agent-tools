#!/usr/bin/env node
/*
MIT License

Copyright (c) 2026 PaisOne contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { pathToFileURL } from 'node:url';

const countries = ['PH', 'ID', 'TH', 'VN', 'SG', 'US', 'JP'];
const base = 'https://www.paisone.online/test/';
const help = `PaisOne CLI · TEST read-only API (Node.js 22+)
  node paisone.mjs catalog [--country PH|ID|TH|VN|SG|US|JP]
  node paisone.mjs numbers
  node paisone.mjs messages --number ID [--after CURSOR]
  node paisone.mjs wait --number ID [--timeout 1..120] [--sender SENDER] [--after CURSOR]
  node paisone.mjs capabilities
  node paisone.mjs --help

Catalog needs no key. Account commands read PAISONE_API_KEY from the environment.
Use a restricted TEST key from account.html#keys. No purchase, payment or production access.
`;

async function readJson(response, account = false) {
  const label = account ? 'TEST API' : 'Catalog';
  if (!response.ok) {
    if (response.status === 429) throw new Error('Rate limited. Wait before trying again; this CLI does not retry automatically.');
    throw new Error(label + ' request failed (HTTP ' + response.status + ').' + (account ? ' Check key validity, permissions and number access.' : ''));
  }
  if ((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error(label + ' returned an unexpected format.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error(label + ' returned an empty response.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      let part;
      try { part = await reader.read(); }
      catch { throw new Error('Unable to read the ' + label + ' response.'); }
      const { value, done } = part;
      if (done) break;
      size += value.byteLength;
      if (size > (account ? 2097152 : 16384)) throw new Error('API response exceeded the expected size.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(label + ' returned invalid JSON.'); }
}

const identifier = value => typeof value === 'string' && !['.', '..'].includes(value) && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const cursor = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[A-Za-z0-9_.-]+$/.test(value);
const date = value => value === null || typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const short = (value, maximum) => typeof value === 'string' && value.length <= maximum;
function schema() { throw new Error('TEST API returned an unexpected schema or environment.'); }
function output(value, key) { return JSON.stringify(value, null, 2).split(key).join('[REDACTED]'); }

function accountArgs(args) {
  const command = args[0];
  if (command === 'numbers' && args.length === 1) return { command };
  if (!['messages', 'wait'].includes(command)) return null;
  const allowed = command === 'messages' ? ['--number', '--after'] : ['--number', '--after', '--sender', '--timeout'];
  const options = {};
  if (args.length % 2 !== 1) return null;
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || Object.hasOwn(options, args[i]) || typeof args[i + 1] !== 'string') return null;
    options[args[i]] = args[i + 1];
  }
  if (!identifier(options['--number']) || options['--after'] !== undefined && !cursor(options['--after'])) return null;
  const sender = options['--sender'];
  if (sender !== undefined && (!sender.trim() || !short(sender, 128) || /[\u0000-\u001f\u007f]/.test(sender))) return null;
  const timeout = options['--timeout'] === undefined ? 120 : Number(options['--timeout']);
  if (command === 'wait' && (!/^(?:[1-9]\d?|1[01]\d|120)$/.test(options['--timeout'] || '120') || !Number.isInteger(timeout))) return null;
  return { command, number: options['--number'], after: options['--after'], sender, timeout };
}

function messages(data, number, waiting) {
  if (!data || data.environment !== 'test' || data.numberId !== number || !Array.isArray(data.messages) || data.messages.length > 100 || !cursor(data.nextCursor) || waiting && typeof data.timedOut !== 'boolean') schema();
  const result = data.messages.map(item => {
    if (!item || !identifier(item.id) || !short(item.sender, 256) || !short(item.text, 4096) || !date(item.receivedAt) || item.receivedAt === null || typeof item.liveSms !== 'boolean') schema();
    return { id: item.id, sender: item.sender, text: item.text, receivedAt: item.receivedAt, liveSms: item.liveSms };
  });
  if (waiting && (data.timedOut && result.length || !data.timedOut && !result.length)) schema();
  return { environment: 'test', numberId: number, messages: result, nextCursor: data.nextCursor, ...(waiting ? { timedOut: data.timedOut } : {}) };
}

async function runAccount(options, { fetcher, env, now }) {
  const key = env.PAISONE_API_KEY;
  if (typeof key !== 'string' || !/^ps_test_[a-f0-9]{64}$/.test(key)) throw new Error('Set PAISONE_API_KEY to a valid restricted TEST key. Do not pass credentials as command arguments.');
  if ([options.number, options.after, options.sender].some(value => typeof value === 'string' && value.includes(key))) throw new Error('Credentials cannot be used as command values.');
  async function request(path, query, seconds = 0) {
    const url = new URL('api/v1/' + path, base);
    for (const [name, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(name, String(value));
    let response;
    try { response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json', Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout((seconds + 8) * 1000) }); }
    catch { throw new Error('Unable to reach the TEST API. Check the connection and try later.'); }
    return readJson(response, true);
  }
  if (options.command === 'numbers') {
    const data = await request('numbers');
    if (!data || data.environment !== 'test' || !Array.isArray(data.numbers) || data.numbers.length > 1000) schema();
    const numbers = data.numbers.map(item => {
      if (!item || !identifier(item.id) || !identifier(item.numberId) || item.leaseId !== null && !identifier(item.leaseId) || !/^\+\d{8,15}$/.test(item.phone) || !countries.includes(item.country) || !short(item.source, 64) || item.status !== 'active' || !date(item.startedAt) || !date(item.expiresAt) || typeof item.liveSms !== 'boolean') schema();
      return { id: item.id, numberId: item.numberId, leaseId: item.leaseId, phone: item.phone, country: item.country, source: item.source, status: item.status, startedAt: item.startedAt, expiresAt: item.expiresAt, liveSms: item.liveSms };
    });
    return output({ environment: 'test', numbers }, key);
  }
  const path = 'numbers/' + encodeURIComponent(options.number) + '/messages';
  if (options.command === 'messages') return output(messages(await request(path, { after: options.after }), options.number, false), key);
  const started = now(); let remaining = options.timeout, after = options.after;
  // At most six long polls. Each consumes its requested timeout even if a server
  // returns early; malformed responses cannot create a rapid unbounded loop.
  while (remaining > 0) {
    const seconds = Math.min(20, remaining);
    const result = messages(await request(path + '/wait', { after, timeout: seconds, sender: options.sender }, seconds), options.number, true);
    if (result.messages.length) return output(result, key);
    after = result.nextCursor;
    remaining = Math.min(remaining - seconds, options.timeout - Math.floor((now() - started) / 1000));
    if (remaining <= 0) return output(result, key);
  }
}

export async function runPaisOne(args, { fetcher = globalThis.fetch, env = process.env, now = Date.now } = {}) {
  if (!args.length || args.length === 1 && ['help', '--help', '-h'].includes(args[0])) return help;
  if (args.length === 1 && args[0] === 'capabilities') return JSON.stringify({
    product: 'PaisOne', version: '0.2.0-test', environment: 'test',
    available: ['public_number_availability', 'authorized_numbers', 'incoming_sms', 'wait_for_sms'],
    planned: ['number_purchase', 'wallet_top_up', 'wallet_read', 'orders_read'],
    authentication: 'Catalog needs no key. Account commands use PAISONE_API_KEY, with numbers:read and/or sms:read scopes and an explicit number allowlist.',
    documentation: base + 'docs.html#skills'
  }, null, 2);
  const account = accountArgs(args);
  if (account) return runAccount(account, { fetcher, env, now });
  if (args[0] !== 'catalog' || ![1, 3].includes(args.length) || args.length === 3 && (args[1] !== '--country' || !countries.includes(args[2]))) {
    throw new Error('Use catalog, numbers, messages --number ID, wait --number ID, capabilities or --help.');
  }
  const selected = args.length === 3 ? [args[2]] : countries;
  const results = [];
  for (const country of selected) {
    const url = new URL('api/catalog/numbers', base); url.searchParams.set('country', country);
    let response;
    try { response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); }
    catch { throw new Error('Unable to reach the TEST catalog. Check the connection and try later.'); }
    const data = await readJson(response);
    if (!data || data.country !== country || data.mode !== 'test' || typeof data.freshAnnualAvailable !== 'boolean' || typeof data.standardMonthlyAvailable !== 'boolean' || typeof data.purchasingEnabled !== 'boolean') throw new Error('Catalog returned an unexpected schema or environment.');
    results.push({ country, freshAnnualAvailable: data.freshAnnualAvailable, standardMonthlyAvailable: data.standardMonthlyAvailable });
  }
  return JSON.stringify({ environment: 'test', simulatedInventory: true, checkedAt: new Date().toISOString(), countries: results,
    note: 'Availability only; no number is reserved. Test purchase availability does not enable real payments.',
    next: base + 'index.html#plans' }, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await runPaisOne(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
