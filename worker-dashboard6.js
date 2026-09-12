import app from "./worker-dashboard4.js";
export { RegistrationIssuer } from "./worker-dashboard4.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Make lottery applications part of the same admin payload as the rest of the dashboard.
    // This removes the fragile second request that previously left the lottery tab empty.
    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let data;
      try { data = await response.json(); }
      catch { return response; }

      const lotteryApplications = await readLotteryApplications(env);
      data.lotteryApplications = lotteryApplications;
      if (data.summary && typeof data.summary === "object") {
        data.summary.lotteryApplications = lotteryApplications.length;
      }
      return json(data);
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();

      // Use the already-loaded dashboard payload for the lottery tab. This guarantees
      // the same refresh/login action that fills the other tabs also fills lottery data.
      page = page.replace(
        "DATA=d;renderAll();$('#syncText').textContent='最終同期 '",
        "DATA=d;LOTTERY=Array.isArray(d.lotteryApplications)?d.lotteryApplications:[];renderAll();renderLottery();$('#syncText').textContent='最終同期 '"
      );

      // Avoid a second fetch when switching to the lottery tab. It is still safe if an
      // older page calls loadLottery(), because /admin/lottery-data remains available.
      page = page.replace(";if(v==='lottery')loadLottery() ", ";if(v==='lottery')renderLottery() ");

      return html(page);
    }

    // Temporary verification endpoint used only to prove the public submission is visible
    // through the admin dataset. It returns booleans only, no application text or secrets.
    if (request.method === "GET" && url.pathname === "/_dev/lottery-link-check") {
      const ap = String(url.searchParams.get("ap") || "").trim().toUpperCase();
      if (!/^AP-[A-Z0-9]{8}$/.test(ap)) return json({ success:false, message:"invalid ap" }, 400);

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

      const list = await readLotteryApplications(env);
      const listedInAdminDataset = list.some(x => String(x.ap || "").toUpperCase() === ap);
      return json({
        success: stored && listedInAdminDataset,
        stored,
        overviewPresent,
        listedInAdminDataset
      }, stored && listedInAdminDataset ? 200 : 500);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

async function listAll(env, prefix, max = 10000) {
  const out = [];
  let cursor;
  do {
    const r = await env.REGISTRATION_KV.list({ prefix, limit: 1000, cursor });
    out.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor && out.length < max);
  return out;
}

async function readLotteryApplications(env) {
  const keys = await listAll(env, "APPLICATION_");
  const applications = [];
  for (const k of keys) {
    if (!/^APPLICATION_AP-[A-Z0-9]{8}$/.test(k.name)) continue;
    const raw = await env.REGISTRATION_KV.get(k.name);
    if (!raw) continue;
    try {
      const d = JSON.parse(raw);
      const ap = String(d.ap || k.name.slice("APPLICATION_".length)).trim().toUpperCase();
      if (!/^AP-[A-Z0-9]{8}$/.test(ap)) continue;

      let winner = null;
      const w = await env.REGISTRATION_KV.get("WINNER_" + ap);
      if (w) {
        try { winner = JSON.parse(w); } catch {}
      }

      applications.push({
        ap,
        overview: String(d.overview || ""),
        appliedAt: d.appliedAt || "",
        appliedDate: d.appliedDate || "",
        applicationMonth: d.applicationMonth || "",
        lotteryEligible: d.lotteryEligible !== false,
        status: d.status || "received",
        winner: winner ? {
          slots: Number(winner.slots) || 0,
          expiryDate: winner.expiryDate || ""
        } : null
      });
    } catch {}
  }
  applications.sort((a,b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
  return applications;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key"
  };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors(), "Content-Type":"application/json; charset=UTF-8", "Cache-Control":"no-store" }
  });
}
function html(value, status = 200) {
  return new Response(value, {
    status,
    headers: { ...cors(), "Content-Type":"text/html; charset=UTF-8", "Cache-Control":"no-store" }
  });
}
