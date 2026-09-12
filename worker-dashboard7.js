import app from "./worker-dashboard6.js";
export { RegistrationIssuer } from "./worker-dashboard6.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";
const KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
const MAX_RECEIVE_FAILURES = 5;
const RECEIVE_LOCK_SECONDS = 15 * 60;

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

    // New applications receive a short 4-character key. The lower layer may have
    // generated an old-format key first; replace its stored hash immediately.
    if (request.method === "POST" && path === "/lottery-apply") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let data;
      try { data = await response.clone().json(); }
      catch { return response; }
      const ap = normalizeAP(data?.ap);
      if (data?.success !== true || !ap) return response;
      const receiveKey = generateShortKey();
      await saveReceiveKey(env, ap, receiveKey);
      data.receiveKey = receiveKey;
      data.receiveKeyNotice = "受取キーは登録書の受取時に必要です。AP番号と一緒に保存してください。この画面を離れた後に同じ受取キーを再表示することはできません。";
      return json(data, response.status);
    }

    // Admin reset also uses the new short format.
    if (request.method === "POST" && path === "/admin/receive-key/reset") {
      if (!isAdmin(request, env)) return json({success:false,message:"Unauthorized."},401);
      let body;
      try { body = await request.json(); }
      catch { return json({success:false,message:"入力内容を確認してください。"},400); }
      const ap = normalizeAP(body?.ap);
      if (!ap) return json({success:false,message:"AP番号が正しくありません。"},400);
      const a = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
      const r = await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:" + ap);
      if (!a && !r) return json({success:false,message:"AP番号が確認できません。"},404);
      const receiveKey = generateShortKey();
      await saveReceiveKey(env, ap, receiveKey);
      await clearReceiveFailures(env, ap);
      return json({success:true,ap,receiveKey,message:"新しい4文字の受取キーを発行しました。旧受取キーは使用できません。"});
    }

    // Accept the new 4-character key at the two private receipt endpoints.
    // Five consecutive failures lock receipt authentication for 15 minutes.
    if (request.method === "POST" && (path === "/receive-status" || path === "/receive-file")) {
      let body;
      try { body = await request.clone().json(); }
      catch { return app.fetch(request, env, ctx); }
      const ap = normalizeAP(body?.ap);
      const key = String(body?.receiveKey ?? "").trim().toUpperCase();
      if (!ap || !/^[A-Z0-9]{4}$/.test(key)) return app.fetch(request, env, ctx);
      const locked = await receiveLocked(env, ap);
      if (locked) return json({success:false,message:"受取キーの確認回数が上限に達しました。15分後にもう一度お試しください。"},429);
      const ok = await verifyShortKey(env, ap, key);
      if (!ok) {
        await recordReceiveFailure(env, ap);
        return json({success:false,message:"AP番号または受取キーを確認できません。"},401);
      }
      await clearReceiveFailures(env, ap);
      // The lower layer only accepts the legacy key format, so handle the successful
      // short-key request here instead of passing it down.
      if (path === "/receive-status") return shortReceiveStatus(env, ap);
      return shortReceiveFile(env, ap, body?.registrationNumber);
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

    if (request.method === "GET" && path === "/receive") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();
      page = page.replace(/XXXX-XXXX-XXXX-XXXX/g, "XXXX");
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
function normalizeNumber(v){const n=String(v??"").trim().toUpperCase();return /^[A-Z0-9]{8}$/.test(n)?n:null}
function generateShortKey(){let s="";for(let i=0;i<4;i++)s+=KEY_CHARS[Math.floor(Math.random()*KEY_CHARS.length)];return s}
async function sha256(v){const b=new TextEncoder().encode(String(v));const d=await crypto.subtle.digest("SHA-256",b);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function saveReceiveKey(env,ap,key){await env.REGISTRATION_KV.put("RECEIVE_AUTH:"+ap,JSON.stringify({hash:await sha256(key),format:"short4",createdAt:new Date().toISOString()}))}
async function verifyShortKey(env,ap,key){const raw=await env.REGISTRATION_KV.get("RECEIVE_AUTH:"+ap);if(!raw)return false;try{return JSON.parse(raw)?.hash===await sha256(key)}catch{return false}}
function failureKey(ap){return "RECEIVE_FAIL:"+ap}
async function receiveLocked(env,ap){const raw=await env.REGISTRATION_KV.get(failureKey(ap));if(!raw)return false;try{const d=JSON.parse(raw);return Number(d.count)>=MAX_RECEIVE_FAILURES && Date.now()-Number(d.firstAt)<RECEIVE_LOCK_SECONDS*1000}catch{return false}}
async function recordReceiveFailure(env,ap){const k=failureKey(ap),now=Date.now();let d={count:0,firstAt:now};const raw=await env.REGISTRATION_KV.get(k);if(raw)try{const x=JSON.parse(raw);if(now-Number(x.firstAt)<RECEIVE_LOCK_SECONDS*1000)d=x}catch{}d.count=Number(d.count||0)+1;await env.REGISTRATION_KV.put(k,JSON.stringify(d),{expirationTtl:RECEIVE_LOCK_SECONDS})}
async function clearReceiveFailures(env,ap){await env.REGISTRATION_KV.delete(failureKey(ap))}
async function shortReceiveStatus(env,ap){const raw=await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:"+ap);if(!raw)return json({success:true,ap,status:"not_submitted",items:[],message:"このAP番号では、登録申請データをまだ確認できません。"});let a;try{a=JSON.parse(raw)}catch{return json({success:false,message:"申請データを確認できません。"},500)}const items=[];for(const item of a.items||[]){const number=normalizeNumber(item.registrationNumber);if(!number||item.registrationStatus==="cancelled")continue;const ready=Boolean(await env.REGISTRATION_KV.get("ISSUED_DATA_META:"+number));items.push({item:item.item,registrationNumber:number,registrationType:item.registrationTypeLabel||"",name:item.finalName||item.name||"",relatedName:item.finalRelatedName||item.relatedName||"",ready})}return json({success:true,ap,status:a.status||"under_review",items,message:items.some(x=>x.ready)?"登録書が完成した資料があります。":"登録書はまだ受取可能な状態ではありません。"})}
async function getRegistration(env,n){for(const k of ["REGISTRATION:"+n,"REGISTRATION_"+n,"REGISTRATION-"+n]){const raw=await env.REGISTRATION_KV.get(k);if(raw)try{return JSON.parse(raw)}catch{return null}}return null}
async function shortReceiveFile(env,ap,value){const n=normalizeNumber(value);if(!n)return new Response("登録番号を確認してください。",{status:400});const reg=await getRegistration(env,n);if(!reg||reg.status==="cancelled"||normalizeAP(reg.ap)!==ap)return new Response("この登録書を受け取る権限を確認できません。",{status:403});const data=await env.REGISTRATION_KV.get("ISSUED_DATA:"+n,{type:"arrayBuffer"});if(!data)return new Response("登録書は準備中です。",{status:404});return new Response(data,{status:200,headers:{...cors(),"Content-Type":"image/jpeg","Content-Disposition":`attachment; filename="${n}.jpg"`,"Cache-Control":"no-store, private"}})}
function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"}}
function json(v,s=200){return new Response(JSON.stringify(v),{status:s,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}})}
function html(v,s=200){return new Response(v,{status:s,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}})}