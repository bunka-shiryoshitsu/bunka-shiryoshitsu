import app from "./worker-entry.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";
const RECEIVE_KEY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/lottery-apply") {
      return lotteryApplyWithReceiveKey(request, env, ctx);
    }

    if (request.method === "POST" && path === "/check-application") {
      return checkApplicationWithGuidance(request, env, ctx);
    }

    if (request.method === "POST" && path === "/admin/review") {
      return reviewWithFinalRegistryText(request, env, ctx);
    }

    if (request.method === "POST" && path === "/admin/registration-text") {
      return updateFinalRegistryText(request, env);
    }

    if (request.method === "POST" && path === "/admin/receive-key/reset") {
      return resetReceiveKey(request, env);
    }

    if (request.method === "POST" && path === "/admin/cancel") {
      return cancelRegistrationConsistently(request, env);
    }

    if (path === "/receive-status") {
      if (request.method !== "POST") return methodNotAllowed();
      return privateReceiveStatus(request, env);
    }

    if (path === "/receive-file") {
      if (request.method !== "POST") return methodNotAllowed();
      return privateReceiveFile(request, env);
    }

    if (request.method === "GET" && path === "/receive") {
      return privateReceivePage();
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

function text(value, status = 200, contentType = "text/plain; charset=UTF-8") {
  return new Response(value, {
    status,
    headers: {
      ...cors(),
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    }
  });
}

function methodNotAllowed() {
  return json({
    success: false,
    message: "この受取機能は専用画面からご利用ください。"
  }, 405);
}

function normalizeAP(value) {
  const ap = String(value ?? "").trim().toUpperCase();
  return /^AP-[A-Z0-9]{8}$/.test(ap) ? ap : null;
}

function normalizeRegistrationNumber(value) {
  const number = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(number) ? number : null;
}

function isAdmin(request, env) {
  return Boolean(
    env.ADMIN_KEY &&
    request.headers.get("X-Admin-Key") === env.ADMIN_KEY
  );
}

function unauthorized() {
  return json({ success: false, message: "Unauthorized." }, 401);
}

function generateReceiveKey() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += RECEIVE_KEY_CHARS[Math.floor(Math.random() * RECEIVE_KEY_CHARS.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveReceiveKey(env, ap, receiveKey) {
  await env.REGISTRATION_KV.put(
    "RECEIVE_AUTH:" + ap,
    JSON.stringify({
      hash: await sha256(receiveKey),
      createdAt: new Date().toISOString()
    })
  );
}

async function verifyReceiveKey(env, ap, receiveKey) {
  const normalizedAP = normalizeAP(ap);
  const key = String(receiveKey ?? "").trim().toUpperCase();
  if (!normalizedAP || !/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(key)) return false;

  const raw = await env.REGISTRATION_KV.get("RECEIVE_AUTH:" + normalizedAP);
  if (!raw) return false;

  try {
    const saved = JSON.parse(raw);
    return saved?.hash === await sha256(key);
  } catch {
    return false;
  }
}

async function lotteryApplyWithReceiveKey(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  const ap = normalizeAP(data?.ap);
  if (data?.success !== true || !ap) return response;

  const receiveKey = generateReceiveKey();
  await saveReceiveKey(env, ap, receiveKey);

  data.receiveKey = receiveKey;
  data.receiveKeyNotice =
    "受取キーは登録書の受取時に必要です。安全な場所に保存してください。安全上、この画面を離れた後に同じ受取キーを再表示することはできません。";
  data.lotteryNotice =
    "この申込みは抽選制です。当選した場合のみ登録申請に進むことができます。";

  return json(data, response.status);
}

async function checkApplicationWithGuidance(request, env, ctx) {
  let ap = null;
  try {
    const body = await request.clone().json();
    ap = normalizeAP(body?.ap);
  } catch {}

  const response = await app.fetch(request, env, ctx);
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  if (data?.status === "cancelled") {
    data.message = "この登録は取消状態です。";
  }

  if (ap) {
    const winnerRaw = await env.REGISTRATION_KV.get("WINNER_" + ap);
    if (winnerRaw) {
      try {
        const winner = JSON.parse(winnerRaw);
        if (winner?.expiryDate) data.expiryDate = winner.expiryDate;
      } catch {}
    }
  }

  if (data?.status === "active" && data?.winner === true) {
    data.notice =
      "当選しています。表示された申請期限までに登録申請を完了してください。期限を過ぎると、この当選による申請はできません。登録書は審査合格後、抽選申込時に発行されたAP番号と受取キーを使って受け取ります。";
  }

  return json(data, response.status);
}

async function reviewWithFinalRegistryText(request, env, ctx) {
  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    return app.fetch(request, env, ctx);
  }

  const response = await app.fetch(request, env, ctx);
  if (!response.ok || !APPROVED_RESULTS.has(String(body?.result || ""))) {
    return response;
  }

  const ap = normalizeAP(body?.ap);
  const itemNo = String(body?.item || "");
  if (!ap || !/^(0[1-9]|10)$/.test(itemNo)) return response;

  await persistFinalRegistryText(
    env,
    ap,
    itemNo,
    body?.finalName,
    body?.finalRelatedName
  );

  return response;
}

async function persistFinalRegistryText(env, ap, itemNo, requestedFinalName, requestedFinalRelatedName) {
  const applicationKey = "REGISTRATION_APPLICATION:" + ap;
  const applicationRaw = await env.REGISTRATION_KV.get(applicationKey);
  if (!applicationRaw) return;

  let application;
  try {
    application = JSON.parse(applicationRaw);
  } catch {
    return;
  }

  const item = application.items?.find(entry => String(entry.item) === itemNo);
  if (!item) return;

  const submittedName = String(item.submittedName ?? item.name ?? "").trim();
  const submittedRelatedName = String(item.submittedRelatedName ?? item.relatedName ?? "").trim();
  const finalName = String(requestedFinalName ?? "").trim() || String(item.finalName ?? "").trim() || submittedName;
  const finalRelatedName = String(requestedFinalRelatedName ?? "").trim() || String(item.finalRelatedName ?? "").trim() || submittedRelatedName;

  item.submittedName = submittedName;
  item.submittedRelatedName = submittedRelatedName;
  item.finalName = finalName;
  item.finalRelatedName = finalRelatedName;
  item.name = finalName;
  item.relatedName = finalRelatedName;
  item.registryTextUpdatedAt = new Date().toISOString();

  await env.REGISTRATION_KV.put(applicationKey, JSON.stringify(application));

  const number = normalizeRegistrationNumber(item.registrationNumber);
  if (!number) return;

  for (const key of [
    "REGISTRATION:" + number,
    "REGISTRATION_" + number,
    "REGISTRATION-" + number
  ]) {
    const raw = await env.REGISTRATION_KV.get(key);
    if (!raw) continue;

    try {
      const registration = JSON.parse(raw);
      registration.submittedName = submittedName;
      registration.submittedRelatedName = submittedRelatedName;
      registration.finalName = finalName;
      registration.finalRelatedName = finalRelatedName;
      registration.name = finalName;
      registration.relatedName = finalRelatedName;
      registration.registryTextUpdatedAt = item.registryTextUpdatedAt;
      await env.REGISTRATION_KV.put(key, JSON.stringify(registration));
    } catch {}
    break;
  }
}

async function updateFinalRegistryText(request, env) {
  if (!isAdmin(request, env)) return unauthorized();

  try {
    const body = await request.json();
    const ap = normalizeAP(body?.ap);
    const item = String(body?.item || "");
    const finalName = String(body?.finalName ?? "").trim();
    const finalRelatedName = String(body?.finalRelatedName ?? "").trim();

    if (!ap || !/^(0[1-9]|10)$/.test(item) || !finalName) {
      return json({
        success: false,
        message: "AP番号、資料番号、登録書記載用の資料名称を確認してください。"
      }, 400);
    }

    await persistFinalRegistryText(env, ap, item, finalName, finalRelatedName);

    return json({
      success: true,
      ap,
      item,
      finalName,
      finalRelatedName,
      message: "登録書記載用の名称を保存しました。申請時の名称は別項目として保持されています。"
    });
  } catch {
    return json({ success: false, message: "登録書記載用名称の保存に失敗しました。" }, 500);
  }
}

async function resetReceiveKey(request, env) {
  if (!isAdmin(request, env)) return unauthorized();

  try {
    const body = await request.json();
    const ap = normalizeAP(body?.ap);
    if (!ap) {
      return json({ success: false, message: "AP番号が正しくありません。" }, 400);
    }

    const application = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
    const registrationApplication = await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:" + ap);
    if (!application && !registrationApplication) {
      return json({ success: false, message: "AP番号が確認できません。" }, 404);
    }

    const receiveKey = generateReceiveKey();
    await saveReceiveKey(env, ap, receiveKey);

    return json({
      success: true,
      ap,
      receiveKey,
      message: "新しい受取キーを発行しました。旧受取キーは使用できません。"
    });
  } catch {
    return json({ success: false, message: "受取キーの再発行に失敗しました。" }, 500);
  }
}

async function privateReceiveStatus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "入力内容を確認してください。" }, 400);
  }

  const ap = normalizeAP(body?.ap);
  const receiveKey = String(body?.receiveKey ?? "").trim().toUpperCase();

  if (!ap || !await verifyReceiveKey(env, ap, receiveKey)) {
    return json({
      success: false,
      message: "AP番号または受取キーを確認できません。"
    }, 401);
  }

  const applicationRaw = await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:" + ap);
  if (!applicationRaw) {
    return json({
      success: true,
      ap,
      status: "not_submitted",
      items: [],
      message: "このAP番号では、登録申請データをまだ確認できません。"
    });
  }

  let application;
  try {
    application = JSON.parse(applicationRaw);
  } catch {
    return json({ success: false, message: "申請データを確認できません。" }, 500);
  }

  const items = [];
  for (const item of application.items || []) {
    const number = normalizeRegistrationNumber(item.registrationNumber);
    if (!number || item.registrationStatus === "cancelled") continue;

    const ready = Boolean(await env.REGISTRATION_KV.get("ISSUED_DATA_META:" + number));
    items.push({
      item: item.item,
      registrationNumber: number,
      registrationType: item.registrationTypeLabel || "",
      name: item.finalName || item.name || "",
      relatedName: item.finalRelatedName || item.relatedName || "",
      ready
    });
  }

  return json({
    success: true,
    ap,
    status: application.status || "under_review",
    items,
    message: items.some(item => item.ready)
      ? "登録書が完成した資料があります。"
      : "登録書はまだ受取可能な状態ではありません。"
  });
}

async function privateReceiveFile(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return text("入力内容を確認してください。", 400);
  }

  const ap = normalizeAP(body?.ap);
  const receiveKey = String(body?.receiveKey ?? "").trim().toUpperCase();
  const number = normalizeRegistrationNumber(body?.registrationNumber);

  if (!ap || !number || !await verifyReceiveKey(env, ap, receiveKey)) {
    return text("AP番号または受取キーを確認できません。", 401);
  }

  const registration = await getRegistrationRecord(env, number);
  if (!registration || registration.status === "cancelled" || normalizeAP(registration.ap) !== ap) {
    return text("この登録書を受け取る権限を確認できません。", 403);
  }

  const data = await env.REGISTRATION_KV.get("ISSUED_DATA:" + number, { type: "arrayBuffer" });
  if (!data) return text("登録書は準備中です。", 404);

  return new Response(data, {
    status: 200,
    headers: {
      ...cors(),
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${number}.jpg"`,
      "Cache-Control": "no-store, private"
    }
  });
}

async function getRegistrationRecord(env, number) {
  for (const key of [
    "REGISTRATION:" + number,
    "REGISTRATION_" + number,
    "REGISTRATION-" + number
  ]) {
    const raw = await env.REGISTRATION_KV.get(key);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function privateReceivePage() {
  return text(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登録書受け取り</title>
<style>
body{font-family:system-ui,sans-serif;background:#f3f1ec;color:#292929;margin:0;padding:35px 15px}
.box{max-width:680px;margin:auto;background:#fff;border:1px solid #d8d2c4;padding:30px}
h1{font-size:24px}label{display:block;margin-top:18px;font-weight:600}input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;margin-top:6px}button{margin-top:20px;padding:12px 22px;background:#292824;color:#fff;border:0;cursor:pointer}.notice{background:#f6f4ef;border-left:4px solid #9d8a5a;padding:15px;margin:18px 0}.item{border-top:1px solid #ddd;padding:18px 0}.small{font-size:12px;color:#666}
</style>
</head>
<body><div class="box">
<h1>登録書受け取り</h1>
<div class="notice">登録書は申請者専用です。抽選申込時に発行されたAP番号と受取キーの両方が必要です。登録番号だけでは受け取ることはできません。</div>
<label>AP番号<input id="ap" autocomplete="off" placeholder="AP-XXXXXXXX"></label>
<label>受取キー<input id="key" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
<button id="check">登録書を確認</button>
<div id="message"></div><div id="items"></div>
<p class="small">受取キーを紛失した場合、同じキーを再表示することはできません。必要な場合は管理側で新しい受取キーを発行します。</p>
</div>
<script>
const message=document.getElementById('message');
const items=document.getElementById('items');
document.getElementById('check').addEventListener('click',async()=>{
 const ap=document.getElementById('ap').value.trim().toUpperCase();
 const receiveKey=document.getElementById('key').value.trim().toUpperCase();
 message.textContent='確認しています…';items.innerHTML='';
 try{
  const r=await fetch('/receive-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ap,receiveKey})});
  const d=await r.json();
  if(!r.ok){message.textContent=d.message||'確認できませんでした。';return;}
  message.textContent=d.message||'';
  for(const x of d.items||[]){
   const div=document.createElement('div');div.className='item';
   div.innerHTML='<strong>'+escapeHtml(x.name||'登録資料')+'</strong><br>'+escapeHtml(x.registrationType||'')+'<br>登録番号 '+escapeHtml(x.registrationNumber||'');
   if(x.ready){
    const b=document.createElement('button');b.textContent='登録書JPGを受け取る';
    b.addEventListener('click',()=>downloadFile(ap,receiveKey,x.registrationNumber));div.appendChild(document.createElement('br'));div.appendChild(b);
   }
   items.appendChild(div);
  }
 }catch(e){message.textContent='確認できませんでした。';}
});
async function downloadFile(ap,receiveKey,registrationNumber){
 const r=await fetch('/receive-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ap,receiveKey,registrationNumber})});
 if(!r.ok){alert(await r.text());return;}
 const blob=await r.blob();const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=registrationNumber+'.jpg';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
function escapeHtml(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
</script></body></html>`, 200, "text/html; charset=UTF-8");
}

function calculateStatus(items) {
  if (!Array.isArray(items) || !items.length) return "under_review";

  const active = items.filter(item => item.registrationStatus !== "cancelled");
  if (!active.length) return "cancelled";

  const allRegistered = active.every(item => item.registrationStatus === "registered");
  if (allRegistered) {
    const allIssued = active.every(item => item.issuedDataReady === true);
    return allIssued ? "registered" : "document_preparing";
  }

  if (active.every(item => item.reviewResult === "rejected")) return "rejected";
  if (active.some(item => item.reviewResult === "additional_check")) return "additional_check";

  if (active.every(item => [
    "rejected",
    "additional_check",
    "type1",
    "type2",
    "type3",
    "special"
  ].includes(item.reviewResult))) {
    return "partially_reviewed";
  }

  return "under_review";
}

async function cancelRegistrationConsistently(request, env) {
  if (!isAdmin(request, env)) return unauthorized();

  try {
    const body = await request.json();
    const number = normalizeRegistrationNumber(body.registrationNumber);

    if (!number) {
      return json({ success: false, message: "登録番号が正しくありません。" }, 400);
    }

    const candidateKeys = [
      "REGISTRATION:" + number,
      "REGISTRATION_" + number,
      "REGISTRATION-" + number
    ];

    let actualKey = null;
    let raw = null;

    for (const key of candidateKeys) {
      const value = await env.REGISTRATION_KV.get(key);
      if (value) {
        actualKey = key;
        raw = value;
        break;
      }
    }

    if (!raw || !actualKey) {
      return json({ success: false, message: "登録番号が見つかりません。" }, 404);
    }

    const registration = JSON.parse(raw);
    const now = new Date().toISOString();

    registration.status = "cancelled";
    registration.cancelledAt = now;
    registration.issuedData = false;
    registration.issuedDataReady = false;

    await env.REGISTRATION_KV.put(actualKey, JSON.stringify(registration));
    await env.REGISTRATION_KV.delete("ISSUED_DATA:" + number);
    await env.REGISTRATION_KV.delete("ISSUED_DATA_META:" + number);

    const ap = String(registration.ap || "").trim().toUpperCase();
    const itemNo = String(registration.item || "");

    if (ap) {
      const applicationKey = "REGISTRATION_APPLICATION:" + ap;
      const applicationRaw = await env.REGISTRATION_KV.get(applicationKey);

      if (applicationRaw) {
        try {
          const application = JSON.parse(applicationRaw);
          const items = Array.isArray(application.items) ? application.items : [];
          const target = items.find(item =>
            String(item.item) === itemNo ||
            String(item.registrationNumber || "").trim().toUpperCase() === number
          );

          if (target) {
            target.registrationStatus = "cancelled";
            target.cancelledAt = now;
            target.issuedData = false;
            target.issuedDataReady = false;
          }

          if (Array.isArray(application.registrationNumbers)) {
            application.registrationNumbers = application.registrationNumbers.filter(entry =>
              String(entry.registrationNumber || "").trim().toUpperCase() !== number
            );
          }

          application.status = calculateStatus(items);
          application.cancelledAt = now;

          await env.REGISTRATION_KV.put(applicationKey, JSON.stringify(application));
          await env.REGISTRATION_KV.put("APPLICATION_STATUS:" + ap, application.status);
        } catch {}
      }
    }

    await env.REGISTRATION_KV.put(
      `CANCELLATION_LOG:${number}:${Date.now()}`,
      JSON.stringify({
        registrationNumber: number,
        ap: registration.ap || null,
        item: registration.item || null,
        cancelledAt: now
      })
    );

    return json({
      success: true,
      registrationNumber: number,
      message: "登録を取消状態に変更しました。"
    });
  } catch {
    return json({ success: false, message: "登録取消に失敗しました。" }, 500);
  }
}
