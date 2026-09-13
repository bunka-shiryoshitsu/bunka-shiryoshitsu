from pathlib import Path

p = Path('index.html')
text = p.read_text(encoding='utf-8')

replacements = [
    (
        '受取キーは安全上、発行画面を離れた後に同じものを再表示できません。紛失した場合は新しい受取キーの再発行が必要となり、それまでの受取キーは無効になります。',
        '受取キーは安全上、発行画面を離れた後に同じものを再表示できません。受取キーを紛失した場合、再発行は行いません。必要な場合は、新規の抽選申込みから改めてお申し込みください。'
    ),
    (
        '<button type="button" id="registration-check-button">登録番号を照会</button>',
        '<button type="button" id="registration-check-button">登録番号を照会 / CHECK REGISTRATION</button>'
    ),
    (
        '<button type="button" id="application-check-button">抽選結果を確認</button>',
        '<button type="button" id="application-check-button">抽選結果を確認 / CHECK LOTTERY RESULT</button>'
    ),
    (
        '<button type="button" id="registration-submit" class="registration-submit" disabled>登録申請を送信</button>',
        '<button type="button" id="registration-submit" class="registration-submit" disabled>登録申請を送信 / SUBMIT REGISTRATION</button>'
    ),
    (
        '<p style="margin-top:28px"><a id="receive-page-link" class="application-next" href="#" style="text-decoration:none;display:inline-block">登録書受取ページを開く</a></p>',
        '<p style="margin-top:28px"><a id="receive-page-link" class="application-next" href="#" style="text-decoration:none;display:inline-block">登録書受取ページを開く / OPEN REGISTRATION DOCUMENT</a></p>'
    ),
    (
        '抽選申込ページへ進む\n</button>',
        '抽選申込ページへ進む / APPLY FOR LOTTERY\n</button>'
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected text not found: {old[:80]}')
    text = text.replace(old, new, 1)

marker = '<p class="small" id="application-status-note">※受付状態はシステムから自動取得します。</p>\n\n<button type="button" id="application-next" class="application-next" disabled>'
insert = '<p class="small" id="application-status-note">※受付状態はシステムから自動取得します。</p>\n<p class="small"><strong>重要 / IMPORTANT：抽選申込み完了後に表示される確認番号（AP番号）と受取キーは、必ず保存してください。紛失した場合、再発行は行いません。</strong></p>\n\n<button type="button" id="application-next" class="application-next" disabled>'
if marker not in text:
    raise SystemExit('Application note insertion point not found')
text = text.replace(marker, insert, 1)

p.write_text(text, encoding='utf-8')
print('index.html updated successfully')
