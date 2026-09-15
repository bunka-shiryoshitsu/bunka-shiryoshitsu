import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import app from '../worker.js';
import {adminReceiptClient} from '../admin-receipt-ui.js';
import {portalScript} from '../supplement-ui.js';
const ap='AP-ABCDEFGH';
function setup(){
 const entries=new Map([['SYSTEM:APPLICATIONS_OPEN','true'],['APPLICATION_'+ap,JSON.stringify({ap})]]);
 const env={ADMIN_KEY:'test-only',REGISTRATION_KV:{get:async(k,opt)=>{const v=entries.get(k);return opt?.type==='json'&&typeof v==='string'?JSON.parse(v):v??null},put:async(k,v)=>entries.set(k,v),delete:async k=>entries.delete(k),list:async({prefix=''})=>({keys:[...entries.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true})}};
 const call=(path,body,admin=false,ip='192.0.2.5')=>app.fetch(new Request('https://local.test'+path,{method:body===undefined?'GET':'POST',headers:{...(admin?{'X-Admin-Key':'test-only'}:{}),'Content-Type':'application/json','CF-Connecting-IP':ip},body:body===undefined?undefined:JSON.stringify(body)}),env,{});
 return {env,entries,call};
}
test('existing APs work without keys, regardless of old records or former locks',async()=>{
 const {entries,call}=setup();assert.equal((await call('/receive-status',{ap})).status,200);
 entries.set('RECEIVE_AUTH:'+ap,JSON.stringify({hash:'old-unused-hash',sealed:{ciphertext:'unused'}}));entries.set('RECEIVE_FAIL:'+ap,JSON.stringify({count:99,firstAt:Date.now()}));
 assert.equal((await call('/receive-status',{ap:ap.toLowerCase(),receiveKey:'obsolete'})).status,200);
 for(const body of [{},{ap:'bad'},{ap:'AP-ZZZZZZZZ'}])assert.equal((await call('/receive-status',body)).status,401);
 assert.equal((await call('/receive-status')).status,405);
 for(const [path,body]of [['/admin/receive-key?ap='+ap,undefined],['/admin/receive-key/reset',{ap}]]){assert.equal((await call(path,body)).status,401);assert.equal((await call(path,body,true)).status,410)}
 assert.equal(JSON.parse(entries.get('RECEIVE_AUTH:'+ap)).hash,'old-unused-hash');
});
test('new applications issue only an AP and need no receipt encryption configuration',async()=>{
 const {call,entries}=setup();const r=await call('/lottery-apply',{overview:'架空の資料'});assert.equal(r.status,200);const d=await r.json();assert.match(d.ap,/^AP-[A-Z0-9]{8}$/);assert.ok(!('receiveKey' in d));assert.match(d.apNotice,/AP番号は他人に教えないでください/);assert.ok(![...entries.keys()].some(k=>k.startsWith('RECEIVE_AUTH:')));assert.equal((await call('/receive-status',{ap:d.ap})).status,200);
});
test('failed AP probing is limited by connection without locking the AP for others',async()=>{
 const {call}=setup();for(let i=0;i<10;i++)assert.equal((await call('/receive-status',{ap:'AP-ZZZZZZZZ'})).status,401);assert.equal((await call('/receive-status',{ap:'AP-YYYYYYYY'})).status,429);assert.equal((await call('/receive-status',{ap},false,'192.0.2.6')).status,200);
});
test('AP-only receipt and admin preview share files and reject missing, cancelled and other-AP access',async()=>{
 const {entries,call}=setup(),number='BCDEFGHJ',bytes=new Uint8Array([255,216,255,217]).buffer;
 entries.set('REGISTRATION_APPLICATION:'+ap,JSON.stringify({ap,status:'registered',items:[{item:'01',name:'確認用',reviewResult:'type1',registrationNumber:number}]}));entries.set('REGISTRATION:'+number,JSON.stringify({ap,status:'active'}));entries.set('ISSUED_DATA_META:'+number,'{}');entries.set('ISSUED_DATA:'+number,bytes);
 assert.deepEqual(await(await call('/admin/receive-preview/status',{ap},true)).json(),await(await call('/receive-status',{ap})).json());
 for(const [path,admin]of [['/receive-file',false],['/admin/receive-preview/file',true]]){const file=await call(path,{ap,registrationNumber:number},admin);assert.equal(file.status,200);assert.deepEqual(await file.arrayBuffer(),bytes);assert.match(file.headers.get('Cache-Control'),/private/)}
 assert.equal((await call('/receive-file',{registrationNumber:number})).status,401);entries.set('REGISTRATION:'+number,JSON.stringify({ap:'AP-BCDEFGHJ',status:'active'}));assert.equal((await call('/receive-file',{ap,registrationNumber:number})).status,403);entries.set('REGISTRATION:'+number,JSON.stringify({ap,status:'cancelled'}));assert.equal((await call('/receive-file',{ap,registrationNumber:number})).status,403);
 for(const path of ['/admin/receive-preview/status','/admin/receive-preview/file'])assert.equal((await call(path,{ap,registrationNumber:number})).status,401);assert.equal((await call('/admin/receive-preview?ap='+ap)).status,401);assert.equal((await call('/admin/receive-preview?ap='+ap,undefined,true)).status,200);
});
test('public screens show only AP input and a large privacy notice',async()=>{
 const {call}=setup();for(const path of ['/lottery','/receive']){const html=await(await call(path)).text();assert.ok(!/受取キー|受け取りキー|receiveKey/.test(html),path);assert.match(html,/AP番号は他人に教えないでください/);assert.match(html,/font-size:clamp\(22px,3.5vw,28px\)/);for(const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(s[1]);const {document}=parseHTML(html);assert.ok(!document.getElementById('key'));assert.ok(document.querySelector('.ap-privacy'))}
 const home=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');assert.ok(!/受取キー|受け取りキー/.test(home));assert.match(home,/AP番号は他人に教えないでください/);
});
test('admin detail retains preview without key lookup or reissue controls',()=>{
 const {document}=parseHTML('<html><body><div id="anchor"></div></body></html>'),window={};vm.runInContext(adminReceiptClient,vm.createContext({window,document,URLSearchParams}));window.AdminReceipt.mount(ap,document.getElementById('anchor'));const root=document.querySelector('.receipt-admin');assert.ok(!/キー|再発行/.test(root.textContent));assert.equal(root.querySelector('a').getAttribute('href'),'/admin/receive-preview?ap='+ap);
});
test('lottery completion renders a single AP and its prominent privacy notice',async()=>{
 const {call}=setup(),html=await(await call('/lottery')).text(),{document}=parseHTML(html);let submit;
 const button=document.getElementById('apply');button.addEventListener=(type,handler)=>{if(type==='click')submit=handler};
 const context=vm.createContext({document,confirm:()=>true,fetch:async(path,options)=>path==='/system/application-status'?Response.json({applicationsOpen:true}):call(path,JSON.parse(options.body))});
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))vm.runInContext(script[1],context);
 await new Promise(resolve=>setImmediate(resolve));document.getElementById('overview').value='架空の申込み';await submit();
 const result=document.getElementById('result');assert.equal(result.querySelectorAll('.code').length,1);assert.match(result.querySelector('.code').textContent,/^AP-[A-Z0-9]{8}$/);assert.equal(result.querySelector('.ap-privacy').textContent,'AP番号は他人に教えないでください。');assert.ok(!/キー|次の2つ/.test(result.textContent));
});
test('admin preview shows pending status without enabling applicant submissions',async()=>{
 const {document}=parseHTML('<html><body><h1>受取</h1><input id="ap"><button id="check"></button><div id="result"></div></body></html>');const requests=[];
 const context=vm.createContext({document,Date,URL,URLSearchParams,Headers,location:{origin:'https://local.test'},RECEIPT_PREVIEW_AP:ap,apInput:document.getElementById('ap'),button:document.getElementById('check'),result:document.getElementById('result'),fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.includes('/receive-preview/status')?{success:true,status:'under_review',items:[]}:{success:true,serverTime:Date.now(),items:[{item:'01',name:'確認用',rounds:[{status:'pending',requestedAt:new Date().toISOString(),instruction:'追加資料を提出してください',deadlineLabel:'2026-10-01',extensions:[],uploads:[],needText:true,needImages:true}]}]})}});
 vm.runInContext(portalScript,context);for(let i=0;i<50;i++)await Promise.resolve();assert.equal(document.querySelectorAll('form').length,0);assert.match(document.getElementById('result').textContent,/追加文章・画像の提出欄/);assert.ok(requests.every(r=>new URL(r.url).pathname.startsWith('/admin/')));assert.ok(requests.every(r=>r.options.headers.get('X-Admin-Key')==='browser-session'));assert.throws(()=>vm.runInContext("portalFetch('/supplement/submit',{method:'POST'})",context),/変更できません/);
});
