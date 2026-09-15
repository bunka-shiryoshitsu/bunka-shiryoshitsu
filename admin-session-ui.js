export function adminSessionClient(initialSession){
  return String.raw`
(() => {
 let expiresAt=${Number(initialSession?.expiresAt)||0},timer=null,loggingIn=null,legacyKey='';
 const input=()=>document.getElementById('adminKey');
 const active=()=>expiresAt>Date.now();
 try{legacyKey=sessionStorage.getItem('bunkaAdminKey')||'';sessionStorage.removeItem('bunkaAdminKey')}catch{}
 const initialKey=()=>{const value=active()?'':legacyKey;legacyKey='';return value};
 const credential=()=>input()?.value.trim()||(active()?'browser-session':'');
 const say=message=>{if(window.AdminUI)window.AdminUI.say(message)};
 function mount(){
   const auth=document.querySelector('.admin-auth');if(!auth)return;
   let state=document.getElementById('admin-session-state');
   if(!state){state=document.createElement('span');state.id='admin-session-state';state.setAttribute('role','status');auth.append(state);const logout=document.createElement('button');logout.id='admin-logout';logout.type='button';logout.textContent='ログアウト';auth.append(logout);logout.onclick=async()=>{if(window.AdminUI?.beforeLeave&&!await window.AdminUI.beforeLeave({logout:true}))return;logout.disabled=true;try{await window.AdminDocumentDrafts?.clear();sessionStorage.removeItem('bunkaAdminDrafts');await sessionRequest('DELETE');expiresAt=0;location.reload()}catch(e){say(e.message);logout.disabled=false}};}
   const signedIn=active();input().hidden=signedIn;auth.querySelector('label[for="adminKey"]').hidden=signedIn;document.getElementById('admin-logout').hidden=!signedIn;
   state.textContent=signedIn?'ログイン中 · '+new Date(expiresAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' まで':'ログイン後24時間、このブラウザー・同じ回線で保持します。';
   clearTimeout(timer);if(signedIn)timer=setTimeout(()=>expire(),Math.max(1,expiresAt-Date.now()));
 }
 function expire(message='ログインの有効期限が切れたか、接続回線が変わりました。管理キーでログインし直してください。'){
   expiresAt=0;clearTimeout(timer);if(input())input().value='';mount();say(message);
 }
 async function sessionRequest(method,key){
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{const response=await fetch('/admin/session',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'X-Admin-Session-Request':'1',...(key?{'X-Admin-Key':key}:{})}});const data=await response.json();if(!response.ok)throw Error(data.message||'ログイン状態を確認できませんでした。');return data}
   catch(e){if(controller.signal.aborted)throw Error('ログインの通信が時間切れになりました。もう一度お試しください。');throw e}finally{clearTimeout(timeout)}
 }
 async function login(){
   if(active()&&!input().value.trim())return true;if(loggingIn)return loggingIn;
   const submitted=input().value.trim();if(!submitted){say('管理キーを入力して「管理情報を表示」を押してください。');input().focus();return false}
   loggingIn=(async()=>{try{const data=await sessionRequest('POST',submitted);if(input().value.trim()!==submitted){say('管理キーが変更されました。もう一度「管理情報を表示」を押してください。');return false}expiresAt=data.session.expiresAt;input().value='';input().removeAttribute('aria-invalid');mount();return true}catch(e){expiresAt=0;mount();say(e.message);window.dispatchEvent(new Event('admin-auth-required'));input().focus();return false}finally{loggingIn=null}})();return loggingIn;
 }
 window.AdminSession={credential,login,mount,expire,active,initialKey};
 window.addEventListener('admin-auth-required',()=>{if(active())expire()});
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
})();
`;
}
