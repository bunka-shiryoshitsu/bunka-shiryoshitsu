import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {inspectionClient} from '../inspection-ui.js';
import app from '../worker.js';

async function fixture(initialKey=''){
  const {document,HTMLElement,HTMLSelectElement,Event,MutationObserver}=parseHTML('<html><body><input id="adminKey"><div id="detail"></div><section id="view-system"></section></body></html>');
  Object.defineProperty(HTMLSelectElement.prototype,'value',{configurable:true,get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  let focused=null,choices=0,rejectDashboard=false;
  HTMLElement.prototype.scrollIntoView=function(){};
  HTMLElement.prototype.focus=function(){focused=this.id};
  const input=document.getElementById('adminKey');input.value=initialKey;
  const requests=[],listeners=new Map();
  const window={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},AdminUI:{setBusy(){},async choose(){choices++;return 'save'}}};
  const context=vm.createContext({window,document,Event,MutationObserver,URL,URLSearchParams,Blob,AbortController,setTimeout,clearTimeout,key:()=>input.value.trim(),H:()=>({'X-Admin-Key':input.value.trim()}),renderItem(){},fetch:async(url,opt={})=>{
    requests.push({url,method:opt.method||'GET'});
    if(opt.headers['X-Admin-Key']!=='test-valid'||(rejectDashboard&&url==='/admin/dashboard-data'))return Response.json({message:'Unauthorized.'},{status:401});
    if(url==='/admin/dashboard-data')return Response.json({applications:[]});
    return Response.json({stats:{count:0,bytes:0,budgetBytes:209715200,availableBytes:209715200,revision:0},records:[]});
  }});
  const html=await (await app.fetch(new Request('https://local.test/admin'),{},{})).text();
  const api=html.match(/async function api\(url,opt=\{\}\)\{[^\n]+/)[0];
  vm.runInContext(api+'\n'+inspectionClient,context);
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  return {document,input,requests,button,get choices(){return choices},get focused(){return focused},rejectDashboard(){rejectDashboard=true},dispatch(type){window.dispatchEvent(new Event(type))},setKey(value){input.value=value;input.dispatchEvent(new Event('input'))}};
}
async function settled(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2))}throw Error('UI did not settle')}

test('inspection migration with no key gives a recovery path and sends no request',async()=>{
  const f=await fixture();await f.button('既存の確定済み画像を縮小保存').onclick();
  assert.equal(f.requests.length,0);assert.equal(f.choices,0);assert.equal(f.focused,'adminKey');
  assert.match(f.document.body.textContent,/管理キーを入力して「管理情報を表示」/);
  assert.ok(f.button('管理キー入力欄へ'));assert.doesNotMatch(f.document.body.textContent,/Unauthorized/);
});
test('wrong key blocks migration before confirmation and successful login refreshes an already visible panel',async()=>{
  const f=await fixture('test-wrong');await f.button('既存の確定済み画像を縮小保存').onclick();
  assert.equal(f.choices,0);assert.equal(f.input.getAttribute('aria-invalid'),'true');assert.equal(f.focused,'adminKey');
  assert.match(f.document.body.textContent,/管理キーを確認できませんでした/);assert.doesNotMatch(f.document.body.textContent,/Unauthorized/);
  assert.ok(f.requests.every(r=>r.method==='GET'&&r.url.includes('/status')));
  f.setKey('test-valid');f.dispatch('admin-authenticated');await settled(()=>f.document.body.textContent.includes('点検画像：0枚'));
  assert.equal(f.input.hasAttribute('aria-invalid'),false);assert.doesNotMatch(f.document.body.textContent,/管理キーを確認できませんでした/);
  await f.button('既存の確定済み画像を縮小保存').onclick();assert.equal(f.choices,1);
  assert.match(f.document.body.textContent,/既存画像の確認が終わりました。縮小保存：0枚/);
});
test('expired authentication during migration preserves the Japanese error and starts no image writes',async()=>{
  const f=await fixture('test-valid');f.rejectDashboard();await f.button('既存の確定済み画像を縮小保存').onclick();
  assert.equal(f.choices,1);assert.equal(f.input.getAttribute('aria-invalid'),'true');
  assert.match(f.document.querySelector('[role="alert"]').textContent,/縮小保存を中断しました.*管理キーを確認できませんでした/);
  assert.doesNotMatch(f.document.body.textContent,/Unauthorized/);assert.ok(f.requests.every(r=>r.method==='GET'));
  assert.equal(f.button('既存の確定済み画像を縮小保存').disabled,false);
});
test('editing the key clears previously loaded inspection information',async()=>{
  const f=await fixture('test-valid');f.dispatch('admin-authenticated');await settled(()=>f.document.body.textContent.includes('点検画像：0枚'));
  f.setKey('');assert.doesNotMatch(f.document.body.textContent,/点検画像：0枚/);assert.ok(f.button('管理キー入力欄へ'));
});
