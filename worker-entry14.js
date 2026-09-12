import app from "./worker-entry13.js";

const APPROVED_RESULTS = new Set(["type1", "type2", "type3", "special"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/_dev/issuer-health") {
      if (!env.REGISTRATION_ISSUER) {
        return json({ success: false, message: "REGISTRATION_ISSUER binding is unavailable." }, 500);
      }
      const id = env.REGISTRATION_ISSUER.idFromName("registration-number-issuer");
      const stub = env.REGISTRATION_ISSUER.get(id);
      return stub.fetch(new Request(new URL("/_dev/issuer-health", url.origin), { method: "GET" }));
    }

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
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
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
    if (request.method === "GET" && url.pathname === "/_dev/issuer-health") {
      return json({ success: true, durableObject: true, message: "Registration issuer coordinator is ready." });
    }

    if (request.method !== "POST" || url.pathname !== "/admin/review") {
      return json({ success: false, message: "Not Found" }, 404);
    }

    return app.fetch(request, this.env, { waitUntil() {} });
  }
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
