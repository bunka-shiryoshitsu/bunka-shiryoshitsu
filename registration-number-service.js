const REGISTRATION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
const PUBLIC_POOL_PREFIX = "PUBLIC_REGISTRATION_POOL:";
const PUBLIC_ISSUED_PREFIX = "PUBLIC_REGISTRATION_ISSUED:";

export const REGISTRATION_NUMBER_POLICY = Object.freeze({
  length: 8,
  chars: REGISTRATION_CHARS,
  ownerPoolPrefix: "REGISTRATION_LIST",
  publicPoolPrefix: PUBLIC_POOL_PREFIX,
  publicIssuedPrefix: PUBLIC_ISSUED_PREFIX
});

export async function getNextPublicRegistrationNumber(env) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const number = generateRegistrationNumber();

    // 第1重複チェック：私用プール、一般用生成台帳、一般用発行済み台帳、既存登録を横断確認。
    const first = await checkRegistrationNumberCollision(env, number);
    if (first.duplicate) continue;

    const generatedAt = new Date().toISOString();
    await env.REGISTRATION_KV.put(
      PUBLIC_POOL_PREFIX + number,
      JSON.stringify({
        number,
        status: "reserved",
        generatedAt,
        source: "public-random",
        isTest: false
      })
    );

    // 発行直前の第2重複チェック。自分自身の予約だけは許可する。
    const final = await checkRegistrationNumberCollision(env, number, {
      allowOwnPublicReservation: true
    });

    if (final.duplicate) {
      await env.REGISTRATION_KV.put(
        PUBLIC_POOL_PREFIX + number,
        JSON.stringify({
          number,
          status: "collision",
          generatedAt,
          collisionCheckedAt: new Date().toISOString(),
          collisionLocations: final.locations,
          source: "public-random",
          isTest: false
        })
      );
      continue;
    }

    return number;
  }

  return null;
}

export async function markPublicRegistrationNumberIssued(env, number, metadata = {}) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) throw new Error("Invalid registration number");

  // 実際の発行記録が作られた後に、私用プールとの衝突がないことを最終確認する。
  const ownerCollision = await findInOwnerPool(env, normalized);
  if (ownerCollision.length) {
    throw new Error("Registration number collided with owner pool before issuance ledger update");
  }

  const issuedAt = metadata.registeredAt || new Date().toISOString();
  const poolKey = PUBLIC_POOL_PREFIX + normalized;
  const issuedKey = PUBLIC_ISSUED_PREFIX + normalized;

  let generated = {};
  const existingPool = await env.REGISTRATION_KV.get(poolKey);
  if (existingPool) {
    try { generated = JSON.parse(existingPool) || {}; } catch {}
  }

  const ap = metadata.ap || null;
  const source = metadata.source || generated.source || "public-random";
  const isTest = Boolean(
    metadata.isTest === true ||
    generated.isTest === true ||
    /^AP-TEST/i.test(String(ap || "")) ||
    /(^|[-_])test($|[-_])/i.test(String(source || ""))
  );

  const record = {
    ...generated,
    number: normalized,
    status: "issued",
    generatedAt: generated.generatedAt || issuedAt,
    issuedAt,
    ap,
    item: metadata.item || null,
    source,
    isTest
  };

  await env.REGISTRATION_KV.put(poolKey, JSON.stringify(record));
  await env.REGISTRATION_KV.put(issuedKey, JSON.stringify(record));
}

export async function checkRegistrationNumberCollision(env, number, options = {}) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) return { duplicate: true, locations: ["invalid-format"] };

  const locations = [];

  const ownerLocations = await findInOwnerPool(env, normalized);
  locations.push(...ownerLocations);

  const publicPoolValue = await env.REGISTRATION_KV.get(PUBLIC_POOL_PREFIX + normalized);
  if (publicPoolValue && !options.allowOwnPublicReservation) {
    locations.push(PUBLIC_POOL_PREFIX + normalized);
  }

  if (await env.REGISTRATION_KV.get(PUBLIC_ISSUED_PREFIX + normalized)) {
    locations.push(PUBLIC_ISSUED_PREFIX + normalized);
  }

  // 過去仕様を含む全ての既存登録キーを確認する。取消済みも番号再利用は禁止。
  const registrationKeys = [
    normalized,
    "REGISTRATION:" + normalized,
    "REGISTRATION_" + normalized,
    "REGISTRATION-" + normalized
  ];

  for (const key of registrationKeys) {
    if (await env.REGISTRATION_KV.get(key)) locations.push(key);
  }

  return {
    duplicate: locations.length > 0,
    locations: [...new Set(locations)]
  };
}

export async function readRegistrationNumberLedgers(env) {
  const owner = [];
  const publicPool = [];
  const publicIssued = [];

  const ownerKeys = await listKeys(env, "REGISTRATION_LIST");
  for (const key of ownerKeys) {
    if (!/^REGISTRATION_LIST(?:\d+)?$/.test(key)) continue;
    const value = await env.REGISTRATION_KV.get(key);
    if (!value) continue;
    let list;
    try { list = JSON.parse(value); } catch { continue; }
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const number = normalizeRegistrationNumber(raw);
      if (number) owner.push({ number, location: key, purpose: "owner-reserved" });
    }
  }

  for (const key of await listKeys(env, PUBLIC_POOL_PREFIX)) {
    const value = await env.REGISTRATION_KV.get(key);
    let data = null;
    try { data = value ? JSON.parse(value) : null; } catch {}
    publicPool.push({
      number: key.slice(PUBLIC_POOL_PREFIX.length),
      location: key,
      ...(data && typeof data === "object" ? data : {})
    });
  }

  for (const key of await listKeys(env, PUBLIC_ISSUED_PREFIX)) {
    const value = await env.REGISTRATION_KV.get(key);
    let data = null;
    try { data = value ? JSON.parse(value) : null; } catch {}
    publicIssued.push({
      number: key.slice(PUBLIC_ISSUED_PREFIX.length),
      location: key,
      ...(data && typeof data === "object" ? data : {})
    });
  }

  const byNumber = list => list.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  return {
    owner: byNumber(owner),
    publicPool: byNumber(publicPool),
    publicIssued: byNumber(publicIssued)
  };
}

export async function hasRegistrationNumberInLedgers(env, number) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) return false;
  for (const prefix of [PUBLIC_POOL_PREFIX, PUBLIC_ISSUED_PREFIX]) {
    if (await env.REGISTRATION_KV.get(prefix + normalized)) return true;
  }
  return (await findInOwnerPool(env, normalized)).length > 0;
}

function generateRegistrationNumber() {
  const bytes = new Uint32Array(8);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const n of bytes) value += REGISTRATION_CHARS[n % REGISTRATION_CHARS.length];
  return value;
}

function normalizeRegistrationNumber(value) {
  const number = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(number) ? number : null;
}

async function findInOwnerPool(env, number) {
  const matches = [];
  const keys = await listKeys(env, "REGISTRATION_LIST");
  for (const key of keys) {
    if (!/^REGISTRATION_LIST(?:\d+)?$/.test(key)) continue;
    const value = await env.REGISTRATION_KV.get(key);
    if (!value) continue;
    let list;
    try { list = JSON.parse(value); } catch { continue; }
    if (!Array.isArray(list)) continue;
    if (list.some(raw => String(raw ?? "").trim().toUpperCase() === number)) matches.push(key);
  }
  return matches;
}

async function listKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const result = await env.REGISTRATION_KV.list({ prefix, limit: 1000, cursor });
    for (const entry of result.keys) keys.push(entry.name);
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return keys;
}
