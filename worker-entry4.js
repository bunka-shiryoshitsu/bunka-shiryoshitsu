import app from "./worker-entry3.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (request.method === "POST" && path === "/lottery-apply") {
      if (!await applicationsOpen(env)) {
        return json({
          success: false,
          message: "現在、新規登録申請は休止しております。"
        }, 503);
      }
      return app.fetch(request, env, ctx);
    }

    if (request.method === "GET" && path === "/system/application-status") {
      return json({ success: true, applicationsOpen: await applicationsOpen(env) });
    }

    if (path === "/admin/system/application-status") {
      if (!isAdmin(request, env)) return unauthorized();

      if (request.method === "GET") {
        return json({ success: true, applicationsOpen: await applicationsOpen(env) });
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ success: false, message: "入力内容を確認してください。" }, 400);
        }

        if (typeof body?.open !== "boolean") {
          return json({ success: false, message: "open は true または false で指定してください。" }, 400);
        }

        await env.REGISTRATION_KV.put("SYSTEM:APPLICATIONS_OPEN", body.open ? "true" : "false");
        return json({
          success: true,
          applicationsOpen: body.open,
          message: body.open
            ? "抽選申込・登録申請の受付を開始しました。"
            : "抽選申込・登録申請の受付を停止しました。"
        });
      }

      return methodNotAllowed();
    }

    if (request.method === "GET" && path === "/admin") {
      return adminPage();
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key"
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors(),
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function html(value, status = 200) {
  return new Response(value, {
    status,
    headers: {
      ...cors(),
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function methodNotAllowed() {
  return json({ success: false, message: "Method Not Allowed." }, 405);
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY);
}

function unauthorized() {
  return json({ success: false, message: "Unauthorized." }, 401);
}

async function applicationsOpen(env) {
  const value = await env.REGISTRATION_KV.get("SYSTEM:APPLICATIONS_OPEN");
  if (value === null) return false;
  return String(value).trim().toLowerCase() === "true";
}

function adminPage() {
  return html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>文化資料登録室 管理</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f1ec;color:#292929;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Yu Gothic",sans-serif;line-height:1.7}
main{max-width:1180px;margin:32px auto;padding:0 18px 80px}
h1{font-size:28px;margin:0 0 20px}
h2{font-size:21px;margin:0 0 14px}
h3{font-size:17px;margin:24px 0 10px}
.box{background:#fff;border:1px solid #dedbd2;padding:24px;margin-bottom:20px;box-shadow:0 5px 18px rgba(0,0,0,.04)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.grow{flex:1 1 260px}
input,textarea,select{width:100%;padding:10px 12px;border:1px solid #aaa;font:inherit;background:#fff}
textarea{min-height:90px;resize:vertical}
button{padding:10px 16px;border:0;background:#292824;color:#fff;cursor:pointer;font:inherit}
button.secondary{background:#6b675f}button.warn{background:#7d562e}button.danger{background:#7a3434}button.good{background:#4f6548}
button:disabled{opacity:.5;cursor:not-allowed}.small{font-size:12px;color:#666}.status{padding:9px 12px;background:#f6f4ef;border-left:4px solid #9d8a5a;margin:10px 0}.error{border-left-color:#963d3d}.success{border-left-color:#4f6548}
.app-row{border-top:1px solid #ddd;padding:14px 0;cursor:pointer}.app-row:hover{background:#faf9f6}.meta{font-size:12px;color:#666}
.item{border:1px solid #ddd;padding:18px;margin:16px 0;background:#fcfbf8}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-size:12px;font-weight:600;margin-bottom:5px}.images{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.images img{width:130px;height:130px;object-fit:contain;border:1px solid #ccc;background:#fff;cursor:pointer}.hidden{display:none}.pill{display:inline-block;padding:2px 8px;border:1px solid #bbb;border-radius:999px;font-size:12px;margin-left:6px}
@media(max-width:700px){.fields{grid-template-columns:1fr}.images img{width:100px;height:100px}}
</style>
</head>
<body>
<main>
<h1>文化資料登録室 管理画面</h1>

<div class="box">
<h2>管理認証</h2>
<div class="row">
<div class="grow"><input id="adminKey" type="password" placeholder="管理キー" autocomplete="off"></div>
<button id="saveKey" type="button">この画面で使用</button>
</div>
<p class="small">管理キーはこのブラウザの sessionStorage のみに保持します。</p>
<div id="authMessage"></div>
</div>

<div class="box">
<h2>受付状態</h2>
<div id="openStatus" class="status">確認してください。</div>
<div class="row">
<button id="openButton" class="good" type="button">受付を開始</button>
<button id="closeButton" class="danger" type="button">受付を停止</button>
<button id="refreshStatus" class="secondary" type="button">状態を再確認</button>
</div>
<p class="small">停止中は抽選申込・画像アップロード・登録申請を受け付けません。</p>
</div>

<div class="box">
<h2>登録申請一覧</h2>
<div class="row"><button id="loadApps" type="button">申請一覧を読み込む</button></div>
<div id="appsMessage"></div>
<div id="apps"></div>
</div>

<div id="detailBox" class="box hidden">
<h2>申請詳細</h2>
<div id="detailHeader"></div>
<div id="detailItems"></div>
</div>
</main>
<script>
const adminKeyInput=document.getElementById('adminKey');
const authMessage=document.getElementById('authMessage');
const openStatus=document.getElementById('openStatus');
const apps=document.getElementById('apps');
const appsMessage=document.getElementById('appsMessage');
const detailBox=document.getElementById('detailBox');
const detailHeader=document.getElementById('detailHeader');
const detailItems=document.getElementById('detailItems');
adminKeyInput.value=sessionStorage.getItem('bunkaAdminKey')||'';

function key(){return adminKeyInput.value.trim()}
function headers(jsonBody=true){const h={'X-Admin-Key':key()};if(jsonBody)h['Content-Type']='application/json';return h}
function msg(el,text,kind=''){el.className='status '+kind;el.textContent=text}
function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}

async function api(url,options={}){
 const r=await fetch(url,options);let data=null;const text=await r.text();try{data=text?JSON.parse(text):null}catch{}
 if(!r.ok)throw new Error(data?.message||text||('HTTP '+r.status));return data;
}

document.getElementById('saveKey').onclick=()=>{sessionStorage.setItem('bunkaAdminKey',key());msg(authMessage,'この画面で管理キーを使用します。','success');loadStatus()};
document.getElementById('refreshStatus').onclick=loadStatus;
document.getElementById('openButton').onclick=()=>setOpen(true);
document.getElementById('closeButton').onclick=()=>setOpen(false);
document.getElementById('loadApps').onclick=loadApplications;

async function loadStatus(){
 try{const d=await api('/admin/system/application-status',{headers:headers(false)});msg(openStatus,d.applicationsOpen?'受付中です。':'現在は受付停止中です。',d.applicationsOpen?'success':'')}
 catch(e){msg(openStatus,e.message,'error')}
}
async function setOpen(open){
 if(!key()){msg(openStatus,'管理キーを入力してください。','error');return}
 if(!confirm(open?'抽選申込・登録申請の受付を開始しますか？':'抽選申込・登録申請の受付を停止しますか？'))return;
 try{const d=await api('/admin/system/application-status',{method:'POST',headers:headers(),body:JSON.stringify({open})});msg(openStatus,d.message,'success')}
 catch(e){msg(openStatus,e.message,'error')}
}
async function loadApplications(){
 apps.innerHTML='';msg(appsMessage,'読み込んでいます…');
 try{const d=await api('/admin/applications',{headers:headers(false)});msg(appsMessage,'申請 '+d.applications.length+' 件を表示しています。','success');
  d.applications.forEach(a=>{const div=document.createElement('div');div.className='app-row';div.innerHTML='<strong>'+esc(a.ap)+'</strong><span class="pill">'+esc(a.status||'')+'</span><div>'+esc((a.items||[]).map(x=>x.name).join(' / '))+'</div><div class="meta">送信: '+esc(a.submittedAt||'')+' / 枠: '+esc(a.slots||'')+'</div>';div.onclick=()=>loadDetail(a.ap);apps.appendChild(div)})
 }catch(e){msg(appsMessage,e.message,'error')}
}
async function loadDetail(ap){
 detailBox.classList.remove('hidden');detailHeader.textContent='読み込んでいます…';detailItems.innerHTML='';
 try{const d=await api('/admin/application?ap='+encodeURIComponent(ap),{headers:headers(false)});const a=d.application;detailHeader.innerHTML='<strong>'+esc(a.ap)+'</strong><span class="pill">'+esc(a.status||'')+'</span><div class="meta">送信: '+esc(a.submittedAt||'')+'</div>';
  (a.items||[]).forEach(item=>renderItem(a.ap,item));detailBox.scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){detailHeader.textContent=e.message}
}
function renderItem(ap,item){
 const wrap=document.createElement('div');wrap.className='item';const n=item.item;
 wrap.innerHTML='<h3>資料 '+esc(n)+'</h3>'+
 '<div class="fields"><div class="field"><label>申請時の資料名称（原文）</label><input readonly value="'+esc(item.submittedName??item.name??'')+'"></div><div class="field"><label>申請時の関連名称（原文）</label><input readonly value="'+esc(item.submittedRelatedName??item.relatedName??'')+'"></div></div>'+
 '<div class="field"><label>入手経緯・資料情報</label><textarea readonly>'+esc(item.acquisition||'')+'</textarea></div>'+
 '<div class="fields"><div class="field"><label>登録書用 資料名称</label><input class="finalName" value="'+esc(item.finalName??item.name??'')+'"></div><div class="field"><label>登録書用 関連名称</label><input class="finalRelatedName" value="'+esc(item.finalRelatedName??item.relatedName??'')+'"></div></div>'+
 '<div class="meta">審査結果: '+esc(item.reviewResult||'未審査')+' / 登録番号: '+esc(item.registrationNumber||'未発行')+' / 登録書: '+(item.issuedDataReady?'受取可能':'未登録')+'</div>'+
 '<div class="images"></div><div class="row actions" style="margin-top:15px"></div><div class="itemMessage"></div><div class="uploadArea" style="margin-top:15px"></div>';
 detailItems.appendChild(wrap);
 const images=wrap.querySelector('.images');
 for(let i=1;i<=20;i++){const no=String(i).padStart(2,'0');const img=document.createElement('img');img.alt='画像 '+no;img.src='/admin/image?ap='+encodeURIComponent(ap)+'&item='+encodeURIComponent(n)+'&image='+no;img.onerror=()=>img.remove();img.onclick=()=>window.open(img.src,'_blank','noopener');images.appendChild(img)}
 const actions=wrap.querySelector('.actions');
 const defs=[['第1種','type1','good'],['第2種','type2','good'],['第3種','type3','good'],['特別登録','special','good'],['追加確認','additional_check','warn'],['不承認','rejected','danger']];
 defs.forEach(d=>{const b=document.createElement('button');b.type='button';b.textContent=d[0];b.className=d[2];b.onclick=()=>review(ap,n,d[1],wrap);actions.appendChild(b)});
 const save=document.createElement('button');save.type='button';save.textContent='名称だけ保存';save.className='secondary';save.onclick=()=>saveNames(ap,n,wrap);actions.appendChild(save);
 if(item.registrationNumber){
  const area=wrap.querySelector('.uploadArea');area.innerHTML='<div class="field"><label>完成した登録書JPG</label><input class="issuedFile" type="file" accept="image/jpeg"></div><div class="row" style="margin-top:10px"><button class="uploadIssued" type="button">登録書JPGを登録</button><button class="resetKey secondary" type="button">受取キー再発行</button><button class="cancel danger" type="button">この登録を取消</button></div>';
  area.querySelector('.uploadIssued').onclick=()=>uploadIssued(item.registrationNumber,wrap);
  area.querySelector('.resetKey').onclick=()=>resetKey(ap,wrap);
  area.querySelector('.cancel').onclick=()=>cancelRegistration(item.registrationNumber,wrap);
 }
}
function values(wrap){return{finalName:wrap.querySelector('.finalName').value.trim(),finalRelatedName:wrap.querySelector('.finalRelatedName').value.trim()}}
async function saveNames(ap,item,wrap){const m=wrap.querySelector('.itemMessage');const v=values(wrap);try{const d=await api('/admin/registration-text',{method:'POST',headers:headers(),body:JSON.stringify({ap,item,finalName:v.finalName,finalRelatedName:v.finalRelatedName})});msg(m,d.message,'success')}catch(e){msg(m,e.message,'error')}}
async function review(ap,item,result,wrap){const m=wrap.querySelector('.itemMessage');const v=values(wrap);if(!confirm('この資料を「'+result+'」として処理しますか？'))return;try{const d=await api('/admin/review',{method:'POST',headers:headers(),body:JSON.stringify({ap,item,result,finalName:v.finalName,finalRelatedName:v.finalRelatedName})});msg(m,d.message+(d.registrationNumber?' 登録番号: '+d.registrationNumber:''),'success');await loadDetail(ap)}catch(e){msg(m,e.message,'error')}}
async function uploadIssued(number,wrap){const m=wrap.querySelector('.itemMessage');const file=wrap.querySelector('.issuedFile')?.files?.[0];if(!file){msg(m,'JPGファイルを選択してください。','error');return}const f=new FormData();f.append('registrationNumber',number);f.append('file',file);try{const r=await fetch('/admin/issued-data-upload',{method:'POST',headers:{'X-Admin-Key':key()},body:f});const t=await r.text();let d=null;try{d=JSON.parse(t)}catch{}if(!r.ok)throw new Error(d?.message||t||('HTTP '+r.status));msg(m,d.message,'success')}catch(e){msg(m,e.message,'error')}}
async function resetKey(ap,wrap){const m=wrap.querySelector('.itemMessage');if(!confirm('受取キーを再発行しますか？旧キーは無効になります。'))return;try{const d=await api('/admin/receive-key/reset',{method:'POST',headers:headers(),body:JSON.stringify({ap})});m.className='status success';m.innerHTML=esc(d.message)+'<br><strong>新しい受取キー: '+esc(d.receiveKey)+'</strong><br>この画面を閉じる前に安全な方法で申請者へ伝えてください。'}catch(e){msg(m,e.message,'error')}}
async function cancelRegistration(number,wrap){const m=wrap.querySelector('.itemMessage');if(!confirm('登録番号 '+number+' を取消しますか？この操作後は公開照会・登録書受取も無効になります。'))return;try{const d=await api('/admin/cancel',{method:'POST',headers:headers(),body:JSON.stringify({registrationNumber:number})});msg(m,d.message,'success')}catch(e){msg(m,e.message,'error')}}
if(key())loadStatus();
</script>
</body>
</html>`);
}
