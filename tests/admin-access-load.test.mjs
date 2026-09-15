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
  async get(key,options){calls.get++;if(failReads)throw Error('KV get() limit exceeded for the day.');const value=records.get(key)??null;const type=typeof options==='string'?options:options?.type;return type==='json'&&value!==null?JSON.parse(value):value},
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
 // An out-of-band edit is not allowed to affect a decision through a cached read.
 f.records.set('REGISTRATION:'+number,JSON.stringify({name:'保存先の最新値'}));
 assert.equal(JSON.parse(await env.REGISTRATION_KV.get('REGISTRATION:'+number)).name,'保存先の最新値');
 await env.REGISTRATION_KV.delete('REGISTRATION:'+number);assert.equal(await view().REGISTRATION_KV.get('REGISTRATION:'+number),null);
 await adminKeys(env,'REGISTRATION_APPLICATION:');await env.REGISTRATION_KV.put('REGISTRATION_APPLICATION:AP-BCDEFGHJ','{}');
 assert.equal((await adminKeys(env,'REGISTRATION_APPLICATION:')).keys.length,2);
});

test('cached admin list pagination retains all records and rejects cross-prefix cursors',async()=>{
 const f=fixture();for(let i=0;i<1201;i++)f.records.set('IMAGE:AP-BCDEFGHJ:01:'+String(i).padStart(4,'0'),'image');
 const view=withAdminLists(withAdminKeyCache(f.env)),first=await view.REGISTRATION_KV.list({prefix:'IMAGE:',limit:700});
 const second=await view.REGISTRATION_KV.list({prefix:'IMAGE:',limit:700,cursor:first.cursor});
 assert.equal(first.list_complete,false);assert.equal(second.list_complete,true);assert.equal(new Set([...first.keys,...second.keys].map(k=>k.name)).size,1202);
 await assert.rejects(view.REGISTRATION_KV.list({prefix:'REGISTRATION:',cursor:first.cursor}));
});

test('inspection reuses image discovery; interrupted uploads with missing metadata are still discovered',async()=>{
 const f=fixture(),env=withAdminKeyCache(f.env),storage=memoryStorage();
 for(let i=0;i<25;i++)assert.equal((await inspectionContext(env,storage,ap,'01')).sources.length,1);
 assert.equal(f.calls.list,1);
 await env.REGISTRATION_KV.put('IMAGE:'+ap+':01:02','orphan-bytes');
 assert.equal((await inspectionContext(env,storage,ap,'01')).sources.length,2);assert.equal(f.calls.list,1);
 await deleteOriginalImageKeys(env,ap,'01');assert.equal(f.calls.delete,3,'delete only the two images and one metadata record');
 await deleteOriginalImageKeys(env,ap,'01');assert.equal(f.calls.delete,3,'repeated cleanup does not delete absent keys');
 assert.equal(f.records.has('REGISTRATION_APPLICATION:'+ap),true);
});

test('private image manifests list only stored originals and do not leak names without login',async()=>{
 const f=fixture(),path='/admin/image-list?ap='+ap+'&item=01';
 assert.deepEqual((await(await f.call(path)).json()).images,['01']);
 assert.equal((await f.call(path,{headers:{'X-Admin-Key':''}})).status,401);
 assert.equal((await f.call('/admin/image-list?ap=bad&item=01')).status,400);
 await withAdminKeyCache(f.env).REGISTRATION_KV.delete('IMAGE:'+ap+':01:01');
 assert.deepEqual((await(await f.call(path)).json()).images,[]);
});

test('image rendering requests only the manifest entries instead of probing 20 possible files',async()=>{
 const source=await fs.readFile(new URL('../worker-dashboard.js',import.meta.url),'utf8');
 const start=source.indexOf('async function loadItemImages('),end=source.indexOf('\nfunction itemMsg',start);assert.ok(start>0&&end>start);
 for(const images of [[],['02','20']]){
  const {document}=parseHTML('<html><body><div id="detail"><div id="images"></div></div></body></html>'),requests=[];
  const context=vm.createContext({document,URLSearchParams,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},MutationObserver:class{observe(){}},H:()=>({}),api:async()=>({images}),fetch:async url=>{requests.push(url);return new Response('jpeg')}});
  vm.runInContext(source.slice(start,end),context);await vm.runInContext("loadItemImages('AP-ABCDEFGH','01',document.getElementById('images'))",context);
  assert.equal(requests.length,images.length);assert.equal(document.querySelectorAll('#images img').length,images.length);
  assert.deepEqual(requests.map(url=>new URL(url,'https://local.test').searchParams.get('image')),images);
 }
});

test('public request and receipt failure limits cannot block admin views from the same IP or consume registration KV writes',async()=>{
 const f=fixture(),request=new Request('https://local.test/check',{headers:{'CF-Connecting-IP':'192.0.2.1'}});
 const results=await Promise.all(Array.from({length:40},()=>publicLimit(request,f.env,'REGISTRATION')));
 assert.equal(results.filter(r=>!r.limited).length,10);assert.equal(f.calls.put,0);assert.equal(f.calls.get,0);
 for(let i=0;i<11;i++){const r=await f.call('/receive-status',{method:'POST',headers:{'X-Admin-Key':''},body:JSON.stringify({ap:'bad'})});assert.equal(r.status,i<10?401:429)}
 assert.equal(f.calls.put,0);
 assert.equal((await f.call('/admin/receive-preview/status',{method:'POST',body:JSON.stringify({ap})})).status,200);
 for(let i=0;i<25;i++)assert.equal((await f.call('/admin/dashboard-data')).status,200);
 assert.equal((await f.call('/admin/dashboard-data',{headers:{'X-Admin-Key':'wrong'}})).status,401);
 assert.equal((await f.call(PUBLIC_LIMIT_PATH,{method:'POST',body:'{}'})).status,404);
});

test('public counter windows survive re-entry, expire at their original boundaries, and clean up',async()=>{
 const storage=memoryStorage(),env={ADMIN_KEY:secret};let now=100000;
 const call=()=>publicLimitStore(new Request('https://internal.invalid'+PUBLIC_LIMIT_PATH,{method:'POST',headers:{'X-Admin-Key':secret},body:JSON.stringify({prefix:'SITE',action:'consume'})}),env,storage,now).then(r=>r.json());
 for(let i=0;i<10;i++)assert.equal((await call()).limited,false);
 now+=59999;assert.equal((await call()).limited,true);now++;assert.equal((await call()).limited,false);
 for(let group=1;group<10;group++){for(let i=0;i<(group===1?9:10);i++)assert.equal((await call()).limited,false);now+=60000;}
 assert.equal((await call()).limited,true,'the hourly window is still enforced');
 now=100000+3600000;assert.equal((await call()).limited,false);
 assert.equal(await publicLimitAlarm(storage,now+86400000),true);assert.equal(await storage.get('public-rate-limit'),undefined);assert.equal(await storage.getAlarm(),null);
});

test('more than 100 authenticated sessions remain usable and expired sessions are removed across pages',async()=>{
 const records=new Map(),storage=memoryStorage(records),now=100000,env={ADMIN_KEY:secret};
 for(let i=0;i<430;i++)records.set('admin-session:'+i.toString(16).padStart(64,'0'),{expiresAt:i<210?now-1:now+SESSION_DURATION,fingerprint:'a'.repeat(64)});
 const request=new Request('https://internal.invalid/_internal/admin-session',{method:'POST',headers:{'X-Admin-Key':secret},body:JSON.stringify({action:'create',id:'f'.repeat(64),fingerprint:'a'.repeat(64)})});
 const response=await adminSessionStore(request,env,storage,now);assert.equal(response.status,200);assert.equal((await response.json()).session.expiresAt,now+SESSION_DURATION);assert.equal(records.size,221);
});
