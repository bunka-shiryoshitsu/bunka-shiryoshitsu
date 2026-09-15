import app from "./worker-entry4.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/lottery") {
      return lotteryPage();
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

function lotteryPage() {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>抽選申込｜文化資料登録室</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f1ec;color:#292929;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8}
main{max-width:720px;margin:50px auto;padding:0 18px}
.box{background:#fff;border:1px solid #dedbd2;padding:30px;box-shadow:0 8px 25px rgba(0,0,0,.04)}
h1{font-size:25px;margin:0 0 18px}.notice{background:#f6f4ef;border-left:4px solid #9d8a5a;padding:16px 18px;margin:18px 0}.small{font-size:13px;color:#666}
button{margin-top:18px;padding:13px 22px;background:#292824;color:#fff;border:0;cursor:pointer;font-size:14px}button:disabled{background:#aaa;cursor:not-allowed}
#result{margin-top:22px}.important{font-weight:700}.code{font-family:ui-monospace,Consolas,monospace;font-size:20px;letter-spacing:1px;padding:12px;background:#f6f4ef;border:1px solid #ddd;margin:8px 0;word-break:break-all}
a{color:#65562f}
.ap-privacy{font-size:clamp(22px,3.5vw,28px);font-weight:800;line-height:1.6;color:#812b20;border:2px solid #a34d38;background:#fff4df;padding:18px;margin:20px 0;overflow-wrap:anywhere}
.code{font-size:28px}
</style>
</head>
<body>
<main>
<div class="box">
<h1>登録申請 抽選申込</h1>
<p>文化資料登録室への登録申請を希望する場合は、まず抽選にお申し込みください。</p>
<div id="status" class="notice">受付状態を確認しています……</div>
<div class="notice small">
抽選への申込みは、同一人物につき1日1件までです。抽選への当選は登録を保証するものではありません。当選した場合のみ、申請期限まで登録申請へ進むことができます。
</div>
<button id="apply" type="button" disabled>抽選に申し込む</button>
<div id="result"></div>
<p class="small"><a href="${ORIGIN}/bunka-shiryoshitsu/">文化資料登録室へ戻る</a></p>
</div>
</main>
<script>
const statusBox=document.getElementById('status');
const applyButton=document.getElementById('apply');
const result=document.getElementById('result');

async function loadStatus(){
 try{
  const r=await fetch('/system/application-status',{cache:'no-store'});
  const d=await r.json();
  if(d.applicationsOpen){
   statusBox.innerHTML='<strong>現在、抽選申込を受け付けています。</strong>';
   applyButton.disabled=false;
  }else{
   statusBox.innerHTML='<strong>現在、新規登録申請を休止しております。</strong>';
   applyButton.disabled=true;
  }
 }catch(e){
  statusBox.textContent='受付状態を確認できませんでした。しばらく時間をおいて再度お試しください。';
 }
}

applyButton.addEventListener('click',async()=>{
 if(applyButton.disabled)return;
 if(!confirm('抽選に申し込みますか？'))return;
 applyButton.disabled=true;
 result.textContent='申込みを受け付けています……';
 try{
  const r=await fetch('/lottery-apply',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({})
  });
  const d=await r.json().catch(()=>null);
  if(!r.ok||!d?.success){
   result.textContent=d?.message||'抽選申込みを受け付けられませんでした。';
   if(r.status!==503)applyButton.disabled=false;
   return;
  }
  result.innerHTML='';
  const p=document.createElement('p');
  p.className='important';
  p.textContent='抽選申込みを受け付けました。次のAP番号を紙などに控えてください。';
  result.appendChild(p);
  const apLabel=document.createElement('div');apLabel.textContent='確認番号（AP番号）';result.appendChild(apLabel);
  const ap=document.createElement('div');ap.className='code';ap.textContent=d.ap||'';result.appendChild(ap);
  const warning=document.createElement('div');warning.className='ap-privacy';warning.textContent='AP番号は他人に教えないでください。';result.appendChild(warning);
  const save=document.createElement('p');save.textContent='AP番号は、抽選結果の確認・登録申請・追加提出・登録書の受取りに使います。紙などに控え、大切に保管してください。';result.appendChild(save);
  const note=document.createElement('p');note.textContent='抽選結果は、文化資料登録室の「抽選結果確認」でAP番号を入力して確認してください。';result.appendChild(note);
 }catch(e){
  result.textContent='抽選申込みに失敗しました。しばらく時間をおいて再度お試しください。';
  applyButton.disabled=false;
 }
});

loadStatus();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": ORIGIN,
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
