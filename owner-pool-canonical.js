const MIGRATION_KEY = 'SYSTEM:MIGRATION:OWNER_POOL_ZERO_PADDED_V1';
const LEGACY_OWNER_POOL_INDICES = Object.freeze([1,2,3,4,5,6,7,8,9]);
let migrationReady = false;

export function canonicalOwnerPoolKey(name) {
  const key = String(name ?? '');
  const match = /^REGISTRATION_LIST([1-9])$/.exec(key);
  return match ? `REGISTRATION_LIST0${match[1]}` : key;
}

function parsePool(value, key) {
  if (value == null) return [];
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new Error(`${key} is not valid JSON`); }
  if (!Array.isArray(parsed)) throw new Error(`${key} is not an array`);
  return parsed;
}

function identity(value) {
  return String(value ?? '').trim().toUpperCase();
}

function mergePools(canonical, legacy) {
  const merged = canonical.slice();
  const seen = new Set(canonical.map(identity));
  for (const value of legacy) {
    const id = identity(value);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(value);
  }
  return merged;
}

function containsAll(target, sources) {
  const have = new Set(target.map(identity));
  return sources.every(source => source.every(value => have.has(identity(value))));
}

async function getMany(kv, keys) {
  const values = await kv.get(keys);
  if (values && typeof values.get === 'function') return values;
  const out = new Map();
  if (values && typeof values === 'object') {
    for (const key of keys) out.set(key, values[key] ?? null);
    return out;
  }
  for (const key of keys) out.set(key, await kv.get(key));
  return out;
}

export async function canonicalizeOwnerPoolKeys(env) {
  if (migrationReady) return {ready:true, cached:true};
  const kv = env?.REGISTRATION_KV;
  if (!kv) throw new Error('REGISTRATION_KV is unavailable');

  const marker = await kv.get(MIGRATION_KEY);
  if (marker) {
    migrationReady = true;
    return {ready:true, alreadyMigrated:true};
  }

  const pairs = LEGACY_OWNER_POOL_INDICES.map(index => ({
    index,
    canonicalKey:`REGISTRATION_LIST${String(index).padStart(2,'0')}`,
    legacyKey:`REGISTRATION_LIST${index}`
  }));
  const keys = pairs.flatMap(pair => [pair.canonicalKey, pair.legacyKey]);
  const before = await getMany(kv, keys);
  const plans = [];

  for (const pair of pairs) {
    const canonicalRaw = before.get(pair.canonicalKey) ?? null;
    const legacyRaw = before.get(pair.legacyKey) ?? null;
    const canonical = parsePool(canonicalRaw, pair.canonicalKey);
    const legacy = parsePool(legacyRaw, pair.legacyKey);
    const merged = mergePools(canonical, legacy);
    plans.push({...pair, canonicalRaw, legacyRaw, canonical, legacy, merged});
  }

  const written = [];
  for (const plan of plans) {
    if (plan.legacyRaw == null) continue;
    if (plan.canonicalRaw == null || JSON.stringify(plan.canonical) !== JSON.stringify(plan.merged)) {
      await kv.put(plan.canonicalKey, JSON.stringify(plan.merged));
      written.push(plan.canonicalKey);
    }
  }

  const verifyKeys = plans.filter(plan => plan.legacyRaw != null).map(plan => plan.canonicalKey);
  if (verifyKeys.length) {
    const verified = await getMany(kv, verifyKeys);
    for (const plan of plans) {
      if (plan.legacyRaw == null) continue;
      const current = parsePool(verified.get(plan.canonicalKey) ?? null, plan.canonicalKey);
      if (!containsAll(current, [plan.canonical, plan.legacy])) {
        throw new Error(`Owner pool migration verification failed for ${plan.canonicalKey}`);
      }
    }
  }

  const deleted = [];
  for (const plan of plans) {
    if (plan.legacyRaw == null) continue;
    await kv.delete(plan.legacyKey);
    deleted.push(plan.legacyKey);
  }

  if (deleted.length) {
    const leftovers = await getMany(kv, deleted);
    for (const key of deleted) {
      if (leftovers.get(key) != null) throw new Error(`Legacy owner pool key still exists: ${key}`);
    }
  }

  const report = {
    version:1,
    migratedAt:new Date().toISOString(),
    canonicalKeysWritten:written,
    legacyKeysDeleted:deleted
  };
  await kv.put(MIGRATION_KEY, JSON.stringify(report));
  migrationReady = true;
  return {ready:true, ...report};
}

export function withCanonicalOwnerPoolKeys(env) {
  if (!env?.REGISTRATION_KV || env.__ownerPoolCanonicalKeys) return env;
  const raw = env.REGISTRATION_KV;
  const kv = new Proxy(raw, {
    get(target, property) {
      if (property === 'get') return async (name, ...args) => {
        if (Array.isArray(name)) {
          const original = name.map(String);
          const mapped = original.map(canonicalOwnerPoolKey);
          const unique = [...new Set(mapped)];
          const values = await target.get(unique, ...args);
          const lookup = values && typeof values.get === 'function'
            ? key => values.get(key) ?? null
            : key => values && typeof values === 'object' ? values[key] ?? null : null;
          const out = new Map();
          for (let i=0;i<original.length;i++) out.set(original[i], lookup(mapped[i]));
          return out;
        }
        return target.get(canonicalOwnerPoolKey(name), ...args);
      };
      if (property === 'put' || property === 'delete') return (name, ...args) =>
        target[property](canonicalOwnerPoolKey(name), ...args);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'REGISTRATION_KV') return kv;
      if (property === '__ownerPoolCanonicalKeys') return true;
      return Reflect.get(target, property, receiver);
    }
  });
}
