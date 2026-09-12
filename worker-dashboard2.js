import app from "./worker-dashboard.js";
export { RegistrationIssuer } from "./worker-dashboard.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 登録申請は、申請する各資料に最低1枚の審査画像が保存済みでなければ受け付けない。
    if (request.method === "POST" && url.pathname === "/registration-submit") {
      let body;
      try { body = await request.clone().json(); }
      catch { return app.fetch(request, env, ctx); }

      const ap = String(body?.ap || "").trim().toUpperCase();
      const items = Array.isArray(body?.items) ? body.items : [];
      if (items.length) {
        for (let index = 0; index < items.length; index++) {
          const raw = items[index] || {};
          const item = String(raw.item || index + 1).padStart(2, "0");
          let found = false;
          for (let i = 1; i <= 20; i++) {
            const image = String(i).padStart(2, "0");
            if (await env.REGISTRATION_KV.get(`IMAGE:${ap}:${item}:${image}`)) { found = true; break; }
          }
          if (!found) {
            return json({
              success: false,
              message: `資料${index + 1}には審査用画像がありません。各資料につき最低1枚の画像を登録してください。`
            }, 400);
          }
        }
      }
      return app.fetch(request, env, ctx);
    }

    // ダッシュボードAPIに各資料の画像枚数を付加する。
    if (request.method === "GET" && url.pathname === "/admin/dashboard-data") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let data;
      try { data = await response.json(); } catch { return response; }
      const counts = new Map();
      let cursor;
      do {
        const r = await env.REGISTRATION_KV.list({ prefix: "IMAGE:", limit: 1000, cursor });
        for (const k of r.keys) {
          const m = /^IMAGE:(AP-[A-Z0-9]{8}):(\d{2}):(\d{2})$/.exec(k.name);
          if (!m) continue;
          const id = `${m[1]}:${m[2]}`;
          counts.set(id, (counts.get(id) || 0) + 1);
        }
        cursor = r.list_complete ? undefined : r.cursor;
      } while (cursor);
      for (const a of data.applications || []) {
        const total = (a.items || []).length;
        (a.items || []).forEach((x, i) => {
          const item = String(x.item || i + 1).padStart(2, "0");
          x.position = i + 1;
          x.totalItems = total;
          x.imageCount = counts.get(`${a.ap}:${item}`) || 0;
        });
      }
      return json(data);
    }

    // 申請一覧はAP単位で一行にまとめず、資料1件につき一行で表示する。
    if (request.method === "GET" && url.pathname === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();
      const start = page.indexOf("function appRows(list){");
      const end = page.indexOf("\nfunction regRows(list){", start);
      if (start >= 0 && end > start) {
        const replacement = `function appRows(list){
 const rows=[];
 list.forEach(a=>{const items=(a.items||[]);if(!items.length){rows.push('<tr class="trclick" data-ap="'+esc(a.ap)+'"><td><strong>'+esc(a.ap)+'</strong></td><td>'+pill(a.status)+'</td><td>資料なし</td><td>–</td><td>'+fmt(a.submittedAt)+'</td><td>–</td><td>–</td></tr>');return}items.forEach((x,i)=>{const pos=(x.position||i+1),total=(x.totalItems||items.length);rows.push('<tr class="trclick" data-ap="'+esc(a.ap)+'"><td><strong>'+esc(a.ap)+'</strong></td><td>'+pill(a.status)+'</td><td><strong>資料 '+pos+' / '+total+'</strong></td><td>'+esc(x.name||'（名称なし）')+'</td><td>'+fmt(a.submittedAt)+'</td><td>'+esc(x.registrationNumber||'–')+'</td><td>'+(x.imageCount>0?'<span class="pill good">画像 '+x.imageCount+'枚</span>':'<span class="pill bad">画像なし</span>')+'</td></tr>')})});
 return '<table><thead><tr><th>AP番号</th><th>状態</th><th>資料位置</th><th>資料名称</th><th>送信日時</th><th>登録番号</th><th>審査画像</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>'}
`;
        page = page.slice(0, start) + replacement + page.slice(end + 1);
      }
      return html(page);
    }

    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"};}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});}
function html(value,status=200){return new Response(value,{status,headers:{...cors(),"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});}
