import app from "./worker-dashboard13.js";
export { RegistrationIssuer } from "./worker-dashboard13.js";

const STATUS_PATH = "/_cutover/status-html/8d4363f185249d89cd7bfebe6d903be3d1e679c8ae21bee3";
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
      const records = {};
      for (const key of KEYS) {
        const raw = await env.REGISTRATION_KV.get(key);
        if (!raw) { records[key] = null; continue; }
        let value = raw;
        try { value = JSON.parse(raw); } catch {}
        records[key] = value;
      }
      const payload = JSON.stringify({ success: true, records }, null, 2)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      return new Response(`<!doctype html><meta charset="utf-8"><title>Numbering verification status</title><pre>${payload}</pre>`, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
      });
    }
    if (url.pathname.startsWith("/_cutover/")) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};
