import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../worker-dashboard2.js';

function envWithImages(images = []) {
  const values = new Map(images.map(k => [k, 'present']));
  let bulkCalls = 0;
  let scalarCalls = 0;
  return {
    env: {
      REGISTRATION_KV: {
        async get(key) {
          if (Array.isArray(key)) {
            bulkCalls++;
            return new Map(key.filter(k => values.has(k)).map(k => [k, values.get(k)]));
          }
          scalarCalls++;
          return values.get(key) || null;
        },
        async list(){ return {keys:[],list_complete:true}; }
      }
    },
    bulkCalls: () => bulkCalls,
    scalarCalls: () => scalarCalls
  };
}

function submit(items) {
  return new Request('https://local.test/registration-submit', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ap:'AP-ABCDEFGH',items})
  });
}

test('registration image precheck uses at most two bulk reads for ten items', async () => {
  const images = Array.from({length:10}, (_,i) => `IMAGE:AP-ABCDEFGH:${String(i+1).padStart(2,'0')}:01`);
  const f = envWithImages(images);
  const response = await app.fetch(submit(Array.from({length:10},(_,i)=>({item:i+1}))), f.env, {});
  assert.notEqual(response.status, 400);
  assert.equal(f.bulkCalls(), 2);
  assert.equal(f.scalarCalls(), 0);
});

test('registration image precheck rejects an item with no image without scalar reads', async () => {
  const f = envWithImages(['IMAGE:AP-ABCDEFGH:01:01']);
  const response = await app.fetch(submit([{item:1},{item:2}]), f.env, {});
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.match(data.message, /資料2には審査用画像がありません/);
  assert.equal(f.bulkCalls(), 1);
  assert.equal(f.scalarCalls(), 0);
});
