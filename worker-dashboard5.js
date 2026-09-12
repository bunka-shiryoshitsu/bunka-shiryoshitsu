import app from "./worker-dashboard4.js";
export { RegistrationIssuer } from "./worker-dashboard4.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Development-only linkage diagnostic. It returns booleans only and never exposes
    // the overview text, admin key, receive key, IP, or any other application detail.
    if (request.method === "GET" && url.pathname === "/_dev/lottery-link-check") {
      const ap = String(url.searchParams.get("ap") || "").trim().toUpperCase();
      if (!/^AP-[A-Z0-9]{8}$/.test(ap)) {
        return json({ success: false, message: "invalid ap" }, 400);
      }
      const raw = await env.REGISTRATION_KV.get("APPLICATION_" + ap);
      let stored = false;
      let overviewPresent = false;
      if (raw) {
        stored = true;
        try {
          const d = JSON.parse(raw);
          overviewPresent = Boolean(String(d?.overview || "").trim());
        } catch {}
      }

      let listedInAdmin = false;
      let adminApiOk = false;
      if (env.ADMIN_KEY) {
        const internal = new Request(new URL("/admin/lottery-data", request.url), {
          method: "GET",
          headers: { "X-Admin-Key": env.ADMIN_KEY }
        });
        const r = await app.fetch(internal, env, ctx);
        adminApiOk = r.ok;
        if (r.ok) {
          try {
            const d = await r.json();
            listedInAdmin = Array.isArray(d?.applications) && d.applications.some(x => String(x?.ap || "").toUpperCase() === ap);
          } catch {}
        }
      }

      return json({
        success: stored && overviewPresent && adminApiOk && listedInAdmin,
        stored,
        overviewPresent,
        adminApiOk,
        listedInAdmin
      }, stored && adminApiOk && listedInAdmin ? 200 : 500);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Access-Control-Allow-Origin": ORIGIN,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
