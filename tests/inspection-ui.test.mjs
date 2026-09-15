import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {inspectionClient} from '../inspection-ui.js';
import app from '../worker.js';

async function fixture(initialKey='',imageMode=false){
  const {document,HTMLElement,HTMLSelectElement,Event,MutationObserver}=parseHTML('<html><body><input id="adminKey"><div id="detail"></div><section id="view-system"></section></body></html>');
  Object.defineProperty(HTMLSelectElement.prototype,'value',{configurable:true,get(){return (this.querySelector('option[selected]')||this.querySelector('option'))?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  let focused=null,choices=0,rejectDashboard=false;
  HTMLElement.prototype.scrollIntoView=function(){};
  HTMLElement.prototype.focus=function(){focused=this.id};
  const input=document.getElementById('adminKey');input.value=initialKey;
  const requests=[],listeners=new Map();
  const images=[],sources=Array.from({length:20},(_,i)=>({id:'original-'+String(i+1).padStart(2,'0'),label:'申請画像 '+(i+1)}));let interrupted=false,readyCalls=0;
  const createElement=document.createElement.bind(document);
  document.createElement=function(tag){const el=createElement(tag);if(tag==='canvas'){el.getContext=()=>({fillRect(){},drawImage(){}});el.toBlob=done=>done(new Blob(['test-image'],{type:'image/jpeg'}));}return el};
  const window={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},AdminUI:{setBusy(){},async choose(){choices++;return 'save'}}};
  const context=vm.createContext({window,document,Event,MutationObserver,URL,URLSearchParams,Blob,AbortController,setTimeout,clearTimeout,createImageBitmap:async()=>({width:896,height:1200,close(){}}),key:()=>input.value.trim(),H:()=>({'X-Admin-Key':input.value.trim()}),renderItem(){const el=createElement('div');el.className='item';document.getElementById('detail').append(el)},fetch:async(url,opt={})=>{
    requests.push({url,method:opt.method||'GET'});
    if(opt.headers['X-Admin-Key']!=='test-valid'||(rejectDashboard&&url==='/admin/dashboard-data'))return Response.json({message:'Unauthorized.'},{status:401});
    if(url==='/admin/dashboard-data')return Response.json({applications:imageMode?[{ap:'AP-TEST9B35',items:[{item:'01',registrationStatus:'cancelled'}]}]:[]});
    if(imageMode){const parsed=new URL(url,'https://local.test'),id=parsed.searchParams.get('id'),action=parsed.pathname.split('/').pop();
      if(action==='source'&&id==='original-11'&&!interrupted){interrupted=true;return Response.json({message:'試験用の通信中断'},{status:503})}
      if(action==='source'||action==='image')return new Response(new Blob(['test-image'],{type:'image/jpeg'}));
      if(action==='upload'){assert.ok(!images.some(i=>i.id===id),'saved images must not be uploaded again');images.push({...sources.find(s=>s.id===id),bytes:10,width:896,height:1200});return Response.json({success:true})}
      if(action==='ready'){readyCalls++;assert.equal(images.length,20);return Response.json({revision:20})}
      if(action==='status'&&parsed.searchParams.has('ap'))return Response.json({finished:true,sources,record:images.length?{images,revision:images.length,finalizedAt:1,expiresAt:Date.now()+86400000}:null,stats:{warning:false}});
    }
    return Response.json({stats:{count:0,bytes:0,budgetBytes:209715200,availableBytes:209715200,revision:0},records:[]});
  }});
  const html=await (await app.fetch(new Request('https://local.test/admin'),{},{})).text();
  const api=html.match(/async function api\(url,opt=\{\}\)\{[^\n]+/)[0];
  vm.runInContext(api+'\n'+inspectionClient,context);
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  return {document,input,requests,button,images,get readyCalls(){return readyCalls},render(){context.renderItem('AP-TEST9B35',{item:'01'})},get choices(){return choices},get focused(){return focused},rejectDashboard(){rejectDashboard=true},dispatch(type){window.dispatchEvent(new Event(type))},setKey(value){input.value=value;input.dispatchEvent(new Event('input'))}};
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

test('interrupted 20-image save refreshes the actual count and resumes without duplicate uploads',async()=>{
  const f=await fixture('test-valid',true);f.render();f.button('点検用画像・保存期限を確認').onclick();await settled(()=>f.button('残っている画像を縮小保存'));
  await f.button('残っている画像を縮小保存').onclick();
  assert.equal(f.images.length,10);assert.equal(f.readyCalls,0);
  assert.match(f.document.querySelector('.inspection-summary').textContent,/10枚/);
  assert.match(f.document.querySelector('.inspection-warning').textContent,/通信中断.*続きから再開/);
  assert.equal(f.button('残っている画像を縮小保存').disabled,false);
  await f.button('残っている画像を縮小保存').onclick();
  assert.equal(f.images.length,20);assert.equal(f.readyCalls,1);assert.equal(f.document.querySelectorAll('.inspection-gallery img').length,20);
  assert.equal(f.button('残っている画像を縮小保存'),undefined);assert.equal(f.document.querySelectorAll('.inspection-panel .inspection-warning').length,0);
});

test('bulk migration reports copies saved in the item interrupted halfway through',async()=>{
  const f=await fixture('test-valid',true);await f.button('既存の確定済み画像を縮小保存').onclick();
  assert.equal(f.images.length,10);assert.equal(f.readyCalls,0);
  assert.match(f.document.querySelector('[role="alert"]').textContent,/今回の保存確認：10枚.*保存済みの画像を除いて再開/);
  await f.button('既存の確定済み画像を縮小保存').onclick();assert.equal(f.images.length,20);assert.equal(f.readyCalls,1);
});
