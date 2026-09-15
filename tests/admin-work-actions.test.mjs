import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {deriveWorkActions,readWorkActions} from '../admin-work-actions.js';
import {workActionClient} from '../admin-work-actions-ui.js';
const now=Date.parse('2026-09-15T00:00:00Z');
const ap='AP-ABCDEFGH';
const application=items=>({ap,submittedAt:'2026-09-10T00:00:00Z',items});

test('human work excludes pending submissions, finalized items and explicitly marked tests',()=>{
 const items=Array.from({length:7},(_,i)=>({item:String(i+1).padStart(2,'0'),name:'資料'+i}));
 Object.assign(items[3],{registrationNumber:'NUMBERSA',issuedDataReady:false});Object.assign(items[4],{reviewResult:'rejected'});Object.assign(items[5],{registrationStatus:'cancelled'});Object.assign(items[6],{isTest:true});
 const queue=[{ap,item:'02',round:{status:'pending',deadline:now+1000}},{ap,item:'03',round:{status:'submitted',deadline:now-1000}}];
 const data=deriveWorkActions({applications:[application(items),{...application([{item:'01'}]),ap:'AP-TEST9B35'}],queue},now);
 assert.deepEqual(data.tasks.map(t=>t.kind),['supplement','review','document']);assert.equal(data.counts.dashboard,3);assert.equal(data.counts.applications,2);assert.equal(data.counts.registry,1);assert.equal(data.waiting.length,1);
});
test('deadline boundary changes waiting to required work; opening and retrying do not clear work',()=>{
 const input={applications:[application([{item:'01'}])],queue:[{ap,item:'01',round:{status:'pending',deadline:now}}]};
 assert.equal(deriveWorkActions(input,now-1).tasks.length,0);const first=deriveWorkActions(input,now);assert.equal(first.tasks[0].kind,'expired');assert.deepEqual(deriveWorkActions(input,now),first);
 input.queue[0].round.deadline=now+1000;assert.equal(deriveWorkActions(input,now).tasks.length,0);
 input.queue[0].round.status='submitted';assert.equal(deriveWorkActions(input,now).tasks.length,1);
 input.applications[0].items[0].reviewResult='type2';input.applications[0].items[0].registrationNumber='NUMBERSA';let done=deriveWorkActions(input,now);assert.equal(done.counts.applications,0);assert.equal(done.counts.registry,1);
 input.applications[0].items[0].issuedDataReady=true;assert.equal(deriveWorkActions(input,now).counts.dashboard,0);
});
test('lottery attention is a request to inspect pending applications, never a suggested result',()=>{
 const lottery=[{ap,overview:'概要'},{ap:'AP-BCDEFGHJ',winner:{slots:1}},{ap:'AP-CDEFGHJK',isTest:true},{ap:'AP-DEFGHJKL',lotteryEligible:false}];
 const result=deriveWorkActions({lottery},now);assert.equal(result.counts.lottery,2);assert.ok(result.tasks.every(t=>t.label==='申込概要と抽選対象を確認'));
});
test('private task endpoint consumes every queue page and fails visibly rather than report zero on read failure',async()=>{
 const values=new Map([['REGISTRATION_APPLICATION:'+ap,JSON.stringify(application([{item:'01'},{item:'02'}]))]]);let queueCalls=0,broken=false;
 const env={ADMIN_KEY:'fixture-only',REGISTRATION_KV:{list:async({prefix})=>({keys:[...values.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}),get:async k=>values.get(k)||null},REGISTRATION_ISSUER:{idFromName:x=>x,get:()=>({fetch:async req=>{queueCalls++;if(broken)return new Response('unavailable',{status:503});const next=new URL(req.url).searchParams.has('cursor');return Response.json({rows:[{ap,item:next?'02':'01',round:{status:next?'submitted':'pending',deadline:Date.now()+10000}}],nextCursor:next?null:'supplement:'+ap+':01'})}})}};
 const call=(key='fixture-only',method='GET')=>readWorkActions(new Request('https://local.test/admin/work-actions',{method,headers:{'X-Admin-Key':key}}),env);
 assert.equal((await call('wrong')).status,401);assert.equal(queueCalls,0);assert.equal((await call('fixture-only','POST')).status,405);
 const response=await call(),data=await response.json();assert.match(response.headers.get('Cache-Control'),/private/);assert.equal(queueCalls,2);assert.equal(data.tasks.length,1);assert.equal(data.waiting.length,1);
 broken=true;assert.equal((await call()).status,503);
});

async function uiFixture(){
 const {document,Event}=parseHTML('<html><body><input id="adminKey"><div><nav class="admin-nav"><a data-view="dashboard">1 要対応</a><a data-view="applications" aria-current="page">3 申請・審査</a><a data-view="registry">4 登録・登録書</a><a data-view="numbers">5 番号・メモ</a></nav><div id="admin-current"></div></div><main id="admin-content"><h1>申請・審査</h1></main></body></html>');
 const listeners=new Map(),timers=new Map();let nextTimer=0,key='fixture-only',reject=false;
 let data={success:true,...deriveWorkActions({applications:[application([{item:'01',name:'資料'}])]},now)};
 const window={AdminSession:{credential:()=>key},AdminUI:{setCurrent(view){for(const a of document.querySelectorAll('.admin-nav a')){if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}},decorateTables(){}},addEventListener:(type,fn)=>listeners.set(type,fn),dispatchEvent:e=>listeners.get(e.type)?.(e)};
 const context=vm.createContext({window,document,Event,Date,URL,URLSearchParams,AbortController,location:{href:'https://local.test/admin?view=applications',pathname:'/admin'},setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer},clearTimeout:id=>timers.delete(id),fetch:async()=>reject?Response.json({success:false,message:'試験用の取得失敗'},{status:503}):Response.json(data)});
 vm.runInContext(workActionClient,context);const flush=async()=>{const job=[...timers].find(([,t])=>t.ms===150);if(job){timers.delete(job[0]);await job[1].fn()}for(let i=0;i<20;i++)await Promise.resolve()};await flush();
 return {document,window,flush,setData:value=>data=value,reject:()=>reject=true,logout(){key='';window.dispatchEvent(new Event('admin-auth-required'))}};
}
test('current-page marker coexists with required-work count; only a saved-state update removes the count',async()=>{
 const f=await uiFixture(),nav=f.document.querySelector('[data-view=applications]');assert.equal(nav.querySelector('.work-here').hidden,false);assert.equal(nav.querySelector('.work-count').textContent,'要作業 1');
 f.window.AdminUI.setCurrent('applications');assert.equal(nav.querySelector('.work-count').textContent,'要作業 1');
 f.setData({success:true,...deriveWorkActions({applications:[application([{item:'01',reviewResult:'rejected'}])]},now)});f.window.AdminActions.refresh();await f.flush();assert.equal(nav.querySelector('.work-count').hidden,true);
 f.window.AdminActions.setDraft('memo:NUMBERSA',{id:'memo:NUMBERSA',number:'NUMBERSA',view:'numbers',kind:'memo',label:'メモを保存',name:'NUMBERSA',local:true});assert.equal(f.document.querySelector('[data-view=numbers] .work-count').textContent,'要作業 1');f.window.AdminActions.setDraft('memo:NUMBERSA',null);assert.equal(f.document.querySelector('[data-view=numbers] .work-count').hidden,true);
});
test('failed refresh retains previous counts with an explicit warning; logout clears private work',async()=>{
 const f=await uiFixture();f.reject();f.window.AdminActions.refresh();await f.flush();assert.match(f.document.querySelector('.work-status').textContent,/取得失敗/);assert.match(f.document.querySelector('[data-view=applications] .work-count').textContent,/前回 要作業 1/);f.logout();assert.equal(f.document.querySelector('#admin-work-actions').hidden,true);assert.equal(f.document.querySelector('[data-view=applications] .work-count').hidden,true);
});
