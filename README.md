# 文化資料登録室

公開案内ページ: https://bunka-shiryoshitsu.github.io/bunka-shiryoshitsu/

申請・管理機能: Cloudflare Worker `bunka-shiryoshitsu-checksoft-mountain-b5a9`

## 動作確認

Node.js 22 以降で `npm test` を実行します。テストはメモリ内の専用データだけを使い、本番の申込・登録・画像を変更しません。

検証対象は、公開画面のスクリプト、管理認証、受付停止、抽選申込、当選設定、画像提出、登録申請、審査、登録番号照会、JPGの登録・本人受取、登録取消です。資料の審査と登録書JPGの作成は管理者が行います。

## 公開

`wrangler.jsonc` の入口は `worker.js` です。既存の KV、Durable Object、管理キーを維持してください。古い `worker-dashboard9.js` を直接指定すると登録番号管理画面が外れます。

公開前にテストと `wrangler deploy --dry-run` を行い、現在の公開バージョンを記録します。公開は `wrangler deploy --keep-vars`、公開後はトップ・申込・受取・管理画面の応答を確認します。

有料プラン、新規有料サービス、追加費用のある操作は、所有者に相談するまで実行しません。秘密鍵や管理キーをリポジトリに保存しないでください。

開発用 `/_dev/` と切替検証用 `/_cutover/` は本番で404になります。古い検証ファイルを公開入口に指定しないでください。
