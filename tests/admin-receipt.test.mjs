import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import app from '../worker.js';
import {saveRecoverableReceiveKey,readRecoverableReceiveKey,receiptHash} from '../receive-key-vault.js';
import {adminReceiptClient} from '../admin-receipt-ui.js';
import {portalScript} from '../supplement-ui.js';
const ap='AP-ABCDEFGH';
function setup(){
 const entries=new Map([['SYSTEM:APPLICATIONS_OPEN','true'],['APPLICATION_'+ap,JSON.stringify({ap})]]);
 const env={ADMIN_KEY:'test-only',RECEIVE_KEY_ENCRYPTION_KEY:'01'.repeat(32),REGISTRATION_KV:{get:async(k,opt)=>{const v=entries.get(k);return opt?.type==='json'&&typeof v==='string'?JSON.parse(v):v??null},put:async(k,v)=>entries.set(k,v),delete:async k=>entries.delete(k),list:async({prefix=''})=>({keys:[...entries.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}};
 const call=(path,body,admin=false)=>app.fetch(new Request('https://local.test'+path,{method:body===undefined?'GET':'POST',headers:{...(admin?{'X-Admin-Key':'test-only'}:{}),'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.5'},body:body===undefined?undefined:JSON.stringify(body)}),env,{});
 return {env,entries,call};
}
test('recoverable keys are encrypted, tied to the AP, and authenticated against the stored receipt hash',async()=>{
 const {env,entries}=setup();await saveRecoverableReceiveKey(env,ap,'ABCD');const raw=entries.get('RECEIVE_AUTH:'+ap);
 assert.ok(!raw.includes('ABCD'));assert.equal((await readRecoverableReceiveKey(env,ap)).receiveKey,'ABCD');
 entries.set('RECEIVE_AUTH:AP-BCDEFGHJ',raw);await assert.rejects(readRecoverableReceiveKey(env,'AP-BCDEFGHJ'));
 await assert.rejects(readRecoverableReceiveKey({...env,RECEIVE_KEY_ENCRYPTION_KEY:'02'.repeat(32)},ap));
 const bad=JSON.parse(raw);bad.hash=await receiptHash('ZZZZ');entries.set('RECEIVE_AUTH:'+ap,JSON.stringify(bad));await assert.rejects(readRecoverableReceiveKey(env,ap));
});
test('admin key reads are private; legacy keys stay valid until deliberate reset',async()=>{
 const {env,entries,call}=setup();entries.set('RECEIVE_AUTH:'+ap,JSON.stringify({hash:await receiptHash('ABCD'),format:'short4'}));const before=entries.get('RECEIVE_AUTH:'+ap);
 assert.equal((await call('/admin/receive-key?ap='+ap)).status,401);
 const legacy=await call('/admin/receive-key?ap='+ap,undefined,true);assert.match(legacy.headers.get('Cache-Control'),/private/);assert.equal((await legacy.json()).reason,'legacy');assert.equal(entries.get('RECEIVE_AUTH:'+ap),before);
 assert.equal((await call('/receive-status',{ap,receiveKey:'ABCD'})).status,200);
 const reset=await call('/admin/receive-key/reset',{ap},true),data=await reset.json();assert.equal(reset.status,200);assert.match(data.receiveKey,/^[A-Z0-9]{4}$/);
 assert.equal((await call('/receive-status',{ap,receiveKey:'ABCD'})).status,401);assert.equal((await call('/receive-status',{ap,receiveKey:data.receiveKey})).status,200);
 assert.equal((await (await call('/admin/receive-key?ap='+ap,undefined,true)).json()).receiveKey,data.receiveKey);
 assert.equal((await call('/admin/receive-key?ap=AP-ZZZZZZZZ',undefined,true)).status,404);
 const old=entries.get('RECEIVE_AUTH:'+ap);delete env.RECEIVE_KEY_ENCRYPTION_KEY;assert.equal((await call('/admin/receive-key/reset',{ap},true)).status,503);assert.equal(entries.get('RECEIVE_AUTH:'+ap),old);
});
test('new lottery receipt keys can be retrieved by the administrator without resetting them',async()=>{
 const {call}=setup();const r=await call('/lottery-apply',{overview:'架空の資料'});assert.equal(r.status,200);const d=await r.json();const read=await call('/admin/receive-key?ap='+d.ap,undefined,true);assert.equal((await read.json()).receiveKey,d.receiveKey);
});
test('admin preview shares receipt status and files, enforces admin auth, and keeps cancelled and other-AP files closed',async()=>{
 const {env,entries,call}=setup();await saveRecoverableReceiveKey(env,ap,'ABCD');const number='BCDEFGHJ',bytes=new Uint8Array([255,216,255,217]).buffer;
 entries.set('REGISTRATION_APPLICATION:'+ap,JSON.stringify({ap,status:'registered',items:[{item:'01',name:'確認用',reviewResult:'type1',registrationNumber:number}]}));
 entries.set('REGISTRATION:'+number,JSON.stringify({ap,status:'active'}));entries.set('ISSUED_DATA_META:'+number,'{}');entries.set('ISSUED_DATA:'+number,bytes);
 for(const path of ['/admin/receive-preview/status','/admin/receive-preview/file'])assert.equal((await call(path,{ap,registrationNumber:number})).status,401);
 const actual=await(await call('/receive-status',{ap,receiveKey:'ABCD'})).json(),preview=await(await call('/admin/receive-preview/status',{ap},true)).json();assert.deepEqual(preview,actual);
 const file=await call('/admin/receive-preview/file',{ap,registrationNumber:number},true);assert.equal(file.status,200);assert.deepEqual(await file.arrayBuffer(),bytes);
 entries.set('REGISTRATION:'+number,JSON.stringify({ap:'AP-BCDEFGHJ',status:'active'}));assert.equal((await call('/admin/receive-preview/file',{ap,registrationNumber:number},true)).status,403);
 entries.set('REGISTRATION:'+number,JSON.stringify({ap,status:'cancelled'}));assert.equal((await call('/admin/receive-preview/file',{ap,registrationNumber:number},true)).status,403);
 assert.equal((await call('/admin/receive-preview?ap='+ap)).status,401);const page=await call('/admin/receive-preview?ap='+ap,undefined,true);assert.match(page.headers.get('Cache-Control'),/private/);
 const html=await page.text();assert.ok(!html.includes('ABCD"'));assert.match(html,/const RECEIPT_PREVIEW_AP=/);for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1]);
 const publicPage=await(await call('/receive')).text();assert.ok(!publicPage.includes('const RECEIPT_PREVIEW_AP='));assert.ok(!publicPage.includes('紛失した場合、再発行は行いません'));
});
test('admin detail masks keys until requested and clears them on logout; preview links carry no key',async()=>{
 const {document,Event}=parseHTML('<html><body><input id="adminKey"><div id="anchor"></div></body></html>'),listeners=new Map();let reads=0;
 const window={AdminSession:{credential:()=> 'test-only'},AdminUI:{choose:async()=> 'stay'},addEventListener:(type,fn)=>listeners.set(type,fn)};
 vm.runInContext(adminReceiptClient,vm.createContext({window,document,Event,URLSearchParams,AbortController,setTimeout,clearTimeout,navigator:{clipboard:{writeText:async()=>{}}},fetch:async()=>{reads++;return Response.json({success:true,receiveKey:'ABCD'})}}));
 window.AdminReceipt.mount(ap,document.getElementById('anchor'));const root=document.querySelector('.receipt-admin'),reveal=root.querySelector('button');assert.equal(reads,0);assert.ok(!root.textContent.includes('ABCD'));assert.equal(root.querySelector('a').getAttribute('href'),'/admin/receive-preview?ap='+ap);
 reveal.onclick();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(reads,1);assert.ok(root.textContent.includes('ABCD'));listeners.get('admin-auth-required')();assert.ok(!root.textContent.includes('ABCD'));
});
test('preview uses admin read endpoints and renders submitted status without allowing applicant changes',async()=>{
 const {document}=parseHTML('<html><body><h1>受取</h1><label for="key">キー</label><input id="ap"><input id="key"><button id="check"></button><div id="result"></div></body></html>');const requests=[];
 const context=vm.createContext({document,Date,URL,URLSearchParams,Headers,location:{origin:'https://local.test'},RECEIPT_PREVIEW_AP:ap,apInput:document.getElementById('ap'),keyInput:document.getElementById('key'),button:document.getElementById('check'),result:document.getElementById('result'),fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.includes('/receive-preview/status')?{success:true,status:'under_review',items:[]}:{success:true,serverTime:Date.now(),items:[{item:'01',name:'確認用',rounds:[{status:'pending',requestedAt:new Date().toISOString(),instruction:'追加資料を提出してください',deadlineLabel:'2026-10-01',extensions:[],uploads:[],needText:true,needImages:true}]}]})}});
 vm.runInContext(portalScript,context);for(let i=0;i<50;i++)await Promise.resolve();
 assert.equal(document.querySelectorAll('form').length,0);assert.match(document.getElementById('result').textContent,/追加文章・画像の提出欄/);assert.ok(requests.every(r=>new URL(r.url).pathname.startsWith('/admin/')));assert.ok(requests.every(r=>r.options.headers.get('X-Admin-Key')==='browser-session'));
 assert.throws(()=>vm.runInContext("portalFetch('/supplement/submit',{method:'POST'})",context),/変更できません/);
});
