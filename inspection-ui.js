export async function makeInspectionCopy(blob) {
  const bitmap=await createImageBitmap(blob);
  const canvas=document.createElement('canvas');
  try {
    let longest=Math.min(1200,Math.max(bitmap.width,bitmap.height));
    for(let attempt=0;attempt<5;attempt++){
      const ratio=longest/Math.max(bitmap.width,bitmap.height);
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const context=canvas.getContext('2d');if(!context)throw Error('点検画像を作成できませんでした。');
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.78,.65,.5]){
        const copy=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
        if(!copy)throw Error('点検画像を作成できませんでした。');
        if(copy.size<=150*1024)return copy;
      }
      longest=Math.floor(longest*.8);
    }
    throw Error('150KB以内に縮小できませんでした。元画像を確認してください。');
  } finally {bitmap.close();canvas.width=canvas.height=1;}
}

export const inspectionStyles=String.raw`
.inspection-panel,.inspection-settings{border:1px solid #aebbc5;border-radius:12px;padding:16px;margin:18px 0;background:#f6fafb;color:#173044;overflow-wrap:anywhere}
.inspection-panel h3,.inspection-settings h2{margin-top:0}.inspection-body[hidden]{display:none}.inspection-summary{font-weight:600;line-height:1.7}.inspection-warning{color:#854000;background:#fff1cf;border-left:4px solid #b56500;padding:12px}.inspection-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.inspection-gallery figure{margin:0;border:1px solid #bac6cd;border-radius:8px;background:white;padding:8px}.inspection-gallery img{display:block;max-width:100%;width:100%;height:160px;object-fit:contain}.inspection-gallery button{display:block;width:100%;padding:4px;background:white;color:#173044}.inspection-gallery figcaption{font-size:14px;line-height:1.5}.inspection-actions{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin:12px 0}.inspection-actions label{display:grid;gap:6px}.inspection-panel button,.inspection-settings button,.inspection-panel input,.inspection-settings select{min-height:44px;font-size:16px;max-width:100%}.inspection-progress{padding:12px;background:#e3f1f6;white-space:pre-line}.inspection-progress button{margin:8px 0}.inspection-settings progress{width:100%;height:22px}.inspection-preview{max-width:min(95vw,1300px);max-height:95vh;border:1px solid #789;padding:16px}.inspection-preview::backdrop{background:#000a}.inspection-preview img{display:block;max-width:100%;max-height:75vh;object-fit:contain}.inspection-record{padding:12px 0;border-top:1px solid #c6d2d8}.inspection-muted{color:#486072;line-height:1.7}@media(max-width:600px){.inspection-panel,.inspection-settings{padding:12px}.inspection-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.inspection-gallery img{height:120px}.inspection-actions>*{max-width:100%}}
`;

export const inspectionClient=String.raw`
(() => {
 const copyImage=${makeInspectionCopy.toString()};
 const endpoint='/admin/inspection-images/';
 const node=(tag,text,parent,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;if(parent)parent.append(el);return el};
 const date=n=>n?new Date(n).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'—';
 const size=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';
 const query=(ap,item,extra={})=>new URLSearchParams({ap,item,...extra});
 let preparing=false,settingsVersion=0;
 const authMessage='管理キーを確認できませんでした。画面上部の管理キーを入力し直して「管理情報を表示」を押してください。';
 async function request(action,params,body,signal,binary=false){
   const keyValue=key();if(!keyValue)throw Error('管理キーを入力してください。');
   const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(abort,20000);
   try{
     const response=await fetch(endpoint+action+(params?'?'+params:''),{method:body===undefined?'GET':'POST',headers:{'X-Admin-Key':keyValue,...(body===undefined?{}:{'Content-Type':body instanceof Blob?'image/jpeg':'application/json'})},body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
     if(key()!==keyValue)throw Error('管理キーが変更されました。もう一度読み込んでください。');
     if(!response.ok){if(response.status===401){window.dispatchEvent(new Event('admin-auth-required'));const e=Error(authMessage);e.status=401;throw e}let message='点検画像を読み込めませんでした。';try{message=(await response.json()).message||message}catch{}throw Error(message)}
     return binary?await response.blob():await response.json();
   }catch(e){if(controller.signal.aborted)throw Error(signal?.aborted?'点検画像の保存を中止しました。審査は確定していません。':'点検画像の通信が時間切れになりました。再試行してください。');throw e}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
 }
 async function prepare(ap,item,wrap,options={}){
   if(preparing)throw Error('点検画像を保存中です。完了をお待ちください。');preparing=true;
   const controller=new AbortController(),progress=node('div',undefined,wrap,'inspection-progress');progress.setAttribute('role','status');const message=node('p','点検用画像の保存状態を確認しています…',progress),cancel=node('button','画像保存を中止',progress);cancel.type='button';cancel.onclick=()=>controller.abort();
   try{
     const current=await request('status',query(ap,item),undefined,controller.signal),missing=current.sources.filter(s=>!current.record?.images?.some(i=>i.id===s.id));
     let completed=0;
     for(const source of missing){
       if(controller.signal.aborted)throw Error('点検画像の保存を中止しました。審査は確定していません。');
       message.textContent='点検用の縮小画像を保存中：'+(completed+1)+' / '+missing.length+'枚\n'+source.label;
       const original=await request('source',query(ap,item,{id:source.id}),undefined,controller.signal,true);
       const copy=await copyImage(original);if(controller.signal.aborted)throw Error('点検画像の保存を中止しました。審査は確定していません。');
       await request('upload',query(ap,item,{id:source.id}),copy,controller.signal);completed++;
       await new Promise(resolve=>setTimeout(resolve,0));
     }
     const ready=await request('ready',query(ap,item),{},controller.signal);
     if(current.sources.length===0&&!current.record?.images?.length&&options.migration)return {revision:0,saved:0};
     return {revision:ready.revision,saved:completed};
   }finally{preparing=false;progress.remove()}
 }
 window.Inspection={prepare};
 const preview=node('dialog',undefined,document.body,'inspection-preview'),previewTitle=node('p','点検用の縮小画像',preview),previewImage=node('img',undefined,preview),previewClose=node('button','閉じる',preview);previewClose.type='button';previewClose.onclick=()=>preview.close();preview.addEventListener('close',()=>{previewImage.removeAttribute('src')});
 const baseItem=renderItem;
 renderItem=(ap,item)=>{
   baseItem(ap,item);const wrap=document.querySelector('#detail>.item:last-child');if(!wrap)return;
   const panel=node('section',undefined,wrap,'inspection-panel');node('h3','点検用画像（管理者専用）',panel);
   const toggle=node('button','点検用画像・保存期限を確認',panel);toggle.type='button';toggle.setAttribute('aria-expanded','false');
   const body=node('div',undefined,panel,'inspection-body');body.hidden=true;
   let controller=null,urls=[],page=0;
   const cleanup=()=>{controller?.abort();for(const url of urls)URL.revokeObjectURL(url);urls=[]};
   const onKeyChange=()=>{cleanup();body.replaceChildren();body.hidden=true;toggle.setAttribute('aria-expanded','false');if(preview.open)preview.close()};document.getElementById('adminKey').addEventListener('input',onKeyChange);
   const observer=new MutationObserver(()=>{if(!panel.isConnected){cleanup();document.getElementById('adminKey').removeEventListener('input',onKeyChange);observer.disconnect()}});observer.observe(document.getElementById('detail'),{childList:true,subtree:true});
   async function show(){
     cleanup();controller=new AbortController();const signal=controller.signal;body.replaceChildren();node('p','読み込み中…',body);
     try{
       const data=await request('status',query(ap,item.item),undefined,signal);if(signal.aborted||!body.isConnected)return;body.replaceChildren();const r=data.record,images=r?.images||[];
       if(images.length){node('p',images.length+'枚・'+size(images.reduce((n,x)=>n+x.bytes,0))+' ／ '+(r.finalizedAt?'保存期限：'+date(r.expiresAt-1):'審査確定後に180日保存します。準備用コピーの期限：'+date(r.expiresAt)),body,'inspection-summary');}
       else node('p',r?.deletedAt?'点検用画像は削除済みです（'+(r.deleteReason==='capacity'?'容量上限による整理':'保存期限の終了')+'：'+date(r.deletedAt)+'）。':data.finished?'点検用画像はまだ保存されていません。すでに削除された元画像は復元できません。':'審査を確定する際に、点検用の縮小画像を自動保存します。',body,'inspection-muted');
       node('p','全体や表裏を見直すための縮小画像です。細かな文字・傷の再判定には元画像が必要です。期限前でも容量上限に達すると、古い確定済み画像から整理します。',body,'inspection-muted');
       if(data.stats.warning)node('p','点検画像の容量が上限に近づいています。⑥設定で使用量をご確認ください。',body,'inspection-warning');
       if(data.finished&&data.sources.some(s=>!images.some(i=>i.id===s.id))){const save=node('button','残っている画像を縮小保存',body);save.type='button';save.onclick=async()=>{save.disabled=true;window.AdminUI.setBusy('inspection:'+ap+':'+item.item,true);try{await prepare(ap,item.item,panel);await show()}catch(e){node('p',e.message,body,'inspection-warning')}finally{save.disabled=false;window.AdminUI.setBusy('inspection:'+ap+':'+item.item,false)}};}
       if(r?.finalizedAt&&images.length){const actions=node('div',undefined,body,'inspection-actions'),label=node('label','延長後の保存期限（日本時間）',actions),input=node('input',undefined,label);input.type='date';input.min=new Date(r.expiresAt+9*3600000).toISOString().slice(0,10);input.max=new Date(Date.now()+365*86400000+9*3600000).toISOString().slice(0,10);const extend=node('button','保存期限を延長',actions);extend.type='button';extend.onclick=async()=>{if(!input.value){input.focus();return}const choice=await window.AdminUI.choose('点検画像の保存期限を延長',ap+' ／ 資料 '+item.item+'\n'+input.value+' 23:59（日本時間）まで保存します。容量上限による整理の対象には含まれます。',[['この期限に延長','extend'],['戻る','stay','secondary']]);if(choice!=='extend')return;extend.disabled=true;window.AdminUI.setBusy('inspection-extend',true);try{await request('extend',query(ap,item.item),{revision:r.revision,date:input.value});await show()}catch(e){node('p',e.message,body,'inspection-warning')}finally{extend.disabled=false;window.AdminUI.setBusy('inspection-extend',false)}};}
       if(!images.length)return;page=Math.min(page,Math.max(0,Math.ceil(images.length/20)-1));const pager=node('div',undefined,body,'inspection-actions');node('span',(page*20+1)+'〜'+Math.min((page+1)*20,images.length)+'枚目 / '+images.length+'枚',pager);for(const [label,delta]of [['前の20枚',-1],['次の20枚',1]]){const b=node('button',label,pager);b.type='button';b.disabled=delta<0?page===0:(page+1)*20>=images.length;b.onclick=()=>{page+=delta;void show()};}
       const gallery=node('div',undefined,body,'inspection-gallery'),visible=images.slice(page*20,(page+1)*20);
       for(const image of visible){
         if(signal.aborted)return;const figure=node('figure',undefined,gallery),button=node('button','読み込み中…',figure);button.type='button';button.disabled=true;node('figcaption',image.label+' ／ '+image.width+'×'+image.height+' ／ '+size(image.bytes),figure);
         try{const blob=await request('image',query(ap,item.item,{id:image.id}),undefined,signal,true);if(signal.aborted)return;const url=URL.createObjectURL(blob);urls.push(url);button.replaceChildren();const img=node('img',undefined,button);img.src=url;img.alt=image.label;button.disabled=false;button.setAttribute('aria-label',image.label+'を拡大');button.onclick=()=>{previewTitle.textContent=ap+' ／ 資料 '+item.item+' ／ '+image.label;previewImage.src=url;previewImage.alt=image.label;preview.showModal()};}catch(e){if(signal.aborted)return;button.textContent=e.message}
       }
     }catch(e){if(!signal.aborted){body.replaceChildren();node('p',e.message,body,'inspection-warning');const retry=node('button','もう一度読み込む',body);retry.type='button';retry.onclick=show}}
   }
   toggle.onclick=()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));if(body.hidden)cleanup();else void show()};
 };
 const settings=node('section',undefined,document.getElementById('view-system'),'inspection-settings');node('h2','点検用画像の保存',settings);
 node('p','管理者だけが閲覧できます。審査確定後180日間、長辺1200px以内・1枚150KB以内で保存します。容量上限に達すると古い確定済み画像から整理します。導入前の確定分は縮小保存日から180日です。',settings,'inspection-muted');
 const controls=node('div',undefined,settings,'inspection-actions'),refresh=node('button','使用容量・削除予定を更新',controls),migrate=node('button','既存の確定済み画像を縮小保存',controls);refresh.type=migrate.type='button';
 const output=node('div',undefined,settings);output.setAttribute('aria-live','polite');
 const keyInput=document.getElementById('adminKey'),focusKey=()=>{keyInput.scrollIntoView({block:'center'});keyInput.focus()};
 let cursor='',shown=false,migrationMessage=null;
 function authNotice(message){output.replaceChildren();node('p',message,output,'inspection-warning');const loginLink=node('button','管理キー入力欄へ',output);loginLink.type='button';loginLink.onclick=focusKey;}
 authNotice('管理キーを入力して「管理情報を表示」を押すと、使用容量を確認できます。');
 window.addEventListener('admin-auth-required',()=>{settingsVersion++;shown=false;keyInput.setAttribute('aria-invalid','true');authNotice(key()?authMessage:'管理キーを入力して「管理情報を表示」を押してください。')});
 keyInput.addEventListener('input',()=>{settingsVersion++;shown=false;cursor='';keyInput.removeAttribute('aria-invalid');migrationMessage?.remove();authNotice('管理キーを入力したら「管理情報を表示」を押してください。')});
 async function loadSettings(next=''){
   const version=++settingsVersion;output.replaceChildren();node('p','使用容量を確認しています…',output);
   try{const data=await request('status',next?new URLSearchParams({cursor:next}):null);if(version!==settingsVersion)return;cursor=next;output.replaceChildren();const s=data.stats;node('p','点検画像：'+s.count+'枚 ／ '+size(s.bytes)+' / 上限 '+size(s.budgetBytes),output,'inspection-summary');const bar=node('progress',undefined,output);bar.max=s.budgetBytes;bar.value=s.bytes;bar.setAttribute('aria-label','点検画像の使用容量');if(s.warning)node('p','保存容量が上限に近づいています。新しい点検画像を保存すると、期限が近い確定済み画像から整理されます。',output,'inspection-warning');node('p','現在の追加保存余地：約'+size(s.availableBytes)+'。申請の追加画像などに必要な空きを確保して保存します。',output,'inspection-muted');if(s.removedCount)node('p','これまでに自動整理した点検画像：'+s.removedCount+'枚 ／ 最終整理：'+date(s.lastRemovedAt),output);
     const limitRow=node('div',undefined,output,'inspection-actions'),label=node('label','点検画像の容量上限',limitRow),select=node('select',undefined,label);for(const mb of [50,100,150,200]){const option=node('option',mb+' MB',select);option.value=mb}select.value=s.budgetBytes/1024/1024;const save=node('button','容量上限を保存',limitRow);save.type='button';save.onclick=async()=>{save.disabled=true;try{await request('budget',null,{megabytes:Number(select.value),revision:s.revision});await loadSettings(cursor)}catch(e){node('p',e.message,output,'inspection-warning')}finally{save.disabled=false}};
     node('h3','保存期限・削除予定',output);if(!data.records.length)node('p','点検画像の保存記録はまだありません。審査確定時に自動保存します。',output);
     for(const r of data.records){const row=node('div',undefined,output,'inspection-record'),a=node('a',r.ap+' ／ 資料 '+r.item+' ／ '+(r.name||'名称未入力'),row);a.href='/admin?'+new URLSearchParams({view:'applications',ap:r.ap,item:r.item});node('p',r.images.length?r.images.length+'枚 ／ '+(r.finalizedAt?'削除予定：':'準備用コピーの期限：')+date(r.expiresAt):'削除済み：'+date(r.deletedAt)+'（'+(r.deleteReason==='capacity'?'容量上限':'保存期限')+'）',row);}
     const pager=node('div',undefined,output,'inspection-actions');if(cursor){const first=node('button','最初の30件',pager);first.onclick=()=>void loadSettings('')}if(data.nextCursor){const more=node('button','次の30件',pager);more.onclick=()=>void loadSettings(data.nextCursor)}keyInput.removeAttribute('aria-invalid');shown=true;return true;
   }catch(e){if(version===settingsVersion){output.replaceChildren();if(!key())authNotice('管理キーを入力して「管理情報を表示」を押してください。');else node('p',e.message,output,'inspection-warning')}return false}
 }
 refresh.onclick=()=>void loadSettings(cursor);
 migrate.onclick=async()=>{
   if(preparing||migrate.disabled)return;migrate.disabled=true;migrationMessage?.remove();
   if(!await loadSettings('')){migrate.disabled=false;if(!key()||keyInput.getAttribute('aria-invalid')==='true')focusKey();return}
   const migrationKey=key(),choice=await window.AdminUI.choose('既存画像を点検用に保存','確定済み資料に残っている画像を縮小保存します。保存が済んだ資料の元画像は整理します。すでに削除済みの画像は復元できません。',[['縮小保存を開始','save'],['戻る','stay','secondary']]);if(choice!=='save'){migrate.disabled=false;return}
   window.AdminUI.setBusy('inspection-migration',true);const message=migrationMessage=node('p','対象の資料を確認しています…',settings,'inspection-progress');message.setAttribute('role','status');let saved=0;
   try{
     if(key()!==migrationKey)throw Error('管理キーが変更されました。もう一度「管理情報を表示」を押してください。');
     const data=await api('/admin/dashboard-data',{headers:H(false)});const materials=data.applications.flatMap(a=>(a.items||[]).filter(i=>i.registrationNumber||['type1','type2','type3','special','rejected'].includes(i.reviewResult)||i.registrationStatus==='cancelled').map(i=>({ap:a.ap,item:i.item})));
     for(const [index,m]of materials.entries()){if(key()!==migrationKey)throw Error('管理キーが変更されました。もう一度「管理情報を表示」を押してください。');message.textContent='既存画像を確認中：'+(index+1)+' / '+materials.length+'資料（保存 '+saved+'枚）';const r=await prepare(m.ap,m.item,settings,{migration:true});saved+=r.saved}
     message.textContent='既存画像の確認が終わりました。縮小保存：'+saved+'枚。';await loadSettings('');
   }catch(e){if(e.status===401)window.dispatchEvent(new Event('admin-auth-required'));message.className='inspection-warning';message.setAttribute('role','alert');message.textContent='縮小保存を中断しました（保存済み：'+saved+'枚）。'+e.message}finally{migrate.disabled=false;window.AdminUI.setBusy('inspection-migration',false)}
 };
 const showSettings=()=>{if(!document.getElementById('view-system').classList.contains('hidden')&&key()&&!shown){shown=true;void loadSettings('')}};
 const visibility=new MutationObserver(showSettings);visibility.observe(document.getElementById('view-system'),{attributes:true,attributeFilter:['class']});
 window.addEventListener('DOMContentLoaded',showSettings);
 window.addEventListener('admin-authenticated',()=>{shown=false;migrationMessage?.remove();showSettings()});
})();
`;
