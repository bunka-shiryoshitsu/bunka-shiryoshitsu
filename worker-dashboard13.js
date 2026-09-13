import app from "./worker-dashboard12.js";
export { RegistrationIssuer } from "./worker-dashboard12.js";

const STATUS_PATH = "/_cutover/status/8d4363f185249d89cd7bfebe6d903be3d1e679c8ae21bee3";
const KEYS = [
  "SYSTEM:NUMBERING_PRODUCTION_VERIFIED",
  "PUBLIC_REGISTRATION_POOL:J6UD6TVN",
  "PUBLIC_REGISTRATION_ISSUED:J6UD6TVN",
  "PUBLIC_REGISTRATION_POOL:56DGARVB",
  "PUBLIC_REGISTRATION_ISSUED:56DGARVB"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === STATUS_PATH) {
      const out = {};
      for (const key of KEYS) {
        const raw = await env.REGISTRATION_KV.get(key);
        if (!raw) {
          out[key] = null;
          continue;
        }
        let value = raw;
        try { value = JSON.parse(raw); } catch {}
        out[key] = value;
      }
      return new Response(JSON.stringify({ success: true, records: out }), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};
