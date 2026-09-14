import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import app, {RegistrationIssuer} from '../worker.js';

const OWNER = 'OWNERA11', PUBLIC = 'PUBLCB22', OTHER = 'OWNERC33';
const savePath = '/admin/registration-numbers/notes';
const readPath = savePath + '/read';

function setup() {
  const kv = new Map([
    ['REGISTRATION_LIST', JSON.stringify([OWNER, OTHER])],
    ['PUBLIC_REGISTRATION_POOL:' + PUBLIC, JSON.stringify({number: PUBLIC, status: 'issued'})],
    ['PUBLIC_REGISTRATION_ISSUED:' + PUBLIC, JSON.stringify({number: PUBLIC, status: 'issued', ap: 'AP-ABCDEFGH', item: '01'})]
  ]);
  const data = new Map();
  let failWrite = false;
  const storage = {
    get: async keys => Array.isArray(keys) ? new Map(keys.filter(k => data.has(k)).map(k => [k, structuredClone(data.get(k))])) : structuredClone(data.get(keys)),
    put: async (key, value) => { if (failWrite) throw new Error('Simulated failure'); data.set(key, structuredClone(value)); }
  };
  const env = {ADMIN_KEY: 'notes-test-only', REGISTRATION_KV: {
    get: async k => kv.get(k) ?? null,
    put: async (k, value) => { kv.set(k, value); },
    list: async ({prefix = ''}) => ({keys: [...kv.keys()].filter(k => k.startsWith(prefix)).map(name => ({name})), list_complete: true})
  }};
  let issuer = new RegistrationIssuer({storage}, env);
  env.REGISTRATION_ISSUER = {idFromName: () => 'issuer', get: () => issuer};
  const request = (path, body, key = env.ADMIN_KEY) => new Request('https://local.test' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', ...(key ? {'X-Admin-Key': key} : {})},
    ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})
  });
  const call = (path, body, key) => app.fetch(request(path, body, key), env, {waitUntil() {}});
  return {call, kv, data, request, direct: r => issuer.fetch(r), restart: () => { issuer = new RegistrationIssuer({storage}, env); }, fail: value => { failWrite = value; }};
}

test('owner and public notes persist separately from ledgers; duplicates share one note', async () => {
  const f = setup(), original = [...f.kv];
  const text = '掛軸・箱書の確認待ち\n保管場所：書庫 A棚\n<script>alert("text only")</script>';
  for (const [number, content] of [[OWNER, text], [PUBLIC, '一般申請の資料メモ']]) {
    const response = await f.call(savePath, {number, text: content, revision: 0});
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).note.revision, 1);
  }
  f.restart();
  const result = await (await f.call(readPath, {numbers: [OWNER, PUBLIC, PUBLIC, OTHER]})).json();
  assert.equal(result.notes[OWNER].text, text);
  assert.equal(result.notes[PUBLIC].text, '一般申請の資料メモ');
  assert.equal(result.notes[OTHER].revision, 0);
  assert.equal(Object.keys(result.notes).length, 3);
  assert.deepEqual([...f.kv], original, 'memo saves must not change number pools or issuance records');
  const ledgers = await (await f.call('/admin/registration-numbers/data')).text();
  assert.ok(!ledgers.includes('書庫'));
  const publicLookup = await f.call('/check', {number: OWNER}, '');
  assert.equal(await publicLookup.text(), '登録あり');
});

test('note endpoints require admin credentials on worker and direct DO paths', async () => {
  const f = setup();
  for (const path of [savePath, readPath]) {
    for (const key of ['', 'wrong']) {
      assert.equal((await f.call(path, {}, key)).status, 401);
      assert.equal((await f.direct(f.request(path, {}, key))).status, 401);
    }
    assert.equal((await f.call(path)).status, 405);
  }
  assert.equal(f.data.size, 0);
});

test('concurrent updates and cleared notes cannot be overwritten by stale editors', async () => {
  const f = setup();
  const responses = await Promise.all(['first', 'second'].map(text => f.call(savePath, {number: OWNER, text, revision: 0})));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const note = (await (await f.call(readPath, {numbers: [OWNER]})).json()).notes[OWNER];
  const retry = await (await f.call(savePath, {number: OWNER, text: note.text, revision: 0})).json();
  assert.equal(retry.note.revision, 1, 'lost-response retry must be idempotent');
  const cleared = await (await f.call(savePath, {number: OWNER, text: '', revision: 1})).json();
  assert.equal(cleared.note.revision, 2);
  const stale = await f.call(savePath, {number: OWNER, text: 'outdated draft', revision: 1});
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.text, '');
  assert.equal((await (await f.call(readPath, {numbers: [OWNER]})).json()).notes[OWNER].text, '');
});

test('note validation, bounded requests, and failed writes retain existing content', async () => {
  const f = setup();
  for (const body of [null, [], {number: OWNER, text: 1, revision: 0}, {number: '../wrong', text: 'x', revision: 0}, {number: OWNER, text: 'x'.repeat(5001), revision: 0}, {number: OWNER, text: 'x', revision: -1}]) {
    assert.equal((await f.call(savePath, body === null ? 'null' : body)).status, 400);
  }
  assert.equal((await f.call(savePath, '{bad json')).status, 400);
  assert.equal((await f.call(savePath, 'x'.repeat(40001))).status, 413);
  assert.equal((await f.call(savePath, {number: 'UNKNOWN1', text: 'x', revision: 0})).status, 404);
  assert.equal((await f.call(readPath, {numbers: Array(101).fill(OWNER)})).status, 400);
  assert.equal((await f.call(readPath, {numbers: []})).status, 200);
  const value = 'あ'.repeat(5000);
  assert.equal((await f.call(savePath, {number: OWNER, text: value, revision: 0})).status, 200);
  f.fail(true);
  assert.equal((await f.call(savePath, {number: OWNER, text: 'failed', revision: 1})).status, 503);
  f.fail(false);
  assert.equal((await (await f.call(readPath, {numbers: [OWNER]})).json()).notes[OWNER].text, value);
});

test('notes page scripts compile and expose no saved private memo without authentication', async () => {
  const f = setup();
  await f.call(savePath, {number: OWNER, text: 'PRIVATE_SENTINEL_123', revision: 0});
  const response = await f.call('/admin/registration-numbers', undefined, '');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.ok(html.includes('5000文字以内'));
  assert.ok(!html.includes('PRIVATE_SENTINEL_123'));
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);
});
