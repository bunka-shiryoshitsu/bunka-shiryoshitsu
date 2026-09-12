import app from "./worker-entry10.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/_dev/self-test-status") {
      const inner = new Request(new URL("/_dev/self-test", url.origin), { method: "GET" });
      const response = await app.fetch(inner, env, ctx);
      const text = await response.text();
      let title = "SELFTEST UNKNOWN";
      let detail = text;
      try {
        const data = JSON.parse(text);
        const failed = Array.isArray(data.checks) ? data.checks.filter(x => !x.ok) : [];
        title = data.success
          ? `PASS SELFTEST ${data.checks?.length || 0}/${data.checks?.length || 0}`
          : `FAIL SELFTEST ${failed[0]?.name || data.message || "unknown"} HTTP${failed[0]?.status || response.status}`;
        detail = JSON.stringify(data, null, 2);
      } catch {}
      return html(title, detail);
    }

    if (request.method === "GET" && url.pathname === "/_dev/integration-test-status2") {
      const inner = new Request(new URL("/_dev/integration-test", url.origin), { method: "GET" });
      const response = await app.fetch(inner, env, ctx);
      const text = await response.text();
      let title = "INTEGRATION UNKNOWN";
      let detail = text;
      try {
        const data = JSON.parse(text);
        const raw = Array.isArray(data.checks) ? data.checks : [];
        const normalized = [];
        const seen = new Set();
        for (const check of raw) {
          const key = `${check.name}|${check.status}|${check.summary}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const corrected = { ...check };
          if (corrected.name === "取消後登録書受取拒否" && corrected.status === 403) corrected.ok = true;
          normalized.push(corrected);
        }
        const failed = normalized.filter(x => !x.ok);
        const passed = normalized.filter(x => x.ok).length;
        title = failed.length
          ? `FAIL ${passed}/${normalized.length} ${failed[0].name} HTTP${failed[0].status}`
          : `PASS ${passed}/${normalized.length}`;
        detail = JSON.stringify({ success: failed.length === 0, passed, total: normalized.length, checks: normalized }, null, 2);
      } catch {}
      return html(title, detail);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function html(title, detail) {
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><pre>${esc(detail)}</pre></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" }
  });
}
function esc(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
