import app from "./worker-entry2.js";

const ORIGIN = "https://bunka-shiryoshitsu.github.io";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/receive") {
      return receivePage();
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

function receivePage() {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登録書受取｜文化資料登録室</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f3f1ec;color:#292929;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;line-height:1.8}
main{max-width:720px;margin:50px auto;padding:0 18px}
.box{background:#fff;border:1px solid #dedbd2;padding:30px;box-shadow:0 8px 25px rgba(0,0,0,.04)}
h1{font-size:25px;margin:0 0 18px}
.notice{background:#f6f4ef;border-left:4px solid #9d8a5a;padding:16px 18px;margin:18px 0}
label{display:block;font-weight:600;margin-top:18px}
input{width:100%;padding:13px;border:1px solid #aaa;font-size:16px;margin-top:7px}
button{margin-top:22px;padding:13px 22px;background:#292824;color:#fff;border:0;cursor:pointer;font-size:14px}
button:disabled{background:#aaa;cursor:not-allowed}
.small{font-size:13px;color:#666}
#result{margin-top:20px}
.item{border-top:1px solid #ddd;padding:18px 0}
.item button{margin-top:8px}
strong{color:#332d20}
</style>
</head>
<body>
<main>
<div class="box">
<h1>登録書受取</h1>
<p>登録書は、申請者本人だけが受け取れるよう、<strong>確認番号（AP番号）と受取キー</strong>の両方で確認します。</p>
<div class="notice">
<strong>登録番号だけでは登録書を取得できません。</strong><br>
抽選申込時に発行されたAP番号と受取キーを入力してください。
</div>
<label for="ap">確認番号（AP番号）</label>
<input id="ap" autocomplete="off" placeholder="AP-XXXXXXXX">
<label for="key">受取キー</label>
<input id="key" autocomplete="off" placeholder="受取キー">
<button id="check" type="button">登録書を確認</button>
<div id="result"></div>
<div class="notice small">
<strong>印刷・保管について</strong><br>
登録書は写真のL判サイズで作成しています。セブン‐イレブンのマルチコピー機等で写真プリントする場合も、L判を選び、サイズや縦横比を変更せずに印刷してください。L判以外への拡大・縮小や縦横比の変更は、画像の粗れ、文字の見にくさ、枠の比率、QRコードの読み取り等に影響する場合があります。<br><br>
印刷後は、長期保存のため、可能な限りラミネート加工等を行い、汚損、折れ、破れ、水濡れ、退色その他の毀損を防いでください。<br><br>
<strong>登録書には登録対象資料の画像を掲載していません。登録書は必ず登録された資料と一緒に保管してください。</strong> どの資料に対応する登録書であるか分からなくならないよう管理してください。登録書を紛失した場合、又は著しく毀損して登録資料との対応関係を確認できなくなった場合は、原則として登録書だけの再発行は行わず、必要な場合は改めて登録申請が必要です。
</div>
</div>
</main>
<script>
const WORKER_URL = location.origin;
const apInput = document.getElementById('ap');
const keyInput = document.getElementById('key');
const button = document.getElementById('check');
const result = document.getElementById('result');

button.addEventListener('click', async () => {
  const ap = apInput.value.trim().toUpperCase();
  const receiveKey = keyInput.value.trim().toUpperCase();
  result.textContent = '確認しています……';
  button.disabled = true;
  try {
    const response = await fetch(WORKER_URL + '/receive-status', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ap, receiveKey})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      result.textContent = data?.message || '確認できませんでした。';
      return;
    }
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      result.textContent = data.message || '現在受け取れる登録書はありません。';
      return;
    }
    result.innerHTML = '';
    const info = document.createElement('p');
    info.textContent = data.message || '登録書を受け取れます。';
    result.appendChild(info);
    for (const item of items) {
      const wrap = document.createElement('div');
      wrap.className = 'item';
      const title = document.createElement('div');
      title.textContent = (item.finalName || item.name || '登録資料') + (item.registrationTypeLabel ? ' / ' + item.registrationTypeLabel : '');
      wrap.appendChild(title);
      if (item.ready) {
        const dl = document.createElement('button');
        dl.type = 'button';
        dl.textContent = '登録書JPGを受け取る';
        dl.addEventListener('click', () => downloadFile(ap, receiveKey, item.registrationNumber));
        wrap.appendChild(dl);
      } else {
        const wait = document.createElement('div');
        wait.className = 'small';
        wait.textContent = '登録書は現在準備中です。';
        wrap.appendChild(wait);
      }
      result.appendChild(wrap);
    }
  } catch (e) {
    result.textContent = '確認できませんでした。しばらく時間をおいてもう一度お試しください。';
  } finally {
    button.disabled = false;
  }
});

async function downloadFile(ap, receiveKey, registrationNumber) {
  const response = await fetch(WORKER_URL + '/receive-file', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ap, receiveKey, registrationNumber})
  });
  if (!response.ok) {
    const text = await response.text();
    alert(text || '登録書を受け取れませんでした。');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (registrationNumber || 'registration-document') + '.jpg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
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
