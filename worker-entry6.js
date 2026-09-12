import app from "./worker-entry5.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 開発中だけ使用する内部自己診断。
    // 管理キー自体は外部へ返さず、サーバー内部でのみ付与して
    // 管理系APIの疎通を確認する。
    if (request.method === "GET" && url.pathname === "/_dev/self-test") {
      return runSelfTest(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

async function runSelfTest(request, env, ctx) {
  const origin = new URL(request.url).origin;
  const checks = [];

  if (!env.ADMIN_KEY) {
    return json({
      success: false,
      developmentSelfTest: true,
      message: "ADMIN_KEY が設定されていません。",
      checks
    }, 500);
  }

  checks.push(await callInternal(
    app,
    new Request(origin + "/admin/system/application-status", {
      method: "GET",
      headers: { "X-Admin-Key": env.ADMIN_KEY }
    }),
    env,
    ctx,
    "管理認証・受付状態API"
  ));

  checks.push(await callInternal(
    app,
    new Request(origin + "/admin/applications", {
      method: "GET",
      headers: { "X-Admin-Key": env.ADMIN_KEY }
    }),
    env,
    ctx,
    "管理認証・申請一覧API"
  ));

  checks.push(await callInternal(
    app,
    new Request(origin + "/system/application-status", {
      method: "GET"
    }),
    env,
    ctx,
    "公開受付状態API"
  ));

  const success = checks.every(x => x.ok);

  return json({
    success,
    developmentSelfTest: true,
    message: success
      ? "開発用自己診断は正常です。管理キーを入力せずに内部疎通を確認できました。"
      : "開発用自己診断で異常を検出しました。",
    checks
  }, success ? 200 : 500);
}

async function callInternal(appModule, request, env, ctx, name) {
  try {
    const response = await appModule.fetch(request, env, ctx);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}

    // 個人情報や申請内容は自己診断結果に返さない。
    return {
      name,
      ok: response.ok,
      status: response.status,
      summary: summarize(name, parsed)
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      summary: String(error?.message || error || "unknown error")
    };
  }
}

function summarize(name, data) {
  if (!data || typeof data !== "object") return "応答あり";
  if (name === "管理認証・受付状態API" || name === "公開受付状態API") {
    return typeof data.applicationsOpen === "boolean"
      ? (data.applicationsOpen ? "受付中" : "受付停止中")
      : "応答あり";
  }
  if (name === "管理認証・申請一覧API") {
    return Array.isArray(data.applications)
      ? `申請一覧取得成功（${data.applications.length}件）`
      : "申請一覧API応答あり";
  }
  return "応答あり";
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
