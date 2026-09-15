import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import app from '../worker.js';

const ap='AP-ABCDEFGH',other='AP-BCDEFGHJ';
async function fixture({draftRows=new Map(),storage=new Map()}={}){
 const response=await app.fetch(new Request('https://local.test/admin?view=applications'),{ADMIN_KEY:'fixture-only'},{});
 const {document,Event,HTMLElement,MutationObserver}=parseHTML(await response.text());
 Object.defineProperty(HTMLElement.prototype,'cells',{configurable:true,get(){return this.localName==='tr'?[...this.children]:undefined}});
 Object.defineProperty(HTMLElement.prototype,'htmlFor',{configurable:true,get(){return this.getAttribute('for')},set(value){this.setAttribute('for',value)}});
 HTMLElement.prototype.getBoundingClientRect=()=>({height:200,top:0,bottom:200});
 HTMLElement.prototype.scrollIntoView=HTMLElement.prototype.focus=()=>{};
 const location=new URL('https://local.test/admin?view=applications'),events=new Map(),requests=[];
 const window={addEventListener(type,fn){const list=events.get(type)||[];list.push(fn);events.set(type,list)},dispatchEvent(e){for(const f of events.get(e.type)||[])f(e)},scrollTo(){}};
 const history={state:{},replaceState(state,unused,url){this.state=state;location.href=new URL(url,location).href},pushState(state,unused,url){this.replaceState(state,unused,url)}};
 const applications=[ap,other].map((ap,i)=>({ap,status:'document_preparing',items:[{item:'01',name:'架空資料',relatedName:'確認用',reviewResult:'type1',registrationNumber:i?'CDEFGHJK':'BCDEFGHJ'}]}));
 let failUpload=false,failDrafts=false,uploadGate=null;
 const context=vm.createContext({window,document,Event,HTMLElement,Date,URL,URLSearchParams,AbortController,FormData,Blob,crypto,location,history,scrollY:0,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){},MutationObserver,fetch:async(url,options={})=>{
  const path=new URL(url,location).pathname;requests.push({path,...options});
  if(path==='/admin/application')return Response.json({success:true,application:applications.find(a=>a.ap===new URL(url,location).searchParams.get('ap'))});
  if(path==='/admin/issued-data-upload'){if(uploadGate)await uploadGate;if(failUpload)return Response.json({success:false,message:'試験用の通信失敗'},{status:503});const file=options.body.get('file'),number=options.body.get('registrationNumber');const item=applications.flatMap(a=>a.items).find(x=>x.registrationNumber===number);Object.assign(item,{issuedDataReady:true,issuedDataFileName:file.name,issuedDataUploadedAt:'2026-09-15T12:00:00Z'});return Response.json({success:true,fileName:file.name,uploadedAt:item.issuedDataUploadedAt})}
  if(path==='/admin/dashboard-data')return Response.json({success:true,applications,registrations:[],counts:{},system:{}});
  if(path==='/admin/system/application-status')return Response.json({success:true,applicationsOpen:true});
  if(path==='/admin/lottery-data')return Response.json({success:true,applications:[]});
  if(path==='/admin/receive-preview/file')return new Response(new Blob(['saved JPEG'],{type:'image/jpeg'}));
  return Response.json({success:true,images:[],rows:[],tasks:[],waiting:[]});
 }});
 for(const script of document.querySelectorAll('script'))vm.runInContext(script.textContent,context);
 // Browser IndexedDB/File round trips are verified separately in the real local preview.
 window.AdminDocumentDrafts.get=async key=>draftRows.get(key);
 window.AdminDocumentDrafts.put=async(key,file,base)=>{if(failDrafts)throw Error('quota');draftRows.set(key,{file,base})};
 window.AdminDocumentDrafts.remove=async key=>{if(failDrafts)throw Error('quota');draftRows.delete(key)};
 window.AdminDocumentDrafts.flush=async()=>{};
 document.getElementById('adminKey').value='fixture-only';
 const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve()};
 const navigate=async target=>{await window.AdminUI.navigate(new URL('/admin?view=applications&ap='+target+'&item=01',location),true);await flush()};
 const input=()=>document.querySelector('#admin-item-01 .issuedFile');
 const select=async(name='01.jpg',type='image/jpeg')=>{const file=new File(['jpeg data'],name,{type});Object.defineProperty(input(),'files',{configurable:true,value:[file]});input().dispatchEvent(new Event('change',{bubbles:true}));await flush();return file};
 const choose=answer=>{window.AdminUI.choose=async()=>answer};
 // Use the real button handler's number binding rather than duplicating its request construction.
 const clickSave=async()=>{document.querySelector('#admin-item-01 .uploadIssued').click();await flush()};
 await navigate(ap);
 return {document,window,requests,navigate,input,select,choose,flush,clickSave,draftRows,storage,context,failUpload:v=>failUpload=v,failDrafts:v=>failDrafts=v,gate:p=>uploadGate=p};
}

test('file selection is a draft; red save keeps a saved preview, clears the draft and preserves other edits',async()=>{
 const f=await fixture();const file=await f.select();
 assert.equal(f.requests.filter(r=>r.path==='/admin/issued-data-upload').length,0);
 assert.equal(f.window.AdminDocuments.file(f.input()),file);
 assert.match(f.document.querySelector('.document-status').textContent,/未保存：01.jpg/);
 const name=f.document.querySelector('.finalName');name.value='名称の下書き';name.dispatchEvent(new f.context.Event('input'));
 await f.clickSave();
 assert.equal(f.requests.filter(r=>r.path==='/admin/issued-data-upload').length,1);
 assert.match(f.document.querySelector('.document-status').textContent,/保存済み：01.jpg/);
 assert.ok(f.document.querySelector('img[alt="保存済みの登録書"]'));
 assert.equal(f.window.AdminDocuments.file(f.input()),null);
 assert.equal(f.draftRows.size,0);
 assert.equal(f.document.querySelector('.finalName'),name,'saving must not rebuild the detail form');
 assert.equal(name.value,'名称の下書き');
 assert.equal(f.document.querySelector('.uploadIssued').disabled,true);
 f.choose('stay');assert.equal(await f.window.AdminUI.beforeLeave(),false,'the other unsaved field still guards navigation');
});

test('keeping a draft restores both file and text across applications and a fresh page; discard removes both',async()=>{
 const f=await fixture();const file=await f.select('02.jpg');const name=f.document.querySelector('.finalName');name.value='下書き';name.dispatchEvent(new f.context.Event('input'));
 f.choose('keep');assert.equal(await f.window.AdminUI.beforeLeave(),true);await f.navigate(other);await f.navigate(ap);
 assert.equal(f.window.AdminDocuments.file(f.input()),file);assert.equal(f.document.querySelector('.finalName').value,'下書き');
 const g=await fixture(f);assert.equal(g.window.AdminDocuments.file(g.input()),file);
 assert.match(g.document.querySelector('.document-local-note').textContent,/復元/);
 g.choose('discard');assert.equal(await g.window.AdminUI.beforeLeave(),true);
 await g.navigate(other);await g.navigate(ap);assert.equal(g.window.AdminDocuments.file(g.input()),null);assert.equal(g.document.querySelector('.finalName').value,'架空資料');
});

test('failed upload and invalid replacement retain the chosen image; unavailable draft storage blocks leaving',async()=>{
 const f=await fixture();const file=await f.select();f.failUpload(true);await f.clickSave();
 assert.equal(f.window.AdminDocuments.file(f.input()),file);assert.equal(f.document.querySelector('.uploadIssued').disabled,false);
 await f.select('bad.png','image/png');assert.equal(f.window.AdminDocuments.file(f.input()),file);
 f.failDrafts(true);f.choose('keep');assert.equal(await f.window.AdminUI.beforeLeave(),false);
 assert.match(f.document.getElementById('admin-feedback').textContent,/保持できません/);
});

test('an upload locks the chooser and navigation until completion',async()=>{
 const f=await fixture();await f.select();let release;f.gate(new Promise(resolve=>release=resolve));await f.clickSave();
 assert.equal(f.input().disabled,true);assert.equal(f.document.querySelector('.finalName').disabled,true);
 assert.equal(await f.window.AdminUI.beforeLeave(),false);release();await f.flush();
 assert.equal(f.input().disabled,false);assert.match(f.document.querySelector('.document-status').textContent,/保存済み/);
});
