const ORIGIN = "https://bunka-shiryoshitsu.github.io";

const MAX = 5 * 1024 * 1024;

const AP_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXY3456789";

const TYPES = {
  type1: "第1種登録（基本登録）",
  type2: "第2種登録",
  type3: "第3種登録",
  special: "特別登録"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors()
      });
    }

    /*
     * Workerのルート
     */
    if (request.method === "GET" && path === "/") {
      return html(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>文化資料登録室 Worker</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:40px;text-align:center">
<h1>文化資料登録室</h1>
<p>Workerは正常に稼働しています。</p>
</body>
</html>
`);
    }

    /*
     * サイト監視
     */
    if (
      request.method === "POST" &&
      path === "/site-monitor"
    ) {
      if (
        await rateLimited(
          request,
          env,
          "SITE"
        )
      ) {
        return rateLimit();
      }

      return text("OK");
    }

    /*
     * 登録番号確認
     */
    if (
      (request.method === "GET" ||
        request.method === "POST") &&
      path === "/check"
    ) {
      return checkRegistration(
        request,
        env
      );
    }

    /*
     * 抽選申込み
     */
    if (
      request.method === "POST" &&
      path === "/lottery-apply"
    ) {
      return lotteryApply(
        request,
        env
      );
    }

    /*
     * 抽選結果確認
     */
    if (
      request.method === "POST" &&
      path === "/check-application"
    ) {
      return checkApplication(
        request,
        env
      );
    }

    /*
     * 当選情報管理
     */
    if (
      request.method === "GET" &&
      path === "/admin-winners"
    ) {
      return winnerPage();
    }

    if (
      request.method === "POST" &&
      path === "/admin-winners/save"
    ) {
      return saveWinner(
        request,
        env
      );
    }

    /*
     * 申請画像
     */
    if (
      request.method === "POST" &&
      path === "/image-upload"
    ) {
      return imageUpload(
        request,
        env
      );
    }

    /*
     * 登録申請
     */
    if (
      request.method === "POST" &&
      path === "/registration-submit"
    ) {
      return registrationSubmit(
        request,
        env
      );
    }

    /*
     * 管理画面
     */
    if (
      request.method === "GET" &&
      path === "/admin"
    ) {
      return adminPage();
    }

    if (
      request.method === "GET" &&
      path === "/admin/application"
    ) {
      return adminApplication(
        request,
        env
      );
    }

    if (
      request.method === "GET" &&
      path === "/admin/applications"
    ) {
      return adminApplications(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      path === "/admin/review"
    ) {
      return reviewApplication(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      path === "/admin/issued-data-upload"
    ) {
      return issuedDataUpload(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      path === "/admin/cancel"
    ) {
      return cancelRegistration(
        request,
        env
      );
    }

    if (
      request.method === "GET" &&
      path === "/admin/image"
    ) {
      return adminImage(
        request,
        env
      );
    }

    /*
     * 発行データ受取
     */
    if (
      request.method === "GET" &&
      path === "/receive-status"
    ) {
      return receiveStatus(
        request,
        env
      );
    }

    if (
      request.method === "GET" &&
      path === "/receive"
    ) {
      return receivePage(
        request,
        env
      );
    }

    if (
      request.method === "GET" &&
      path === "/receive-file"
    ) {
      return receiveFile(
        request,
        env
      );
    }

    return text(
      "Not Found",
      404
    );
  }
};


/* =========================================================
   共通
========================================================= */

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,X-Admin-Key"
  };
}

function text(
  value,
  status = 200
) {
  return new Response(
    value,
    {
      status,
      headers: {
        ...cors(),
        "Content-Type":
          "text/plain; charset=UTF-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

function json(
  value,
  status = 200
) {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        ...cors(),
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

function html(
  value,
  status = 200
) {
  return new Response(
    value,
    {
      status,
      headers: {
        ...cors(),
        "Content-Type":
          "text/html; charset=UTF-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeAP(value) {
  let v = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(
      /[Ａ-Ｚａ-ｚ０-９]/g,
      c =>
        String.fromCharCode(
          c.charCodeAt(0) - 65248
        )
    )
    .replace(/\s/g, "");

  if (!/^AP-[A-Z0-9]{8}$/.test(v)) {
    return null;
  }

  if (
    ![...v.slice(3)].every(c =>
      AP_CHARS.includes(c)
    )
  ) {
    return null;
  }

  return v;
}

function validRegistrationNumber(
  value
) {
  return /^[A-Z0-9]{8}$/.test(
    String(value ?? "")
      .trim()
      .toUpperCase()
  );
}

function normalizeRegistrationNumber(
  value
) {
  const number = String(value ?? "")
    .trim()
    .toUpperCase();

  return validRegistrationNumber(number)
    ? number
    : null;
}

function isAdmin(
  request,
  env
) {
  return Boolean(
    env.ADMIN_KEY &&
    request.headers.get(
      "X-Admin-Key"
    ) === env.ADMIN_KEY
  );
}

function unauthorized() {
  return json(
    {
      success: false,
      message: "Unauthorized."
    },
    401
  );
}

function generateAP() {
  let result = "";

  for (let i = 0; i < 8; i++) {
    result +=
      AP_CHARS[
        Math.floor(
          Math.random() *
            AP_CHARS.length
        )
      ];
  }

  return "AP-" + result;
}

function japanDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}

async function sha256(value) {
  const data =
    new TextEncoder().encode(value);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  return [...new Uint8Array(hash)]
    .map(x =>
      x.toString(16).padStart(2, "0")
    )
    .join("");
}

async function rateLimited(
  request,
  env,
  prefix
) {
  const ip =
    request.headers.get(
      "CF-Connecting-IP"
    ) || "unknown";

  const hash =
    await sha256(ip);

  const keys = [
    `RATE_${prefix}_M_${hash}`,
    `RATE_${prefix}_H_${hash}`,
    `RATE_${prefix}_D_${hash}`
  ];

  const limits = [
    10,
    100,
    500
  ];

  const ttl = [
    60,
    3600,
    86400
  ];

  for (let i = 0; i < 3; i++) {
    const count =
      Number(
        await env.REGISTRATION_KV.get(
          keys[i]
        )
      ) || 0;

    if (count >= limits[i]) {
      return true;
    }

    await env.REGISTRATION_KV.put(
      keys[i],
      String(count + 1),
      {
        expirationTtl:
          ttl[i]
      }
    );
  }

  return false;
}

function rateLimit() {
  return text(
    "しばらく時間をおいてから、もう一度お試しください。",
    429
  );
}


/* =========================================================
   登録番号確認
========================================================= */

/*
 * 公開照会専用。
 *
 * 以下の形式をすべて確認する。
 *
 * 1. F8ZB225Y
 * 2. REGISTRATION:F8ZB225Y
 * 3. REGISTRATION_F8ZB225Y
 * 4. REGISTRATION-F8ZB225Y
 *
 * ここでは「登録番号が存在するか」だけを見る。
 *
 * getRegistration()とは分離する。
 * getNextRegistrationNumber()などの内部処理では
 * getRegistration()を使用するため。
 */
async function registrationExists(
  env,
  number
) {
  const normalized =
    normalizeRegistrationNumber(
      number
    );

  if (!normalized) {
    return false;
  }

  /*
   * 旧方式の登録番号在庫を先に確認。
   * KVのlist()は使わず、既知キーを直接読む。
   */
  const legacyListKeys = [
    "REGISTRATION_LIST",
    "REGISTRATION_LIST1",
    "REGISTRATION_LIST2",
    "REGISTRATION_LIST3",
    "REGISTRATION_LIST4",
    "REGISTRATION_LIST5",
    "REGISTRATION_LIST6",
    "REGISTRATION_LIST7",
    "REGISTRATION_LIST8",
    "REGISTRATION_LIST9",
    "REGISTRATION_LIST10",
    "REGISTRATION_LIST11",
    "REGISTRATION_LIST12",
    "REGISTRATION_LIST13",
    "REGISTRATION_LIST14",
    "REGISTRATION_LIST15",
    "REGISTRATION_LIST16",
    "REGISTRATION_LIST17",
    "REGISTRATION_LIST18",
    "REGISTRATION_LIST19",
    "REGISTRATION_LIST20"
  ];

  for (const key of legacyListKeys) {
    const value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) {
      continue;
    }

    let list;

    try {
      list =
        JSON.parse(value);
    } catch {
      continue;
    }

    if (!Array.isArray(list)) {
      continue;
    }

    for (const raw of list) {
      const candidate =
        String(raw || "")
          .trim()
          .toUpperCase();

      if (
        candidate === normalized
      ) {
        return true;
      }
    }
  }

  /*
   * 新方式・単独キーも確認。
   */
  const directKeys = [
    normalized,
    "REGISTRATION:" + normalized,
    "REGISTRATION_" + normalized,
    "REGISTRATION-" + normalized
  ];

  for (const key of directKeys) {
    const value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) {
      continue;
    }

    try {
      const data =
        JSON.parse(value);

      if (
        data &&
        data.status === "cancelled"
      ) {
        continue;
      }
    } catch {
      /*
       * JSONでない値でも、
       * キーが存在すれば登録あり。
       */
    }

    return true;
  }

  return false;
}

async function checkRegistration(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "REGISTRATION"
    )
  ) {
    return rateLimit();
  }

  let number = "";

  if (request.method === "GET") {
    number =
      new URL(request.url)
        .searchParams
        .get("number") || "";
  } else {
    try {
      const body =
        await request.json();

      number =
        body.number || "";
    } catch {
      number = "";
    }
  }

  number =
    String(number)
      .trim()
      .toUpperCase();

  /*
   * 公開照会では登録データそのものを取得せず、
   * 登録番号の存在だけを確認する。
   */
  const registered =
    await registrationExists(
      env,
      number
    );

  if (request.method === "POST") {
    return text(
      registered
        ? "登録あり"
        : "登録なし"
    );
  }

  return html(
    `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">
<title>登録番号確認</title>
<style>
body{
font-family:system-ui,sans-serif;
background:#f7f7f7;
margin:0;
padding:40px 15px;
text-align:center;
color:#222
}
.box{
max-width:620px;
margin:auto;
background:#fff;
padding:30px;
border:1px solid #ccc;
border-radius:10px
}
.result{
font-size:27px;
font-weight:bold;
margin:25px 0
}
.ok{color:#064}
.ng{color:#900}
</style>
</head>
<body>
<div class="box">
<h1>登録番号確認ページ</h1>
<div class="result ${
      registered
        ? "ok"
        : "ng"
    }">
${
  registered
    ? "登録済み"
    : "登録されていません"
}
</div>
${
  registered
    ? `
<p>
この登録番号は、文化資料登録室の
登録番号データベースに登録されています。
</p>
<p>
登録番号：
${escapeHtml(number)}
</p>
`
    : `
<p>
この登録番号は確認できません。
</p>
`
}
</div>
</body>
</html>
`
  );
}


/* =========================================================
   抽選申込み
========================================================= */

async function lotteryApply(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "LOTTERY"
    )
  ) {
    return json(
      {
        success: false,
        message:
          "しばらく時間をおいてから、もう一度お試しください。"
      },
      429
    );
  }

  try {
    const today =
      japanDate();

    const month =
      today.slice(0, 7);

    const ip =
      request.headers.get(
        "CF-Connecting-IP"
      ) || "unknown";

    const ipHash =
      await sha256(ip);

    const dailyKey =
      `LOTTERY_IP_D_${month}_${today}_${ipHash}`;

    if (
      await env.REGISTRATION_KV.get(
        dailyKey
      )
    ) {
      return json(
        {
          success: false,
          duplicate: true,
          message:
            "本日の抽選申込みはすでに受け付けています。"
        },
        409
      );
    }

    let applicationNumber =
      null;

    for (let i = 0; i < 20; i++) {
      const candidate =
        generateAP();

      if (
        !await env.REGISTRATION_KV.get(
          "APPLICATION_" +
            candidate
        )
      ) {
        applicationNumber =
          candidate;
        break;
      }
    }

    if (!applicationNumber) {
      return json(
        {
          success: false,
          message:
            "申込み番号の発行に失敗しました。"
        },
        500
      );
    }

    await env.REGISTRATION_KV.put(
      "APPLICATION_" +
        applicationNumber,
      JSON.stringify({
        ap: applicationNumber,
        applicationMonth: month,
        appliedDate: today,
        appliedAt:
          new Date().toISOString(),
        status: "received"
      })
    );

    await env.REGISTRATION_KV.put(
      dailyKey,
      applicationNumber,
      {
        expirationTtl: 172800
      }
    );

    return json({
      success: true,
      ap: applicationNumber,
      applicationMonth: month,
      message:
        "抽選申込みを受け付けました。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "抽選申込みの受付に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   当選情報
========================================================= */

async function getWinner(
  env,
  ap
) {
  const value =
    await env.REGISTRATION_KV.get(
      "WINNER_" + ap
    );

  if (!value) {
    return {
      active: false
    };
  }

  try {
    const data =
      JSON.parse(value);

    const today =
      japanDate();

    if (
      data.expiryDate &&
      today > data.expiryDate
    ) {
      return {
        active: false,
        status: "expired"
      };
    }

    if (
      data.checkStart &&
      today < data.checkStart
    ) {
      if (data.savedAt) {
        const savedDate =
          String(
            data.savedAt
          ).slice(0, 10);

        if (
          savedDate &&
          savedDate <= today
        ) {
          return {
            active: true,
            slots: Number(
              data.slots
            ),
            applicationMonth:
              data.applicationMonth ||
              ""
          };
        }
      }

      return {
        active: false,
        status: "not_started"
      };
    }

    const slots =
      Number(data.slots);

    if (
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > 10
    ) {
      return {
        active: false
      };
    }

    return {
      active: true,
      slots,
      applicationMonth:
        data.applicationMonth ||
        ""
    };

  } catch {
    return {
      active: false
    };
  }
}


/* =========================================================
   抽選結果確認
========================================================= */

async function checkApplication(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "APPLICATION"
    )
  ) {
    return json(
      {
        winner: false,
        message:
          "しばらく時間をおいてから、もう一度お試しください。"
      },
      429
    );
  }

  try {
    const body =
      await request.json();

    const ap =
      normalizeAP(body.ap);

    if (!ap) {
      return json({
        winner: false,
        message:
          "今回の抽選では、登録申請の対象となっていません。"
      });
    }

    const winner =
      await getWinner(
        env,
        ap
      );

    if (!winner.active) {
      return json({
        winner: false,
        status:
          winner.status ||
          "not_winner",
        message:
          winner.status ===
          "not_started"
            ? "抽選結果はまだ確認できません。"
            : winner.status ===
              "expired"
            ? "この当選による登録申請は、有効期限を過ぎています。"
            : "今回の抽選では、登録申請の対象となっていません。"
      });
    }

    const value =
      await env.REGISTRATION_KV.get(
        "REGISTRATION_APPLICATION:" +
          ap
      );

    if (!value) {
      return json({
        winner: true,
        status: "active",
        slots: winner.slots,
        message:
          "今回の抽選に当選しています。"
      });
    }

    let application;

    try {
      application =
        JSON.parse(value);
    } catch {
      return json({
        winner: true,
        status: "received",
        slots: winner.slots,
        message:
          "登録申請を受け付けています。"
      });
    }

    const numbers =
      Array.isArray(
        application.registrationNumbers
      )
        ? application.registrationNumbers
        : [];

    if (!numbers.length) {
      return json({
        winner: true,
        status:
          application.status ||
          "received",
        slots: winner.slots,
        message:
          application.status ===
          "rejected"
            ? "今回の登録申請は不承認となりました。"
            : application.status ===
              "additional_check"
            ? "現在、追加確認中です。"
            : "登録申請を受け付けています。"
      });
    }

    const readyNumbers = [];
    const preparingNumbers = [];

    for (
      const entry of numbers
    ) {
      const registrationNumber =
        String(
          entry.registrationNumber ||
            ""
        )
          .trim()
          .toUpperCase();

      if (
        !validRegistrationNumber(
          registrationNumber
        )
      ) {
        preparingNumbers.push(
          entry
        );
        continue;
      }

      const ready =
        await env.REGISTRATION_KV.get(
          "ISSUED_DATA_META:" +
            registrationNumber
        );

      if (ready) {
        readyNumbers.push(
          entry
        );
      } else {
        preparingNumbers.push(
          entry
        );
      }
    }

    const status =
      readyNumbers.length ===
      numbers.length
        ? "registered"
        : "document_preparing";

    return json({
      winner: true,
      status,
      slots: winner.slots,
      registrationNumbers:
        numbers,
      readyNumbers,
      preparingNumbers,
      message:
        status === "registered"
          ? "登録書が完成しました。発行データを受け取ることができます。"
          : "審査完了です。登録書完成までしばらくお待ちください。登録書完成後、登録番号を使って発行データを受け取ることができます。"
    });

  } catch {
    return json({
      winner: false,
      message:
        "今回の抽選では、登録申請の対象となっていません。"
    });
  }
}


/* =========================================================
   当選情報保存
========================================================= */

async function saveWinner(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  try {
    const body =
      await request.json();

    const ap =
      normalizeAP(body.ap);

    const slots =
      Number(body.slots);

    const month =
      String(
        body.applicationMonth ||
          ""
      ).trim();

    if (
      !ap ||
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > 10 ||
      !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(
        month
      )
    ) {
      return json(
        {
          success: false,
          message:
            "入力内容が正しくありません。"
        },
        400
      );
    }

    const savedAt =
      new Date();

    const checkStart =
      japanDate();

    const expiry =
      new Date(
        savedAt.getTime() +
          60 * 24 * 60 * 60 * 1000
      );

    const expiryDate =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).format(expiry);

    await env.REGISTRATION_KV.put(
      "WINNER_" + ap,
      JSON.stringify({
        slots,
        applicationMonth:
          month,
        checkStart,
        expiryDate,
        savedAt:
          savedAt.toISOString()
      })
    );

    await env.REGISTRATION_KV.put(
      "APPLICATION_STATUS:" +
        ap,
      "winner"
    );

    return json({
      success: true,
      ap,
      slots,
      applicationMonth:
        month,
      checkStart,
      expiryDate,
      message:
        "当選情報を保存しました。保存直後から確認できます。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "当選情報の保存に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   申請画像
========================================================= */

async function imageUpload(
  request,
  env
) {
  const url =
    new URL(request.url);

  const ap =
    normalizeAP(
      url.searchParams.get("ap")
    );

  const item =
    url.searchParams.get("item");

  const image =
    url.searchParams.get("image");

  if (
    !ap ||
    !/^(0[1-9]|10)$/.test(
      item || ""
    ) ||
    !/^(0[1-9]|1[0-9]|20)$/.test(
      image || ""
    )
  ) {
    return json(
      {
        success: false,
        error:
          "入力内容が正しくありません。"
      },
      400
    );
  }

  const winner =
    await getWinner(
      env,
      ap
    );

  if (
    !winner.active ||
    Number(item) >
      winner.slots
  ) {
    return json(
      {
        success: false,
        error:
          "登録申請の対象ではありません。"
      },
      403
    );
  }

  if (
    await env.REGISTRATION_KV.get(
      "REGISTRATION_APPLICATION:" +
        ap
    )
  ) {
    return json(
      {
        success: false,
        error:
          "このAP番号の登録申請はすでに送信されています。"
      },
      409
    );
  }

  try {
    const form =
      await request.formData();

    const file =
      form.get("image");

    if (!(file instanceof File)) {
      return json(
        {
          success: false,
          error:
            "画像データがありません。"
        },
        400
      );
    }

    if (
      file.type !==
      "image/jpeg"
    ) {
      return json(
        {
          success: false,
          error:
            "JPG形式の画像をアップロードしてください。"
        },
        415
      );
    }

    if (
      file.size <= 0 ||
      file.size > MAX
    ) {
      return json(
        {
          success: false,
          error:
            "画像は5MB以下で指定してください。"
        },
        413
      );
    }

    const key =
      `IMAGE:${ap}:${item}:${image}`;

    if (
      await env.REGISTRATION_KV.get(
        `IMAGE_META:${ap}:${item}:${image}`
      )
    ) {
      return json({
        success: true,
        duplicate: true,
        message:
          "この画像番号はすでに登録されています。"
      });
    }

    await env.REGISTRATION_KV.put(
      key,
      await file.arrayBuffer()
    );

    await env.REGISTRATION_KV.put(
      `IMAGE_META:${ap}:${item}:${image}`,
      JSON.stringify({
        ap,
        item,
        image,
        uploadedAt:
          new Date().toISOString()
      })
    );

    return json({
      success: true,
      duplicate: false,
      ap,
      item,
      image,
      message:
        "画像を保存しました。"
    });

  } catch {
    return json(
      {
        success: false,
        error:
          "画像データを読み取れませんでした。"
      },
      400
    );
  }
}


/* =========================================================
   登録申請
========================================================= */

async function registrationSubmit(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "SUBMIT"
    )
  ) {
    return json(
      {
        success: false,
        message:
          "しばらく時間をおいてから、もう一度お試しください。"
      },
      429
    );
  }

  try {
    const body =
      await request.json();

    const ap =
      normalizeAP(body.ap);

    if (!ap) {
      return json(
        {
          success: false,
          message:
            "AP番号が正しくありません。"
        },
        400
      );
    }

    const winner =
      await getWinner(
        env,
        ap
      );

    if (!winner.active) {
      return json(
        {
          success: false,
          message:
            "登録申請の対象ではありません。"
        },
        403
      );
    }

    const key =
      "REGISTRATION_APPLICATION:" +
      ap;

    if (
      await env.REGISTRATION_KV.get(
        key
      )
    ) {
      return json(
        {
          success: false,
          message:
            "このAP番号の登録申請はすでに送信されています。"
        },
        409
      );
    }

    if (
      !Array.isArray(body.items) ||
      body.items.length !==
        winner.slots
    ) {
      return json(
        {
          success: false,
          message:
            "登録資料数が当選枠数と一致していません。"
        },
        400
      );
    }

    const items = [];

    for (
      let i = 0;
      i < body.items.length;
      i++
    ) {
      const source =
        body.items[i] || {};

      const item =
        String(
          source.item ||
            String(
              i + 1
            ).padStart(2, "0")
        );

      const name =
        String(
          source.name || ""
        ).trim();

      const relatedName =
        String(
          source.relatedName ||
            ""
        ).trim();

      const acquisition =
        String(
          source.acquisition ||
            ""
        ).trim();

      if (
        item !==
          String(
            i + 1
          ).padStart(2, "0") ||
        !name ||
        name.length > 200 ||
        relatedName.length > 200 ||
        acquisition.length > 5000
      ) {
        return json(
          {
            success: false,
            message:
              "入力内容が正しくありません。"
          },
          400
        );
      }

      let hasImage = false;

      for (
        let n = 1;
        n <= 20;
        n++
      ) {
        const image =
          String(n).padStart(
            2,
            "0"
          );

        if (
          await env.REGISTRATION_KV.get(
            `IMAGE:${ap}:${item}:${image}`
          )
        ) {
          hasImage = true;
          break;
        }
      }

      if (!hasImage) {
        return json(
          {
            success: false,
            message:
              "各資料には少なくとも1枚の画像が必要です。"
          },
          400
        );
      }

      items.push({
        item,
        name,
        relatedName,
        acquisition
      });
    }

    const application = {
      ap,
      slots:
        winner.slots,
      applicationMonth:
        winner.applicationMonth,
      submittedAt:
        new Date().toISOString(),
      status:
        "received",
      items
    };

    await env.REGISTRATION_KV.put(
      key,
      JSON.stringify(
        application
      )
    );

    await env.REGISTRATION_KV.put(
      "APPLICATION_STATUS:" +
        ap,
      "received"
    );

    return json({
      success: true,
      ap,
      slots:
        winner.slots,
      message:
        "登録申請を受け付けました。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "登録申請の送信に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   登録番号在庫
========================================================= */

async function registrationListKeys(
  env
) {
  const keys = [];
  let cursor;

  do {
    const result =
      await env.REGISTRATION_KV.list(
        {
          prefix:
            "REGISTRATION_LIST",
          limit: 1000,
          cursor
        }
      );

    for (
      const key of result.keys
    ) {
      if (
        /^REGISTRATION_LIST(?:\d+)?$/.test(
          key.name
        )
      ) {
        keys.push(
          key.name
        );
      }
    }

    cursor =
      result.list_complete
        ? undefined
        : result.cursor;

  } while (cursor);

  return [
    ...new Set(keys)
  ].sort((a, b) => {
    const number =
      x =>
        x ===
        "REGISTRATION_LIST"
          ? 0
          : Number(
              x.slice(17)
            );

    return (
      number(a) -
      number(b)
    );
  });
}

async function getNextRegistrationNumber(
  env
) {
  const keys =
    await registrationListKeys(
      env
    );

  for (
    const key of keys
  ) {
    const value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) continue;

    let list;

    try {
      list =
        JSON.parse(value);
    } catch {
      continue;
    }

    if (!Array.isArray(list)) {
      continue;
    }

    for (
      const raw of list
    ) {
      const number =
        String(
          raw || ""
        )
          .trim()
          .toUpperCase();

      if (
        !validRegistrationNumber(
          number
        )
      ) {
        continue;
      }

      if (
        await getRegistration(
          env,
          number
        )
      ) {
        continue;
      }

      return number;
    }
  }

  return null;
}

async function removeRegistrationNumberFromPool(
  env,
  number
) {
  const normalized =
    normalizeRegistrationNumber(
      number
    );

  if (!normalized) {
    return false;
  }

  const keys =
    await registrationListKeys(
      env
    );

  for (
    const key of keys
  ) {
    const value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) continue;

    let list;

    try {
      list =
        JSON.parse(value);
    } catch {
      continue;
    }

    if (!Array.isArray(list)) {
      continue;
    }

    const filtered =
      list.filter(
        x =>
          String(x || "")
            .trim()
            .toUpperCase() !==
          normalized
      );

    if (
      filtered.length !==
      list.length
    ) {
      await env.REGISTRATION_KV.put(
        key,
        JSON.stringify(
          filtered
        )
      );

      return true;
    }
  }

  return false;
}


/* =========================================================
   登録データ
========================================================= */

async function getRegistration(
  env,
  number
) {
  const normalized =
    normalizeRegistrationNumber(
      number
    );

  if (!normalized) {
    return null;
  }

  const keys = [
    "REGISTRATION:" +
      normalized,

    "REGISTRATION_" +
      normalized,

    "REGISTRATION-" +
      normalized
  ];

  for (
    const key of keys
  ) {
    const value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) {
      continue;
    }

    try {
      const data =
        JSON.parse(value);

      if (
        data.status ===
        "cancelled"
      ) {
        return null;
      }

      if (
        data.registrationNumber
      ) {
        const storedNumber =
          String(
            data.registrationNumber
          )
            .trim()
            .toUpperCase();

        if (
          storedNumber !==
          normalized
        ) {
          continue;
        }
      }

      return data;

    } catch {
      continue;
    }
  }

  return null;
}


/* =========================================================
   ステータス
========================================================= */

function calculateApplicationStatus(
  items
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return "under_review";
  }

  const allRegistered =
    items.every(
      item =>
        item.registrationStatus ===
        "registered"
    );

  if (allRegistered) {
    const allIssued =
      items.every(
        item =>
          item.issuedDataReady ===
          true
      );

    return allIssued
      ? "registered"
      : "document_preparing";
  }

  if (
    items.every(
      item =>
        item.reviewResult ===
        "rejected"
    )
  ) {
    return "rejected";
  }

  if (
    items.some(
      item =>
        item.reviewResult ===
        "additional_check"
    )
  ) {
    return "additional_check";
  }

  if (
    items.every(
      item =>
        [
          "rejected",
          "additional_check",
          "type1",
          "type2",
          "type3",
          "special"
        ].includes(
          item.reviewResult
        )
    )
  ) {
    return "partially_reviewed";
  }

  return "under_review";
}


/* =========================================================
   審査
========================================================= */

async function reviewApplication(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  try {
    const body =
      await request.json();

    const ap =
      normalizeAP(body.ap);

    const item =
      String(
        body.item || ""
      );

    const result =
      String(
        body.result || ""
      );

    if (
      !ap ||
      !/^(0[1-9]|10)$/.test(
        item
      ) ||
      ![
        "type1",
        "type2",
        "type3",
        "special",
        "additional_check",
        "rejected"
      ].includes(result)
    ) {
      return json(
        {
          success: false,
          message:
            "入力内容が正しくありません。"
        },
        400
      );
    }

    const applicationKey =
      "REGISTRATION_APPLICATION:" +
      ap;

    const value =
      await env.REGISTRATION_KV.get(
        applicationKey
      );

    if (!value) {
      return json(
        {
          success: false,
          message:
            "登録申請が見つかりません。"
        },
        404
      );
    }

    const application =
      JSON.parse(value);

    const target =
      application.items?.find(
        x =>
          String(x.item) ===
          item
      );

    if (!target) {
      return json(
        {
          success: false,
          message:
            "指定された資料が見つかりません。"
        },
        404
      );
    }

    if (
      target.registrationStatus ===
      "registered"
    ) {
      return json(
        {
          success: false,
          alreadyRegistered: true,
          message:
            "この資料はすでに登録済みです。"
        },
        409
      );
    }

    const now =
      new Date().toISOString();

    if (
      result ===
        "additional_check" ||
      result ===
        "rejected"
    ) {
      target.reviewResult =
        result;

      target.reviewedAt =
        now;

      target.registrationType =
        null;

      target.registrationTypeLabel =
        null;

      application.reviewedAt =
        now;

      application.status =
        calculateApplicationStatus(
          application.items
        );

      await env.REGISTRATION_KV.put(
        applicationKey,
        JSON.stringify(
          application
        )
      );

      await env.REGISTRATION_KV.put(
        "APPLICATION_STATUS:" +
          ap,
        application.status
      );

      return json({
        success: true,
        ap,
        item,
        result,
        status:
          application.status,
        message:
          result ===
          "additional_check"
            ? "追加確認として保存しました。"
            : "不承認として保存しました。"
      });
    }

    const registrationNumber =
      await getNextRegistrationNumber(
        env
      );

    if (!registrationNumber) {
      return json(
        {
          success: false,
          message:
            "登録番号の在庫がありません。"
        },
        409
      );
    }

    const registrationData = {
      registrationNumber,
      ap,
      item,
      name:
        target.name,
      relatedName:
        target.relatedName,
      acquisition:
        target.acquisition,
      registrationType:
        result,
      registrationTypeLabel:
        TYPES[result],
      registeredAt:
        now,
      status:
        "registered",
      issuedData:
        false,
      issuedDataReady:
        false
    };

    await env.REGISTRATION_KV.put(
      "REGISTRATION:" +
        registrationNumber,
      JSON.stringify(
        registrationData
      )
    );

    await removeRegistrationNumberFromPool(
      env,
      registrationNumber
    );

    target.reviewResult =
      result;

    target.registrationType =
      result;

    target.registrationTypeLabel =
      TYPES[result];

    target.reviewedAt =
      now;

    target.registrationNumber =
      registrationNumber;

    target.registeredAt =
      now;

    target.registrationStatus =
      "registered";

    target.issuedData =
      false;

    target.issuedDataReady =
      false;

    application.registrationNumbers =
      Array.isArray(
        application.registrationNumbers
      )
        ? application.registrationNumbers
        : [];

    application.registrationNumbers.push(
      {
        item,
        registrationNumber,
        registrationType:
          result,
        registrationTypeLabel:
          TYPES[result]
      }
    );

    application.reviewedAt =
      now;

    application.status =
      calculateApplicationStatus(
        application.items
      );

    await env.REGISTRATION_KV.put(
      applicationKey,
      JSON.stringify(
        application
      )
    );

    await env.REGISTRATION_KV.put(
      "APPLICATION_STATUS:" +
        ap,
      application.status
    );

    await deleteApplicationImages(
      env,
      ap,
      [target]
    );

    return json({
      success: true,
      ap,
      item,
      result,
      registrationType:
        TYPES[result],
      registrationNumber,
      status:
        application.status,
      message:
        "審査に合格し、登録番号を発行しました。登録書完成までしばらくお待ちください。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "審査・登録番号発行処理に失敗しました。"
      },
      500
    );
  }
}

async function deleteApplicationImages(
  env,
  ap,
  items
) {
  for (
    const item of items
  ) {
    for (
      let i = 1;
      i <= 20;
      i++
    ) {
      const image =
        String(i).padStart(
          2,
          "0"
        );

      await env.REGISTRATION_KV.delete(
        `IMAGE:${ap}:${item.item}:${image}`
      );

      await env.REGISTRATION_KV.delete(
        `IMAGE_META:${ap}:${item.item}:${image}`
      );
    }
  }
}


/* =========================================================
   登録書完成後のJPG
========================================================= */

async function issuedDataUpload(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  try {
    const form =
      await request.formData();

    const number =
      String(
        form.get(
          "registrationNumber"
        ) || ""
      )
        .trim()
        .toUpperCase();

    const file =
      form.get("file");

    if (
      !validRegistrationNumber(
        number
      )
    ) {
      return json(
        {
          success: false,
          message:
            "登録番号が正しくありません。"
        },
        400
      );
    }

    if (!(file instanceof File)) {
      return json(
        {
          success: false,
          message:
            "登録書のJPGファイルを選択してください。"
        },
        400
      );
    }

    if (
      file.type !==
      "image/jpeg"
    ) {
      return json(
        {
          success: false,
          message:
            "JPG形式の画像をアップロードしてください。"
        },
        415
      );
    }

    if (
      file.size <= 0 ||
      file.size > MAX
    ) {
      return json(
        {
          success: false,
          message:
            "JPGファイルは5MB以下で指定してください。"
        },
        413
      );
    }

    const registrationKey =
      "REGISTRATION:" +
      number;

    let value =
      await env.REGISTRATION_KV.get(
        registrationKey
      );

    let actualKey =
      registrationKey;

    if (!value) {
      actualKey =
        "REGISTRATION_" +
        number;

      value =
        await env.REGISTRATION_KV.get(
          actualKey
        );
    }

    if (!value) {
      return json(
        {
          success: false,
          message:
            "登録番号が確認できません。"
        },
        404
      );
    }

    const registration =
      JSON.parse(value);

    if (
      registration.status ===
      "cancelled"
    ) {
      return json(
        {
          success: false,
          message:
            "この登録番号は取消状態です。"
        },
        409
      );
    }

    const now =
      new Date().toISOString();

    await env.REGISTRATION_KV.put(
      "ISSUED_DATA:" +
        number,
      await file.arrayBuffer()
    );

    await env.REGISTRATION_KV.put(
      "ISSUED_DATA_META:" +
        number,
      JSON.stringify({
        registrationNumber:
          number,
        uploadedAt:
          now,
        contentType:
          "image/jpeg",
        fileName:
          file.name ||
          number + ".jpg"
      })
    );

    registration.issuedData =
      true;

    registration.issuedDataReady =
      true;

    registration.issuedDataUploadedAt =
      now;

    await env.REGISTRATION_KV.put(
      actualKey,
      JSON.stringify(
        registration
      )
    );

    const applicationKey =
      "REGISTRATION_APPLICATION:" +
      registration.ap;

    const applicationValue =
      await env.REGISTRATION_KV.get(
        applicationKey
      );

    if (applicationValue) {
      const application =
        JSON.parse(
          applicationValue
        );

      const target =
        application.items?.find(
          x =>
            String(x.item) ===
            String(
              registration.item
            )
        );

      if (target) {
        target.issuedData =
          true;

        target.issuedDataReady =
          true;

        target.issuedDataUploadedAt =
          now;
      }

      application.status =
        calculateApplicationStatus(
          application.items
        );

      await env.REGISTRATION_KV.put(
        applicationKey,
        JSON.stringify(
          application
        )
      );

      await env.REGISTRATION_KV.put(
        "APPLICATION_STATUS:" +
          registration.ap,
        application.status
      );
    }

    return json({
      success: true,
      registrationNumber:
        number,
      ready: true,
      message:
        "登録書の発行データJPGを登録しました。発行データを受け取れる状態になりました。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "発行データJPGの登録に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   管理：申請一覧
========================================================= */

async function adminApplications(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  try {
    const result =
      await env.REGISTRATION_KV.list(
        {
          prefix:
            "REGISTRATION_APPLICATION:",
          limit: 100
        }
      );

    const applications = [];

    for (
      const key of result.keys
    ) {
      const value =
        await env.REGISTRATION_KV.get(
          key.name
        );

      if (!value) continue;

      try {
        const data =
          JSON.parse(value);

        applications.push({
          ap: data.ap,
          slots: data.slots,
          applicationMonth:
            data.applicationMonth,
          submittedAt:
            data.submittedAt,
          status:
            data.status,
          items:
            (data.items || [])
              .map(
                item => ({
                  item:
                    item.item,
                  name:
                    item.name,
                  reviewResult:
                    item.reviewResult ||
                    null,
                  registrationType:
                    item.registrationType ||
                    null,
                  registrationNumber:
                    item.registrationNumber ||
                    null,
                  registrationStatus:
                    item.registrationStatus ||
                    null,
                  issuedDataReady:
                    item.issuedDataReady ===
                    true
                })
              )
        });

      } catch {}
    }

    applications.sort(
      (a, b) =>
        String(
          b.submittedAt || ""
        ).localeCompare(
          String(
            a.submittedAt || ""
          )
        )
    );

    return json({
      success: true,
      applications,
      cursor:
        result.list_complete
          ? null
          : result.cursor,
      listComplete:
        result.list_complete
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "申請一覧の取得に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   管理：個別申請
========================================================= */

async function adminApplication(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  const ap =
    normalizeAP(
      new URL(request.url)
        .searchParams
        .get("ap")
    );

  if (!ap) {
    return json(
      {
        success: false,
        message:
          "AP番号が正しくありません。"
      },
      400
    );
  }

  const value =
    await env.REGISTRATION_KV.get(
      "REGISTRATION_APPLICATION:" +
        ap
    );

  if (!value) {
    return json(
      {
        success: false,
        message:
          "申請が見つかりません。"
      },
      404
    );
  }

  try {
    return json({
      success: true,
      application:
        JSON.parse(value)
    });
  } catch {
    return json(
      {
        success: false,
        message:
          "申請データが壊れています。"
      },
      500
    );
  }
}


/* =========================================================
   管理：申請画像
========================================================= */

async function adminImage(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return text(
      "Unauthorized",
      401
    );
  }

  const url =
    new URL(request.url);

  const ap =
    normalizeAP(
      url.searchParams.get("ap")
    );

  const item =
    url.searchParams.get("item");

  const image =
    url.searchParams.get("image");

  if (
    !ap ||
    !/^(0[1-9]|10)$/.test(
      item || ""
    ) ||
    !/^(0[1-9]|1[0-9]|20)$/.test(
      image || ""
    )
  ) {
    return text(
      "Invalid request",
      400
    );
  }

  const data =
    await env.REGISTRATION_KV.get(
      `IMAGE:${ap}:${item}:${image}`,
      {
        type: "arrayBuffer"
      }
    );

  if (!data) {
    return text(
      "Not Found",
      404
    );
  }

  return new Response(
    data,
    {
      status: 200,
      headers: {
        ...cors(),
        "Content-Type":
          "image/jpeg",
        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
   管理：登録取消
========================================================= */

async function cancelRegistration(
  request,
  env
) {
  if (!isAdmin(request, env)) {
    return unauthorized();
  }

  try {
    const body =
      await request.json();

    const number =
      normalizeRegistrationNumber(
        body.registrationNumber
      );

    if (!number) {
      return json(
        {
          success: false,
          message:
            "登録番号が正しくありません。"
        },
        400
      );
    }

    const key =
      "REGISTRATION:" +
      number;

    let actualKey = key;

    let value =
      await env.REGISTRATION_KV.get(
        key
      );

    if (!value) {
      actualKey =
        "REGISTRATION_" +
        number;

      value =
        await env.REGISTRATION_KV.get(
          actualKey
        );
    }

    if (!value) {
      return json(
        {
          success: false,
          message:
            "登録番号が見つかりません。"
        },
        404
      );
    }

    const data =
      JSON.parse(value);

    data.status =
      "cancelled";

    data.cancelledAt =
      new Date().toISOString();

    await env.REGISTRATION_KV.put(
      actualKey,
      JSON.stringify(data)
    );

    return json({
      success: true,
      registrationNumber:
        number,
      message:
        "登録を取消状態に変更しました。"
    });

  } catch {
    return json(
      {
        success: false,
        message:
          "登録取消に失敗しました。"
      },
      500
    );
  }
}


/* =========================================================
   発行データ受取：状態確認
========================================================= */

async function receiveStatus(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "RECEIVE_STATUS"
    )
  ) {
    return rateLimit();
  }

  const number =
    new URL(request.url)
      .searchParams
      .get("number")
      ?.trim()
      .toUpperCase();

  if (
    !validRegistrationNumber(
      number
    )
  ) {
    return json(
      {
        ready: false,
        message:
          "登録番号が正しくありません。"
      },
      400
    );
  }

  const registration =
    await getRegistration(
      env,
      number
    );

  if (!registration) {
    return json(
      {
        ready: false,
        message:
          "この登録番号は確認できません。"
      },
      404
    );
  }

  const ready =
    Boolean(
      await env.REGISTRATION_KV.get(
        "ISSUED_DATA_META:" +
          number
      )
    );

  return json({
    ready,
    registrationNumber:
      number,
    name:
      registration.name ||
      "",
    registrationType:
      registration.registrationTypeLabel ||
      "",
    message:
      ready
        ? "登録書が完成しました。発行データを受け取ることができます。"
        : "審査完了です。登録書完成までしばらくお待ちください。登録書完成後、登録番号を使って発行データを受け取ることができます。"
  });
}


/* =========================================================
   発行データ受取ページ
========================================================= */

async function receivePage(
  request,
  env
) {
  const number =
    new URL(request.url)
      .searchParams
      .get("number")
      ?.trim()
      .toUpperCase() || "";

  if (!number) {
    return html(
      receiveHTML()
    );
  }

  if (
    !validRegistrationNumber(
      number
    )
  ) {
    return html(
      receiveHTML(
        number,
        null,
        "登録番号が正しくありません。"
      )
    );
  }

  const registration =
    await getRegistration(
      env,
      number
    );

  if (!registration) {
    return html(
      receiveHTML(
        number,
        null,
        "この登録番号は確認できません。"
      )
    );
  }

  const ready =
    Boolean(
      await env.REGISTRATION_KV.get(
        "ISSUED_DATA_META:" +
          number
      )
    );

  return html(
    receiveHTML(
      number,
      registration,
      ready
        ? ""
        : "審査完了です。登録書完成までしばらくお待ちください。登録書完成後、登録番号を使って発行データを受け取ることができます。",
      ready
    )
  );
}


/* =========================================================
   発行データJPG取得
========================================================= */

async function receiveFile(
  request,
  env
) {
  if (
    await rateLimited(
      request,
      env,
      "RECEIVE_FILE"
    )
  ) {
    return rateLimit();
  }

  const number =
    new URL(request.url)
      .searchParams
      .get("number")
      ?.trim()
      .toUpperCase();

  if (
    !validRegistrationNumber(
      number
    )
  ) {
    return text(
      "登録番号が正しくありません。",
      400
    );
  }

  const registration =
    await getRegistration(
      env,
      number
    );

  if (!registration) {
    return text(
      "登録番号が確認できません。",
      404
    );
  }

  const data =
    await env.REGISTRATION_KV.get(
      "ISSUED_DATA:" +
        number,
      {
        type: "arrayBuffer"
      }
    );

  if (!data) {
    return text(
      "発行データは準備中です。",
      404
    );
  }

  return new Response(
    data,
    {
      status: 200,
      headers: {
        ...cors(),
        "Content-Type":
          "image/jpeg",
        "Content-Disposition":
          `inline; filename="${number}.jpg"`,
        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =========================================================
   受取ページHTML
========================================================= */

function receiveHTML(
  number = "",
  registration = null,
  message = "",
  ready = false
) {
  const name =
    registration?.name ||
    "";

  const type =
    registration?.registrationTypeLabel ||
    "";

  return `
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">
<title>発行データ受け取り</title>
<style>
body{
font-family:system-ui,sans-serif;
background:#f7f7f7;
margin:0;
padding:35px 15px;
color:#222;
text-align:center
}
.box{
max-width:620px;
margin:auto;
background:#fff;
padding:28px;
border:1px solid #ccc;
border-radius:10px
}
input{
width:100%;
box-sizing:border-box;
padding:12px;
font-size:18px;
margin:8px 0;
border:1px solid #999
}
button,a{
display:inline-block;
padding:12px 18px;
margin-top:10px;
font-size:16px;
text-decoration:none
}
button{
background:#222;
color:#fff;
border:0;
cursor:pointer
}
a{
background:#222;
color:#fff
}
.info{
background:#f5f5f5;
padding:12px;
margin-top:15px;
text-align:left;
line-height:1.8
}
.ok{color:#064}
.err{color:#900}
</style>
</head>
<body>
<div class="box">
<h1>発行データ受け取り</h1>

<p>
登録書完成後に発行された登録番号を入力してください。
</p>

<p>
発行データの受け取りには、登録番号が必要です。
</p>

<form method="get" action="/receive">
<input
name="number"
value="${escapeHtml(number)}"
placeholder="例：F8ZB225Y"
autocomplete="off">
<button type="submit">確認する</button>
</form>

${
  message
    ? `
<p class="${
        ready ? "ok" : "err"
      }">
${escapeHtml(message)}
</p>
`
    : ""
}

${
  ready && registration
    ? `
<div class="info">
<strong>登録番号：</strong>
${escapeHtml(number)}
<br>

<strong>資料名称：</strong>
${escapeHtml(name)}
<br>

<strong>登録区分：</strong>
${escapeHtml(type)}
</div>

<p class="ok">
登録書が完成しました。
発行データを受け取ることができます。
</p>

<a href="/receive-file?number=${encodeURIComponent(
        number
      )}">
発行データ（JPG）を受け取る
</a>
`
    : ""
}

</div>
</body>
</html>
`;
}


/* =========================================================
   当選番号管理画面
========================================================= */

function winnerPage() {
  return html(
    String.raw`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">
<title>Winner Registration</title>
<style>
body{
font-family:system-ui,sans-serif;
background:#f5f5f5;
padding:30px
}
.box{
max-width:650px;
margin:auto;
background:#fff;
padding:25px
}
input,button{
width:100%;
box-sizing:border-box;
padding:11px;
margin:7px 0;
font-size:16px
}
button{
background:#222;
color:#fff;
border:0;
cursor:pointer
}
</style>
</head>
<body>

<div class="box">

<h1>Winner Registration</h1>

<input
id="month"
type="month">

<input
id="ap"
placeholder="AP-K7M4P8Q9"
autocomplete="off">

<input
id="slots"
type="number"
min="1"
max="10"
value="1">

<button onclick="saveWinner()">
Save
</button>

<p id="message"></p>

</div>

<script>
function getKey(){
  let key =
    sessionStorage.getItem("ADMIN_KEY");

  if(!key){
    key = prompt(
      "管理者キーを入力してください"
    );

    if(key){
      sessionStorage.setItem(
        "ADMIN_KEY",
        key
      );
    }
  }

  return key;
}

function setCurrentMonth(){
  const month =
    new Date()
      .toISOString()
      .slice(0,7);

  document.getElementById(
    "month"
  ).value = month;
}

async function saveWinner(){
  const key = getKey();

  if(!key){
    return;
  }

  const response =
    await fetch(
      "/admin-winners/save",
      {
        method:"POST",
        headers:{
          "Content-Type":
            "application/json",
          "X-Admin-Key":key
        },
        body:JSON.stringify({
          applicationMonth:
            document.getElementById(
              "month"
            ).value,

          ap:
            document.getElementById(
              "ap"
            ).value,

          slots:
            Number(
              document.getElementById(
                "slots"
              ).value
            )
        })
      }
    );

  const data =
    await response.json();

  if(response.status===401){
    sessionStorage.removeItem(
      "ADMIN_KEY"
    );
  }

  document.getElementById(
    "message"
  ).textContent =
    data.message ||
    "Save failed.";
}

setCurrentMonth();
</script>

</body>
</html>
`
  );
}


/* =========================================================
   管理画面
========================================================= */

function adminPage() {
  return html(
    String.raw`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>文化資料登録室 管理画面</title>

<style>

body{
font-family:system-ui,sans-serif;
background:#f3f3f3;
margin:0;
padding:20px;
color:#222
}

.box{
max-width:1100px;
margin:auto;
background:#fff;
padding:22px
}

input,button{
font-size:16px;
padding:9px
}

button{
cursor:pointer
}

.search{
display:flex;
gap:8px;
margin:15px 0
}

.search input{
flex:1
}

.application{
border:1px solid #bbb;
padding:15px;
margin:15px 0
}

.item{
border-top:1px solid #ddd;
padding:15px 0
}

.buttons{
display:flex;
flex-wrap:wrap;
gap:6px;
margin-top:12px
}

.images{
display:grid;
grid-template-columns:
repeat(auto-fill,minmax(150px,1fr));
gap:10px;
margin-top:10px
}

.images img{
width:100%;
height:150px;
object-fit:contain;
background:#eee;
border:1px solid #ccc
}

.issued{
background:#f5f5f5;
padding:12px;
margin-top:15px
}

.message{
white-space:pre-wrap;
margin:8px 0
}

</style>
</head>

<body>

<div class="box">

<h1>文化資料登録室 管理画面</h1>

<button onclick="loadApplications()">
申請一覧を更新
</button>

<div class="search">

<input
id="apSearch"
placeholder="AP-K7M4P8Q9"
autocomplete="off">

<button onclick="loadApplication()">
申請を確認
</button>

</div>

<div id="output"></div>

</div>

<script>

const TYPES = {
  type1:"第1種登録（基本登録）",
  type2:"第2種登録",
  type3:"第3種登録",
  special:"特別登録"
};

const EXTRA_TYPES = {
  additional_check:"追加確認",
  rejected:"不承認"
};

function getKey(){

  let key =
    sessionStorage.getItem(
      "ADMIN_KEY"
    );

  if(!key){

    key = prompt(
      "管理者キーを入力してください"
    );

    if(key){

      sessionStorage.setItem(
        "ADMIN_KEY",
        key
      );

    }

  }

  return key;
}

async function adminFetch(
  url,
  options={}
){

  const key = getKey();

  if(!key){
    throw new Error(
      "管理者キーがありません。"
    );
  }

  options.headers = {
    ...(options.headers || {}),
    "X-Admin-Key":key
  };

  const response =
    await fetch(
      url,
      options
    );

  if(response.status===401){

    sessionStorage.removeItem(
      "ADMIN_KEY"
    );

    throw new Error(
      "管理者認証に失敗しました。"
    );
  }

  return response;
}

function message(text){

  const p =
    document.createElement(
      "p"
    );

  p.className =
    "message";

  p.textContent =
    text;

  return p;
}

async function loadApplications(){

  const output =
    document.getElementById(
      "output"
    );

  output.textContent =
    "申請一覧を読み込んでいます……";

  try{

    const response =
      await adminFetch(
        "/admin/applications?limit=100"
      );

    const data =
      await response.json();

    output.innerHTML = "";

    if(!data.success){

      output.appendChild(
        message(
          data.message ||
          "申請一覧を取得できませんでした。"
        )
      );

      return;
    }

    if(!data.applications.length){

      output.appendChild(
        message(
          "現在、登録申請はありません。"
        )
      );

      return;
    }

    for(
      const application
      of data.applications
    ){

      const box =
        document.createElement(
          "div"
        );

      box.className =
        "application";

      const title =
        document.createElement(
          "h2"
        );

      title.textContent =
        "AP番号：" +
        application.ap;

      box.appendChild(
        title
      );

      box.appendChild(
        message(
          "状態：" +
          application.status
        )
      );

      for(
        const item
        of application.items || []
      ){

        const row =
          document.createElement(
            "div"
          );

        row.className =
          "item";

        row.textContent =
          "資料 " +
          item.item +
          "：" +
          item.name +
          " / " +
          (
            item.registrationNumber ||
            TYPES[
              item.registrationType
            ] ||
            EXTRA_TYPES[
              item.reviewResult
            ] ||
            "未審査"
          );

        row.style.cursor =
          "pointer";

        row.onclick = () => {

          document.getElementById(
            "apSearch"
          ).value =
            application.ap;

          loadApplication();

        };

        box.appendChild(
          row
        );
      }

      output.appendChild(
        box
      );
    }

  }catch(error){

    output.innerHTML = "";

    output.appendChild(
      message(
        error.message
      )
    );
  }
}

async function loadApplication(){

  const ap =
    document.getElementById(
      "apSearch"
    ).value.trim();

  if(!ap){
    return;
  }

  const output =
    document.getElementById(
      "output"
    );

  output.textContent =
    "申請情報を読み込んでいます……";

  try{

    const response =
      await adminFetch(
        "/admin/application?ap=" +
        encodeURIComponent(ap)
      );

    const data =
      await response.json();

    output.innerHTML = "";

    if(!data.success){

      output.appendChild(
        message(
          data.message
        )
      );

      return;
    }

    renderApplication(
      data.application,
      output
    );

  }catch(error){

    output.innerHTML = "";

    output.appendChild(
      message(
        error.message
      )
    );
  }
}

function renderApplication(
  application,
  output
){

  const box =
    document.createElement(
      "div"
    );

  box.className =
    "application";

  const title =
    document.createElement(
      "h2"
    );

  title.textContent =
    "AP番号：" +
    application.ap;

  box.appendChild(
    title
  );

  box.appendChild(
    message(
      "状態：" +
      application.status
    )
  );

  for(
    const item
    of application.items || []
  ){

    renderItem(
      application,
      item,
      box
    );
  }

  output.appendChild(
    box
  );
}

function renderItem(
  application,
  item,
  parent
){

  const box =
    document.createElement(
      "div"
    );

  box.className =
    "item";

  const title =
    document.createElement(
      "h3"
    );

  title.textContent =
    "資料 " +
    item.item +
    "：" +
    item.name;

  box.appendChild(
    title
  );

  box.appendChild(
    message(
      "関連資料名称：" +
      (item.relatedName || "")
    )
  );

  box.appendChild(
    message(
      "入手経緯など：" +
      (item.acquisition || "")
    )
  );

  if(
    item.registrationStatus ===
    "registered"
  ){

    box.appendChild(
      message(
        "登録番号：" +
        item.registrationNumber
      )
    );

    box.appendChild(
      message(
        item.issuedDataReady
          ? "登録書が完成しています。発行データを受け取れる状態です。"
          : "審査完了です。登録書完成までしばらくお待ちください。"
      )
    );

    const issued =
      document.createElement(
        "div"
      );

    issued.className =
      "issued";

    const label =
      document.createElement(
        "p"
      );

    label.textContent =
      "登録書完成後の発行データJPG";

    issued.appendChild(
      label
    );

    const file =
      document.createElement(
        "input"
      );

    file.type =
      "file";

    file.accept =
      "image/jpeg,.jpg,.jpeg";

    issued.appendChild(
      file
    );

    const button =
      document.createElement(
        "button"
      );

    button.textContent =
      item.issuedDataReady
        ? "発行データJPGを差し替える"
        : "発行データJPGを登録する";

    button.onclick = () => {

      uploadIssuedData(
        item.registrationNumber,
        file
      );

    };

    issued.appendChild(
      button
    );

    box.appendChild(
      issued
    );

  }else{

    const images =
      document.createElement(
        "div"
      );

    images.className =
      "images";

    box.appendChild(
      images
    );

    loadImages(
      application.ap,
      item.item,
      images
    );

    const buttons =
      document.createElement(
        "div"
      );

    buttons.className =
      "buttons";

    for(
      const [code,label]
      of Object.entries(
        TYPES
      )
    ){

      const button =
        document.createElement(
          "button"
        );

      button.textContent =
        label;

      button.onclick = () => {

        review(
          application.ap,
          item.item,
          code
        );

      };

      buttons.appendChild(
        button
      );
    }

    for(
      const [code,label]
      of Object.entries(
        EXTRA_TYPES
      )
    ){

      const button =
        document.createElement(
          "button"
        );

      button.textContent =
        label;

      button.onclick = () => {

        review(
          application.ap,
          item.item,
          code
        );

      };

      buttons.appendChild(
        button
      );
    }

    box.appendChild(
      buttons
    );
  }

  parent.appendChild(
    box
  );
}

async function loadImages(
  ap,
  item,
  container
){

  const key =
    getKey();

  if(!key){
    return;
  }

  for(
    let i = 1;
    i <= 20;
    i++
  ){

    const imageNumber =
      String(i).padStart(
        2,
        "0"
      );

    try{

      const response =
        await fetch(
          "/admin/image?ap=" +
          encodeURIComponent(ap) +
          "&item=" +
          encodeURIComponent(item) +
          "&image=" +
          imageNumber,
          {
            headers:{
              "X-Admin-Key":
                key
            }
          }
        );

      if(!response.ok){
        continue;
      }

      const blob =
        await response.blob();

      const objectUrl =
        URL.createObjectURL(
          blob
        );

      const image =
        document.createElement(
          "img"
        );

      image.src =
        objectUrl;

      image.alt =
        "資料画像 " +
        imageNumber;

      image.onload = () => {
        URL.revokeObjectURL(
          objectUrl
        );
      };

      container.appendChild(
        image
      );

    }catch{}
  }
}

async function review(
  ap,
  item,
  result
){

  const question =
    result === "rejected"
      ? "この資料を不承認にしますか？"
      : result === "additional_check"
      ? "追加確認にしますか？"
      : "この資料を審査合格として登録番号を発行しますか？";

  if(!confirm(question)){
    return;
  }

  try{

    const response =
      await adminFetch(
        "/admin/review",
        {
          method:"POST",
          headers:{
            "Content-Type":
              "application/json"
          },
          body:JSON.stringify({
            ap,
            item,
            result
          })
        }
      );

    const data =
      await response.json();

    if(
      !response.ok ||
      !data.success
    ){

      alert(
        data.message ||
        "処理に失敗しました。"
      );

      return;
    }

    if(
      data.registrationNumber
    ){

      alert(
        "審査完了です。\n\n" +
        "登録番号：" +
        data.registrationNumber +
        "\n\n" +
        "登録書完成までしばらくお待ちください。\n\n" +
        "登録書完成後、発行データJPGを登録すると、申請者が登録番号を入力してデータを受け取れるようになります。"
      );

    }else{

      alert(
        data.message ||
        "保存しました。"
      );
    }

    loadApplication();

  }catch(error){

    alert(
      error.message
    );
  }
}

async function uploadIssuedData(
  number,
  fileInput
){

  const file =
    fileInput.files &&
    fileInput.files[0];

  if(!file){

    alert(
      "JPGファイルを選択してください。"
    );

    return;
  }

  if(
    file.type !==
    "image/jpeg"
  ){

    alert(
      "JPG形式の画像を選択してください。"
    );

    return;
  }

  if(
    file.size <= 0 ||
    file.size >
      5 * 1024 * 1024
  ){

    alert(
      "JPGファイルは5MB以下で指定してください。"
    );

    return;
  }

  if(
    !confirm(
      "このJPGを登録番号 " +
      number +
      " の発行データとして登録しますか？"
    )
  ){
    return;
  }

  try{

    const form =
      new FormData();

    form.append(
      "registrationNumber",
      number
    );

    form.append(
      "file",
      file
    );

    const response =
      await adminFetch(
        "/admin/issued-data-upload",
        {
          method:"POST",
          body:form
        }
      );

    const data =
      await response.json();

    alert(
      data.message ||
      "完了しました。"
    );

    if(data.success){
      loadApplication();
    }

  }catch(error){

    alert(
      error.message
    );
  }
}

loadApplications();

</script>

</body>
</html>
`
  );
}
