import app from "./worker-entry7.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_dev/integration-test") {
      const response = await app.fetch(request, env, ctx);
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json; charset=UTF-8",
          "Cache-Control": "no-store",
          "X-Integration-Original-Status": String(response.status)
        }
      });
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};
