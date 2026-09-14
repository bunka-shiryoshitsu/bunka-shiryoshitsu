import app from "./worker-dashboard9.js";
import { readRegistrationNumberLedgers } from "./registration-number-service.js";
import {registrationNotePaths} from './registration-number-notes.js';
import {registrationNumbersClient} from './registration-number-ui.js';
export { RegistrationIssuer } from "./worker-dashboard9.js";


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (registrationNotePaths.has(path)) {
      if (!isAdmin(request, env)) return json({success: false, message: 'Unauthorized.'}, 401);
      if (!env.REGISTRATION_ISSUER) return json({success: false, message: 'ただいまメモを利用できません。'}, 503);
      try {
        const stub = env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('registration-number-issuer'));
        return await stub.fetch(request);
      } catch {
        return json({success: false, message: 'メモを保存・取得できませんでした。もう一度お試しください。'}, 503);
      }
    }


    if (request.method === "GET" && path === "/admin/registration-numbers") {
      return registrationNumbersPage();
    }

    if (request.method === "GET" && path === "/admin/registration-numbers/data") {
      if (!isAdmin(request, env)) return json({ success: false, message: "Unauthorized." }, 401);
      const ledgers = await readRegistrationNumberLedgers(env);
      const testConsumed = ledgers.publicIssued.filter(isTestRecord).length;
      return json({
        success: true,
        counts: {
          owner: ledgers.owner.length,
          publicPool: ledgers.publicPool.length,
          publicIssued: ledgers.publicIssued.length,
          testConsumed
        },
        ...ledgers
      });
    }

    if (request.method === "GET" && path === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();
      const link = '<p style="margin:12px 0"><a href="/admin/registration-numbers" style="display:inline-block;padding:10px 14px;border:1px solid #777;border-radius:8px;text-decoration:none">登録番号管理 / REGISTRATION NUMBERS</a></p>';
      page = page.includes("</body>") ? page.replace("</body>", link + "</body>") : page + link;
      return htmlFrom(response, page);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function isAdmin(request, env) {
  return Boolean(env.ADMIN_KEY && request.headers.get("X-Admin-Key") === env.ADMIN_KEY);
}

function isTestRecord(record) {
  if (!record || typeof record !== "object") return false;
  return Boolean(
    record.isTest === true ||
    /^AP-TEST/i.test(String(record.ap || "")) ||
    /(^|[-_])test($|[-_])/i.test(String(record.source || ""))
  );
}

function registrationNumbersPage() {
  return new Response(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>登録番号管理｜文化資料登録室</title>
<style>body{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;background:#f3f1ec;color:#292929;margin:0}.wrap{max-width:1100px;margin:auto;padding:28px 18px 60px}h1{font-size:1.7rem}h2{margin-top:34px}.box{background:#fff;border:1px solid #d6d1c6;border-radius:10px;padding:16px;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1;min-width:230px;padding:10px}.row button{padding:10px 16px}.summary{display:flex;gap:10px;flex-wrap:wrap}.card{background:#fff;border:1px solid #d6d1c6;border-radius:8px;padding:12px;min-width:180px}table{width:100%;border-collapse:collapse;background:#fff;font-size:.9rem}th,td{border:1px solid #ddd;padding:7px;text-align:left;vertical-align:top}th{background:#eee}code{word-break:break-all}.note{font-size:.9rem;color:#555}.ok{color:#176b2c}.err{color:#a21b1b}.test-row,.test-row td{background:#ffe7e7!important;color:#a00000}.test-number{color:#c40000;font-weight:800}.test-badge{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:999px;background:#b00020;color:#fff;font-size:.75rem;font-weight:700}.test-card{border-color:#d98b8b;color:#a00000}.wrap{max-width:1400px}.ledger-table{overflow-x:auto}.memo-cell{min-width:260px;width:34%}.memo-input{box-sizing:border-box;display:block;width:100%;min-width:240px;min-height:88px;resize:vertical;padding:10px;border:1px solid #aaa;border-radius:6px;font:inherit;font-size:16px;line-height:1.6;background:#fff;color:#292929}.memo-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}.memo-save{padding:7px 18px;border:0;border-radius:5px;background:#292929;color:#fff;font:inherit;font-size:16px;cursor:pointer}button:disabled{opacity:.55;cursor:default}.memo-status{font-size:14px}.unsaved{color:#805000}.memo-conflict{margin-top:10px;padding:10px;border:1px solid #c88;background:#fff7f5;color:#292929}.memo-latest{white-space:pre-wrap;overflow-wrap:anywhere}.memo-conflict button{font:inherit;padding:6px 10px}.memo-input:focus{outline:2px solid #80652a;outline-offset:2px}@media(max-width:600px){.wrap{padding:18px 12px 40px}.memo-cell{min-width:240px}.row input{box-sizing:border-box;min-width:0;width:100%}}</style></head><body><div class="wrap">
<h1>登録番号管理 / REGISTRATION NUMBERS</h1>
<p>自己所有品用と一般申請者用の番号を分離して確認する管理画面です。</p>
<p class="note">テスト用に消費された番号は、再利用防止のため通常番号と同様に保持し、この画面では赤色で表示します。</p>
<p class="note">各番号に管理者用メモを書き込めます（5000文字以内・改行可）。メモは公開照会や登録書には表示されません。同じ番号のメモは、各台帳で共通です。</p><div class="box"><div class="row"><input id="adminKey" type="password" autocomplete="off" placeholder="ADMIN KEY"><button id="load">一覧を読み込む / LOAD</button></div><p id="status" class="note">管理キーを入力してください。</p></div>
<div id="summary" class="summary"></div>
<section><h2>自己所有品専用プール</h2><p class="note">REGISTRATION_LIST*。一般申請者への自動発行では使用しません。</p><div id="owner"></div></section>
<section><h2>一般申請用・生成台帳</h2><p class="note">PUBLIC_REGISTRATION_POOL:*。ランダム生成した番号を状態付きで記録します。</p><div id="publicPool"></div></section>
<section><h2>一般申請用・発行済み台帳</h2><p class="note">PUBLIC_REGISTRATION_ISSUED:*。実際に発行した番号、AP番号、資料番号を記録します。テスト消費番号は赤色です。</p><div id="publicIssued"></div></section>
<p><a href="/admin">← 管理画面へ戻る</a></p>
</div><script>${registrationNumbersClient}</script></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" } });
}

function htmlFrom(response, body) {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=UTF-8");
  headers.set("Cache-Control", "no-store");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
