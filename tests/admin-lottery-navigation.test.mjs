import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import app from '../worker.js';

const ap='AP-ABCDEFGH',other='AP-BCDEFGHJ';
async function fixture(initial='/admin?view=lottery'){
 const response=await app.fetch(new Request('https://local.test'+initial),{ADMIN_KEY:'fixture-only'},{});
 const {document,Event,HTMLElement,MutationObserver}=parseHTML(await response.text());
 // Linkedom does not implement table cells, layout or focus; record those browser effects.
 Object.defineProperty(HTMLElement.prototype,'cells',{configurable:true,get(){return this.localName==='tr'?[...this.children]:undefined}});
 Object.defineProperty(HTMLElement.prototype,'htmlFor',{configurable:true,get(){return this.getAttribute('for')},set(value){this.setAttribute('for',value)}});
 HTMLElement.prototype.getBoundingClientRect=()=>({height:200,top:0,bottom:200});
 const scrolls=[],frames=[],timers=new Map(),events=new Map(),requests=[];let focused=null,timer=0;
 HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this.id)};
 HTMLElement.prototype.focus=function(){focused=this.id};
 const location=new URL('https://local.test'+initial),saved=new Map();
 const window={addEventListener(type,fn){const f=events.get(type)||[];f.push(fn);events.set(type,f)},dispatchEvent(e){for(const f of events.get(e.type)||[])f(e)},scrollTo(x,y){scrolls.push(y)}};
 const history={state:{},replaceState(state,unused,url){this.state=state;location.href=new URL(url,location).href},pushState(state,unused,url){this.replaceState(state,unused,url)}};
 const lottery=[ap,other].map((ap,i)=>({ap,overview:'架空の資料 '+i,appliedAt:'2026-09-01T00:00:00Z',lotteryEligible:true,status:'received'}));
 const context=vm.createContext({window,document,Event,HTMLElement,Date,URL,URLSearchParams,AbortController,FormData,Blob,location,history,scrollY:120,sessionStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>frames.push(fn),setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{requests.push({url,method:options?.method||'GET'});const path=new URL(url,location).pathname;if(path==='/admin/lottery-data')return Response.json({success:true,applications:lottery});if(path==='/admin/work-actions')return Response.json({success:true,tasks:lottery.map(a=>({id:'lottery:'+a.ap,ap:a.ap,view:'lottery',kind:'lottery',label:'申込概要と抽選対象を確認',name:a.overview})),waiting:[]});throw Error('Unexpected request: '+path)}});
 context.MutationObserver=MutationObserver;
 for(const script of document.querySelectorAll('script'))vm.runInContext(script.textContent,context);
 document.getElementById('adminKey').value='fixture-only';
 const flush=async()=>{const read=[...timers].find(([,job])=>job.ms===150);if(read){timers.delete(read[0]);await read[1].fn()}for(let i=0;i<20;i++)await Promise.resolve();while(frames.length)frames.shift()()};
 return {document,window,requests,scrolls,location,flush,focused:()=>focused,navigate:async(path,restore)=>{await window.AdminUI.navigate(new URL(path,location),true,restore);await flush()}};
}

test('lottery work navigation keeps the requested row visible instead of restoring the list position',async()=>{
 const f=await fixture();await f.navigate('/admin?view=lottery&work=lottery&target='+ap,{scrollY:120});
 assert.equal(f.scrolls.at(-1),'lottery-'+ap);
 assert.equal(f.focused(),'lottery-'+ap);
 assert.equal(f.document.querySelector('#lottery-'+ap+' .work-selected-label').textContent,'選択中');
 assert.match(f.document.getElementById('admin-feedback').textContent,new RegExp(ap));
 assert.ok(f.requests.every(r=>r.method==='GET'),'navigation must not select a winner');
 // Repeating the same destination and switching rows both preserve the explicit target.
 await f.navigate(f.location.href,{scrollY:0});assert.equal(f.scrolls.at(-1),'lottery-'+ap);
 await f.navigate('/admin?view=lottery&work=lottery&target='+other,{scrollY:0});assert.equal(f.scrolls.at(-1),'lottery-'+other);
 assert.equal(f.document.querySelectorAll('.work-selected-label').length,1);
 assert.equal(f.document.getElementById('lottery-'+ap).classList.contains('work-selected'),false);
});

test('ordinary lottery navigation restores the list position and missing targets do not claim selection',async()=>{
 const f=await fixture();await f.navigate('/admin?view=lottery',{scrollY:450});assert.equal(f.scrolls.at(-1),450);
 assert.equal(f.document.querySelectorAll('.work-selected-label').length,0);
 await f.navigate('/admin?view=lottery&work=lottery&target=AP-ZZZZZZZZ',{scrollY:80});assert.equal(f.scrolls.at(-1),80);
 assert.equal(f.window.AdminActions.focusRequested(),false);
});
