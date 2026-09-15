import test from 'node:test';
import assert from 'node:assert/strict';
import {adminKeyCacheStore,adminKeys,withAdminKeyCache,nextListReset} from '../admin-key-cache.js';
import {registrationNumberNotes} from '../registration-number-notes.js';
import app from '../worker.js';

class Storage{
 constructor(){this.rows=new Map()}
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.rows.has(x)).map(x=>[x,structuredClone(this.rows.get(x))])):structuredClone(this.rows.get(k))}
 async put(k,v){this.rows.set(k,structuredClone(v))}
 async delete(k){this.rows.delete(k)}
 async transaction(fn){const before=structuredClone(this.rows);try{return await fn(this)}catch(e){this.rows=before;throw e}}
}
function fixture(){
 const storage=new Storage(),values=new Map([['REGISTRATION_LIST',JSON.stringify(['ABCDEFGH'])],['REGISTRATION_LIST01',JSON.stringify(['BCDEFGHJ'])],['PUBLIC_REGISTRATION_POOL:CDEFGHJK',JSON.stringify({number:'CDEFGHJK',status:'reserved'})]]);
 let calls=0,fail=false,now=Date.parse('2026-09-15T07:00:00Z'),chain=Promise.resolve();
 const raw={ADMIN_KEY:'test-only',ADMIN_KEY_CACHE:'true',REGISTRATION_KV:{async get(k){return values.get(k)||null},async put(k,v){values.set(k,v)},async delete(k){values.delete(k)},async list({prefix='',cursor,limit=1000}={}){calls++;if(fail)throw Error('KV list() limit exceeded for the day.');const keys=[...values.keys()].filter(k=>k.startsWith(prefix)).sort(),start=Number(cursor)||0;return {keys:keys.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=keys.length,cursor:start+limit<keys.length?String(start+limit):undefined}}}};
 raw.REGISTRATION_ISSUER={idFromName:name=>name,get:()=>({fetch(request){const run=chain.then(()=>adminKeyCacheStore(request,raw,storage,now));chain=run.catch(()=>{});return run}})};
 const env=withAdminKeyCache(raw);
 return {env,raw,storage,values,calls:()=>calls,fail:()=>fail=true,advance:ms=>now+=ms,now:()=>now,restore:(keys,at=now-7200000)=>adminKeyCacheStore(new Request('https://internal.invalid/_internal/admin-key-cache',{method:'POST',headers:{'X-Admin-Key':'test-only'},body:JSON.stringify({action:'restore',prefix:'REGISTRATION_LIST',keys,at})}),raw,storage,now)};
}

test('administrative refreshes share durable key discovery and mutations update it immediately',async()=>{
 const f=fixture();await Promise.all(Array.from({length:30},()=>adminKeys(f.env,'REGISTRATION_LIST')));assert.equal(f.calls(),1);
 await f.env.REGISTRATION_KV.put('REGISTRATION_LIST02','["CDEFGHJK"]');assert.equal((await adminKeys(f.env,'REGISTRATION_LIST')).keys.length,3);assert.equal(f.calls(),1);
 await f.env.REGISTRATION_KV.delete('REGISTRATION_LIST01');assert.equal((await adminKeys(f.env,'REGISTRATION_LIST')).keys.length,2);
 await f.env.REGISTRATION_KV.list({prefix:'REGISTRATION_LIST'});assert.equal(f.calls(),2,'critical raw listing is not replaced with a stale cache');
});

test('quota failure keeps an existing index and blocks repeated list calls until the daily reset',async()=>{
 const f=fixture();await adminKeys(f.env,'REGISTRATION_LIST');f.advance(3600001);f.fail();
 const cached=await adminKeys(f.env,'REGISTRATION_LIST');assert.equal(cached.stale,true);assert.equal(cached.keys.length,2);assert.equal(cached.retryAt,nextListReset(f.now()));
 for(let i=0;i<20;i++)await adminKeys(f.env,'REGISTRATION_LIST');assert.equal(f.calls(),2);
 await assert.rejects(adminKeys(f.env,'APPLICATION_'),e=>e.code==='KV_LIST_LIMIT');assert.equal(f.calls(),2,'quota backoff is shared across prefixes');
});

test('restored owner keys read live numbers and allow notes while unavailable ledgers remain unknown',async()=>{
 const f=fixture();f.fail();assert.equal((await f.restore(['REGISTRATION_LIST','REGISTRATION_LIST01'])).status,200);
 const response=await app.fetch(new Request('https://local.test/admin/registration-numbers/data',{headers:{'X-Admin-Key':'test-only'}}),f.env,{});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.counts.owner,2);assert.equal(data.counts.publicPool,null);assert.equal(data.counts.publicIssued,null);assert.deepEqual(data.unavailable,['publicPool','publicIssued']);assert.ok(data.warnings.length);assert.equal(f.calls(),1);
 const note=await registrationNumberNotes(new Request('https://local.test/admin/registration-numbers/notes',{method:'POST',headers:{'X-Admin-Key':'test-only'},body:JSON.stringify({number:'ABCDEFGH',text:'保存先の確認',revision:0})}),f.env,new Storage());assert.equal(note.status,200);assert.equal(f.calls(),1);
 assert.equal((await f.restore(['REGISTRATION_LIST'])).status,409,'a recovery snapshot cannot overwrite an existing index');
});

test('cache and recovery endpoints require administrator authentication and internal paths stay private',async()=>{
 const f=fixture();const request=new Request('https://local.test/admin/key-cache/restore',{method:'POST',body:'{}'});assert.equal((await app.fetch(request,f.env,{})).status,401);
 assert.equal((await app.fetch(new Request('https://local.test/_internal/admin-key-cache'),f.env,{})).status,404);
 assert.equal((await adminKeyCacheStore(new Request('https://internal.invalid/_internal/admin-key-cache',{method:'POST',body:'{}'}),f.raw,f.storage)).status,401);
});

test('large cached indexes retain every key across storage chunks',async()=>{
 const f=fixture();for(let i=0;i<1200;i++)f.values.set('APPLICATION_AP-'+String(i).padStart(8,'0'),'{}');
 const result=await adminKeys(f.env,'APPLICATION_');assert.equal(result.keys.length,1200);assert.equal(f.calls(),2);assert.equal((await adminKeys(f.env,'APPLICATION_')).keys.length,1200);assert.equal(f.calls(),2);
});
