import {receiptEndpoint} from "./receipt-access.js";
import app from "./worker-entry.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";
const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/lottery-apply") {
      return lotteryApplyWithAP(request, env, ctx);
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

    if (request.method === "POST" && path === "/admin/cancel") {
      return cancelRegistrationConsistently(request, env);
    }

    if (path === "/receive-status" || path === "/receive-file") return receiptEndpoint(request, env);

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

async function lotteryApplyWithAP(request, env, ctx) {
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

  data.apNotice = "AP番号は他人に教えないでください。紙などに控え、大切に保管してください。";
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
      "当選しています。表示された申請期限までに登録申請を完了してください。期限を過ぎると、この当選による申請はできません。登録書は審査合格後、抽選申込時に発行されたAP番号を使って受け取ります。";
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
