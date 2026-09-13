import app from "./worker-dashboard11.js";
import {
  readRegistrationNumberLedgers,
  markPublicRegistrationNumberIssued,
  checkRegistrationNumberCollision,
  getNextPublicRegistrationNumber
} from "./registration-number-service.js";
export { RegistrationIssuer } from "./worker-dashboard11.js";

const LIVE_VERIFY_PATH = "/_cutover/f819da5705a7e816404a324eeeff45f414376fce14b9179a";
const LIVE_VERIFY_KEY = "SYSTEM:NUMBERING_PRODUCTION_VERIFIED";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === LIVE_VERIFY_PATH) {
      return finishProductionVerification(env);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

async function finishProductionVerification(env) {
  const previous = await env.REGISTRATION_KV.get(LIVE_VERIFY_KEY);
  if (previous) {
    let record = null;
    try { record = JSON.parse(previous); } catch {}
    return json({ success: false, alreadyCompleted: true, record }, 409);
  }

  const before = await readRegistrationNumberLedgers(env);
  const issuedNumbers = new Set(before.publicIssued.map(x => x.number));
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  let recoverable = before.publicPool
    .filter(x =>
      x &&
      x.status === "reserved" &&
      x.source === "public-random" &&
      x.isTest !== true &&
      !issuedNumbers.has(x.number) &&
      Number.isFinite(Date.parse(x.generatedAt || "")) &&
      Date.parse(x.generatedAt) >= cutoff
    )
    .sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));

  if (recoverable.length > 5) {
    return json({
      success: false,
      message: "Too many recent reserved numbers; verification stopped safely.",
      candidates: recoverable.map(x => ({ number: x.number, generatedAt: x.generatedAt }))
    }, 409);
  }

  if (recoverable.length === 0) {
    const number = await getNextPublicRegistrationNumber(env);
    if (!number) return json({ success: false, message: "Random number generation failed." }, 500);
    const raw = await env.REGISTRATION_KV.get("PUBLIC_REGISTRATION_POOL:" + number);
    let generated = null;
    try { generated = raw ? JSON.parse(raw) : null; } catch {}
    recoverable = [{ number, ...(generated || {}) }];
  }

  const ownerNumbers = new Set(before.owner.map(x => x.number));
  const ownerConflicts = recoverable.filter(x => ownerNumbers.has(x.number));
  if (ownerConflicts.length) {
    return json({
      success: false,
      message: "Owner-pool collision detected before verification issuance.",
      conflicts: ownerConflicts.map(x => x.number)
    }, 500);
  }

  const now = new Date().toISOString();
  const chosen = recoverable[0];
  const extras = recoverable.slice(1);

  for (const extra of extras) {
    const poolKey = "PUBLIC_REGISTRATION_POOL:" + extra.number;
    const raw = await env.REGISTRATION_KV.get(poolKey);
    let record = {};
    try { record = raw ? JSON.parse(raw) || {} : {}; } catch {}
    await env.REGISTRATION_KV.put(poolKey, JSON.stringify({
      ...record,
      number: extra.number,
      status: "test-consumed",
      source: "production-verification-reservation",
      isTest: true,
      consumedAt: now,
      note: "Reserved during production numbering verification; never reuse."
    }));
  }

  await markPublicRegistrationNumberIssued(env, chosen.number, {
    ap: "AP-SYSTEM-VERIFY",
    item: "00",
    registeredAt: now,
    source: "production-verification",
    isTest: true
  });

  const poolKey = "PUBLIC_REGISTRATION_POOL:" + chosen.number;
  const issuedKey = "PUBLIC_REGISTRATION_ISSUED:" + chosen.number;
  const poolRaw = await env.REGISTRATION_KV.get(poolKey);
  const issuedRaw = await env.REGISTRATION_KV.get(issuedKey);
  let poolRecord = null;
  let issuedRecord = null;
  try { poolRecord = poolRaw ? JSON.parse(poolRaw) : null; } catch {}
  try { issuedRecord = issuedRaw ? JSON.parse(issuedRaw) : null; } catch {}

  const chosenCollision = await checkRegistrationNumberCollision(env, chosen.number, { allowOwnPublicReservation: true });
  const chosenOwnerLocations = (chosenCollision.locations || []).filter(x => /^REGISTRATION_LIST(?:\d+)?$/.test(String(x)));

  const extraChecks = [];
  for (const extra of extras) {
    const poolExtraRaw = await env.REGISTRATION_KV.get("PUBLIC_REGISTRATION_POOL:" + extra.number);
    let extraRecord = null;
    try { extraRecord = poolExtraRaw ? JSON.parse(poolExtraRaw) : null; } catch {}
    const collision = await checkRegistrationNumberCollision(env, extra.number, { allowOwnPublicReservation: true });
    const ownerLocations = (collision.locations || []).filter(x => /^REGISTRATION_LIST(?:\d+)?$/.test(String(x)));
    extraChecks.push({
      number: extra.number,
      status: extraRecord?.status || null,
      isTest: extraRecord?.isTest === true,
      ownerCollision: ownerLocations.length > 0
    });
  }

  const ok = Boolean(
    poolRecord &&
    issuedRecord &&
    poolRecord.number === chosen.number &&
    issuedRecord.number === chosen.number &&
    poolRecord.status === "issued" &&
    issuedRecord.status === "issued" &&
    poolRecord.isTest === true &&
    issuedRecord.isTest === true &&
    chosenOwnerLocations.length === 0 &&
    extraChecks.every(x => x.status === "test-consumed" && x.isTest === true && x.ownerCollision === false)
  );

  const result = {
    success: ok,
    issuedVerificationNumber: chosen.number,
    issuedLocation: issuedKey,
    poolLocation: poolKey,
    issuedStatus: issuedRecord?.status || null,
    poolStatus: poolRecord?.status || null,
    testMarked: Boolean(poolRecord?.isTest === true && issuedRecord?.isTest === true),
    ownerCollision: chosenOwnerLocations.length > 0,
    additionalTestConsumed: extraChecks,
    checkedAt: now,
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
