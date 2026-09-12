from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    if old not in s:
        raise SystemExit('patch target not found: '+label)
    s=s.replace(old,new,count)

rep(
    '<div id="registration-application" class="registration-application" style="display:none;">\n<h3>登録申請</h3>\n<p>抽選に当選された方は、以下の内容を入力してください。</p>\n<div id="registration-slots"></div>\n<button type="button" id="registration-submit" class="registration-submit" disabled>登録申請を送信</button>\n<div id="registration-submit-message" class="application-next-message"></div>\n</div>',
    '<div id="registration-application" class="registration-application" style="display:none;">\n<h3>登録申請</h3>\n<p>抽選に当選された方は、以下の内容を入力してください。</p>\n<div id="registration-slots"></div>\n<button type="button" id="registration-submit" class="registration-submit" disabled>登録申請を送信</button>\n<div id="registration-submit-message" class="application-next-message"></div>\n</div>\n<p style="margin-top:28px"><a id="receive-page-link" class="application-next" href="#" style="text-decoration:none;display:inline-block">登録書受取ページを開く</a></p>',
    'receive link')
rep('<div class="application-box">\n<div class="notice">現在、新規登録申請は休止しております。</div>\n\n<p>登録申請の受付を再開する場合は、本ページにてご案内します。</p>', '<div class="application-box">\n<div id="application-status-notice" class="notice">受付状態を確認しています……</div>\n\n<p id="application-status-guidance">抽選申込の受付状況を確認しています。</p>', 'status block')
rep('<li>発行された確認番号（AP番号）を保管してください。</li>', '<li>発行された確認番号（AP番号）と受取キーを保管してください。</li>', 'flow key')
rep('<li>当選した方は、案内された期間内に専用の登録申請を行います。</li>', '<li>当選した方は、表示された申請期限までに専用の登録申請を行います。</li>', 'flow deadline')
rep('<li>登録が決定した資料には登録番号を付与し、登録書を作成します。</li>', '<li>登録が決定した資料には登録番号を付与し、登録書を作成します。</li>\n<li>登録書は、AP番号と受取キーを使って専用ページから受け取ります。</li>', 'flow receive')
rep('<li>登録を希望する場合は、まず抽選にお申し込みください。抽選に当選した方のみ、専用の登録申請を行うことができます。</li>', '<li>登録を希望する場合は、まず抽選にお申し込みください。抽選に当選した方のみ、専用の登録申請を行うことができます。</li>\n<li>抽選申込時には、確認番号（AP番号）とは別に受取キーを発行します。受取キーは登録書の受取時に必要となるため、AP番号とともに必ず保存してください。</li>\n<li>受取キーは安全上、発行画面を離れた後に同じものを再表示できません。紛失した場合は新しい受取キーの再発行が必要となり、それまでの受取キーは無効になります。</li>', 'key guidance')
rep('<li>当選した場合は、画面上に当選及び登録申請枠数が表示されます。</li>', '<li>当選した場合は、画面上に当選、登録申請枠数及び申請期限が表示されます。</li>\n<li>登録申請は、表示された申請期限までに完了してください。期限を過ぎると当選は失効し、その当選による登録申請はできません。</li>', 'deadline guidance')
rep('<p>当選者は、案内された方法により登録申請を行い、資料について確認できる情報及び画像を提出してください。</p>\n<p>申請内容、提出画像及び資料関連情報を確認した上で、当資料室が登録の可否及び登録区分を判断します。</p>', '<p>当選者は、案内された方法により登録申請を行い、資料について確認できる情報及び画像を提出してください。</p>\n<p>申請者が入力した資料名称及び関連名称は、申請時の記録として保存します。</p>\n<p>登録書に記載する資料名称及び関連名称は、提出された画像その他の情報を確認した上で、記録として適切な表記に当資料室が整理する場合があります。その場合も、申請者が最初に入力した内容は削除せず、申告内容として保存します。</p>\n<p>申請内容、提出画像及び資料関連情報を確認した上で、当資料室が登録の可否及び登録区分を判断します。</p>', 'name preservation')
rep('<p>登録書はJPG形式でお送りします。L判サイズに合わせて作成していますので、印刷する際はサイズを変更せず、L判サイズのまま印刷してください。</p>\n<p>最寄りのセブン‐イレブンのマルチコピー機から印刷することもできます。サイズを変更すると、画像のギザつきや文字の見にくさ、QRコードの読み取りに影響する場合があります。</p>\n<p>登録書は、可能な限り登録された資料とともに保管してください。</p>', '<p>登録書は、専用の登録書受取ページでAP番号と受取キーを入力し、本人確認ができた場合に限りJPG形式で受け取ることができます。登録番号だけでは登録書を受け取ることはできません。</p>\n<p>登録書は、写真用L判サイズでの印刷を前提として作成しています。印刷する際は、サイズを変更せずL判のまま印刷してください。セブン‐イレブン等のマルチコピー機では、写真プリントのL判で印刷することができます。</p>\n<p>L判以外への拡大・縮小や縦横比の変更は、画像の粗れ、文字や枠の見え方、QRコードの読み取り等に影響する場合があるため推奨しません。</p>\n<p>登録書には登録対象資料の画像を掲載していません。どの資料に対応する登録書であるか分からなくならないよう、登録書は必ず登録された資料とともに保管してください。</p>\n<p>登録書を長期に保存するため、汚損、破損、折れ、退色等を防ぐラミネート加工その他の保護を行うことを推奨します。</p>\n<p>登録書を紛失し、又は著しく毀損して登録された資料との対応関係を確認できなくなった場合、原則として登録書のみの再発行は行いません。必要な場合は、改めて登録申請を行ってください。</p>', 'certificate guidance')
rep('<p class="small">※現在は新規登録申請を休止しています。</p>\n\n<button type="button" id="application-next" class="application-next" disabled>\n確認して次へ\n</button>', '<p class="small" id="application-status-note">※受付状態はシステムから自動取得します。</p>\n\n<button type="button" id="application-next" class="application-next" disabled>\n抽選申込ページへ進む\n</button>', 'button')
rep('let registrationSubmitted=false;', 'let registrationSubmitted=false;\nlet applicationsOpen=false;', 'global status')
rep('result.innerHTML=`\n    <div>今回の抽選に当選しています。</div>\n    <div class="application-slots">登録申請：${slots}枠</div>\n   `;', 'result.innerHTML=`\n    <div>今回の抽選に当選しています。</div>\n    <div class="application-slots">登録申請：${slots}枠</div>\n    ${data.expiryDate?`<div class="small">申請期限：${data.expiryDate}</div>`:""}\n   `;', 'expiry display')

old='''function applicationNext(){
 const checkbox=document.getElementById("application-agree");
 const message=document.getElementById("application-next-message");

 if(!checkbox?.checked||!message)return;

 message.textContent=
  "現在、新規登録申請を休止しております。受付再開時には、このページから申請手続きへ進めるようになります。";
}'''
new='''async function loadApplicationStatus(){
 const notice=document.getElementById("application-status-notice");
 const guidance=document.getElementById("application-status-guidance");
 const note=document.getElementById("application-status-note");
 const checkbox=document.getElementById("application-agree");
 const nextButton=document.getElementById("application-next");
 try{
  const response=await fetch(WORKER_URL+"/system/application-status",{cache:"no-store"});
  const data=await response.json();
  applicationsOpen=data?.applicationsOpen===true;
  if(applicationsOpen){
   if(notice)notice.textContent="現在、抽選申込を受け付けています。";
   if(guidance)guidance.textContent="登録を希望する場合は、注意事項を確認・同意のうえ、抽選申込ページへ進んでください。";
   if(note)note.textContent="※抽選への当選は登録を保証するものではありません。";
  }else{
   if(notice)notice.textContent="現在、新規登録申請は休止しております。";
   if(guidance)guidance.textContent="受付を再開した場合は、このページから抽選申込へ進むことができます。";
   if(note)note.textContent="※現在は抽選申込・登録申請ともに受け付けていません。";
  }
 }catch(error){
  applicationsOpen=false;
  if(notice)notice.textContent="受付状態を確認できませんでした。";
  if(guidance)guidance.textContent="しばらく時間をおいてから再度お試しください。";
 }
 if(nextButton)nextButton.disabled=!(applicationsOpen&&checkbox?.checked);
}

function applicationNext(){
 const checkbox=document.getElementById("application-agree");
 const message=document.getElementById("application-next-message");
 if(!checkbox?.checked||!message)return;
 if(!applicationsOpen){
  message.textContent="現在、新規登録申請は休止しております。";
  return;
 }
 window.location.href=WORKER_URL+"/lottery";
}'''
rep(old,new,'dynamic status')
rep(' const applicationNumberInput=document.getElementById("application-number");', ' const applicationNumberInput=document.getElementById("application-number");\n const receivePageLink=document.getElementById("receive-page-link");\n\n if(receivePageLink){\n  receivePageLink.href=WORKER_URL+"/receive";\n }', 'receive js')
rep(' if(checkbox&&nextButton){\n  checkbox.addEventListener("change",()=>{\n   nextButton.disabled=!checkbox.checked;\n  });\n }', ' if(checkbox&&nextButton){\n  checkbox.addEventListener("change",()=>{\n   nextButton.disabled=!(applicationsOpen&&checkbox.checked);\n  });\n }', 'checkbox')
rep(' monitorSiteAccess();\n});', ' loadApplicationStatus();\n monitorSiteAccess();\n});', 'load status')

p.write_text(s,encoding='utf-8')
m=re.search(r'<script>([\s\S]*)</script>',s)
if not m:
    raise SystemExit('script not found')
Path('/tmp/index-script.js').write_text(m.group(1),encoding='utf-8')
