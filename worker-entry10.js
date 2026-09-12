import app from "./worker-entry9.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_dev/integration-test-status") {
      const inner = new Request(new URL("/_dev/integration-test", url.origin), { method: "GET" });
      const response = await app.fetch(inner, env, ctx);
      const text = await response.text();
      let title = "INTEGRATION UNKNOWN";
      let detail = text;
      try {
        const data = JSON.parse(text);
        const failed = Array.isArray(data.checks) ? data.checks.filter(x => !x.ok) : [];
        if (data.success) {
          title = `PASS ${data.passed}/${data.total}`;
        } else if (failed.length) {
          const f = failed[0];
          title = `FAIL ${data.passed}/${data.total} ${f.name} HTTP${f.status} ${f.summary || ""}`.slice(0, 220);
        } else {
          title = `FAIL ${data.passed || 0}/${data.total || 0} ${data.error || data.message || ""}`.slice(0, 220);
        }
        detail = JSON.stringify(data, null, 2);
      } catch {}
      return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(detail)}</pre></body></html>`, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" }
      });
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};
function escapeHtml(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
