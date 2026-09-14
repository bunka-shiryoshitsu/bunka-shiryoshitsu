const RETRY_MS = 60_000;
const CURSOR_KEY = 'supplement-cleanup:cursor';
const PAGE_SIZE = 20;

export function supplementFinished(item, record, final) {
  return Boolean(final) || Boolean(item?.registrationNumber) ||
    item?.registrationStatus === 'cancelled' || item?.reviewResult === 'rejected' ||
    record?.rounds?.at(-1)?.status === 'closed';
}

export async function ensureRetentionAlarm(storage, now = Date.now()) {
  const alarm = await storage.getAlarm();
  if (alarm === null || alarm > now + RETRY_MS) await storage.setAlarm(now + RETRY_MS);
}

// Keep the submission history, but delete every image chunk for this finished item.
// The prefix also covers chunks left by interrupted uploads and attachment removal.
export async function purgeSupplementImages(storage, ap, item, record, now = Date.now()) {
  if (!/^AP-[A-Z0-9]{8}$/.test(ap) || !/^(0[1-9]|10)$/.test(item)) {
    throw new Error('Invalid supplement cleanup target');
  }
  if (!record || record.imageCleanup?.status === 'deleted') return true;
  await ensureRetentionAlarm(storage, now);
  const key = 'supplement:' + ap + ':' + item;
  if (!record.imageCleanup) {
    record.imageCleanup = {status: 'pending', requestedAt: new Date(now).toISOString()};
    // A newly finished item may sort before a sweep already in progress.
    await storage.delete(CURSOR_KEY);
    await storage.put(key, record);
  }
  const prefix = 'supplement-image:' + ap + ':' + item + ':';
  // Bound each pass to 256 chunks; large histories continue at the next alarm.
  for (let batch = 0; batch < 8; batch++) {
    const chunks = await storage.list({prefix, limit: 32});
    if (chunks.size) await storage.delete([...chunks.keys()]);
    if (chunks.size < 32) {
      record.imageCleanup = {...record.imageCleanup, status: 'deleted', deletedAt: new Date(now).toISOString()};
      await storage.put(key, record);
      return true;
    }
  }
  return false;
}

export async function tryPurgeSupplementImages(storage, ap, item, record, now = Date.now()) {
  try {
    return await purgeSupplementImages(storage, ap, item, record, now);
  } catch {
    // The persisted alarm and daily sweep retry without changing the review result.
    console.warn('Supplement image cleanup will be retried.');
    return false;
  }
}

export async function sweepSupplementImages(storage, env, now = Date.now()) {
  const cursor = await storage.get(CURSOR_KEY) || '';
  const records = await storage.list({prefix: 'supplement:', limit: PAGE_SIZE, ...(cursor ? {startAfter: cursor} : {})});
  let previous = cursor, checked = 0, deleted = 0;
  for (const [key, record] of records) {
    const match = /^supplement:(AP-[A-Z0-9]{8}):(0[1-9]|10)$/.exec(key);
    if (!match) throw new Error('Invalid supplement record key');
    const [, ap, itemNo] = match;
    checked++;
    if (record.imageCleanup?.status !== 'deleted') {
      const final = await storage.get('supplement-final:' + ap + ':' + itemNo);
      let item;
      if (!final && record.rounds?.at(-1)?.status !== 'closed') {
        const raw = await env.REGISTRATION_KV.get('REGISTRATION_APPLICATION:' + ap);
        item = raw ? JSON.parse(raw).items?.find(x => String(x.item) === itemNo) : undefined;
      }
      if (supplementFinished(item, record, final)) {
        if (!await purgeSupplementImages(storage, ap, itemNo, record, now)) {
          await storage.put(CURSOR_KEY, previous);
          return {checked, deleted, more: true};
        }
        deleted++;
      }
    }
    previous = key;
  }
  if (records.size === PAGE_SIZE) {
    await storage.put(CURSOR_KEY, previous);
    return {checked, deleted, more: true};
  }
  await storage.delete(CURSOR_KEY);
  return {checked, deleted, more: false};
}
