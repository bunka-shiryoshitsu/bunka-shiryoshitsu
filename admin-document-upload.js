// Local document drafts are scoped to this browser tab and expire after 24 hours.
export const documentDraftClient = String.raw`
(() => {
 const ui=window.AdminUI, memory=new Map();let connection,scope,chain=Promise.resolve();
 function tabScope(){if(scope)return scope;scope=ui.read('bunkaDocumentDraftScope','');if(!scope){scope=crypto.randomUUID();if(!ui.write('bunkaDocumentDraftScope',scope))throw Error('このタブに下書きを保持できません。')}return scope}
 function database(){if(!connection)connection=new Promise((resolve,reject)=>{const r=indexedDB.open('bunka-admin-document-drafts',1),timer=setTimeout(()=>reject(Error('下書きの保存先の応答がありません。')),10000);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>{clearTimeout(timer);resolve(r.result)};r.onerror=()=>{clearTimeout(timer);reject(r.error)};r.onblocked=()=>{clearTimeout(timer);reject(Error('下書きの保存先を開けません。'))}}).catch(e=>{connection=null;throw e});return connection}
 async function transaction(mode,work){const db=await database();return new Promise((resolve,reject)=>{const t=db.transaction('files',mode),store=t.objectStore('files');let result;try{work(store,v=>result=v)}catch(e){reject(e);return}t.oncomplete=()=>resolve(result);t.onerror=t.onabort=()=>reject(t.error||Error('下書きを保持できません。'))})}
 function serial(work){const next=chain.catch(()=>{}).then(work);chain=next;return next}
 const id=key=>tabScope()+':'+key;
 const expiry=()=>Date.now()+86400000;
 const drafts=window.AdminDocumentDrafts={
  async get(key){if(memory.has(key)){const row=memory.get(key);return row&&row.expiresAt>Date.now()?row:null;}await chain.catch(()=>{});const row=await transaction('readonly',(s,done)=>{const r=s.get(id(key));r.onsuccess=()=>done(r.result)});const valid=row&&row.expiresAt>Date.now()?row:null;if(valid)memory.set(key,valid);return valid},
  put(key,file,base){const row={id:id(key),file,base,expiresAt:expiry()};memory.set(key,row);return serial(()=>transaction('readwrite',s=>s.put(row)))},
  remove(key){memory.set(key,null);return serial(()=>transaction('readwrite',s=>s.delete(id(key))))},
  async flush(){await chain;},
  async clear(){if(!scope&&!ui.read('bunkaDocumentDraftScope',''))return;const prefix=tabScope()+':';memory.clear();await serial(()=>transaction('readwrite',s=>{const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(c.key.startsWith(prefix))c.delete();c.continue()}}}));},
  async cleanup(){await transaction('readwrite',s=>{const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(c){if(c.value.expiresAt<=Date.now())c.delete();c.continue()}}})}
 };
 drafts.cleanup().catch(()=>{});
})();
`;

export const documentUploadStyles=String.raw`
.document-guide{font-size:18px;font-weight:650}.document-status{padding:12px 16px;background:#edf4ea;border-left:4px solid #325b3b;overflow-wrap:anywhere}.document-status.pending{background:#fff0ec;border-color:#a92c29;color:#772321}.document-previews{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0}.document-previews figure{margin:0;padding:12px;border:1px solid #cdd3c7;border-radius:8px;max-width:100%;background:white}.document-previews img{display:block;width:auto;height:auto;max-width:min(100%,360px);max-height:340px;object-fit:contain;margin-top:8px}.document-previews figcaption{font-weight:650;overflow-wrap:anywhere}.document-previews [hidden]{display:none}.document-local-note{color:#526051}.uploadArea input[type=file]{width:100%;max-width:600px}.uploadArea .uploadIssued{font-size:18px!important}.uploadArea .uploadIssued:disabled{background:#667061;color:white}.document-error{color:#8c3131}
`;

export const documentUploadClient=String.raw`
(() => {
 const drafts=window.AdminDocumentDrafts, states=new Map();
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e};
 const state=input=>states.get(input);
 function paint(s){const pending=Boolean(s.file);s.status.classList.toggle('pending',pending);s.status.textContent=pending?'未保存：'+s.file.name+' — 赤い保存ボタンを押すと登録されます。':s.item.issuedDataReady?'保存済み：'+(s.item.issuedDataFileName||s.item.registrationNumber+'.jpg')+' — 申請者が受け取れる状態です。':'登録書はまだ保存されていません。JPGを選択してください。';s.button.textContent=s.item.issuedDataReady?'② 選択したJPGで差し替えて保存':'② 選択したJPGを保存';s.button.disabled=!pending||s.locked;s.button.classList.toggle('work-action',pending);s.clear.hidden=!pending;s.clear.disabled=Boolean(s.locked);s.input.disabled=Boolean(s.locked);s.pending.hidden=!pending;window.AdminActions?.decorate()}
 function preview(s,kind,file){const slot=s[kind];if(s.urls[kind])URL.revokeObjectURL(s.urls[kind]);s.urls[kind]='';slot.replaceChildren();if(!file){slot.hidden=true;return}slot.hidden=false;slot.append(make('figcaption','',kind==='pending'?'未保存の選択画像：'+file.name:'保存済みの登録書'));const img=make('img');img.alt=kind==='pending'?'選択した登録書（未保存）':'保存済みの登録書';s.urls[kind]=URL.createObjectURL(file);img.src=s.urls[kind];slot.append(img)}
 async function loadSaved(s){if(!s.item.issuedDataReady||!s.input.isConnected)return;s.saved.hidden=false;s.saved.textContent='保存済みの画像を読み込んでいます…';const generation=++s.generation,controller=new AbortController();s.controller?.abort();s.controller=controller;const timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch('/admin/receive-preview/file',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:H(),body:JSON.stringify({ap:s.ap,registrationNumber:s.item.registrationNumber})});if(!response.ok)throw Error('保存済み画像を読み込めませんでした。');const blob=await response.blob();if(generation===s.generation&&s.input.isConnected)preview(s,'saved',blob)}catch{if(generation!==s.generation||!s.input.isConnected)return;s.saved.textContent='登録書は保存済みですが、画像の表示を再確認してください。';const b=make('button','secondary','保存済み画像を再表示');b.type='button';b.onclick=()=>void loadSaved(s);s.saved.append(b)}finally{clearTimeout(timer)}}
 function notify(s){s.input.dispatchEvent(new Event('input',{bubbles:true}));paint(s)}
 async function keep(s){try{await drafts.put(s.key,s.file,s.item.issuedDataUploadedAt||'');s.note.textContent='このタブの画像下書きとして24時間保持します。赤い保存ボタンを押すまでは申請者に反映されません。';s.error=''}catch{ s.error='画像の下書きを端末に保持できません。画面を離れず、保存するか選択を取り消してください。';s.note.textContent=s.error;}}
 async function discard(s){await drafts.remove(s.key);s.file=null;s.input.value='';preview(s,'pending',null);s.note.textContent='';s.error='';notify(s)}
 const documents=window.AdminDocuments={
  file:input=>state(input)?.file||null,
  refresh:input=>{if(state(input))paint(state(input))},
  lock(input,locked){const s=state(input);if(s){s.locked=locked;paint(s)}},
  async discard(input){if(state(input))await discard(state(input))},
  async flush(){for(const s of states.values())if(s.file&&s.input.isConnected){await drafts.put(s.key,s.file,s.item.issuedDataUploadedAt||'');s.error=''}await drafts.flush()},
  dispose(){for(const s of states.values()){s.controller?.abort();for(const url of Object.values(s.urls))if(url)URL.revokeObjectURL(url)}states.clear()},
  async committed(input,file,data){const s=state(input);if(!s)return;Object.assign(s.item,{issuedDataReady:true,issuedDataFileName:data.fileName||file.name,issuedDataUploadedAt:data.uploadedAt||new Date().toISOString()});s.file=null;s.input.value='';preview(s,'pending',null);preview(s,'saved',file);s.note.textContent='保存が完了しました。表示中の画像が保存した登録書です。';try{await drafts.remove(s.key)}catch{s.note.textContent+=' 下書きの消去を再試行するまで、この画面でお待ちください。';s.cleanupRequired=true}notify(s);},
  async prepareLeave(){for(const s of states.values())if(s.cleanupRequired){await drafts.remove(s.key);s.cleanupRequired=false}await documents.flush()},
  async mount(ap,item,w){const input=w.querySelector('.issuedFile'),button=w.querySelector('.uploadIssued');if(!input||!button)return;const area=w.querySelector('.uploadArea');input.parentElement.querySelector('label').textContent='① 完成した登録書JPGを選択（5MB以下）';const status=make('p','document-status'),note=make('p','document-local-note'),previews=make('div','document-previews'),pending=make('figure'),saved=make('figure'),clear=make('button','secondary','画像の選択を取り消す');status.setAttribute('role','status');note.setAttribute('role','status');clear.type='button';previews.append(pending,saved);area.prepend(make('p','document-guide','① JPGを選択 → ② 赤いボタンで保存 → 保存済み画像を確認'));area.append(status,previews,note);button.after(clear);const s={ap,item,input,button,status,note,pending,saved,clear,file:null,urls:{},generation:0,key:ap+':'+item.item};states.set(input,s);paint(s);input.addEventListener('change',()=>{if(s.locked)return;const f=input.files?.[0];if(!f)return;if(f.type!=='image/jpeg'||f.size<=0||f.size>5*1024*1024){input.value='';note.textContent='5MB以下のJPG画像を選択してください。現在の下書きは変更していません。';notify(s);return}s.file=f;preview(s,'pending',f);notify(s);void keep(s)});clear.onclick=()=>void discard(s).catch(()=>{note.textContent='画像の下書きを消去できませんでした。もう一度お試しください。'});s.locked=true;paint(s);try{const row=await drafts.get(s.key);if(!input.isConnected)return;if(row?.file){s.file=row.file;preview(s,'pending',s.file);note.textContent='画像の下書きを復元しました。まだ保存されていません。'+(row.base!==(item.issuedDataUploadedAt||'')?' 保存済みの登録書が変更されています。差し替える前に両方の画像を確認してください。':'')}}catch{note.textContent='画像下書きの保持機能を利用できません。選択後はこの画面で保存してください。'}finally{s.locked=false;notify(s)}void loadSaved(s);}
 };
 window.addEventListener('pagehide',()=>documents.dispose());
})();
`;
