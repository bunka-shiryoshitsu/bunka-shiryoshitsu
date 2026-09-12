from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old='''  if(data.status==="not_started"){
   result.textContent="抽選結果はまだ確認できません。";
   return;
  }'''
new='''  if(data.status==="not_started"){
   result.textContent=
    data.message ||
    (data.checkStart
      ? `抽選結果は${data.checkStart}から確認できます。`
      : "抽選結果はまだ確認できません。");
   return;
  }'''
if s.count(old)!=1:
    raise SystemExit(f'expected 1 target, found {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
