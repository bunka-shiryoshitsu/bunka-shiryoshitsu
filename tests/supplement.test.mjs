import test from 'node:test';
import assert from 'node:assert/strict';
import app,{RegistrationIssuer} from '../worker.js';
import {supplementService,deadlineAfter,deadlineLabel,initialWindow} from '../supplement-service.js';
import {sweepSupplementImages} from '../supplement-retention.js';
import {memoryStorage,jpeg} from './inspection-fixture.js';
import {inspectionService} from '../inspection-images.js';

const AP='AP-ABCDEFGH';
async function fixture(){
 const original={ap:AP,status:'received',submittedAt:'2026-01-01T00:00:00Z',items:[{item:'01',name:'資料A',acquisition:'元の説明'},{item:'02',name:'資料B'}]};
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ABCD')))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const kv=new Map([['REGISTRATION_APPLICATION:'+AP,JSON.stringify(original)],['RECEIVE_AUTH:'+AP,JSON.stringify({hash})]]),records=new Map();
 const storage=memoryStorage(records);
 const env={ADMIN_KEY:'test-only',REGISTRATION_KV:{get:async(k,opt)=>{const v=kv.get(k);return opt?.type==='json'&&v?JSON.parse(v):v??null;},put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k),list:async({prefix=''})=>({keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}};
 const issuer=new RegistrationIssuer({storage},env);env.REGISTRATION_ISSUER={idFromName:()=>'',get:()=>issuer};
 function request(path,body,admin=false,query={},receiveKey='ABCD'){
  const params=new URLSearchParams({ap:AP,item:'01',...query});const binary=body instanceof Uint8Array;
  return new Request('https://local.test'+path+'?'+params,{method:body===undefined?'GET':'POST',headers:admin?{'X-Admin-Key':'test-only','Content-Type':'application/json'}:{'X-Receive-Key':receiveKey,'Content-Type':binary?'image/jpeg':'application/json'},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
 }
 const call=(...args)=>app.fetch(request(...args),env,{waitUntil(){}});
 const direct=(now,...args)=>supplementService(request(...args),env,storage,now);
 async function prepareInspection(){
  const q=new URLSearchParams({ap:AP,item:'01'}),status=await (await inspectionService(new Request('https://local.test/admin/inspection-images/status?'+q,{headers:{'X-Admin-Key':'test-only'}}),env,storage)).json();
  for(const source of status.sources){q.set('id',source.id);const r=await inspectionService(new Request('https://local.test/admin/inspection-images/upload?'+q,{method:'POST',headers:{'X-Admin-Key':'test-only'},body:jpeg()}),env,storage);assert.equal(r.status,200,await r.clone().text());}
  return records.get('inspection:record:'+AP+':01')?.revision||0;
 }
 return {call,direct,records,kv,original,storage,issuer,env,prepareInspection};
}
test('JST deadline includes 30 whole days after publication, including year/leap transitions',()=>{
 assert.deepEqual(initialWindow('2026-09'),{checkStart:'2026-11-01',expiryDate:'2026-12-30'});
 assert.deepEqual(initialWindow('2026-10'),{checkStart:'2026-12-01',expiryDate:'2027-01-29'});
 assert.equal(deadlineLabel(deadlineAfter(Date.parse('2026-09-14T14:59:59Z'))),'2026-10-14 23:59（日本時間）');
 assert.equal(deadlineLabel(deadlineAfter(Date.parse('2026-09-14T15:00:00Z'))),'2026-10-15 23:59（日本時間）');
 assert.equal(deadlineLabel(deadlineAfter(Date.parse('2027-12-31T00:00:00Z'))),'2028-01-30 23:59（日本時間）');
 assert.equal(deadlineLabel(deadlineAfter(Date.parse('2028-01-30T00:00:00Z'))),'2028-02-29 23:59（日本時間）');
});
test('authenticated request, immutable images, required fields, duplicate submission and independent items',async()=>{
 const f=await fixture();let r=await f.call('/admin/supplement/request',{revision:0,instruction:'裏面画像と入手時期',needText:true,needImages:true},true);assert.equal(r.status,200);const round=(await r.json()).round;
 assert.equal((await f.call('/admin/supplement/request',{revision:0,instruction:'重複',needText:true},true)).status,409);
 const id=crypto.randomUUID(),image=new Uint8Array(250000);image.set([255,216,255]);
 assert.equal((await f.call('/supplement/upload',image,false,{round:round.id,id})).status,200);
 assert.equal((await f.call('/supplement/upload',image,false,{round:round.id,id})).status,200);
 r=await f.call('/supplement/image',undefined,false,{id});assert.deepEqual(new Uint8Array(await r.arrayBuffer()),image);
 assert.equal((await f.call('/supplement/image',undefined,false,{id,item:'02'})).status,404);
 assert.equal((await f.call('/supplement/submit',{round:round.id,token:crypto.randomUUID(),text:''})).status,400);
 const body={round:round.id,token:crypto.randomUUID(),text:'1999年頃に入手'};
 const results=await Promise.all([f.call('/supplement/submit',body),f.call('/supplement/submit',body)]);assert.deepEqual(results.map(x=>x.status),[200,200]);
 assert.equal((await f.call('/supplement/submit',{...body,token:crypto.randomUUID()})).status,409);
 r=await f.call('/supplement/status');const d=await r.json();assert.equal(d.items[0].rounds[0].submission.text,body.text);assert.equal(d.items[0].rounds[0].uploads.length,1);assert.equal(d.items[1].rounds.length,0);
 assert.deepEqual(JSON.parse(f.kv.get('REGISTRATION_APPLICATION:'+AP)),f.original);
 r=await f.call('/admin/supplement/request',{revision:2,instruction:'表面の撮り直し',needImages:true},true);assert.equal(r.status,200);assert.equal((await (await f.call('/supplement/status')).json()).items[0].rounds.length,2);
 r=await f.call('/admin/review',{ap:AP,item:'01',result:'rejected',inspectionRevision:await f.prepareInspection()},true);assert.equal(r.status,200);
 const decided=await (await f.call('/supplement/status')).json();assert.equal(decided.items[0].reviewResult,'rejected');assert.equal(decided.items[0].rounds.at(-1).status,'resolved');
 assert.equal((await f.call('/admin/supplement/request',{revision:4,instruction:'終了後の依頼',needText:true},true)).status,409);
});
test('expiration boundary, extension, closing and no dependence on initial 60-day deadline',async()=>{
 const f=await fixture(),now=Date.parse('2026-09-14T14:59:00Z');
 let r=await f.direct(now,'/admin/supplement/request',{revision:0,instruction:'入手時期',needText:true},true);const round=(await r.json()).round;
 const before=await f.direct(round.deadline-1,'/supplement/status');assert.equal((await before.json()).items[0].rounds[0].status,'pending');
 r=await f.direct(round.deadline,'/supplement/submit',{round:round.id,token:crypto.randomUUID(),text:'回答'});assert.equal(r.status,409);
 r=await f.direct(round.deadline,'/admin/supplement/extend',{round:round.id,revision:1,date:'2026-10-31'},true);assert.equal(r.status,200);
 r=await f.direct(round.deadline,'/supplement/submit',{round:round.id,token:crypto.randomUUID(),text:'期限延長後に提出'});assert.equal(r.status,200);
 const other=await fixture();const created=await other.direct(now,'/admin/supplement/request',{revision:0,instruction:'画像',needImages:true},true);const pending=(await created.json()).round;
 assert.equal((await other.direct(now,'/admin/supplement/close',{round:pending.id,revision:1},true)).status,409);
 assert.equal((await other.direct(pending.deadline,'/admin/supplement/close',{round:pending.id,revision:1},true)).status,200);
 const status=await (await other.direct(pending.deadline,'/supplement/status')).json();assert.equal(status.items[0].rounds[0].status,'closed');assert.notEqual(status.items[0].reviewResult,'rejected');
 assert.equal((await other.call('/admin/review',{ap:AP,item:'01',result:'type1'},true)).status,409);
});
test('authentication, read-only methods, upload limits and removable staging',async()=>{
 const f=await fixture();assert.equal((await f.call('/admin/supplement/status')).status,401);
 assert.equal((await f.call('/supplement/status',undefined,false,{},'WRNG')).status,401);
 assert.equal((await f.call('/supplement/status',{})).status,405);
 let r=await f.call('/admin/supplement/request',{revision:0,instruction:'画像のみ',needImages:true},true);const round=(await r.json()).round,id=crypto.randomUUID();
 assert.equal((await f.call('/supplement/upload',new Uint8Array([1,2,3]),false,{round:round.id,id})).status,400);
 assert.equal((await f.call('/supplement/upload',new Uint8Array(3*1024*1024+1),false,{round:round.id,id})).status,413);
 assert.equal((await f.call('/supplement/upload',new Uint8Array([255,216,255]),false,{round:round.id,id})).status,200);
 assert.equal((await f.call('/supplement/remove',{round:round.id,id})).status,200);
 assert.equal((await f.call('/supplement/submit',{round:round.id,token:crypto.randomUUID()})).status,400);
 assert.equal((await f.call('/supplement/image',undefined,false,{id})).status,404);
 const queue=await (await f.call('/admin/supplement/queue',undefined,true)).json();assert.equal(queue.rows.length,1);
});

async function uploadSupplement(f,item='01'){
 const response=await f.call('/admin/supplement/request',{revision:0,instruction:'裏面を提出',needText:true,needImages:true},true,{item});
 assert.equal(response.status,200);const round=(await response.json()).round,id=crypto.randomUUID();
 assert.equal((await f.call('/supplement/upload',new Uint8Array([255,216,255,1,2,3]),false,{item,round:round.id,id})).status,200);
 assert.equal((await f.call('/supplement/submit',{round:round.id,token:crypto.randomUUID(),text:'提出した説明'},false,{item})).status,200);
 return {round,id};
}

test('every final review deletes supplemental bytes but preserves the submission history and other items',async()=>{
 for(const result of ['type1','type2','type3','special','rejected']){
  const f=await fixture(),{id}=await uploadSupplement(f);const other=await uploadSupplement(f,'02');
  const response=await f.call('/admin/review',{ap:AP,item:'01',result,inspectionRevision:await f.prepareInspection()},true);
  assert.equal(response.status,200,await response.clone().text());
  assert.equal([...f.records.keys()].filter(k=>k.startsWith('supplement-image:'+AP+':01:')).length,0);
  const status=await (await f.call('/supplement/status')).json(),round=status.items[0].rounds[0];
  assert.equal(round.submission.text,'提出した説明');assert.equal(round.instruction,'裏面を提出');
  assert.equal(round.uploads[0].id,id);assert.equal(round.imagesUnavailable,true);assert.ok(round.imagesDeletedAt);
  assert.equal(status.items[1].rounds[0].imagesUnavailable,false);
  for(const admin of [false,true])assert.equal((await f.call((admin?'/admin':'')+'/supplement/image',undefined,admin,{id})).status,410);
  assert.equal((await f.call('/supplement/image',undefined,false,{item:'02',id:other.id})).status,200);
 }
});

test('closing an expired unsubmitted request removes staged images and interrupted-upload chunks',async()=>{
 const f=await fixture(),now=Date.parse('2026-01-01T00:00:00Z');
 const created=await f.direct(now,'/admin/supplement/request',{revision:0,instruction:'画像',needImages:true},true);
 const round=(await created.json()).round,id=crypto.randomUUID();
 assert.equal((await f.direct(now,'/supplement/upload',new Uint8Array([255,216,255]),false,{round:round.id,id})).status,200);
 f.records.set('supplement-image:'+AP+':01:orphan:0',new ArrayBuffer(3));
 const closed=await f.direct(round.deadline,'/admin/supplement/close',{round:round.id,revision:1},true);
 assert.equal(closed.status,200);assert.ok((await closed.json()).round.imagesDeletedAt);
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('supplement-image:')).length,0);
 assert.deepEqual(JSON.parse(f.kv.get('REGISTRATION_APPLICATION:'+AP)),f.original);
});

test('deletion failure blocks image reads immediately and a persisted alarm retries after restart',async()=>{
 const f=await fixture(),{id}=await uploadSupplement(f);const realDelete=f.storage.delete;
 f.storage.delete=async keys=>{if(Array.isArray(keys))throw Error('simulated storage outage');return realDelete(keys)};
 assert.equal((await f.call('/admin/review',{ap:AP,item:'01',result:'rejected',inspectionRevision:await f.prepareInspection()},true)).status,200);
 assert.ok(await f.storage.getAlarm());
 assert.equal(f.records.get('supplement:'+AP+':01').imageCleanup.status,'pending');
 assert.equal((await f.call('/supplement/image',undefined,false,{id})).status,410);
 f.storage.delete=realDelete;
 const restarted=new RegistrationIssuer({storage:f.storage},f.env);await restarted.alarm();
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('supplement-image:')).length,0);
 assert.equal(f.records.get('supplement:'+AP+':01').imageCleanup.status,'deleted');
 assert.equal(await f.storage.getAlarm(),f.records.get('inspection:record:'+AP+':01').expiresAt);
 await restarted.alarm(); // Idempotent duplicate alarm delivery.
 assert.equal(f.records.get('supplement:'+AP+':01').rounds[0].submission.text,'提出した説明');
});

test('daily sweep handles legacy finalized records, skips open work and bounds large deletions',async()=>{
 const f=await fixture();await uploadSupplement(f);const ongoing=await uploadSupplement(f,'02');
 const a=JSON.parse(f.kv.get('REGISTRATION_APPLICATION:'+AP));a.items[0].reviewResult='rejected';f.kv.set('REGISTRATION_APPLICATION:'+AP,JSON.stringify(a));
 for(let n=0;n<300;n++)f.records.set('supplement-image:'+AP+':01:orphan:'+n,new ArrayBuffer(1));
 const first=await sweepSupplementImages(f.storage,f.env);assert.equal(first.more,true);assert.ok(await f.storage.getAlarm());
 await f.issuer.alarm();
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('supplement-image:'+AP+':01:')).length,0);
 assert.equal((await f.call('/supplement/image',undefined,false,{item:'02',id:ongoing.id})).status,200);
 const pending=[];await app.scheduled({},f.env,{waitUntil(p){pending.push(p)}});await Promise.all(pending);
 assert.equal(await f.storage.getAlarm(),null);
 assert.equal((await app.fetch(new Request('https://local.test/_internal/supplement-retention',{method:'POST'}),f.env,{})).status,404);
});

test('a newly finished item before the sweep cursor is retried without waiting for another daily run',async()=>{
 const f=await fixture();await uploadSupplement(f);
 f.records.set('supplement-cleanup:cursor','supplement:AP-ZZZZZZZZ:10');
 for(let n=0;n<300;n++)f.records.set('supplement-image:'+AP+':01:interrupted:'+n,new ArrayBuffer(1));
 assert.equal((await f.call('/admin/review',{ap:AP,item:'01',result:'rejected',inspectionRevision:await f.prepareInspection()},true)).status,200);
 assert.equal(f.records.has('supplement-cleanup:cursor'),false);
 assert.ok([...f.records.keys()].some(k=>k.startsWith('supplement-image:')));
 await f.issuer.alarm();
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('supplement-image:')).length,0);
 assert.equal(await f.storage.getAlarm(),f.records.get('inspection:record:'+AP+':01').expiresAt);
});
