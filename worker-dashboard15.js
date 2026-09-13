import app from "./worker-dashboard14.js";
export { RegistrationIssuer } from "./worker-dashboard14.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/_cutover/")) {
      return new Response("Not Found", {
        status: 404,
        headers: { "Cache-Control": "no-store" }
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
