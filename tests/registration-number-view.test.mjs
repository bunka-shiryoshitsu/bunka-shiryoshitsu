import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {numberRecords,numberPage} from '../registration-number-view.js';
import {registrationNumbersClient} from '../registration-number-ui.js';
import app from '../worker.js';

const number=i=>'N'+String(i).padStart(7,'0');
const dataFor=count=>({success:true,counts:{owner:count,publicPool:1,publicIssued:1},owner:Array.from({length:count},(_,i)=>({number:number(i),location:'REGISTRATION_LIST'})),publicPool:[{number:'PUBLIC01',status:'issued'}],publicIssued:[{number:'PUBLIC01',ap:'AP-ABCDEFGH',item:'01',status:'issued'}]});

test('large ledgers page without duplicates and search all numbers and notes',()=>{
 const records=numberRecords(dataFor(10000)),notes=new Map([[number(9999),{text:'棚Aの資料'}]]);
 assert.equal(records.length,10001);
 assert.equal(numberPage(records,notes).rows.length,50);
 assert.equal(numberPage(records,notes,'','all',1).rows[0].number,number(50));
 assert.deepEqual(numberPage(records,notes,'棚A').rows.map(r=>r.number),[number(9999)]);
 assert.deepEqual(numberPage(records,notes,'AP-ABCDEFGH').rows.map(r=>r.number),['PUBLIC01']);
 assert.equal(numberPage(records,notes,'','public').total,1);
 assert.equal(numberPage(records,notes,'','all',99999).rows.length,1);
});

async function waitFor(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI did not settle');}
async function fixture(count=10000,{stall=false}={}){
 const html=await (await app.fetch(new Request('https://local.test/admin/registration-numbers'),{},{})).text();
 const {document,HTMLElement,HTMLSelectElement,Event}=parseHTML(html);
 // linkedom omits the browser select-value setter and layout-only scrolling.
 Object.defineProperty(HTMLSelectElement.prototype,'value',{configurable:true,get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===value)}});
 HTMLElement.prototype.scrollIntoView=function(){};
 const store=new Map([['bunkaAdminKey','fixture-only']]),events=new Map(),timers=new Map(),saved=new Map();
 let requests=0,concurrent=0,maxConcurrent=0,abortCount=0,stalled=stall;
 const ui={beforeLeave:async()=>true,say:text=>{document.querySelector('#admin-feedback').textContent=text},choose:async()=> 'stay'};
 const window={AdminUI:ui,addEventListener:(name,fn)=>events.set(name,fn)};
 const fetch=async(path,options)=>{
   requests++;
   if(stalled)return new Promise((resolve,reject)=>{const abort=()=>{abortCount++;reject(new Error('aborted'))};if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true})});
   if(path.endsWith('/data'))return Response.json(dataFor(count));
   const body=JSON.parse(options.body);
   if(path.endsWith('/read')){concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await new Promise(setImmediate);concurrent--;return Response.json({success:true,notes:Object.fromEntries(body.numbers.map(n=>[n,saved.get(n)||{text:n===number(count-1)?'最後の番号のメモ':'',revision:0,updatedAt:null}]))});}
   const note={text:body.text,revision:body.revision+1,updatedAt:new Date().toISOString()};saved.set(body.number,note);return Response.json({success:true,note});
 };
 vm.runInNewContext(registrationNumbersClient,{document,window,URLSearchParams,location:{search:''},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},fetch,AbortController,Intl,Date,scrollY:0,scrollTo(){},requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.set(id,{fn,ms});return id},clearTimeout:id=>{clearTimeout(id);timers.delete(id)}});
 const click=el=>el.dispatchEvent(new Event('click'));
 events.get('DOMContentLoaded')();
 return {document,Event,ui,store,saved,click,stats:()=>({requests,maxConcurrent,abortCount}),unstall(){stalled=false},timeout(){[...timers.values()].find(t=>t.ms===15000).fn()},close(){for(const id of timers.keys())clearTimeout(id)}};
}

test('10000-number client creates only 50 editors and keeps a draft across pages',async()=>{
 const f=await fixture();try{
  await waitFor(()=>f.document.querySelector('#status').textContent.startsWith('読み込みました'));
  assert.equal(f.document.querySelectorAll('.ledger-card').length,50);
  assert.equal(f.document.querySelectorAll('.memo-input').length,50);
  assert.ok(f.stats().maxConcurrent<=3);
  assert.ok(f.document.querySelectorAll('*').length<3000,'DOM size must stay bounded');
  let input=f.document.querySelector('.memo-input');input.value='移動しても保持するメモ';input.dispatchEvent(new f.Event('input'));
  const requests=f.stats().requests;
  f.click([...f.document.querySelectorAll('button')].find(b=>b.textContent==='次の50件'));
  assert.equal(f.document.querySelector('.record-number').textContent,number(50));
  assert.equal(f.document.querySelectorAll('.memo-input').length,50);
  f.click([...f.document.querySelectorAll('button')].find(b=>b.textContent==='前の50件'));
  input=f.document.querySelector('.memo-input');assert.equal(input.value,'移動しても保持するメモ');
  assert.equal(f.stats().requests,requests,'paging must reuse loaded notes');
  f.click(f.document.querySelector('.memo-save'));await waitFor(()=>f.saved.has(number(0)));
  assert.equal(f.saved.get(number(0)).text,'移動しても保持するメモ');
  const search=f.document.querySelector('input[type=search]');search.value='最後の番号';search.dispatchEvent(new f.Event('input'));
  await waitFor(()=>f.document.querySelectorAll('.ledger-card').length===1);
  assert.equal(f.document.querySelector('.record-number').textContent,number(9999));
 }finally{f.close()}
});

test('stalled reading can be cancelled and then retried without losing navigation',async()=>{
 const f=await fixture(100,{stall:true});try{
  const stop=[...f.document.querySelectorAll('button')].find(b=>b.textContent==='読み込みを中止');
  assert.equal(stop.hidden,false);f.click(stop);
  await waitFor(()=>!f.document.querySelector('#load').disabled);
  assert.match(f.document.querySelector('#status').textContent,/中止/);
  assert.equal(f.stats().abortCount,1);
  f.unstall();f.click(f.document.querySelector('#load'));
  await waitFor(()=>f.document.querySelector('#status').textContent.startsWith('読み込みました'));
  assert.equal(await f.ui.beforeLeave(),true);
 }finally{f.close()}
});

test('request deadline recovers the load button instead of waiting indefinitely',async()=>{
 const f=await fixture(100,{stall:true});try{
  f.timeout();await waitFor(()=>!f.document.querySelector('#load').disabled);
  assert.match(f.document.querySelector('#status').textContent,/時間内に完了しませんでした/);
  assert.equal(f.stats().abortCount,1);
 }finally{f.close()}
});
