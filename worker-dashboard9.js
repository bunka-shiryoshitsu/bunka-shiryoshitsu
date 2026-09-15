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

      page = page.replace(
        '<button id="apply" type="button" disabled>抽選に申し込む</button>',
        '<div class="notice small"><strong>重要 / IMPORTANT</strong><br>申込完了後に表示される確認番号（AP番号）と受取キーは、必ず保存してください。受取キーを紛失した場合は、AP番号を用意して管理者へご相談ください。確認のうえ、キーの案内または再発行を行います。</div><button id="apply" type="button" disabled>抽選に申し込む / APPLY FOR LOTTERY</button>'
      );

      page = page.replace(
        'AP番号と受取キーは、今ここで保存してください。',
        '重要 / IMPORTANT：AP番号と受取キーは、今ここで必ず保存してください。'
      );

      page = page.replace(
        '受取キーは登録書の受取時に必要です。安全上、この画面を離れた後に同じ受取キーを再表示することはできません。',
        '受取キーは登録書の受取時に必要です。AP番号と一緒に保管してください。紛失時は、AP番号を用意して管理者へご相談ください。'
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
        '<label for="key">受取キー</label>',
        '<label for="key">受取キー / RECEIVE KEY</label>'
      );
      page = page.replace(
        '<button id="check" type="button">登録書を確認</button>',
        '<div class="notice small"><strong>重要 / IMPORTANT</strong><br>受取キーを紛失した場合は、AP番号を用意して管理者へご相談ください。確認のうえ、キーの案内または再発行を行います。</div><button id="check" type="button">登録書を確認 / CHECK</button>'
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

      // 運用方針として受取キーは再発行しないため、管理画面の再発行ボタンだけ非表示にする。
      // APIそのものには触れず、既存処理の巻き戻しリスクを避ける。
      page = page.replace(/<button[^>]*class=["'][^"']*resetKey[^"']*["'][^>]*>受取キー再発行<\/button>/g, "");
      page = page.replace(/<button[^>]*>受取キー再発行<\/button>/g, "");

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
