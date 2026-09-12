import app from "./worker-dashboard2.js";
export { RegistrationIssuer } from "./worker-dashboard2.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";
const MAX_OVERVIEW = 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/lottery") {
      return lotteryPage();
    }

    if (request.method === "POST" && url.pathname === "/lottery-apply") {
      let body;
      try { body = await request.clone().json(); }
      catch { return json({success:false,message:"入力内容を確認してください。"},400); }

      const overview = String(body?.overview || "").trim();
      if (!overview) {
        return json({success:false,message:"登録を希望する資料の概要を入力してください。"},400);
      }
      if (overview.length > MAX_OVERVIEW) {
        return json({success:false,message:`資料の概要は${MAX_OVERVIEW}文字以内で入力してください。`},400);
      }

      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;

      let data;
      try { data = await response.clone().json(); }
      catch { return response; }

      if (data?.success && /^AP-[A-Z0-9]{8}$/.test(String(data.ap || ""))) {
        const key = "APPLICATION_" + data.ap;
        const raw = await env.REGISTRATION_KV.get(key);
        if (raw) {
          try {
            const record = JSON.parse(raw);
            record.overview = overview;
            record.overviewSubmittedAt = new Date().toISOString();
            await env.REGISTRATION_KV.put(key, JSON.stringify(record));
          } catch {}
        }
      }
      return response;
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

function cors(){return {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Admin-Key"};}
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...cors(),"Content-Type":"application/json; charset=UTF-8","Cache-Control":"no-store"}});}

function lotteryPage(){
 const page=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>抽選申込｜文化資料登録室</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f1ec;color:#292929;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8}main{max-width:720px;margin:50px auto;padding:0 18px}.box{background:#fff;border:1px solid #dedbd2;padding:30px;box-shadow:0 8px 25px rgba(0,0,0,.04)}h1{font-size:25px;margin:0 0 18px}.notice{background:#f6f4ef;border-left:4px solid #9d8a5a;padding:16px 18px;margin:18px 0}.small{font-size:13px;color:#666}label{display:block;font-weight:700;margin-top:20px}textarea{width:100%;min-height:150px;margin-top:8px;padding:12px;border:1px solid #aaa;font:inherit;resize:vertical;background:#fff}button{margin-top:18px;padding:13px 22px;background:#292824;color:#fff;border:0;cursor:pointer;font-size:14px}button:disabled{background:#aaa;cursor:not-allowed}#result{margin-top:22px}.important{font-weight:700}.code{font-family:ui-monospace,Consolas,monospace;font-size:20px;letter-spacing:1px;padding:12px;background:#f6f4ef;border:1px solid #ddd;margin:8px 0;word-break:break-all}a{color:#65562f}.count{text-align:right;font-size:12px;color:#666}
</style></head><body><main><div class="box"><h1>登録申請 抽選申込</h1><p>文化資料登録室への登録申請を希望する場合は、まず抽選にお申し込みください。</p><div id="status" class="notice">受付状態を確認しています……</div><div class="notice small">抽選への申込みは、同一人物につき1日1件までです。抽選への当選は登録を保証するものではありません。当選した場合のみ、申請期限まで登録申請へ進むことができます。</div>
<label for="overview">登録を希望する資料の概要（必須）</label><p class="small">画像はこの段階では不要です。資料の種類・内容・年代・入手経緯など、分かる範囲で簡潔に記載してください。この概要は抽選時の確認資料として使用し、当選後の正式な登録審査は実際の申請内容と画像を確認して行います。</p><textarea id="overview" maxlength="1000" placeholder="例：1990年代のアニメ作品の制作資料と思われるセル画。中古市場で入手。"></textarea><div id="count" class="count">0 / 1000</div>
<button id="apply" type="button" disabled>抽選に申し込む</button><div id="result"></div><p class="small"><a href="${ORIGIN}/bunka-shiryoshitsu/">文化資料登録室へ戻る</a></p></div></main><script>
const statusBox=document.getElementById('status'),applyButton=document.getElementById('apply'),result=document.getElementById('result'),overview=document.getElementById('overview'),count=document.getElementById('count');overview.addEventListener('input',()=>count.textContent=overview.value.length+' / 1000');
async function loadStatus(){try{const r=await fetch('/system/application-status',{cache:'no-store'}),d=await r.json();if(d.applicationsOpen){statusBox.innerHTML='<strong>現在、抽選申込を受け付けています。</strong>';applyButton.disabled=false}else{statusBox.innerHTML='<strong>現在、新規登録申請を休止しております。</strong>';applyButton.disabled=true}}catch(e){statusBox.textContent='受付状態を確認できませんでした。しばらく時間をおいて再度お試しください。'}}
applyButton.addEventListener('click',async()=>{if(applyButton.disabled)return;const text=overview.value.trim();if(!text){result.textContent='登録を希望する資料の概要を入力してください。';overview.focus();return}if(!confirm('この内容で抽選に申し込みますか？'))return;applyButton.disabled=true;result.textContent='申込みを受け付けています……';try{const r=await fetch('/lottery-apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overview:text})}),d=await r.json().catch(()=>null);if(!r.ok||!d?.success){result.textContent=d?.message||'抽選申込みを受け付けられませんでした。';if(r.status!==503)applyButton.disabled=false;return}result.innerHTML='';const p=document.createElement('p');p.className='important';p.textContent='抽選申込みを受け付けました。次の2つを必ず保存してください。';result.appendChild(p);const al=document.createElement('div');al.textContent='確認番号（AP番号）';result.appendChild(al);const ap=document.createElement('div');ap.className='code';ap.textContent=d.ap||'';result.appendChild(ap);const kl=document.createElement('div');kl.textContent='受取キー';result.appendChild(kl);const k=document.createElement('div');k.className='code';k.textContent=d.receiveKey||'';result.appendChild(k);const w=document.createElement('div');w.className='notice';w.innerHTML='<strong>AP番号と受取キーは、今ここで保存してください。</strong><br>受取キーは登録書の受取時に必要です。安全上、この画面を離れた後に同じ受取キーを再表示することはできません。';result.appendChild(w);const n=document.createElement('p');n.textContent='抽選結果は、文化資料登録室の「抽選結果確認」でAP番号を入力して確認してください。';result.appendChild(n)}catch(e){result.textContent='抽選申込みに失敗しました。しばらく時間をおいて再度お試しください。';applyButton.disabled=false}});loadStatus();
</script></body></html>`;
 return new Response(page,{status:200,headers:{"Access-Control-Allow-Origin":ORIGIN,"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});
}
