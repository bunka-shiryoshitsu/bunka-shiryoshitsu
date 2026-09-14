export const portalScript = String.raw`
let portalGeneration=0;
function node(tag,text,parent){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(parent)parent.appendChild(el);return el;}
function showDate(value){return new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）';}
function roundLabel(status){return {pending:'追加資料の提出待ち',expired:'追加提出期限切れ（管理者確認待ち）',submitted:'追加提出済み・確認中',closed:'未提出による手続終了',resolved:'確認終了'}[status]||status;}
async function supplementCall(ap,receiveKey,path,item,body){
 const q=new URLSearchParams({ap});if(item)q.set('item',item);
 const r=await fetch(path+'?'+q,{method:body?'POST':'GET',headers:{'X-Receive-Key':receiveKey,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const d=await r.json();if(!r.ok||!d.success)throw Error(d.message||'確認できませんでした。');return d;
}
async function showSupplementImage(ap,receiveKey,item,image,container,admin=false){
 const query=new URLSearchParams({ap,item,id:image.id});
 const response=await fetch((admin?'/admin':'')+'/supplement/image?'+query,{headers:admin?H(false):{'X-Receive-Key':receiveKey},cache:'no-store'});
 if(!response.ok)throw Error('画像を読み込めませんでした。');
 const blob=await response.blob();if(!container.isConnected)return;
 const url=URL.createObjectURL(blob),img=node('img',undefined,container);img.src=url;img.alt='追加提出画像';img.style.cssText='max-width:100%;max-height:480px;object-fit:contain;display:block';
 const observer=new MutationObserver(()=>{if(!img.isConnected){URL.revokeObjectURL(url);observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
}
async function loadPortal(){
 const generation=++portalGeneration,ap=apInput.value.trim().toUpperCase(),receiveKey=keyInput.value.trim().toUpperCase();
 result.textContent='確認しています……';button.disabled=true;
 try{
  const received=await fetch('/receive-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ap,receiveKey})});
  const receipt=await received.json();if(!received.ok||!receipt.success)throw Error(receipt.message||'認証できませんでした。');
  if(receipt.status==='not_submitted'){result.textContent='初回の登録申請はまだ受け付けられていません。HPの抽選結果確認口から当選状況を確認し、初回申請を行ってください。';return;}
  const data=await supplementCall(ap,receiveKey,'/supplement/status');if(generation!==portalGeneration)return;
  result.innerHTML='';node('p','最新確認：'+showDate(data.serverTime),result);
  for(const item of data.items){
   const wrap=node('section',undefined,result);wrap.className='item';node('h2','資料 '+item.item+'：'+item.name,wrap);
   const round=item.rounds.at(-1),ready=(receipt.items||[]).find(x=>x.item===item.item);
   const final=item.registrationStatus==='cancelled'?'登録取消':item.reviewResult==='rejected'?'登録見送り':['type1','type2','type3','special'].includes(item.reviewResult)?(ready?.ready?'登録書受取可能':'登録決定・登録書作成中'):null;
   node('p','状況：'+(final||(round?roundLabel(round.status):'確認中')),wrap);
   if(item.reviewResult==='additional_check'&&!round)node('p','追加確認中です。提出内容と期限の案内が掲載されるまでお待ちください。',wrap);
   if(ready?.ready&&item.registrationStatus!=='cancelled'){const dl=node('button','登録書JPGを受け取る',wrap);dl.onclick=()=>downloadFile(ap,receiveKey,ready.registrationNumber);}
   for(const r of item.rounds){
    const section=node('div',undefined,wrap);section.className='notice';node('h3','追加依頼 '+(item.rounds.indexOf(r)+1)+'：'+roundLabel(r.status),section);
    node('p','掲載：'+showDate(r.requestedAt),section);const instruction=node('p',r.instruction,section);instruction.style.whiteSpace='pre-wrap';
    node('strong','提出期限：'+r.deadlineLabel,section);
    for(const extension of r.extensions)node('p','期限延長：'+showDate(extension.at)+' に更新',section);
    if(r.submission){node('p','提出完了：'+showDate(r.submission.at),section);const answer=node('p',r.submission.text||'文章の追加なし',section);answer.style.whiteSpace='pre-wrap';}
    if(r.closedAt)node('p','終了：'+showDate(r.closedAt),section);
    const imageArea=node('div',undefined,section);
    for(const image of r.uploads){const box=node('div',undefined,imageArea);const view=node('button','追加画像 '+(r.uploads.indexOf(image)+1)+' を確認',box);view.type='button';view.onclick=async()=>{view.disabled=true;try{await showSupplementImage(ap,receiveKey,item.item,image,box);}catch(e){node('p',e.message,box);view.disabled=false;}};
     if(r===round&&r.status==='pending'&&!final){const remove=node('button','この添付を取り消す',box);remove.type='button';remove.onclick=async()=>{if(!confirm('この添付を取り消して画面を読み直します。未送信の入力は消えます。よろしいですか？'))return;remove.disabled=true;try{await supplementCall(ap,receiveKey,'/supplement/remove',item.item,{round:r.id,id:image.id});await loadPortal();}catch(e){node('p',e.message,box);remove.disabled=false;}};}
    }
    if(r!==round||r.status!=='pending'||final)continue;
    node('p','追加提出は登録の内定や承認を意味するものではありません。提出後も登録を見送る場合があります。個別の判断理由や審査過程の説明・お問い合わせへの回答は行いません。',section);
    const form=node('form',undefined,section);let answer=null,fileInput=null;
    if(r.needText){const label=node('label','追加情報（必須・5000文字以内）',form);answer=node('textarea',undefined,label);answer.required=true;answer.maxLength=5000;answer.rows=7;answer.style.cssText='width:100%;font:inherit;padding:10px';}
    if(r.needImages){const label=node('label','追加画像（必須・JPEG/PNG/WebP、1枚3MB以内、合計10枚まで）',form);fileInput=node('input',undefined,label);fileInput.type='file';fileInput.multiple=true;fileInput.accept='image/jpeg,image/png,image/webp';node('p','添付した画像は下の「追加資料を提出」を押すと送信します。通信が途中で止まった場合は同じ画面で再試行してください。',form);}
    const message=node('p','',form);message.setAttribute('role','status');
    const submit=node('button','追加資料を提出',form);submit.type='submit';
    const token=crypto.randomUUID(),ids=new Map();
    form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;if(answer)answer.readOnly=true;if(fileInput)fileInput.disabled=true;
     try{
      const files=Array.from(fileInput?.files||[]);
      if(files.length+r.uploads.length>10)throw Error('既に添付済みの画像と合わせて10枚以内にしてください。');
      if(files.some(f=>f.size>3*1024*1024))throw Error('画像は1枚3MB以内にしてください。');
      if(r.needImages&&!r.uploads.length&&!files.length)throw Error('追加画像を選択してください。');
      for(let n=0;n<files.length;n++){
       const file=files[n];if(!ids.has(file))ids.set(file,crypto.randomUUID());message.textContent='画像を送信中：'+(n+1)+' / '+files.length;
       const q=new URLSearchParams({ap,item:item.item,round:r.id,id:ids.get(file)});
       const response=await fetch('/supplement/upload?'+q,{method:'POST',headers:{'X-Receive-Key':receiveKey,'Content-Type':file.type},body:file});const d=await response.json();if(!response.ok)throw Error(d.message||'画像を送信できませんでした。');
      }
      message.textContent='提出内容を保存しています……';
      const data=await supplementCall(ap,receiveKey,'/supplement/submit',item.item,{round:r.id,token,text:answer?.value||''});
      message.textContent=data.message;await loadPortal();
     }catch(e){message.textContent=e.message;submit.disabled=false;if(answer)answer.readOnly=false;if(fileInput)fileInput.disabled=false;}
    };
   }
  }
 }catch(e){if(generation===portalGeneration)result.textContent=e.message;}
 finally{if(generation===portalGeneration)button.disabled=false;}
}
apInput.addEventListener('input',()=>{portalGeneration++;result.innerHTML='';button.disabled=false;});
keyInput.addEventListener('input',()=>{portalGeneration++;result.innerHTML='';button.disabled=false;});
`;

export const adminSupplementScript = String.raw`
function supplementNode(tag,text,parent){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(parent)parent.appendChild(el);return el;}
function supplementDate(value){return new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）';}
async function loadSupplementAdmin(ap,item,wrap){
 const root=supplementNode('section',undefined,wrap);root.className='detail';supplementNode('h3','追加提出の管理',root);
 try{
  const q=new URLSearchParams({ap});const d=await api('/admin/supplement/status?'+q,{headers:H(false)});if(!root.isConnected)return;
  const entry=d.items.find(x=>x.item===item);if(!entry)return;
  const final=entry.registrationStatus==='cancelled'||['type1','type2','type3','special','rejected'].includes(entry.reviewResult);
  const current=entry.rounds.at(-1);
  const labels={pending:'提出待ち',expired:'提出期限切れ',submitted:'追加提出済み・再確認待ち',closed:'未提出による手続終了',resolved:'確認終了'};
  const msg=supplementNode('p','',root);msg.setAttribute('role','status');
  async function save(action,body,btn){btn.disabled=true;try{await api('/admin/supplement/'+action+'?'+new URLSearchParams({ap,item}),{method:'POST',headers:H(),body:JSON.stringify(body)});await loadDetail(ap);await loadSupplementQueue();}catch(e){msg.textContent=e.message;btn.disabled=false;}}
  for(const r of entry.rounds){
   const box=supplementNode('div',undefined,root);box.className='msg';supplementNode('strong',labels[r.status]||r.status,box);
   supplementNode('p','依頼掲載：'+supplementDate(r.requestedAt),box);const instruction=supplementNode('p',r.instruction,box);instruction.style.whiteSpace='pre-wrap';
   supplementNode('p','提出期限：'+r.deadlineLabel,box);
   if(r.submission){supplementNode('p','提出日時：'+supplementDate(r.submission.at),box);const answer=supplementNode('p',r.submission.text||'文章の追加なし',box);answer.style.whiteSpace='pre-wrap';}
   for(const image of r.uploads){
    const slot=supplementNode('div',undefined,box);const view=supplementNode('button','追加画像 '+(r.uploads.indexOf(image)+1)+' を表示',slot);view.onclick=async()=>{view.disabled=true;try{const response=await fetch('/admin/supplement/image?'+new URLSearchParams({ap,item,id:image.id}),{headers:H(false),cache:'no-store'});if(!response.ok)throw Error('画像を読み込めませんでした。');const blob=await response.blob();if(!slot.isConnected)return;const url=URL.createObjectURL(blob),img=supplementNode('img',undefined,slot);img.src=url;img.alt='追加提出画像';img.style.cssText='max-width:100%;max-height:600px;object-fit:contain';const observer=new MutationObserver(()=>{if(!img.isConnected){URL.revokeObjectURL(url);observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});}catch(e){msg.textContent=e.message;view.disabled=false;}};
   }
  }
  if(final||current?.status==='closed'){supplementNode('p','確認・手続は終了しています。',root);return;}
  if(current&&['pending','expired'].includes(current.status)){
   const label=supplementNode('label','延長後の提出期限（日本時間23:59まで）',root),date=supplementNode('input',undefined,label);date.type='date';date.min=current.deadlineLabel.slice(0,10);
   const extend=supplementNode('button','期限を延長',root);extend.onclick=()=>{if(confirm('表示した日付まで提出期限を延長しますか？'))save('extend',{round:current.id,revision:entry.revision,date:date.value},extend);};
   if(current.status==='expired'){const close=supplementNode('button','未提出による手続終了',root);close.className='danger';close.onclick=()=>{if(confirm('この資料を未提出による手続終了としますか？不承認とは別の扱いです。'))save('close',{round:current.id,revision:entry.revision},close);};}
   return;
  }
  const label=supplementNode('label','申請者に表示する依頼内容（必須・2000文字以内）',root),instruction=supplementNode('textarea',undefined,label);instruction.maxLength=2000;instruction.rows=5;instruction.style.cssText='display:block;width:100%;font:inherit';instruction.placeholder='例：裏面全体と署名部分の画像、入手時期についての情報をご提出ください。';
  function check(text){const label=supplementNode('label',text,root),input=supplementNode('input',undefined,label);input.type='checkbox';return input;}
  const needText=check('追加文章が必要'),needImages=check('追加画像・撮り直しが必要');
  supplementNode('p','掲載日の翌日を1日目とする30日目の23:59（日本時間）が提出期限になります。必要な内容をまとめて記入してください。登録承認を示唆する表現や判断理由は記載しないでください。',root);
  const publish=supplementNode('button','追加依頼を掲載',root);publish.onclick=()=>{if(!instruction.value.trim()||(!needText.checked&&!needImages.checked)){msg.textContent='依頼内容と必要な提出物を指定してください。';return;}if(confirm('この依頼を申請者の確認画面に掲載しますか？'))save('request',{revision:entry.revision,instruction:instruction.value,needText:needText.checked,needImages:needImages.checked},publish);};
 }catch(e){supplementNode('p',e.message,root);}
}
const supplementQueue=document.createElement('section');supplementQueue.className='section';document.querySelector('.nav').after(supplementQueue);
async function loadSupplementQueue(cursor=''){
 if(!key()){supplementQueue.innerHTML='';return;}
 supplementQueue.innerHTML='';supplementNode('h2','追加提出一覧',supplementQueue);
 try{const data=await api('/admin/supplement/queue'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:H(false)});const root=supplementNode('div',undefined,supplementQueue);root.className='detail';
 const labels={pending:'提出待ち',expired:'期限切れ・要対応',submitted:'追加提出済み・要確認',closed:'未提出による手続終了',resolved:'確認終了'};
 if(!data.rows.length)supplementNode('p','追加提出の依頼はありません。',root);
 for(const entry of data.rows){const row=supplementNode('p',undefined,root);const open=supplementNode('button',entry.ap+' / 資料 '+entry.item+' — '+labels[entry.round.status],row);open.onclick=()=>{setView('applications');loadDetail(entry.ap);};supplementNode('span','　提出期限 '+entry.round.deadlineLabel,row);}
 const refresh=supplementNode('button','一覧を更新',root);refresh.onclick=()=>loadSupplementQueue();
 if(data.nextCursor){const next=supplementNode('button','次の100件',root);next.onclick=()=>loadSupplementQueue(data.nextCursor);}
 }catch(e){supplementNode('p',e.message,supplementQueue);}
}
const loadAllBeforeSupplements=loadAll;
loadAll=async function(){await loadAllBeforeSupplements();await loadSupplementQueue();};
`;
