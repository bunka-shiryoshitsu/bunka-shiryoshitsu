import core from "./worker.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";
const AP_CHARS = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
const APPLICATIONS_OPEN_DEFAULT = false;
const ORPHAN_IMAGE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const ISSUE_LOCK_TTL = 60;
const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if ((request.method === "GET" || request.method === "POST") && path === "/check") {
      // REGISTRATION_LIST* は管理者自身がカード発行に使う予約番号として保持する。
      // 公開照会では、従来どおり予約番号も「登録あり」として扱う。
      return core.fetch(request, env, ctx);
    }

    if (request.method === "POST" && path === "/lottery-apply") {
      return lotteryApply(request, env);
    }

    if (request.method === "POST" && path === "/image-upload") {
      if (!await applicationsOpen(env)) {
        return json({
          success: false,
          error: "現在、新規登録申請は休止しております。"
        }, 503);
      }
      return core.fetch(request, env, ctx);
    }

    if (request.method === "POST" && path === "/registration-submit") {
      if (!await applicationsOpen(env)) {
        return json({
          success: false,
          message: "現在、新規登録申請は休止しております。"
        }, 503);
      }
      return core.fetch(request, env, ctx);
    }

    if (request.method === "POST" && path === "/admin-winners/save") {
      const blocked = await duplicateExcludedWinner(request, env);
      if (blocked) return blocked;
      return core.fetch(request, env, ctx);
    }

    if (request.method === "POST" && path === "/admin/review") {
      return guardedReview(request, env, ctx);
    }

    return core.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupOrphanImages(env));
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key"
  };
}

function text(value, status = 200) {
  return new Response(value, {
    status,
    headers: {
      ...cors(),
      "Content-Type": "text/plain; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
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

function normalizeAP(value) {
  const v = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248))
    .replace(/\s/g, "");

  if (!/^AP-[A-Z0-9]{8}$/.test(v)) return null;
  if (![...v.slice(3)].every(c => AP_CHARS.includes(c))) return null;
  return v;
}

function normalizeRegistrationNumber(value) {
  const number = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(number) ? number : null;
}

function japanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function generateAP() {
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += AP_CHARS[Math.floor(Math.random() * AP_CHARS.length)];
  }
  return "AP-" + result;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function rateLimited(request, env, prefix) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hash = await sha256(ip);
  const keys = [
    `RATE_${prefix}_M_${hash}`,
    `RATE_${prefix}_H_${hash}`,
    `RATE_${prefix}_D_${hash}`
  ];
  const limits = [10, 100, 500];
  const ttl = [60, 3600, 86400];

  for (let i = 0; i < keys.length; i++) {
    const count = Number(await env.REGISTRATION_KV.get(keys[i])) || 0;
    if (count >= limits[i]) return true;
    await env.REGISTRATION_KV.put(keys[i], String(count + 1), { expirationTtl: ttl[i] });
  }
  return false;
}

async function applicationsOpen(env) {
  const value = await env.REGISTRATION_KV.get("SYSTEM:APPLICATIONS_OPEN");
  if (value === null) return APPLICATIONS_OPEN_DEFAULT;
  return String(value).trim().toLowerCase() === "true";
}

async function registrationExists(env, number) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) return false;

  const keys = [
    normalized,
    "REGISTRATION:" + normalized,
    "REGISTRATION_" + normalized,
    "REGISTRATION-" + normalized
  ];

  for (const key of keys) {
    const value = await env.REGISTRATION_KV.get(key);
    if (!value) continue;

    try {
      const data = JSON.parse(value);
      if (data && data.status === "cancelled") continue;
    } catch {
      // A non-JSON direct registration key still represents an issued registration.
    }
    return true;
  }
  return false;
}

async function checkRegistration(request, env) {
  if (await rateLimited(request, env, "REGISTRATION")) {
    return text("しばらく時間をおいてから、もう一度お試しください。", 429);
  }

  let number = "";
  if (request.method === "GET") {
    number = new URL(request.url).searchParams.get("number") || "";
  } else {
    try {
      const body = await request.json();
      number = body.number || "";
    } catch {
      number = "";
    }
  }

  number = String(number).trim().toUpperCase();
  const registered = await registrationExists(env, number);

  if (request.method === "POST") {
    return text(registered ? "登録あり" : "登録なし");
  }

  return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登録番号確認</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:40px"><h1>登録番号確認</h1><p style="font-size:28px;font-weight:bold">${registered ? "登録済み" : "登録されていません"}</p></body></html>`, {
    headers: { ...cors(), "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" }
  });
}

async function lotteryApply(request, env) {
  if (await rateLimited(request, env, "LOTTERY")) {
    return json({
      success: false,
      message: "しばらく時間をおいてから、もう一度お試しください。"
    }, 429);
  }

  try {
    const today = japanDate();
    const month = today.slice(0, 7);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await sha256(ip);
    const dailyKey = `LOTTERY_IP_D_${month}_${today}_${ipHash}`;
    const firstApplication = await env.REGISTRATION_KV.get(dailyKey);
    const eligible = !firstApplication;

    let applicationNumber = null;
    for (let i = 0; i < 20; i++) {
      const candidate = generateAP();
      if (!await env.REGISTRATION_KV.get("APPLICATION_" + candidate)) {
        applicationNumber = candidate;
        break;
      }
    }

    if (!applicationNumber) {
      return json({ success: false, message: "申込み番号の発行に失敗しました。" }, 500);
    }

    await env.REGISTRATION_KV.put(
      "APPLICATION_" + applicationNumber,
      JSON.stringify({
        ap: applicationNumber,
        applicationMonth: month,
        appliedDate: today,
        appliedAt: new Date().toISOString(),
        status: eligible ? "received" : "excluded_duplicate",
        lotteryEligible: eligible
      })
    );

    if (eligible) {
      await env.REGISTRATION_KV.put(dailyKey, applicationNumber, { expirationTtl: 172800 });
    }

    return json({
      success: true,
      ap: applicationNumber,
      applicationMonth: month,
      message: "抽選申込みを受け付けました。"
    });
  } catch {
    return json({ success: false, message: "抽選申込みの受付に失敗しました。" }, 500);
  }
}

async function duplicateExcludedWinner(request, env) {
  try {
    const copy = request.clone();
    const body = await copy.json();
    const ap = normalizeAP(body.ap);
    if (!ap) return null;

    const value = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
    if (!value) return null;

    const data = JSON.parse(value);
    if (data?.lotteryEligible === false) {
      return json({
        success: false,
        message: "このAP番号は抽選対象外です。"
      }, 409);
    }
  } catch {
    // Let the original handler validate malformed requests.
  }
  return null;
}

async function acquireIssueLock(env) {
  const key = "SYSTEM:REGISTRATION_ISSUE_LOCK";
  const existing = await env.REGISTRATION_KV.get(key);
  if (existing) return null;

  const token = crypto.randomUUID();
  await env.REGISTRATION_KV.put(key, token, { expirationTtl: ISSUE_LOCK_TTL });
  const confirmed = await env.REGISTRATION_KV.get(key);
  return confirmed === token ? { key, token } : null;
}

async function guardedReview(request, env, ctx) {
  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    return core.fetch(request, env, ctx);
  }

  const result = String(body?.result || "");
  const ap = normalizeAP(body?.ap);
  const item = String(body?.item || "");

  if (result === "rejected") {
    const response = await core.fetch(request, env, ctx);
    if (response.ok && ap && /^(0[1-9]|10)$/.test(item)) {
      await deleteApplicationItemImages(env, ap, item);
    }
    return response;
  }

  if (!APPROVED_RESULTS.has(result)) {
    return core.fetch(request, env, ctx);
  }

  const lock = await acquireIssueLock(env);
  if (!lock) {
    return json({
      success: false,
      message: "別の登録番号発行処理を実行中です。少し待ってからもう一度お試しください。"
    }, 409);
  }

  try {
    return await core.fetch(request, env, ctx);
  } finally {
    const current = await env.REGISTRATION_KV.get(lock.key);
    if (current === lock.token) {
      await env.REGISTRATION_KV.delete(lock.key);
    }
  }
}

async function deleteApplicationItemImages(env, ap, item) {
  for (let i = 1; i <= 20; i++) {
    const image = String(i).padStart(2, "0");
    await env.REGISTRATION_KV.delete(`IMAGE:${ap}:${item}:${image}`);
    await env.REGISTRATION_KV.delete(`IMAGE_META:${ap}:${item}:${image}`);
  }
}

async function cleanupOrphanImages(env) {
  let cursor;
  let checked = 0;
  const now = Date.now();

  do {
    const result = await env.REGISTRATION_KV.list({
      prefix: "IMAGE_META:",
      limit: 500,
      cursor
    });

    for (const entry of result.keys) {
      checked++;
      const metaValue = await env.REGISTRATION_KV.get(entry.name);
      if (!metaValue) continue;

      let meta;
      try {
        meta = JSON.parse(metaValue);
      } catch {
        continue;
      }

      const ap = normalizeAP(meta.ap);
      const item = String(meta.item || "");
      const image = String(meta.image || "");
      const uploadedAt = Date.parse(meta.uploadedAt || "");

      if (!ap || !/^(0[1-9]|10)$/.test(item) || !/^(0[1-9]|1[0-9]|20)$/.test(image) || !Number.isFinite(uploadedAt)) {
        continue;
      }

      if (now - uploadedAt < ORPHAN_IMAGE_MAX_AGE_MS) continue;

      const application = await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:" + ap);
      if (application) continue;

      await env.REGISTRATION_KV.delete(`IMAGE:${ap}:${item}:${image}`);
      await env.REGISTRATION_KV.delete(entry.name);
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor && checked < 5000);
}