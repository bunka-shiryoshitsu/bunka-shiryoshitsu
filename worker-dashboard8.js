import app from "./worker-dashboard7.js";
export { RegistrationIssuer } from "./worker-dashboard7.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Save winner directly here so duplicate-IP applications can be manually approved
    // without being blocked by the lower duplicate guard.
    if (request.method === "POST" && path === "/admin/lottery-winner") {
      if (!isAdmin(request, env)) return json({success:false,message:"Unauthorized."},401);
      let body;
      try { body = await request.json(); }
      catch { return json({success:false,message:"入力内容が正しくありません。"},400); }

      const ap = normalizeAP(body?.ap);
      const slots = Number(body?.slots);
      if (!ap || !Number.isInteger(slots) || slots < 1 || slots > 10) {
        return json({success:false,message:"AP番号または当選枠数が正しくありません。"},400);
      }

      const raw = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
      if (!raw) return json({success:false,message:"抽選申込が見つかりません。"},404);

      let rec;
      try { rec = JSON.parse(raw); }
      catch { return json({success:false,message:"抽選申込データを読み取れません。"},500); }

      const savedAt = new Date();
      const checkStart = japanDate();
      const expiry = new Date(savedAt.getTime() + 60 * 24 * 60 * 60 * 1000);
      const expiryDate = new Intl.DateTimeFormat("en-CA", {
        timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"
      }).format(expiry);
      const month = String(rec.applicationMonth || rec.appliedDate || checkStart).slice(0,7);

      await env.REGISTRATION_KV.put("WINNER_" + ap, JSON.stringify({
        slots,
        applicationMonth: month,
        checkStart,
        expiryDate,
        savedAt: savedAt.toISOString(),
        manualOverride: rec.lotteryEligible === false,
        duplicateIpOverride: rec.lotteryEligible === false
      }));
      await env.REGISTRATION_KV.put("APPLICATION_STATUS:" + ap, "winner");

      return json({
        success:true, ap, slots, applicationMonth:month, checkStart, expiryDate,
        manualOverride: rec.lotteryEligible === false,
        message:"当選情報を保存しました。"
      });
    }

    if (request.method === "GET" && path === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();

      // Replace the whole lottery renderer instead of fragile partial string replacement.
      const start = page.indexOf("function renderLottery(){");
      const end = page.indexOf("\nasync function setLotteryWinner", start);
      if (start >= 0 && end > start) {
        const replacement = `function renderLottery(){
 const box=$('#lotteryTable');if(!box)return;
 if(!LOTTERY.length){box.innerHTML='<div class="detail muted">抽選申込はありません。</div>';return}
 box.innerHTML='<table><thead><tr><th>AP番号</th><th>申込日時</th><th>資料概要</th><th>状態</th><th>当選枠</th><th>操作</th></tr></thead><tbody>'+LOTTERY.map(x=>{
  const flagged=x.lotteryEligible===false;
  const status=x.winner?'<span class="pill good">当選設定済み</span>':(flagged?'<span class="pill bad">同一IP・同日重複（手動当選可）</span>':'<span class="pill warn">未設定</span>');
  const slots=x.winner?esc(x.winner.slots)+'枠':'<select id="slots-'+esc(x.ap)+'">'+[1,2,3,4,5,6,7,8,9,10].map(n=>'<option value="'+n+'">'+n+'枠</option>').join('')+'</select>';
  const action=x.winner?'期限 '+esc(x.winner.expiryDate||'–'):'<button class="good" onclick="setLotteryWinner(\\''+esc(x.ap)+'\\')">当選設定</button>';
  return '<tr><td><strong>'+esc(x.ap)+'</strong></td><td>'+fmt(x.appliedAt)+'</td><td style="min-width:320px;white-space:pre-wrap">'+esc(x.overview||'（旧申込：概要なし）')+'</td><td>'+status+'</td><td>'+slots+'</td><td>'+action+'</td></tr>'
 }).join('')+'</tbody></table>'
}
`;
        page = page.slice(0,start) + replacement + page.slice(end + 1);
      }

      return html(page);
    }

    // Public non-sensitive self-check so deployment can be verified without admin secrets.
    if (request.method === "GET" && path === "/_dev/manual-winner-ui-check") {
      const adminResponse = await app.fetch(new Request(new URL("/admin", request.url), {method:"GET"}), env, ctx);
      const page = await adminResponse.text();
      return json({
        success: page.includes("同一IP・同日重複（手動当選可）") && page.includes("当選設定"),
        duplicateLabelPresent: page.includes("同一IP・同日重複（手動当選可）"),
        winnerButtonPresent: page.includes("当選設定"),
        serverManualWinnerHandler: true
      });
    }

    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function isAdmin(request, env){return Boolean(env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY)}
function normalizeAP(v){const ap=String(v??"").trim().toUpperCase();return /^AP-[A-Z0-9]{8}$/.test(ap)?ap:null}
function japanDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"}}
function json(v,s=200){return new Response(JSON.stringify(v),{status:s,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}})}
function html(v,s=200){return new Response(v,{status:s,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}})}