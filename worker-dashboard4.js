import app from "./worker-dashboard3.js";
export { RegistrationIssuer } from "./worker-dashboard3.js";

const ORIGIN="https://bunka-shiryoshitsu.github.io";

export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==="GET"&&url.pathname==="/admin/lottery-data"){
   if(!isAdmin(request,env))return json({success:false,message:"Unauthorized."},401);
   return lotteryData(env);
  }
  if(request.method==="POST"&&url.pathname==="/admin/lottery-winner"){
   if(!isAdmin(request,env))return json({success:false,message:"Unauthorized."},401);
   let body;try{body=await request.clone().json()}catch{return json({success:false,message:"入力内容が正しくありません。"},400)}
   const ap=String(body?.ap||"").trim().toUpperCase();
   const slots=Number(body?.slots);
   if(!/^AP-[A-Z0-9]{8}$/.test(ap)||!Number.isInteger(slots)||slots<1||slots>10)return json({success:false,message:"AP番号または当選枠数が正しくありません。"},400);
   const raw=await env.REGISTRATION_KV.get("APPLICATION_"+ap);
   if(!raw)return json({success:false,message:"抽選申込が見つかりません。"},404);
   let rec;try{rec=JSON.parse(raw)}catch{return json({success:false,message:"抽選申込データを読み取れません。"},500)}
   if(rec.lotteryEligible===false)return json({success:false,message:"この申込みは内部判定により当選設定できません。"},409);
   const month=String(rec.applicationMonth||rec.appliedDate||"").slice(0,7);
   const internal=new Request(new URL("/admin-winners/save",request.url),{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Key":request.headers.get("X-Admin-Key")||""},body:JSON.stringify({ap,slots,applicationMonth:month})});
   return app.fetch(internal,env,ctx);
  }
  if(request.method==="GET"&&url.pathname==="/admin"){
   const response=await app.fetch(request,env,ctx);if(!response.ok)return response;
   let page=await response.text();
   page=patchAdmin(page);
   return html(page);
  }
  return app.fetch(request,env,ctx);
 },
 async scheduled(controller,env,ctx){if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx)}
};

function isAdmin(request,env){return Boolean(env.ADMIN_KEY&&request.headers.get("X-Admin-Key")===env.ADMIN_KEY)}
function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"}}
function json(v,s=200){return new Response(JSON.stringify(v),{status:s,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}})}
function html(v,s=200){return new Response(v,{status:s,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}})}

async function listAll(env,prefix){const out=[];let cursor;do{const r=await env.REGISTRATION_KV.list({prefix,limit:1000,cursor});out.push(...r.keys);cursor=r.list_complete?undefined:r.cursor}while(cursor&&out.length<10000);return out}
async function lotteryData(env){
 const keys=await listAll(env,"APPLICATION_");const applications=[];
 for(const k of keys){
  if(!/^APPLICATION_AP-[A-Z0-9]{8}$/.test(k.name))continue;
  const raw=await env.REGISTRATION_KV.get(k.name);if(!raw)continue;
  try{const d=JSON.parse(raw);const ap=d.ap||k.name.slice(12);let winner=null;const w=await env.REGISTRATION_KV.get("WINNER_"+ap);if(w)try{winner=JSON.parse(w)}catch{}
   applications.push({ap,overview:d.overview||"",appliedAt:d.appliedAt||"",appliedDate:d.appliedDate||"",applicationMonth:d.applicationMonth||"",lotteryEligible:d.lotteryEligible!==false,status:d.status||"received",winner:winner?{slots:Number(winner.slots)||0,expiryDate:winner.expiryDate||""}:null});
  }catch{}
 }
 applications.sort((a,b)=>String(b.appliedAt).localeCompare(String(a.appliedAt)));
 return json({success:true,applications});
}

function patchAdmin(page){
 page=page.replace('<button data-view="dashboard" class="active">概要</button><button data-view="applications">申請管理</button>','<button data-view="dashboard" class="active">概要</button><button data-view="lottery">抽選管理</button><button data-view="applications">登録申請管理</button>');
 const lotterySection='<section id="view-lottery" class="hidden"><div class="section"><h2>抽選申込管理</h2><div class="detail"><p class="muted">抽選時に提出された資料概要を確認し、必要に応じて当選枠数を設定します。当選枠の判断基準は公開しません。</p></div><div id="lotteryTable" class="tablewrap"></div><div id="lotteryMsg" class="detail"></div></div></section>\n';
 page=page.replace('<section id="view-applications"',lotterySection+'<section id="view-applications"');
 page=page.replace("['dashboard','applications','registry','system'].forEach(x=>$('#view-'+x).classList.toggle('hidden',x!==v))","['dashboard','lottery','applications','registry','system'].forEach(x=>$('#view-'+x).classList.toggle('hidden',x!==v));if(v==='lottery')loadLottery() ");
 const start=page.indexOf('function appRows(list){');const end=page.indexOf('\nfunction regRows(list){',start);
 if(start>=0&&end>start){const replacement=`function appRows(list){return '<table><thead><tr><th>AP番号</th><th>状態</th><th>資料数</th><th>資料名称</th><th>送信日時</th><th>登録番号</th><th>審査画像</th></tr></thead><tbody>'+list.map(a=>{const items=a.items||[],names=items.map(x=>x.name||'（名称なし）').join(' / '),nums=items.map(x=>x.registrationNumber).filter(Boolean).join(' / '),imgs=items.reduce((n,x)=>n+(Number(x.imageCount)||0),0);return '<tr class="trclick" data-ap="'+esc(a.ap)+'"><td><strong>'+esc(a.ap)+'</strong></td><td>'+pill(a.status)+'</td><td><strong>'+items.length+'資料</strong></td><td>'+esc(names||'–')+'</td><td>'+fmt(a.submittedAt)+'</td><td>'+esc(nums||'–')+'</td><td>'+(imgs?'<span class="pill good">画像 '+imgs+'枚</span>':'<span class="pill bad">画像なし</span>')+'</td></tr>'}).join('')+'</tbody></table>'}\n`;
  page=page.slice(0,start)+replacement+page.slice(end+1);
 }
 const extra=`\nlet LOTTERY=[];\nasync function loadLottery(){if(!key())return;try{const d=await api('/admin/lottery-data',{headers:H(false)});LOTTERY=d.applications||[];renderLottery()}catch(e){const m=$('#lotteryMsg');if(m)m.innerHTML='<div class="msg error">'+esc(e.message)+'</div>'}}\nfunction renderLottery(){const box=$('#lotteryTable');if(!box)return;if(!LOTTERY.length){box.innerHTML='<div class="detail muted">抽選申込はありません。</div>';return}box.innerHTML='<table><thead><tr><th>AP番号</th><th>申込日時</th><th>資料概要</th><th>状態</th><th>当選枠</th><th>操作</th></tr></thead><tbody>'+LOTTERY.map(x=>'<tr><td><strong>'+esc(x.ap)+'</strong></td><td>'+fmt(x.appliedAt)+'</td><td style="min-width:320px;white-space:pre-wrap">'+esc(x.overview||'（旧申込：概要なし）')+'</td><td>'+(x.winner?'<span class="pill good">当選設定済み</span>':(x.lotteryEligible?'<span class="pill warn">未設定</span>':'<span class="pill bad">内部対象外</span>'))+'</td><td>'+(x.winner?esc(x.winner.slots)+'枠':'<select id="slots-'+esc(x.ap)+'">'+[1,2,3,4,5,6,7,8,9,10].map(n=>'<option value="'+n+'">'+n+'枠</option>').join('')+'</select>')+'</td><td>'+(x.winner?'期限 '+esc(x.winner.expiryDate||'–'):(x.lotteryEligible?'<button class="good" onclick="setLotteryWinner(\\''+esc(x.ap)+'\\')">当選設定</button>':'–'))+'</td></tr>').join('')+'</tbody></table>'}\nasync function setLotteryWinner(ap){const el=document.getElementById('slots-'+ap),slots=Number(el?.value||0);if(!confirm(ap+' を '+slots+'枠で当選にしますか？'))return;try{await api('/admin/lottery-winner',{method:'POST',headers:H(),body:JSON.stringify({ap,slots})});await loadLottery();alert('当選設定を保存しました。')}catch(e){alert(e.message)}}\n`;
 page=page.replace('</script>',extra+'</script>');
 return page;
}
