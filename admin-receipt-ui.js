export const adminReceiptClient=String.raw`
(() => {
 const ui=window.AdminUI,blocks=new Set();if(!ui)return;
 const node=(tag,text,parent)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e};
 const credential=()=>window.AdminSession?.credential()||document.getElementById('adminKey')?.value.trim()||'';
 function clear(){for(const b of blocks)b.clear()}
 window.addEventListener('admin-auth-required',clear);document.getElementById('adminKey')?.addEventListener('input',clear);
 window.AdminReceipt={mount(ap,anchor){
  for(const b of blocks)if(!b.root.isConnected)blocks.delete(b);
  const root=node('section');root.className='detail receipt-admin';root.id='admin-receipt-'+ap;root.tabIndex=-1;root.style.scrollMarginTop='calc(var(--shell-height) + 100px)';anchor.after(root);
  const jump=node('button','受取キー・受取確認',anchor);jump.type='button';jump.setAttribute('aria-controls',root.id);jump.onclick=()=>{root.scrollIntoView({block:'start'});root.focus({preventScroll:true})};
  node('h3','受け取りキー・受取画面の確認',root);node('p','このAP番号の全資料で共通です。キーは管理者だけが確認できます。',root);
  const display=node('p',undefined,root),label=node('strong','受け取りキー：',display),value=node('code','未表示',display);value.className='code';value.style.cssText='font-size:22px;letter-spacing:.15em;margin-left:10px';
  const actions=node('div',undefined,root);actions.className='row';
  const reveal=node('button','キーを表示',actions),copy=node('button','キーをコピー',actions),preview=node('a','申請者の受取画面を確認',actions),reset=node('button','紛失時：キーを再発行',actions);
  for(const b of [reveal,copy,reset])b.type='button';copy.hidden=true;reset.className='secondary';
  preview.className='table-action';preview.href='/admin/receive-preview?'+new URLSearchParams({ap});preview.target='_blank';preview.rel='noopener noreferrer';
  const message=node('p','',root);message.setAttribute('role','status');let current='',busy=false,version=0;
  const hide=()=>{version++;current='';value.textContent='未表示';copy.hidden=true;reveal.textContent='キーを表示';message.textContent=''};
  const state={root,clear:hide};blocks.add(state);
  async function read(resetKey=false){
   if(busy)return;busy=true;const own=++version;reveal.disabled=reset.disabled=true;current='';copy.hidden=true;value.textContent='確認中…';message.textContent='';
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const key=credential();if(!key)throw Error('管理者としてログインしてください。');
    const response=await fetch(resetKey?'/admin/receive-key/reset':'/admin/receive-key?'+new URLSearchParams({ap}),{method:resetKey?'POST':'GET',headers:{'X-Admin-Key':key,...(resetKey?{'Content-Type':'application/json'}:{})},...(resetKey?{body:JSON.stringify({ap})}:{}),cache:'no-store',signal:controller.signal});
    const data=await response.json();if(own!==version||!root.isConnected)return;
    if(!response.ok||!data.success){if(response.status===401)window.dispatchEvent(new Event('admin-auth-required'));throw Error(data.message||'確認できませんでした。')}
    current=data.receiveKey||'';value.textContent=current||'再表示できません';copy.hidden=!current;reveal.textContent=current?'キーを隠す':'もう一度確認';message.textContent=data.message||'';
   }catch(e){if(own===version&&root.isConnected){value.textContent='確認できません';message.textContent=controller.signal.aborted?'通信が時間切れになりました。再発行後の場合は「キーを表示」で保存結果を確認してください。':e.message;reveal.textContent='キーを表示'}}
   finally{clearTimeout(timeout);busy=false;reveal.disabled=reset.disabled=false}
  }
  reveal.onclick=()=>{if(current)hide();else void read()};
  copy.onclick=async()=>{if(!current)return;try{await navigator.clipboard.writeText(current);message.textContent='受け取りキーをコピーしました。'}catch{message.textContent='コピーできませんでした。表示されたキーを選択してコピーしてください。'}};
  reset.onclick=async()=>{if(busy)return;const answer=await ui.choose('受け取りキーを再発行します',ap+'\n申請者本人とAP番号を確認してから行ってください。古いキーは使えなくなります。新しいキーを申請者へ案内してください。',[['確認して再発行','reset','danger'],['戻る','stay','secondary']]);if(answer==='reset')await read(true)};
 }};
})();
`;
