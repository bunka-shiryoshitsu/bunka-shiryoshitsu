import {hasRegistrationNumberInLedgers} from './registration-number-service.js';

export const registrationNotePaths = new Set([
  '/admin/registration-numbers/notes',
  '/admin/registration-numbers/notes/read'
]);
const PREFIX = 'registration-number-note:';
const NUMBER = /^[A-Z0-9]{8}$/;
const MAX_TEXT = 5000;
const MAX_BODY = 40000;
const emptyNote = () => ({text: '', revision: 0, updatedAt: null});
const json = (value, status = 200) => Response.json(value, {
  status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
});

// Bound the body while reading it, including requests without Content-Length.
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw new RangeError();
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Called inside RegistrationIssuer's existing serialized request queue. A revision
// check and the following durable write therefore cannot race another note save.
export async function registrationNumberNotes(request, env, storage) {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({success: false, message: 'Unauthorized.'}, 401);
  }
  if (request.method !== 'POST') return json({success: false, message: 'Method Not Allowed'}, 405);
  let body;
  try { body = await readBody(request); }
  catch (error) {
    return json({success: false, message: error instanceof RangeError ? '入力内容が長すぎます。' : '入力内容を確認してください。'}, error instanceof RangeError ? 413 : 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({success: false, message: '入力内容を確認してください。'}, 400);
  }
  try {
    if (new URL(request.url).pathname.endsWith('/read')) {
      if (!Array.isArray(body.numbers) || body.numbers.length > 100 ||
          body.numbers.some(n => typeof n !== 'string' || !NUMBER.test(n))) {
        return json({success: false, message: '番号は100件以内で指定してください。'}, 400);
      }
      const numbers = [...new Set(body.numbers)];
      const saved = numbers.length ? await storage.get(numbers.map(n => PREFIX + n)) : new Map();
      return json({success: true, notes: Object.fromEntries(numbers.map(n => [n, saved.get(PREFIX + n) || emptyNote()]))});
    }
    const {number, text, revision} = body;
    if (typeof number !== 'string' || !NUMBER.test(number) || typeof text !== 'string' ||
        text.length > MAX_TEXT || !Number.isSafeInteger(revision) || revision < 0) {
      return json({success: false, message: '番号を確認し、メモは5000文字以内で入力してください。'}, 400);
    }
    if (!await hasRegistrationNumberInLedgers(env, number)) {
      return json({success: false, message: '台帳に番号が見つかりません。一覧を読み込み直してください。'}, 404);
    }
    const key = PREFIX + number;
    const current = await storage.get(key) || emptyNote();
    // A retry after a lost response is safe and does not create another revision.
    if (text === current.text) return json({success: true, number, note: current});
    if (revision !== current.revision) {
      return json({success: false, message: '別の画面でメモが更新されています。最新の内容を確認してください。', current}, 409);
    }
    const note = {text, revision: revision + 1, updatedAt: new Date().toISOString()};
    // Keep an empty note's revision too, so a stale editor cannot undo a clear.
    await storage.put(key, note);
    return json({success: true, number, note});
  } catch {
    return json({success: false, message: 'メモを保存・取得できませんでした。入力内容を残したまま、もう一度お試しください。'}, 503);
  }
}
