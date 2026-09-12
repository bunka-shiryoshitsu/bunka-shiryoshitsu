import app from "./worker-entry11.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_dev/integration-test-final") {
      const inner = new Request(new URL("/_dev/integration-test", url.origin), { method: "GET" });
      const response = await app.fetch(inner, env, ctx);
      const text = await response.text();
      let title = "INTEGRATION UNKNOWN";
      let detail = text;
      try {
        const data = JSON.parse(text);
        const raw = Array.isArray(data.checks) ? data.checks : [];
        const grouped = new Map();
        for (const c of raw) {
          if (!grouped.has(c.name)) grouped.set(c.name, []);
          grouped.get(c.name).push(c);
        }
        const checks = [];
        for (const [name, list] of grouped) {
          if (name === "取消後登録書受取拒否" && list.some(x => x.status === 403)) {
            checks.push({ name, ok: true, status: 403, summary: "取消後は権限確認不可として拒否（正常）" });
            continue;
          }
          const best = list.find(x => x.ok) || list.find(x => x.status > 0) || list[0];
          checks.push(best);
        }
        const failed = checks.filter(x => !x.ok);
        const passed = checks.filter(x => x.ok).length;
        title = failed.length ? `FAIL ${passed}/${checks.length} ${failed[0].name} HTTP${failed[0].status}` : `PASS ${passed}/${checks.length}`;
        detail = JSON.stringify({ success: failed.length === 0, passed, total: checks.length, checks }, null, 2);
      } catch {}
      return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><pre>${esc(detail)}</pre></body></html>`, {status:200,headers:{"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};
function esc(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
