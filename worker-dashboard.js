import app from "./worker-production.js";
export { RegistrationIssuer } from "./worker-production.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/admin") return adminPage();
    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      if (!isAdmin(request, env)) return json({success:false,message:"Unauthorized."},401);
      return dashboardData(env);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function isAdmin(request, env){
  return Boolean(env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY);
}
function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"};}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});}
function html(value,status=200){return new Response(value,{status,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});}

async function listAll(env,prefix,max=10000){
  const out=[];let cursor;let count=0;
  do{
    const r=await env.REGISTRATION_KV.list({prefix,limit:1000,cursor});
    out.push(...r.keys);count+=r.keys.length;
    cursor=r.list_complete?undefined:r.cursor;
  }while(cursor&&count<max);
  return out;
}
async function dashboardData(env){
  try{
    const [registrationKeys, applicationKeys, lotteryKeys, poolKeys] = await Promise.all([
      listAll(env,"REGISTRATION:"),
      listAll(env,"REGISTRATION_APPLICATION:"),
      listAll(env,"APPLICATION_"),
      listAll(env,"REGISTRATION_LIST")
    ]);

    const registrations=[];
    for(const k of registrationKeys){
      const raw=await env.REGISTRATION_KV.get(k.name);if(!raw)continue;
      try{const d=JSON.parse(raw);registrations.push({
        registrationNumber:d.registrationNumber||k.name.slice("REGISTRATION:".length),
        ap:d.ap||"",item:d.item||"",name:d.finalName||d.name||"",relatedName:d.finalRelatedName||d.relatedName||"",
        registrationType:d.registrationType||"",registrationTypeLabel:d.registrationTypeLabel||"",
        registeredAt:d.registeredAt||"",status:d.status||"registered",issuedDataReady:d.issuedDataReady===true
      });}catch{}
    }
    registrations.sort((a,b)=>String(b.registeredAt).localeCompare(String(a.registeredAt)));

    const applications=[];
    for(const k of applicationKeys){
      const raw=await env.REGISTRATION_KV.get(k.name);if(!raw)continue;
      try{const d=JSON.parse(raw);applications.push({
        ap:d.ap||k.name.slice("REGISTRATION_APPLICATION:".length),slots:d.slots||0,applicationMonth:d.applicationMonth||"",
        submittedAt:d.submittedAt||"",status:d.status||"received",
        items:(d.items||[]).map(x=>({item:x.item,name:x.finalName||x.name||"",reviewResult:x.reviewResult||null,registrationNumber:x.registrationNumber||null,issuedDataReady:x.issuedDataReady===true,registrationStatus:x.registrationStatus||null}))
      });}catch{}
    }
    applications.sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));

    let lotteryCount=0;
    for(const k of lotteryKeys){if(/^APPLICATION_AP-[A-Z0-9]{8}$/.test(k.name))lotteryCount++;}

    let poolCount=0;
    for(const k of poolKeys){
      if(!/^REGISTRATION_LIST(?:\d+)?$/.test(k.name))continue;
      const raw=await env.REGISTRATION_KV.get(k.name);if(!raw)continue;
      try{const a=JSON.parse(raw);if(Array.isArray(a))poolCount+=a.length;}catch{}
    }

    const activeRegistrations=registrations.filter(x=>x.status!=="cancelled");
    const cancelledRegistrations=registrations.filter(x=>x.status==="cancelled");
    const pendingApplications=applications.filter(a=>["received","under_review","additional_check","partially_reviewed"].includes(a.status));
    const documentPending=activeRegistrations.filter(x=>!x.issuedDataReady);
    const typeCounts={type1:0,type2:0,type3:0,special:0};
    for(const r of activeRegistrations)if(typeCounts[r.registrationType]!==undefined)typeCounts[r.registrationType]++;

    return json({success:true,generatedAt:new Date().toISOString(),summary:{
      lotteryApplications:lotteryCount,registrationApplications:applications.length,pendingApplications:pendingApplications.length,
      registrations:activeRegistrations.length,cancelled:cancelledRegistrations.length,documentPending:documentPending.length,poolCount,typeCounts
    },applications,registrations});
  }catch(e){return json({success:false,message:"統合管理データの取得に失敗しました。"},500);}
}

function adminPage(){return html(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文化資料登録室 統合管理</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1efe9;color:#262522;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Yu Gothic",sans-serif;line-height:1.65}.top{background:#25241f;color:#fff;padding:18px 24px;position:sticky;top:0;z-index:10;border-bottom:1px solid #49463e}.topin{max-width:1380px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{font-size:20px;letter-spacing:2px}.brand small{display:block;color:#c7b886;font-size:10px;letter-spacing:3px;margin-top:2px}.auth{display:flex;gap:8px;align-items:center}.auth input{width:260px;background:#fff}.wrap{max-width:1380px;margin:0 auto;padding:24px 18px 80px}.statusbar{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#fff;border:1px solid #ddd8cb;padding:14px 16px;margin-bottom:18px}.statusleft{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.dot{width:10px;height:10px;border-radius:50%;background:#aaa}.dot.on{background:#3f7f54}.dot.off{background:#a34b43}.nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.nav button{background:#ded9cc;color:#292824}.nav button.active{background:#292824;color:white}.cards{display:grid;grid-template-columns:repeat(7,minmax(130px,1fr));gap:10px;margin-bottom:18px}.card{background:#fff;border:1px solid #ddd8cb;padding:16px;min-height:96px}.card .n{font-size:29px;font-weight:700;line-height:1.1}.card .l{font-size:12px;color:#69655d;margin-top:7px}.card.warn .n{color:#8a5a20}.card.good .n{color:#3f6f4c}.section{background:#fff;border:1px solid #ddd8cb;margin-bottom:18px}.section h2{font-size:18px;margin:0;padding:16px 18px;border-bottom:1px solid #e4e0d5}.toolbar{display:flex;gap:10px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid #ece8df}.toolbar input,.toolbar select{min-width:180px;flex:1;padding:9px 11px;border:1px solid #aaa;background:#fff}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:900px}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid #ece8df;font-size:13px;vertical-align:top}th{background:#f8f7f3;font-size:11px;color:#625e55;position:sticky;top:0}.trclick{cursor:pointer}.trclick:hover{background:#fbfaf7}.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#ece9e1;font-size:11px;white-space:nowrap}.pill.good{background:#e3efe6;color:#315d3e}.pill.warn{background:#f4eadb;color:#7b511b}.pill.bad{background:#f0dddd;color:#7e3434}.hidden{display:none!important}.detail{padding:18px}.item{border:1px solid #dedbd2;padding:16px;margin:14px 0;background:#fcfbf8}.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-size:11px;font-weight:700;margin-bottom:4px;color:#5b574e}.field input,.field textarea{width:100%;padding:9px 10px;border:1px solid #aaa;font:inherit}.field textarea{min-height:80px}.images{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.images img{width:110px;height:110px;object-fit:contain;border:1px solid #ccc;background:#fff}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button{padding:9px 14px;border:0;background:#292824;color:#fff;cursor:pointer;font:inherit}button.secondary{background:#6b675f}button.good{background:#4f6548}button.warn{background:#8a632e}button.danger{background:#7a3434}button:disabled{opacity:.5;cursor:not-allowed}.msg{padding:10px 12px;margin-top:10px;background:#f6f4ef;border-left:4px solid #9d8a5a}.msg.error{border-left-color:#963d3d}.msg.success{border-left-color:#4f6548}.muted{font-size:12px;color:#6d685e}.types{display:flex;gap:14px;flex-wrap:wrap;padding:12px 18px;background:#faf9f5}.typechip{font-size:12px}.typechip b{font-size:16px;margin-left:4px}@media(max-width:1000px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){.topin{align-items:flex-start;flex-direction:column}.auth{width:100%}.auth input{flex:1;width:auto}.cards{grid-template-columns:repeat(2,1fr)}.fields{grid-template-columns:1fr}.statusbar{align-items:flex-start;flex-direction:column}}
</style></head><body><header class="top"><div class="topin"><div class="brand">文化資料登録室<small>INTEGRATED ADMINISTRATION</small></div><div class="auth"><input id="adminKey" type="password" placeholder="管理キー" autocomplete="off"><button id="login">管理画面を開く</button></div></div></header><main class="wrap">
<div id="statusbar" class="statusbar"><div class="statusleft"><span id="dot" class="dot"></span><strong id="openText">管理キーを入力してください</strong><span id="syncText" class="muted"></span></div><div class="row"><button id="refresh" class="secondary">再読込</button><button id="openBtn" class="good">受付開始</button><button id="closeBtn" class="danger">受付停止</button></div></div>
<div class="nav"><button data-view="dashboard" class="active">概要</button><button data-view="applications">申請管理</button><button data-view="registry">登録台帳</button><button data-view="system">システム</button></div>
<section id="view-dashboard"><div class="cards"><div class="card"><div class="n" id="cLottery">–</div><div class="l">抽選申込</div></div><div class="card"><div class="n" id="cApps">–</div><div class="l">登録申請</div></div><div class="card warn"><div class="n" id="cPending">–</div><div class="l">要対応・審査中</div></div><div class="card good"><div class="n" id="cRegs">–</div><div class="l">有効登録</div></div><div class="card warn"><div class="n" id="cDocs">–</div><div class="l">登録書未完成</div></div><div class="card"><div class="n" id="cCancelled">–</div><div class="l">取消</div></div><div class="card"><div class="n" id="cPool">–</div><div class="l">予約番号プール</div></div></div><div class="section"><h2>登録区分</h2><div class="types"><span class="typechip">第1種 <b id="t1">–</b></span><span class="typechip">第2種 <b id="t2">–</b></span><span class="typechip">第3種 <b id="t3">–</b></span><span class="typechip">特別登録 <b id="ts">–</b></span></div></div><div class="section"><h2>最近の要対応申請</h2><div id="recentPending" class="tablewrap"></div></div><div class="section"><h2>最近の登録</h2><div id="recentRegs" class="tablewrap"></div></div></section>
<section id="view-applications" class="hidden"><div class="section"><h2>申請管理</h2><div class="toolbar"><input id="appSearch" placeholder="AP番号・資料名称で検索"><select id="appFilter"><option value="all">すべて</option><option value="pending">要対応・審査中</option><option value="registered">登録済み</option><option value="rejected">不承認</option></select></div><div id="appsTable" class="tablewrap"></div></div><div id="detailBox" class="section hidden"><h2>申請詳細</h2><div id="detail" class="detail"></div></div></section>
<section id="view-registry" class="hidden"><div class="section"><h2>登録台帳</h2><div class="toolbar"><input id="regSearch" placeholder="登録番号・AP番号・資料名称・関連名称で検索"><select id="regFilter"><option value="active">有効登録</option><option value="all">すべて</option><option value="cancelled">取消済み</option><option value="docpending">登録書未完成</option></select></div><div id="regsTable" class="tablewrap"></div></div></section>
<section id="view-system" class="hidden"><div class="section"><h2>システム</h2><div class="detail"><p><strong>受付状態：</strong><span id="systemOpen">–</span></p><p><strong>予約番号プール：</strong><span id="systemPool">–</span> 件</p><p class="muted">予約番号プールは未使用番号の在庫です。正式な登録台帳とは別管理です。</p><div class="row"><button id="systemRefresh" class="secondary">全情報を再読込</button></div><div id="systemMsg"></div></div></div></section>
</main><script>
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];let DATA={applications:[],registrations:[],summary:null};
const key=()=>$('#adminKey').value.trim();const H=(json=true)=>{const h={'X-Admin-Key':key()};if(json)h['Content-Type']='application/json';return h};
function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}function fmt(v){if(!v)return'–';try{return new Date(v).toLocaleString('ja-JP')}catch{return v}}function pill(status){const s=String(status||'');let c='';if(['registered','document_preparing'].includes(s))c='good';else if(['received','under_review','additional_check','partially_reviewed'].includes(s))c='warn';else if(['rejected','cancelled'].includes(s))c='bad';return '<span class="pill '+c+'">'+esc(labelStatus(s))+'</span>'}function labelStatus(s){return ({received:'受付済み',under_review:'審査中',additional_check:'追加確認',partially_reviewed:'一部審査済み',document_preparing:'登録書作成中',registered:'登録済み',rejected:'不承認',cancelled:'取消'}[s]||s||'–')}
async function api(url,opt={}){const r=await fetch(url,opt);const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw new Error(d?.message||t||('HTTP '+r.status));return d}
function setView(v){$$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));['dashboard','applications','registry','system'].forEach(x=>$('#view-'+x).classList.toggle('hidden',x!==v))}$$('.nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
$('#adminKey').value=sessionStorage.getItem('bunkaAdminKey')||'';$('#login').onclick=()=>{sessionStorage.setItem('bunkaAdminKey',key());loadAll()};$('#refresh').onclick=loadAll;$('#systemRefresh').onclick=loadAll;
async function loadStatus(){const d=await api('/admin/system/application-status',{headers:H(false)});$('#dot').className='dot '+(d.applicationsOpen?'on':'off');$('#openText').textContent=d.applicationsOpen?'受付中':'受付停止中';$('#systemOpen').textContent=d.applicationsOpen?'受付中':'受付停止中';return d}
async function setOpen(open){if(!key())return alert('管理キーを入力してください。');if(!confirm(open?'受付を開始しますか？':'受付を停止しますか？'))return;await api('/admin/system/application-status',{method:'POST',headers:H(),body:JSON.stringify({open})});await loadStatus()}
$('#openBtn').onclick=()=>setOpen(true).catch(e=>alert(e.message));$('#closeBtn').onclick=()=>setOpen(false).catch(e=>alert(e.message));
async function loadAll(){if(!key()){alert('管理キーを入力してください。');return}try{const [d]=await Promise.all([api('/admin/dashboard-data',{headers:H(false)}),loadStatus()]);DATA=d;renderAll();$('#syncText').textContent='最終同期 '+new Date().toLocaleTimeString('ja-JP')}catch(e){$('#openText').textContent=e.message;$('#dot').className='dot off'}}
function renderAll(){const s=DATA.summary;$('#cLottery').textContent=s.lotteryApplications;$('#cApps').textContent=s.registrationApplications;$('#cPending').textContent=s.pendingApplications;$('#cRegs').textContent=s.registrations;$('#cDocs').textContent=s.documentPending;$('#cCancelled').textContent=s.cancelled;$('#cPool').textContent=s.poolCount;$('#systemPool').textContent=s.poolCount;$('#t1').textContent=s.typeCounts.type1;$('#t2').textContent=s.typeCounts.type2;$('#t3').textContent=s.typeCounts.type3;$('#ts').textContent=s.typeCounts.special;renderApplications();renderRegistrations();renderRecent()}
function appRows(list){return '<table><thead><tr><th>AP番号</th><th>状態</th><th>資料</th><th>送信日時</th><th>登録番号</th><th>登録書</th></tr></thead><tbody>'+list.map(a=>'<tr class="trclick" data-ap="'+esc(a.ap)+'"><td><strong>'+esc(a.ap)+'</strong></td><td>'+pill(a.status)+'</td><td>'+esc((a.items||[]).map(x=>x.name).join(' / '))+'</td><td>'+fmt(a.submittedAt)+'</td><td>'+esc((a.items||[]).map(x=>x.registrationNumber).filter(Boolean).join(', ')||'–')+'</td><td>'+((a.items||[]).some(x=>x.issuedDataReady)?'完成あり':'–')+'</td></tr>').join('')+'</tbody></table>'}
function regRows(list){return '<table><thead><tr><th>登録番号</th><th>資料名称</th><th>関連名称</th><th>区分</th><th>登録日</th><th>AP番号</th><th>登録書</th><th>状態</th></tr></thead><tbody>'+list.map(r=>'<tr><td><strong>'+esc(r.registrationNumber)+'</strong></td><td>'+esc(r.name||'–')+'</td><td>'+esc(r.relatedName||'–')+'</td><td>'+esc(r.registrationTypeLabel||r.registrationType||'–')+'</td><td>'+fmt(r.registeredAt)+'</td><td>'+esc(r.ap||'–')+'</td><td>'+(r.issuedDataReady?'完成':'未完成')+'</td><td>'+pill(r.status)+'</td></tr>').join('')+'</tbody></table>'}
function isPending(a){return ['received','under_review','additional_check','partially_reviewed'].includes(a.status)}function renderRecent(){const p=DATA.applications.filter(isPending).slice(0,8);$('#recentPending').innerHTML=p.length?appRows(p):'<div class="detail muted">現在、要対応の申請はありません。</div>';$('#recentRegs').innerHTML=DATA.registrations.filter(r=>r.status!=='cancelled').slice(0,8).length?regRows(DATA.registrations.filter(r=>r.status!=='cancelled').slice(0,8)):'<div class="detail muted">登録データはありません。</div>';bindAppRows()}
function renderApplications(){const q=($('#appSearch').value||'').toLowerCase(),f=$('#appFilter').value;let l=DATA.applications.filter(a=>{const txt=(a.ap+' '+(a.items||[]).map(x=>x.name).join(' ')).toLowerCase();if(q&&!txt.includes(q))return false;if(f==='pending'&&!isPending(a))return false;if(f==='registered'&&a.status!=='registered'&&a.status!=='document_preparing')return false;if(f==='rejected'&&a.status!=='rejected')return false;return true});$('#appsTable').innerHTML=l.length?appRows(l):'<div class="detail muted">該当する申請はありません。</div>';bindAppRows()}
function renderRegistrations(){const q=($('#regSearch').value||'').toLowerCase(),f=$('#regFilter').value;let l=DATA.registrations.filter(r=>{const txt=(r.registrationNumber+' '+r.ap+' '+r.name+' '+r.relatedName).toLowerCase();if(q&&!txt.includes(q))return false;if(f==='active'&&r.status==='cancelled')return false;if(f==='cancelled'&&r.status!=='cancelled')return false;if(f==='docpending'&&(r.status==='cancelled'||r.issuedDataReady))return false;return true});$('#regsTable').innerHTML=l.length?regRows(l):'<div class="detail muted">該当する登録はありません。</div>'}
$('#appSearch').oninput=renderApplications;$('#appFilter').onchange=renderApplications;$('#regSearch').oninput=renderRegistrations;$('#regFilter').onchange=renderRegistrations;
function bindAppRows(){$$('.trclick[data-ap]').forEach(tr=>tr.onclick=()=>{setView('applications');loadDetail(tr.dataset.ap)})}
async function loadDetail(ap){$('#detailBox').classList.remove('hidden');$('#detail').innerHTML='読み込んでいます…';try{const d=await api('/admin/application?ap='+encodeURIComponent(ap),{headers:H(false)});renderDetail(d.application);$('#detailBox').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){$('#detail').innerHTML='<div class="msg error">'+esc(e.message)+'</div>'}}
function renderDetail(a){$('#detail').innerHTML='<div class="row"><strong>'+esc(a.ap)+'</strong>'+pill(a.status)+'<span class="muted">送信 '+fmt(a.submittedAt)+'</span></div>';(a.items||[]).forEach(item=>renderItem(a.ap,item))}
function renderItem(ap,item){const wrap=document.createElement('div');wrap.className='item';const n=item.item;wrap.innerHTML='<h3>資料 '+esc(n)+'</h3><div class="fields"><div class="field"><label>申請時 資料名称</label><input readonly value="'+esc(item.submittedName??item.name??'')+'"></div><div class="field"><label>申請時 関連名称</label><input readonly value="'+esc(item.submittedRelatedName??item.relatedName??'')+'"></div></div><div class="field"><label>入手経緯・資料情報</label><textarea readonly>'+esc(item.acquisition||'')+'</textarea></div><div class="fields"><div class="field"><label>登録書用 資料名称</label><input class="finalName" value="'+esc(item.finalName??item.name??'')+'"></div><div class="field"><label>登録書用 関連名称</label><input class="finalRelatedName" value="'+esc(item.finalRelatedName??item.relatedName??'')+'"></div></div><p class="muted">審査: '+esc(item.reviewResult||'未審査')+' ／ 登録番号: '+esc(item.registrationNumber||'未発行')+' ／ 登録書: '+(item.issuedDataReady?'完成':'未完成')+'</p><div class="images"></div><div class="row actions"></div><div class="msg itemMsg hidden"></div><div class="uploadArea"></div>';$('#detail').appendChild(wrap);const images=wrap.querySelector('.images');for(let i=1;i<=20;i++){const no=String(i).padStart(2,'0'),img=document.createElement('img');img.src='/admin/image?ap='+encodeURIComponent(ap)+'&item='+encodeURIComponent(n)+'&image='+no;img.alt='画像 '+no;img.onerror=()=>img.remove();img.onclick=()=>window.open(img.src,'_blank','noopener');images.appendChild(img)}const defs=[['第1種','type1','good'],['第2種','type2','good'],['第3種','type3','good'],['特別登録','special','good'],['追加確認','additional_check','warn'],['不承認','rejected','danger']];defs.forEach(([t,v,c])=>{const b=document.createElement('button');b.textContent=t;b.className=c;b.onclick=()=>review(ap,n,v,wrap);wrap.querySelector('.actions').appendChild(b)});const save=document.createElement('button');save.textContent='名称のみ保存';save.className='secondary';save.onclick=()=>saveNames(ap,n,wrap);wrap.querySelector('.actions').appendChild(save);if(item.registrationNumber){const area=wrap.querySelector('.uploadArea');area.innerHTML='<div class="field" style="margin-top:14px"><label>完成した登録書JPG</label><input class="issuedFile" type="file" accept="image/jpeg"></div><div class="row" style="margin-top:8px"><button class="uploadIssued">登録書JPGを登録</button><button class="resetKey secondary">受取キー再発行</button><button class="cancel danger">登録取消</button></div>';area.querySelector('.uploadIssued').onclick=()=>uploadIssued(item.registrationNumber,area.querySelector('.issuedFile'),wrap);area.querySelector('.resetKey').onclick=()=>resetKey(ap,wrap);area.querySelector('.cancel').onclick=()=>cancelReg(item.registrationNumber,wrap)}}
function itemMsg(w,t,ok=false){const el=w.querySelector('.itemMsg');el.classList.remove('hidden','error','success');el.classList.add(ok?'success':'error');el.textContent=t}
async function review(ap,item,result,w){if(!confirm('この審査結果で保存しますか？'))return;try{const d=await api('/admin/review',{method:'POST',headers:H(),body:JSON.stringify({ap,item,result,finalName:w.querySelector('.finalName').value.trim(),finalRelatedName:w.querySelector('.finalRelatedName').value.trim()})});itemMsg(w,d.message||'保存しました。',true);await loadAll();await loadDetail(ap)}catch(e){itemMsg(w,e.message)}}
async function saveNames(ap,item,w){try{const d=await api('/admin/registration-text',{method:'POST',headers:H(),body:JSON.stringify({ap,item,finalName:w.querySelector('.finalName').value.trim(),finalRelatedName:w.querySelector('.finalRelatedName').value.trim()})});itemMsg(w,d.message,true);await loadAll()}catch(e){itemMsg(w,e.message)}}
async function uploadIssued(number,fileInput,w){const f=fileInput.files?.[0];if(!f)return itemMsg(w,'JPGファイルを選択してください。');const fd=new FormData();fd.append('registrationNumber',number);fd.append('file',f);try{const d=await api('/admin/issued-data-upload',{method:'POST',headers:H(false),body:fd});itemMsg(w,d.message,true);await loadAll()}catch(e){itemMsg(w,e.message)}}
async function resetKey(ap,w){if(!confirm('受取キーを再発行しますか？'))return;try{const d=await api('/admin/receive-key/reset',{method:'POST',headers:H(),body:JSON.stringify({ap})});itemMsg(w,'新しい受取キー: '+d.receiveKey+' ※この画面で控えてください。',true)}catch(e){itemMsg(w,e.message)}}
async function cancelReg(number,w){if(!confirm('登録 '+number+' を取消しますか？'))return;try{const d=await api('/admin/cancel',{method:'POST',headers:H(),body:JSON.stringify({registrationNumber:number})});itemMsg(w,d.message,true);await loadAll()}catch(e){itemMsg(w,e.message)}}
if(key())loadAll();
</script></body></html>`)}
