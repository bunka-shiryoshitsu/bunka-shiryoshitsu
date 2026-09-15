import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import app, {RegistrationIssuer} from '../worker.js';
import {memoryStorage,jpeg} from './inspection-fixture.js';
function setup(){
 const entries=new Map([['SYSTEM:APPLICATIONS_OPEN','true'],['REGISTRATION_LIST',JSON.stringify(['ABCDEFGH'])]]);
 const kv={get:async(k,opt)=>{const v=entries.get(k);if(v===undefined)return null;if(v instanceof ArrayBuffer)return opt?.type==='arrayBuffer'?v:new TextDecoder().decode(v);return opt?.type==='json'?JSON.parse(v):v},put:async(k,v)=>entries.set(k,v),delete:async k=>entries.delete(k),list:async({prefix=''})=>({keys:[...entries.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})};
 const env={REGISTRATION_KV:kv,ADMIN_KEY:'test-only'};const issuer=new RegistrationIssuer({storage:memoryStorage()},env);env.REGISTRATION_ISSUER={idFromName:()=> 'local',get:()=>issuer};
 const call=(path,body,admin=false)=>app.fetch(new Request('https://local.test'+path,{method:body===undefined?'GET':'POST',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(admin?{'X-Admin-Key':'test-only'}:{}),'CF-Connecting-IP':'192.0.2.1'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),env,{waitUntil(p){return p}});
 return {entries,call,env};
}
test('public and admin pages compile; internal diagnostics are closed',async()=>{
 const {call}=setup();for(const path of ['/','/lottery','/receive','/admin','/admin/registration-numbers']){const r=await call(path);assert.equal(r.status,200,path);const html=await r.text();for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1],{filename:path});}
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1]);
 for(const path of ['/_dev/self-test','/_cutover/test'])assert.equal((await call(path)).status,404);
 const config=JSON.parse(await fs.readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.equal(config.main,'worker.js');
});
test('private endpoints reject missing administrator credentials',async()=>{
 const {call}=setup();for(const path of ['/admin/dashboard-data','/admin/application?ap=AP-ABCDEFGH','/admin/registration-numbers/data','/admin/image?ap=AP-ABCDEFGH&item=01&image=01'])assert.equal((await call(path)).status,401,path);
 for(const path of ['/admin/review','/admin/lottery-winner','/admin/cancel'])assert.equal((await call(path,{ap:'AP-ABCDEFGH',item:'01',result:'type1'})).status,401,path);
});
test('lottery, winner, upload, submission, review, private receipt and cancellation',async()=>{
 const {call,entries,env}=setup();
 let r=await call('/lottery-apply',{overview:'テスト用資料・本番には送信しません'});assert.equal(r.status,200);const lottery=await r.json();assert.match(lottery.ap,/^AP-[A-Z0-9]{8}$/);assert.ok(!('receiveKey' in lottery));assert.ok(!entries.has('RECEIVE_AUTH:'+lottery.ap));const {ap}=lottery;
 assert.equal(JSON.parse(entries.get('APPLICATION_'+ap)).overview,'テスト用資料・本番には送信しません');
 const applied=JSON.parse(entries.get('APPLICATION_'+ap));const fixtureMonth=new Date();fixtureMonth.setUTCDate(1);fixtureMonth.setUTCMonth(fixtureMonth.getUTCMonth()-2);applied.applicationMonth=fixtureMonth.toISOString().slice(0,7);entries.set('APPLICATION_'+ap,JSON.stringify(applied));
 r=await call('/admin/lottery-winner',{ap,slots:1},true);assert.equal(r.status,200,await r.clone().text());
 const jpg=new Uint8Array([255,216,255,224,1,2,3,255,217]);
 let form=new FormData();form.append('image',new File([jpg],'test.jpg',{type:'image/jpeg'}));
 r=await call('/image-upload?ap='+ap+'&item=01&image=01',form);assert.equal(r.status,200,await r.clone().text());
 r=await call('/admin/image?ap='+ap+'&item=01&image=01',undefined,true);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),jpg);
 const submission={ap,items:[{item:'01',name:'資料A',relatedName:'関連名',acquisition:'試験用'}]};
 r=await call('/registration-submit',submission);assert.equal(r.status,200,await r.clone().text());
 assert.equal((await call('/registration-submit',submission)).status,409);
 const inspectionUpload=await app.fetch(new Request('https://local.test/admin/inspection-images/upload?'+new URLSearchParams({ap,item:'01',id:'original-01'}),{method:'POST',headers:{'X-Admin-Key':'test-only'},body:jpeg()}),env,{});assert.equal(inspectionUpload.status,200,await inspectionUpload.clone().text());
 const inspectionRevision=(await inspectionUpload.json()).record.revision;
 r=await call('/admin/review',{ap,item:'01',result:'type1',inspectionRevision,finalName:'整理後の資料A',finalRelatedName:'関連名'},true);assert.equal(r.status,200,await r.clone().text());const reviewed=await r.json();const number=reviewed.registrationNumber;assert.match(number,/^[A-Z0-9]{8}$/);assert.notEqual(number,'ABCDEFGH');
 assert.equal((await call('/admin/review',{ap,item:'01',result:'type1'},true)).status,409);
 assert.equal(await (await call('/check',{number})).text(),'登録あり');
 form=new FormData();form.append('registrationNumber',number);form.append('file',new File([jpg],'document.jpg',{type:'image/jpeg'}));
 r=await call('/admin/issued-data-upload',form,true);assert.equal(r.status,200,await r.clone().text());
 assert.equal((await call('/receive-status',{ap:'AP-ZZZZZZZZ'})).status,401);
 r=await call('/receive-status',{ap});assert.equal(r.status,200);assert.equal((await r.json()).items[0].ready,true);
 r=await call('/receive-file',{ap,registrationNumber:number});assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),jpg);
 r=await call('/admin/cancel',{registrationNumber:number},true);assert.equal(r.status,200);
 assert.equal(await (await call('/check',{number})).text(),'登録なし');
 assert.equal((await call('/receive-file',{ap,registrationNumber:number})).status,403);
 assert.ok(entries.has('PUBLIC_REGISTRATION_ISSUED:'+number));
});
test('closed intake and missing overview are rejected',async()=>{const {call,entries}=setup();assert.equal((await call('/lottery-apply',{})).status,400);entries.set('SYSTEM:APPLICATIONS_OPEN','false');assert.equal((await call('/lottery-apply',{overview:'test'})).status,503);});

test('legacy winner URL moves to the shared workspace without modifying data',async()=>{
 const {call,entries}=setup(),before=[...entries];
 const response=await call('/admin-winners');
 assert.equal(response.status,302);
 assert.equal(response.headers.get('Location'),'/admin?view=lottery');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.deepEqual([...entries],before);
});

test('administrator application search receives the saved related name',async()=>{
 const {call,entries}=setup();
 entries.set('REGISTRATION_APPLICATION:AP-ABCDEFGH',JSON.stringify({ap:'AP-ABCDEFGH',status:'under_review',submittedAt:'2026-09-01T00:00:00Z',items:[{item:'01',name:'原名称',relatedName:'原関連名',finalName:'保存済名称',finalRelatedName:'保存済関連名'}]}));
 const response=await call('/admin/dashboard-data',undefined,true);
 assert.equal(response.status,200);
 const data=await response.json(),item=data.applications.find(a=>a.ap==='AP-ABCDEFGH')?.items[0];
 assert.ok(item,'申請が検索用の一覧に含まれる');
 assert.equal(item.name,'保存済名称');
 assert.equal(item.relatedName,'保存済関連名');
});
