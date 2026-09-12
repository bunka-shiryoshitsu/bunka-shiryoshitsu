import app from "./worker-entry6.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/_dev/integration-test") {
      return runIntegrationTest(request);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

class MemoryKV {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }

  async get(key, options) {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key);
    if (options && options.type === "arrayBuffer") {
      if (value instanceof ArrayBuffer) return value.slice(0);
      if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      if (typeof value === "string") return new TextEncoder().encode(value).buffer;
    }
    return value;
  }

  async put(key, value) {
    if (value instanceof ArrayBuffer) {
      this.map.set(key, value.slice(0));
      return;
    }
    if (ArrayBuffer.isView(value)) {
      this.map.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      return;
    }
    this.map.set(key, String(value));
  }

  async delete(key) {
    this.map.delete(key);
  }

  async list(options = {}) {
    const prefix = String(options.prefix || "");
    const limit = Number(options.limit || 1000);
    const keys = [...this.map.keys()]
      .filter(name => name.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map(name => ({ name }));
    return { keys, list_complete: true, cursor: "" };
  }
}

async function runIntegrationTest(request) {
  const origin = new URL(request.url).origin;
  const kv = new MemoryKV({
    "SYSTEM:APPLICATIONS_OPEN": "true",
    "REGISTRATION_LIST": JSON.stringify(["TST00001", "TST00002", "TST00003"])
  });
  const env = {
    REGISTRATION_KV: kv,
    ADMIN_KEY: "DEV-INTEGRATION-ONLY"
  };
  const ctx = { waitUntil() {} };
  const adminHeaders = { "X-Admin-Key": env.ADMIN_KEY };
  const checks = [];

  const step = async (name, fn, verify = r => r.ok) => {
    try {
      const response = await fn();
      const body = await readResponse(response);
      const ok = Boolean(verify(response, body));
      checks.push({ name, ok, status: response.status, summary: summarize(body) });
      if (!ok) throw new Error(name + " failed: HTTP " + response.status + " " + summarize(body));
      return { response, body };
    } catch (error) {
      checks.push({ name, ok: false, status: 0, summary: String(error?.message || error) });
      throw error;
    }
  };

  try {
    const lottery = await step("抽選申込・AP/受取キー発行", () => app.fetch(new Request(origin + "/lottery-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.10" },
      body: JSON.stringify({})
    }), env, ctx), (r, b) => r.ok && b?.success === true && /^AP-[A-Z0-9]{8}$/.test(b?.ap || "") && typeof b?.receiveKey === "string");

    const ap = lottery.body.ap;
    const receiveKey = lottery.body.receiveKey;
    const month = lottery.body.applicationMonth;

    await step("同一IP二重申込は外形上受付", () => app.fetch(new Request(origin + "/lottery-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.10" },
      body: JSON.stringify({})
    }), env, ctx), (r, b) => r.ok && b?.success === true && /^AP-[A-Z0-9]{8}$/.test(b?.ap || ""));

    await step("当選設定", () => app.fetch(new Request(origin + "/admin-winners/save", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ap, slots: 1, applicationMonth: month })
    }), env, ctx), (r, b) => r.ok && b?.success === true);

    await step("当選確認", () => app.fetch(new Request(origin + "/check-application", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.11" },
      body: JSON.stringify({ ap })
    }), env, ctx), (r, b) => r.ok && b?.winner === true);

    const imageForm = new FormData();
    imageForm.append("image", new Blob([new Uint8Array([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0xff,0xd9])], { type: "image/jpeg" }), "test.jpg");
    await step("申請画像アップロード", () => app.fetch(new Request(origin + "/image-upload?ap=" + encodeURIComponent(ap) + "&item=01&image=01", {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.12" },
      body: imageForm
    }), env, ctx), (r, b) => r.ok && b?.success === true);

    await step("登録申請送信", () => app.fetch(new Request(origin + "/registration-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.13" },
      body: JSON.stringify({ ap, items: [{ item: "01", name: "統合試験資料", relatedName: "試験関連名", acquisition: "統合試験用データ" }] })
    }), env, ctx), (r, b) => r.ok && b?.success === true);

    await step("二重送信拒否", () => app.fetch(new Request(origin + "/registration-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.14" },
      body: JSON.stringify({ ap, items: [{ item: "01", name: "統合試験資料", relatedName: "試験関連名", acquisition: "統合試験用データ" }] })
    }), env, ctx), (r) => r.status === 409);

    await step("管理・申請一覧", () => app.fetch(new Request(origin + "/admin/applications", { headers: adminHeaders }), env, ctx), (r, b) => r.ok && Array.isArray(b?.applications) && b.applications.length === 1);

    await step("管理・個別申請", () => app.fetch(new Request(origin + "/admin/application?ap=" + encodeURIComponent(ap), { headers: adminHeaders }), env, ctx), (r, b) => r.ok && b?.application?.ap === ap);

    await step("登録書用名称保存", () => app.fetch(new Request(origin + "/admin/registration-text", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ap, item: "01", finalName: "統合試験資料・確定", finalRelatedName: "試験関連名・確定" })
    }), env, ctx), (r, b) => r.ok && b?.success === true);

    const review = await step("審査承認・登録番号発行", () => app.fetch(new Request(origin + "/admin/review", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ap, item: "01", result: "type1", finalName: "統合試験資料・確定", finalRelatedName: "試験関連名・確定" })
    }), env, ctx), (r, b) => r.ok && b?.success === true && /^[A-Z0-9]{8}$/.test(b?.registrationNumber || ""));

    const number = review.body.registrationNumber;

    await step("二重承認拒否", () => app.fetch(new Request(origin + "/admin/review", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ap, item: "01", result: "type1" })
    }), env, ctx), r => r.status === 409);

    await step("公開登録番号照会・登録あり", () => app.fetch(new Request(origin + "/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.15" },
      body: JSON.stringify({ number })
    }), env, ctx), (r, b) => r.ok && b === "登録あり");

    await step("受取・準備中", () => app.fetch(new Request(origin + "/receive-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ap, receiveKey })
    }), env, ctx), (r, b) => r.ok && b?.success === true && Array.isArray(b?.items) && b.items.some(x => x.registrationNumber === number && x.ready === false));

    await step("誤受取キー拒否", () => app.fetch(new Request(origin + "/receive-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ap, receiveKey: "AAAA-BBBB-CCCC-DDDD" })
    }), env, ctx), r => r.status === 401);

    const issuedForm = new FormData();
    issuedForm.append("registrationNumber", number);
    issuedForm.append("file", new Blob([new Uint8Array([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00,0xff,0xd9])], { type: "image/jpeg" }), number + ".jpg");
    await step("登録書JPG登録", () => app.fetch(new Request(origin + "/admin/issued-data-upload", {
      method: "POST",
      headers: adminHeaders,
      body: issuedForm
    }), env, ctx), (r, b) => r.ok && b?.success === true && b?.ready === true);

    await step("受取・準備完了", () => app.fetch(new Request(origin + "/receive-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ap, receiveKey })
    }), env, ctx), (r, b) => r.ok && b?.items?.some(x => x.registrationNumber === number && x.ready === true));

    await step("本人だけ登録書JPG受取", () => app.fetch(new Request(origin + "/receive-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ap, receiveKey, registrationNumber: number })
    }), env, ctx), r => r.ok && (r.headers.get("Content-Type") || "").includes("image/jpeg"));

    await step("登録取消", () => app.fetch(new Request(origin + "/admin/cancel", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ registrationNumber: number })
    }), env, ctx), (r, b) => r.ok && b?.success === true);

    await step("取消後公開照会・登録なし", () => app.fetch(new Request(origin + "/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.16" },
      body: JSON.stringify({ number })
    }), env, ctx), (r, b) => r.ok && b === "登録なし");

    await step("取消後登録書受取拒否", () => app.fetch(new Request(origin + "/receive-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ap, receiveKey, registrationNumber: number })
    }), env, ctx), r => r.status === 404 || r.status === 409);

    return json({
      success: checks.every(x => x.ok),
      isolated: true,
      productionDataTouched: false,
      message: "隔離メモリ上の統合試験が完了しました。実データは変更していません。",
      passed: checks.filter(x => x.ok).length,
      total: checks.length,
      checks
    }, checks.every(x => x.ok) ? 200 : 500);
  } catch (error) {
    return json({
      success: false,
      isolated: true,
      productionDataTouched: false,
      message: "隔離メモリ上の統合試験で異常を検出しました。",
      error: String(error?.message || error),
      passed: checks.filter(x => x.ok).length,
      total: checks.length,
      checks
    }, 500);
  }
}

async function readResponse(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    try { return await response.clone().json(); } catch { return null; }
  }
  if (contentType.includes("image/")) return "[image]";
  try { return await response.clone().text(); } catch { return null; }
}

function summarize(body) {
  if (typeof body === "string") return body.length > 120 ? body.slice(0, 120) : body;
  if (!body || typeof body !== "object") return "応答あり";
  if (body.message) return String(body.message);
  if (body.error) return String(body.error);
  if (body.success === true) return "成功";
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
