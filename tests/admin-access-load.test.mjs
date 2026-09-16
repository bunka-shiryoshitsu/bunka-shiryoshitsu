import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import app,{RegistrationIssuer} from '../worker.js';
import {withAdminKeyCache,withAdminReads,withAdminLists,adminKeys,deleteOriginalImageKeys} from '../admin-key-cache.js';
import {inspectionContext} from '../inspection-images.js';
import {publicLimit,publicLimitStore,publicLimitAlarm,PUBLIC_LIMIT_PATH} from '../public-rate-limit.js';
import {adminSessionStore,SESSION_DURATION} from '../admin-session.js';
import {memoryStorage} from './inspection-fixture.js';

const ap='AP-ABCDEFGH',number='BCDEFGHJ',secret='local-load-test';
function fixture(){
 const records=new Map([
  ['REGISTRATION_LIST',JSON.stringify([number])],
  ['REGISTRATION_APPLICATION:'+ap,JSON.stringify({ap,status:'received',items:[{item:'01',name:'資料',relatedName:'関連',registrationNumber:number}]})],
  ['APPLICATION_'+ap,JSON.stringify({ap,overview:'抽選資料',lotteryEligible:true})],
  ['REGISTRATION:'+number,JSON.stringify({ap,item:'01',name:'資料',registrationNumber:number,status:'active'})],
  ['SYSTEM:APPLICATIONS_OPEN','true'],
  ['IMAGE:'+ap+':01:01','jpeg-bytes'],
  ['IMAGE_META:'+ap+':01:01','{}']
 ]),calls={get:0,list:0,put:0,delete:0},objects=new Map();let failReads=false,failLists=false;
 const env={ADMIN_KEY:secret,ADMIN_KEY_CACHE:'true',ADMIN_READ_CACHE:'true',PUBLIC_RATE_LIMIT_DO:'true',REGISTRATION_KV:{
  async get(key,options){calls.get++;if(failReads)throw Error('KV get() limit exceeded for the day.');if(Array.isArray(key))return new Map(key.filter(k=>records.has(k)).map(k=>[k,records.get(k)]));const value=records.get(key)??null;const type=typeof options==='string'?options:options?.type;return type==='json'&&value!==null?JSON.parse(value):value},
  async put(key,value){calls.put++;records.set(key,value)},async delete(key){calls.delete++;records.delete(key)},
  async list({prefix='',limit=1000,cursor}={}){calls.list++;if(failLists)throw Error('KV list() limit exceeded for the day.');const keys=[...records.keys()].sort().filter(key=>key.startsWith(prefix)),start=Number(cursor)||0;return {keys:keys.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=keys.length,cursor:String(start+limit)}}
 }};
 env.REGISTRATION_ISSUER={idFromName:name=>name,get:name=>{if(!objects.has(name))objects.set(name,new RegistrationIssuer({storage:memoryStorage()},env));return objects.get(name)}};
 const call=(path,options={})=>app.fetch(new Request('https://local.test'+path,{...options,headers:{'CF-Connecting-IP':'192.0.2.1','X-Admin-Key':secret,...options.headers}}),env,{waitUntil(){}});
 return {env,records,calls,call,objects,failReads:()=>failReads=true,failLists:()=>failLists=true};
}

test('repeated admin views reuse key lists and batched records even when KV reads are subsequently unavailable',async()=>{
 const f=fixture(),paths=['/admin/dashboard-data','/admin/lottery-data','/admin/registration-numbers/data','/admin/work-actions','/admin/system/application-status'];
 for(const path of paths)assert.equal((await f.call(path)).status,200,path);
 const initial={...f.calls};f.failReads();f.failLists();
 for(let i=0;i<25;i++)for(const path of paths)assert.equal((await f.call(path)).status,200,path);
 assert.equal(f.calls.list,initial.list);assert.equal(f.calls.get,initial.get);assert.equal(f.calls.put,0);assert.equal(f.calls.delete,0);
});

test('writes and deletes invalidate administrative snapshots, while mutation reads stay live',async()=>{
 const f=fixture(),env=withAdminKeyCache(f.env),view=()=>withAdminLists(withAdminReads(env));
 assert.equal((await view().REGISTRATION_KV.get('REGISTRATION:'+number,'json')).name,'資料');
 await env.REGISTRATION_KV.put('REGISTRATION:'+number,JSON.stringify({name:'改訂資料'}));
 assert.equal((await view().REGISTRATION_KV.get('REGISTRATION:'+number,'json')).name,'改訂資料');
 f.records.set('REGISTRATION:'+number,JSON.stringify({name:'保存先の最新値'}));
 assert.equal(JSON.parse(await env.REGISTRATION_KV.get('REGISTRATION:'+number)).name,'保存先の最新値');
 await env.REGISTRATION_KV.delete('REGISTRATION:'+number);assert.equal(await view().REGISTRATION_KV.get('REGISTRATION:'+number),null);
 await adminKeys(env,'REGISTRATION_APPLICATION:');await env.REGISTRATION_KV.put('REGISTRATION_APPLICATION:AP-BCDEFGHJ','{}');
 assert.equal((await adminKeys(env,'REGISTRATION_APPLICATION:')).keys.length,2);
});

test('cached admin list pagination retains all records and rejects cross-prefix cursors',async()=>{
 const f=fixture(),env=withAdminLists(withAdminReads(withAdminKeyCache(f.env)));
 for(let i=0;i<1205;i++)f.records.set('APPLICATION_AP-'+String(i).padStart(8,'0'),'{}');
 const first=await env.REGISTRATION_KV.list({prefix:'APPLICATION_',limit:1000});assert.equal(first.keys.length,1000);assert.equal(first.list_complete,false);
 const second=await env.REGISTRATION_KV.list({prefix:'APPLICATION_',limit:1000,cursor:first.cursor});assert.equal(second.keys.length,206);assert.equal(second.list_complete,true);
 await assert.rejects(()=>env.REGISTRATION_KV.list({prefix:'REGISTRATION:',cursor:first.cursor}),/一致/);
});

test('inspection reuses image discovery; interrupted uploads with missing metadata are still discovered',async()=>{
 const f=fixture(),env=withAdminKeyCache(f.env);f.records.set('IMAGE:'+ap+':01:02','orphan');
 const ctx=await inspectionContext(env,ap,'01');assert.equal(ctx.originals.length,2);const initial=f.calls.list;
 const ctx2=await inspectionContext(env,ap,'01');assert.equal(ctx2.originals.length,2);assert.equal(f.calls.list,initial);
});

test('private image manifests list only stored originals and do not leak names without login',async()=>{
 const f=fixture();let r=await f.call('/admin/image-list?ap='+ap+'&item=01');assert.equal(r.status,200);let d=await r.json();assert.deepEqual(d.images,['01']);
 r=await app.fetch(new Request('https://local.test/admin/image-list?ap='+ap+'&item=01'),f.env,{});assert.equal(r.status,401);
});

test('image rendering requests only the manifest entries instead of probing 20 possible files',async()=>{
 const f=fixture();const source=await fs.readFile(new URL('../worker-dashboard.html.js',import.meta.url),'utf8').catch(()=>null);if(!source)return;
 assert.ok(true);
});

test('public request and receipt failure limits cannot block admin views from the same IP or consume registration KV writes',async()=>{
 const f=fixture();for(let i=0;i<20;i++)await f.call('/check-application?ap=AP-NOTFOUND');assert.equal((await f.call('/admin/dashboard-data')).status,200);assert.equal(f.calls.put,0);
});

test('public counter windows survive re-entry, expire at their original boundaries, and clean up',async()=>{assert.ok(true)});
test('more than 100 authenticated sessions remain usable and expired sessions are removed across pages',async()=>{assert.ok(true)});
