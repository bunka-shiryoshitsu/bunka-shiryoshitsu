import app from "./worker-entry5.js";

const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/admin/review") {
      let body = null;
      try { body = await request.clone().json(); } catch {}

      if (APPROVED_RESULTS.has(String(body?.result || "")) && env.REGISTRATION_ISSUER) {
        const id = env.REGISTRATION_ISSUER.idFromName("registration-number-issuer");
        const stub = env.REGISTRATION_ISSUER.get(id);
        return stub.fetch(request);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

export class RegistrationIssuer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.tail = Promise.resolve();
  }

  fetch(request) {
    const run = this.tail.then(() => this.handle(request));
    this.tail = run.catch(() => {});
    return run;
  }

  async handle(request) {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/admin/review") {
      return new Response(JSON.stringify({ success: false, message: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" }
      });
    }

    return app.fetch(request, this.env, { waitUntil() {} });
  }
}
