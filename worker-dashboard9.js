import app from "./worker-dashboard8.js";
export { RegistrationIssuer } from "./worker-dashboard8.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 完成版では開発用の公開自己診断URLを外部へ公開しない。
    if (path.startsWith("/_dev/")) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "no-store"
        }
      });
    }

    // 抽選申込ページは処理を変えず、重要表示だけを明確化する。
    if (request.method === "GET" && path === "/lottery") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();
      page = page.replace('</style>', '.ap-privacy{font-size:clamp(22px,3.5vw,28px);font-weight:800;line-height:1.6;color:#812b20;border:2px solid #a34d38;background:#fff4df;padding:18px;margin:20px 0;overflow-wrap:anywhere}.code{font-size:28px}</style>');
      page = page.replace('</head>', '<meta name="referrer" content="no-referrer"></head>');

      page = page.replace(
        '<button id="apply" type="button" disabled>抽選に申し込む</button>',
        '<p class="ap-privacy">AP番号は他人に教えないでください。</p><div class="notice">申込完了後に表示されるAP番号を、紙などに控えてください。</div><button id="apply" type="button" disabled>抽選に申し込む / APPLY FOR LOTTERY</button>'
      );

      return htmlFrom(response, page);
    }

    // 登録書受取ページも認証処理はそのまま、表示だけを整理する。
    if (request.method === "GET" && path === "/receive") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();

      page = page.replace(
        '<h1>登録書受取</h1>',
        '<h1>登録書受取 / REGISTRATION DOCUMENT</h1>'
      );
      page = page.replace(
        '<label for="ap">確認番号（AP番号）</label>',
        '<label for="ap">確認番号（AP番号） / APPLICATION NUMBER</label>'
      );
      page = page.replace(
        "dl.textContent = '登録書JPGを受け取る';",
        "dl.textContent = '登録書JPGを受け取る / DOWNLOAD JPG';"
      );

      return htmlFrom(response, page);
    }

    // 管理画面では生のIPを表示せず、必要な内部判定だけ抽象化して表示する。
    if (request.method === "GET" && path === "/admin") {
      const response = await app.fetch(request, env, ctx);
      if (!response.ok) return response;
      let page = await response.text();

      page = page.replaceAll(
        "同一IP・同日重複（手動当選可）",
        "重複申込の可能性あり（手動当選可）"
      );


      return htmlFrom(response, page);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};

function htmlFrom(response, body) {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=UTF-8");
  headers.set("Cache-Control", "no-store");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
