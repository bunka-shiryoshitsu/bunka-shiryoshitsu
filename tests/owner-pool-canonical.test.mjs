import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalOwnerPoolKey, canonicalizeOwnerPoolKeys, withCanonicalOwnerPoolKeys} from '../owner-pool-canonical.js';

class FakeKV {
  constructor(entries={}) { this.data=new Map(Object.entries(entries)); }
  async get(name) {
    if (Array.isArray(name)) return new Map(name.map(key=>[key,this.data.get(key)??null]));
    return this.data.get(name)??null;
  }
  async put(name,value){this.data.set(name,value)}
  async delete(name){this.data.delete(name)}
}

test('canonical key zero-pads only 1-9',()=>{
  assert.equal(canonicalOwnerPoolKey('REGISTRATION_LIST4'),'REGISTRATION_LIST04');
  assert.equal(canonicalOwnerPoolKey('REGISTRATION_LIST9'),'REGISTRATION_LIST09');
  assert.equal(canonicalOwnerPoolKey('REGISTRATION_LIST10'),'REGISTRATION_LIST10');
  assert.equal(canonicalOwnerPoolKey('REGISTRATION_LIST'),'REGISTRATION_LIST');
});

test('migration merges legacy into zero-padded key and deletes legacy',async()=>{
  const kv=new FakeKV({
    REGISTRATION_LIST04:JSON.stringify(['258ZZAYP','AAAA1111']),
    REGISTRATION_LIST4:JSON.stringify(['258ZZAYP','BBBB2222'])
  });
  const result=await canonicalizeOwnerPoolKeys({REGISTRATION_KV:kv});
  assert.equal(result.ready,true);
  assert.deepEqual(JSON.parse(await kv.get('REGISTRATION_LIST04')),['258ZZAYP','AAAA1111','BBBB2222']);
  assert.equal(await kv.get('REGISTRATION_LIST4'),null);
});

test('wrapper redirects old key reads and writes to canonical key',async()=>{
  const kv=new FakeKV({REGISTRATION_LIST04:JSON.stringify(['258ZZAYP'])});
  const env=withCanonicalOwnerPoolKeys({REGISTRATION_KV:kv});
  assert.equal(await env.REGISTRATION_KV.get('REGISTRATION_LIST4'),JSON.stringify(['258ZZAYP']));
  await env.REGISTRATION_KV.put('REGISTRATION_LIST5',JSON.stringify(['CCCC3333']));
  assert.equal(await kv.get('REGISTRATION_LIST5'),null);
  assert.equal(await kv.get('REGISTRATION_LIST05'),JSON.stringify(['CCCC3333']));
});
