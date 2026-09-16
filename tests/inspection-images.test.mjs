import test from 'node:test';
import assert from 'node:assert/strict';
import app,{RegistrationIssuer} from '../worker.js';
import {inspectionService,sweepInspectionImages,INSPECTION,jpegDimensions,requireInspectionReady,finalizeInspection} from '../inspection-images.js';
import {memoryStorage,jpeg} from './inspection-fixture.js';
const AP='AP-ABCDEFGH',DAY=86400000,NOW=Date.now();
function fixture(){
  const records=new Map(),storage=memoryStorage(records),entries=new Map();
  const env={ADMIN_KEY:'test-only',REGISTRATION_KV:{get:async(k,opt)=>{if(Array.isArray(k))return new Map(k.filter(key=>entries.has(key)).map(key=>[key,entries.get(key)]));const v=entries.get(k);return opt?.type==='json'&&typeof v==='string'?JSON.parse(v):v??null},put:async(k,v)=>entries.set(k,v),delete:async k=>entries.delete(k),list:async({prefix='',limit=1000})=>({keys:[...entries.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true})}};
  const material=(item='01',finished=false)=>{let application=JSON.parse(entries.get('REGISTRATION_APPLICATION:'+AP)||'{"items":[]}');application.ap=AP;application.items.push({item,name:'点検資料 '+item,...(finished?{reviewResult:'type1',registrationNumber:'REGTEST1'}:{})});entries.set('REGISTRATION_APPLICATION:'+AP,JSON.stringify(application));entries.set('IMAGE_META:'+AP+':'+item+':01',JSON.stringify({uploadedAt:new Date(NOW).toISOString()}));entries.set('IMAGE:'+AP+':'+item+':01',jpeg().buffer)};
  material();const issuer=new RegistrationIssuer({storage},env);env.REGISTRATION_ISSUER={idFromName:()=>'',get:()=>issuer};
  const request=(action,body,query={},auth=true)=>new Request('https://local.test/admin/inspection-images/'+action+'?'+new URLSearchParams({ap:AP,item:'01',...query}),{method:body===undefined?'GET':'POST',headers:{...(auth?{'X-Admin-Key':'test-only'}:{}),'Content-Type':body instanceof Uint8Array?'image/jpeg':'application/json'},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});
  const call=(action,body,query={},now=NOW)=>inspectionService(request(action,body,query),env,storage,now);
  const finish=item=>{const application=JSON.parse(entries.get('REGISTRATION_APPLICATION:'+AP));Object.assign(application.items.find(i=>i.item===item),{reviewResult:'type1',registrationNumber:'REGTEST1'});entries.set('REGISTRATION_APPLICATION:'+AP,JSON.stringify(application))};
  return {records,storage,entries,env,issuer,request,call,material,finish};
}
test('inspection endpoints are private, bounded and enforce real dimensions',async()=>{
  const f=fixture();for(const action of ['status','source','image','upload','ready','extend','budget']){const r=await app.fetch(f.request(action,['upload','ready','extend','budget'].includes(action)?{}:undefined,{},false),f.env,{});assert.equal(r.status,401,action)}
  assert.equal((await app.fetch(new Request('https://local.test/inspection-images/image?ap='+AP+'&item=01&id=original-01'),f.env,{})).status,404);
  assert.equal((await f.call('upload',jpeg({width:1201}),{id:'original-01'})).status,415);
  assert.equal((await f.call('upload',jpeg({size:INSPECTION.imageBytes+1}),{id:'original-01'})).status,413);
  assert.equal((await f.call('upload',new TextEncoder().encode('<svg/>'),{id:'original-01'})).status,415);
  assert.equal((await f.call('upload',jpeg(),{id:'original-02'})).status,409);
  assert.deepEqual(jpegDimensions(jpeg()),{width:1200,height:800});
  const exif=jpeg();exif[3]=0xe1;assert.equal(jpegDimensions(exif),null);
});
test('failed or stale preparation cannot finalize a review or remove originals',async()=>{
  const f=fixture();const review=rev=>app.fetch(new Request('https://local.test/admin/review',{method:'POST',headers:{'X-Admin-Key':'test-only','Content-Type':'application/json'},body:JSON.stringify({ap:AP,item:'01',result:'rejected',inspectionRevision:rev})}),f.env,{});
  assert.equal((await review()).status,409);assert.ok(f.entries.has('IMAGE:'+AP+':01:01'));
  await f.call('upload',jpeg(),{id:'original-01'});const ready=await (await f.call('ready',{})).json();
  await f.issuer.env.REGISTRATION_KV.put('IMAGE_META:'+AP+':01:02','{}');await f.issuer.env.REGISTRATION_KV.put('IMAGE:'+AP+':01:02',jpeg().buffer);
  assert.equal((await review(ready.revision)).status,409);assert.ok(f.entries.has('IMAGE:'+AP+':01:01'));
  await f.call('upload',jpeg(),{id:'original-02'});const fresh=await (await f.call('ready',{})).json();
  const response=await review(fresh.revision);assert.equal(response.status,200,await response.clone().text());
  const r=f.records.get('inspection:record:'+AP+':01');assert.equal(r.images.length,2);assert.ok(r.finalizedAt);assert.equal(r.expiresAt-Date.parse(r.finalizedAt),180*DAY);
  await f.issuer.alarm();assert.equal(f.entries.has('IMAGE:'+AP+':01:01'),false);assert.equal((await f.call('image',undefined,{id:'original-01'},Date.now())).status,200);
});
test('atomic image writes roll back on failure and retries never double count',async()=>{
  const f=fixture(),bytes=jpeg({size:140000});f.storage.failAfter(1);
  assert.equal((await f.call('upload',bytes,{id:'original-01'})).status,503);assert.equal([...f.records.keys()].some(k=>k.startsWith('inspection:blob:')),false);
  assert.equal((await f.call('upload',bytes,{id:'original-01'})).status,200);assert.equal((await f.call('upload',bytes,{id:'original-01'})).status,200);
  assert.equal(f.records.get('inspection:state').count,1);assert.equal(f.records.get('inspection:state').bytes,140000);
  const response=await f.call('image',undefined,{id:'original-01'});assert.equal(response.headers.get('Cache-Control'),'no-store, private');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});
test('an original with a missing metadata record is still preserved for inspection',async()=>{
  const f=fixture();f.entries.delete('IMAGE_META:'+AP+':01:01');
  const data=await (await f.call('status')).json();assert.deepEqual(data.sources.map(s=>s.id),['original-01']);
  await assert.rejects(()=>requireInspectionReady(f.env,f.storage,AP,'01',undefined,NOW),e=>e.status===409);
  assert.equal((await f.call('upload',jpeg(),{id:'original-01'})).status,200);
  const ready=await (await f.call('ready',{})).json();await requireInspectionReady(f.env,f.storage,AP,'01',ready.revision,NOW);
  assert.ok(f.entries.has('IMAGE:'+AP+':01:01'));
});
test('expiry deletes only inspection bytes and is enforced even before an alarm runs',async()=>{
  const f=fixture();f.finish('01');await f.call('upload',jpeg(),{id:'original-01'});const record=f.records.get('inspection:record:'+AP+':01');
  assert.equal((await f.call('image',undefined,{id:'original-01'},record.expiresAt-1)).status,200);
  assert.equal((await f.call('image',undefined,{id:'original-01'},record.expiresAt)).status,410);
  assert.equal(f.records.get('inspection:state').bytes,0);assert.equal(f.records.get('inspection:state').count,0);assert.ok(f.entries.has('REGISTRATION_APPLICATION:'+AP));
  assert.equal([...f.records.keys()].some(k=>k.startsWith('inspection:blob:')),false);
  await sweepInspectionImages(f.storage,f.env,record.expiresAt+1);assert.equal(f.records.get('inspection:state').removedCount,1);
});
test('extension is revision checked, capped and moves the deletion date',async()=>{
  const f=fixture();f.finish('01');await f.call('upload',jpeg(),{id:'original-01'});let r=f.records.get('inspection:record:'+AP+':01'),old=r.expiresAt;
  assert.equal((await f.call('extend',{revision:r.revision-1,date:'2027-06-01'})).status,409);
  assert.equal((await f.call('extend',{revision:r.revision,date:'2028-01-01'})).status,400);
  assert.equal((await f.call('extend',{revision:r.revision,date:'2027-06-01'})).status,200);r=f.records.get('inspection:record:'+AP+':01');assert.ok(r.expiresAt>old);
  await sweepInspectionImages(f.storage,f.env,old+1);assert.equal(f.records.get('inspection:state').count,1);
  assert.equal((await f.call('extend',{revision:r.revision,date:'2027-02-30'})).status,400);
  const s=f.records.get('inspection:state');f.records.set('inspection:state',{...s,budgetBytes:s.bytes});assert.equal((await f.call('extend',{revision:r.revision,date:'2027-07-01'})).status,409);
});
test('capacity evicts oldest finished copies and never alters active originals',async()=>{
  const f=fixture();f.finish('01');await f.call('upload',jpeg({size:100000}),{id:'original-01'});f.material('02',true);f.material('03');
  f.records.set('inspection:state',{...f.records.get('inspection:state'),budgetBytes:150000});
  assert.equal((await f.call('upload',jpeg({size:100000}),{id:'original-01',item:'02'},NOW+1000)).status,200);
  assert.equal(f.records.get('inspection:record:'+AP+':01').deleteReason,'capacity');assert.equal(f.records.get('inspection:state').bytes,100000);
  assert.equal((await f.call('upload',jpeg({size:100000}),{id:'original-01',item:'03'},NOW+2000)).status,200);
  assert.ok(f.entries.has('IMAGE:'+AP+':03:01'));assert.equal(f.records.get('inspection:state').count,1);
  f.material('04');assert.equal((await f.call('upload',jpeg({size:100000}),{id:'original-01',item:'04'},NOW+3000)).status,507);assert.ok(f.entries.has('IMAGE:'+AP+':04:01'));
});
test('storage reserve refuses new copies without changing originals',async()=>{
  const f=fixture();f.storage.sql={databaseSize:INSPECTION.storageCeiling};assert.equal((await f.call('upload',jpeg(),{id:'original-01'})).status,507);assert.ok(f.entries.has('IMAGE:'+AP+':01:01'));
});
test('alarm recovers a review completed just before finalization was interrupted',async()=>{
  const f=fixture();await f.call('upload',jpeg(),{id:'original-01'});const r=f.records.get('inspection:record:'+AP+':01');await requireInspectionReady(f.env,f.storage,AP,'01',r.revision,NOW);f.finish('01');
  await sweepInspectionImages(f.storage,f.env,NOW+DAY+1);const recovered=f.records.get('inspection:record:'+AP+':01');assert.ok(recovered.finalizedAt);assert.equal(recovered.expiresAt,NOW+180*DAY);assert.equal(recovered.images.length,1);
  await sweepInspectionImages(f.storage,f.env,NOW+DAY+2);assert.equal(f.entries.has('IMAGE:'+AP+':01:01'),false);
});
test('submitted supplemental photos are included but draft attachments are excluded',async()=>{
  const f=fixture(),submitted=crypto.randomUUID(),draft=crypto.randomUUID(),bytes=jpeg();f.records.set('supplement:'+AP+':01',{revision:1,rounds:[{id:crypto.randomUUID(),status:'submitted',uploads:[{id:submitted,size:bytes.length,chunks:1,type:'image/jpeg'},{id:draft,size:bytes.length,chunks:1,type:'image/jpeg'}],submission:{imageIds:[submitted]}}]});f.records.set('supplement-image:'+AP+':01:'+submitted+':0',bytes.buffer);
  const d=await (await f.call('status')).json();assert.deepEqual(d.sources.map(s=>s.id),['original-01','supplement-'+submitted]);
  assert.equal((await f.call('source',undefined,{id:'supplement-'+draft})).status,404);
  assert.equal((await f.call('upload',bytes,{id:'supplement-'+submitted})).status,200);
  assert.equal((await f.call('ready',{})).status,409);await f.call('upload',bytes,{id:'original-01'});assert.equal((await f.call('ready',{})).status,200);
});
