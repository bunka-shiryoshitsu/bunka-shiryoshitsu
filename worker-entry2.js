import app from "./worker-entry.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/admin/cancel") {
      return cancelRegistrationConsistently(request, env);
    }

    if (request.method === "POST" && path === "/check-application") {
      const response = await app.fetch(request, env, ctx);
      return normalizeCancelledApplicationResponse(response);
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

function calculateStatus(items) {
  if (!Array.isArray(items) || !items.length) return "under_review";

  const active = items.filter(item => item.registrationStatus !== "cancelled");

  if (!active.length) return "cancelled";

  const allRegistered = active.every(item => item.registrationStatus === "registered");
  if (allRegistered) {
    const allIssued = active.every(item => item.issuedDataReady === true);
    return allIssued ? "registered" : "document_preparing";
  }

  if (active.every(item => item.reviewResult === "rejected")) {
    return "rejected";
  }

  if (active.some(item => item.reviewResult === "additional_check")) {
    return "additional_check";
  }

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
  if (!isAdmin(request, env)) {
    return json({ success: false, message: "Unauthorized." }, 401);
  }

  try {
    const body = await request.json();
    const number = normalizeRegistrationNumber(body.registrationNumber);

    if (!number) {
      return json({
        success: false,
        message: "登録番号が正しくありません。"
      }, 400);
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
      return json({
        success: false,
        message: "登録番号が見つかりません。"
      }, 404);
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
        } catch {
          // Registration cancellation itself remains valid even if an old application record is malformed.
        }
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
    return json({
      success: false,
      message: "登録取消に失敗しました。"
    }, 500);
  }
}

async function normalizeCancelledApplicationResponse(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  if (data?.status !== "cancelled") return response;

  data.message = "この登録は取消状態です。";

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: response.headers
  });
}
