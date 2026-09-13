import app from "./worker-dashboard10.js";
import {
  readRegistrationNumberLedgers,
  getNextPublicRegistrationNumber,
  markPublicRegistrationNumberIssued,
  checkRegistrationNumberCollision
} from "./registration-number-service.js";
export { RegistrationIssuer } from "./worker-dashboard10.js";

const LIVE_VERIFY_PATH = "/_cutover/f819da5705a7e816404a324eeeff45f414376fce14b9179a";
const LIVE_VERIFY_KEY = "SYSTEM:NUMBERING_PRODUCTION_VERIFIED";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === LIVE_VERIFY_PATH) {
      return runProductionNumberingVerification(env);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

async function runProductionNumberingVerification(env) {
  const previous = await env.REGISTRATION_KV.get(LIVE_VERIFY_KEY);
  if (previous) {
    let record = null;
    try { record = JSON.parse(previous); } catch {}
    return json({ success: false, alreadyCompleted: true, record }, 409);
  }

  const before = await readRegistrationNumberLedgers(env);
  const issuedNumbers = new Set(before.publicIssued.map(x => x.number));
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  const recoverable = before.publicPool
    .filter(x =>
      x &&
      x.status === "reserved" &&
      x.source === "public-random" &&
      x.isTest !== true &&
      !issuedNumbers.has(x.number) &&
      Number.isFinite(Date.parse(x.generatedAt || "")) &&
      Date.parse(x.generatedAt) >= cutoff
    )
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));

  if (recoverable.length > 1) {
    return json({
      success: false,
      message: "Multiple recent reserved numbers exist; verification stopped safely.",
      candidates: recoverable.map(x => ({ number: x.number, generatedAt: x.generatedAt }))
    }, 409);
  }

  let number;
  let recoveredReservation = false;

  if (recoverable.length === 1) {
    number = recoverable[0].number;
    recoveredReservation = true;
  } else {
    number = await getNextPublicRegistrationNumber(env);
    if (!number) return json({ success: false, message: "Random number generation failed." }, 500);
  }

  const ownerBefore = before.owner.filter(x => x.number === number).map(x => x.location);
  if (ownerBefore.length) {
    return json({ success: false, message: "Owner-pool collision detected before issuance.", number, ownerLocations: ownerBefore }, 500);
  }

  const now = new Date().toISOString();
  await markPublicRegistrationNumberIssued(env, number, {
    ap: "AP-SYSTEM-VERIFY",
    item: "00",
    registeredAt: now,
    source: "production-verification",
    isTest: true
  });

  const poolKey = "PUBLIC_REGISTRATION_POOL:" + number;
  const issuedKey = "PUBLIC_REGISTRATION_ISSUED:" + number;
  const poolRaw = await env.REGISTRATION_KV.get(poolKey);
  const issuedRaw = await env.REGISTRATION_KV.get(issuedKey);

  let poolRecord = null;
  let issuedRecord = null;
  try { poolRecord = poolRaw ? JSON.parse(poolRaw) : null; } catch {}
  try { issuedRecord = issuedRaw ? JSON.parse(issuedRaw) : null; } catch {}

  const collision = await checkRegistrationNumberCollision(env, number, {
    allowOwnPublicReservation: true
  });
  const ownerLocations = (collision.locations || []).filter(x => /^REGISTRATION_LIST(?:\d+)?$/.test(String(x)));

  const ok = Boolean(
    poolRecord &&
    issuedRecord &&
    poolRecord.number === number &&
    issuedRecord.number === number &&
    poolRecord.status === "issued" &&
    issuedRecord.status === "issued" &&
    poolRecord.isTest === true &&
    issuedRecord.isTest === true &&
    ownerLocations.length === 0
  );

  const result = {
    success: ok,
    number,
    checkedAt: now,
    recoveredReservation,
    generatedLocation: poolKey,
    issuedLocation: issuedKey,
    generatedStatus: poolRecord?.status || null,
    issuedStatus: issuedRecord?.status || null,
    testMarked: Boolean(poolRecord?.isTest === true && issuedRecord?.isTest === true),
    ownerCollision: ownerLocations.length > 0,
    ownerLocations,
    countsBefore: {
      owner: before.owner.length,
      publicPool: before.publicPool.length,
      publicIssued: before.publicIssued.length
    }
  };

  if (ok) {
    await env.REGISTRATION_KV.put(LIVE_VERIFY_KEY, JSON.stringify(result));
  }
  return json(result, ok ? 200 : 500);
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
