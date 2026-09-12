import app from "./worker-entry8.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_dev/integration-test-view") {
      const inner = new Request(new URL("/_dev/integration-test", url.origin), { method: "GET" });
      const response = await app.fetch(inner, env, ctx);
      const text = await response.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Integration Test</title></head><body><h1>Integration Test</h1><pre>${escapeHtml(pretty)}</pre></body></html>`, {
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

function escapeHtml(value) {
  return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
