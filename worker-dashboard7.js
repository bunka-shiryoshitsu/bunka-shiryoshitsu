import app from "./worker-dashboard6.js";
export { RegistrationIssuer } from "./worker-dashboard6.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Administrator override: duplicate-IP applications remain internally flagged,
    // but the administrator may deliberately award them after reviewing the overview.
    if (request.method === "POST" && path === "/admin/lottery-winner") {
      if (!isAdmin(request, env)) return json({ success:false, message:"Unauthorized." }, 401);
      let body;
      try { body = await request.json(); }
      catch { return json({ success:false, message:"入力内容が正しくありません。" }, 400); }
      const ap = normalizeAP(body?.ap);
      const slots = Number(body?.slots);
      if (!ap || !Number.isInteger(slots) || slots < 1 || slots > 10) {
        return json({ success:false, message:"AP番号または当選枠数が正しくありません。" }, 400);
      }
      const raw = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
      if (!raw) return json({ success:false, message:"抽選申込が見つかりません。" }, 404);
      let rec;
      try { rec = JSON.parse(raw); }
      catch { return json({ success:false, message:"抽選申込データを読み取れません。" }, 500); }
      const month = String(rec.applicationMonth || rec.appliedDate || "").slice(0,7);
      const internal = new Request(new URL("/admin-winners/save", request.url), {
        method:"POST",
        headers:{"Content-Type":"application/json","X-Admin-Key":request.headers.get("X-Admin-Key") || ""},
        body:JSON.stringify({ap, slots, applicationMonth:month, manualOverride:true})
      });
      return app.fetch(internal, env, ctx);
    }

    if (request.method === "GET" && path === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();
      // Duplicate-IP applications stay visibly flagged but retain the winner controls.
      page = page.replace(
        "(x.lotteryEligible?'<span class=\"pill warn\">未設定</span>':'<span class=\"pill bad\">内部対象外</span>')",
        "(x.lotteryEligible?'<span class=\"pill warn\">未設定</span>':'<span class=\"pill bad\">同一IP・同日重複（手動当選可）</span>')"
      );
      page = page.replace(
        "(x.lotteryEligible?'<button class=\"good\" onclick=\"setLotteryWinner(\\\\''+esc(x.ap)+'\\\\')\">当選設定</button>':'–')",
        "('<button class=\"good\" onclick=\"setLotteryWinner(\\\\''+esc(x.ap)+'\\\\')\">当選設定</button>')"
      );
      return html(page);
    }

    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function isAdmin(request, env){return Boolean(env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY)}
function normalizeAP(v){const ap=String(v??"").trim().toUpperCase();return /^AP-[A-Z0-9]{8}$/.test(ap)?ap:null}
function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"}}
function json(v,s=200){return new Response(JSON.stringify(v),{status:s,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}})}
function html(v,s=200){return new Response(v,{status:s,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}})}
