export const workActionStyles=String.raw`
.admin-nav a{flex-wrap:wrap;align-content:center;gap:4px 8px}.work-nav-name{display:flex;align-items:center;justify-content:center;gap:7px}.work-nav-state{display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:wrap;width:100%}.work-here{font-size:12px;border:1px solid currentColor;border-radius:4px;padding:0 5px;white-space:nowrap}.work-here[hidden],.work-count[hidden],#admin-work-actions[hidden]{display:none!important}.work-count{display:inline-block;background:#ac2925;color:#fff;border:1px solid #fff;border-radius:20px;font-size:13px;font-weight:600;padding:1px 7px;white-space:nowrap}.work-legend{font-size:14px;color:#526051;margin:8px 0 0}.work-legend span{margin-right:14px}.work-legend strong{color:#325b3b}.work-legend .work-red{color:#962520}
#admin-content button,#admin-content button.secondary,.admin-shell button{background:#fff;color:#253820;border:1px solid #899583}#admin-content button.good,#admin-content button.warn{background:#fff;color:#253820}#admin-content .work-action,.admin-dialog .work-action{background:#ac2925!important;border-color:#ac2925!important;color:#fff!important}#admin-content [data-review]{background:#fff!important;color:#253820!important;border:1px solid #899583!important}#admin-content button.danger:not([data-review]){background:#fff5f3;color:#8c3131;border:2px solid #8c3131}.admin-dialog button.danger{background:#8c3131;color:#fff}#admin-content .queue-filters button[aria-pressed=true]{background:#325b3b;color:#fff}.queue-status.pending{background:#edf0eb;color:#526051}.work-action:disabled{background:#6d756b!important;border-color:#6d756b!important;color:#fff!important}.memo-save.work-action{min-height:44px}
.work-tasks{margin:16px 0 22px;border:1px solid #cdd3c7;border-radius:10px;background:#fff;padding:16px}.work-tasks-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}.work-tasks h2{font-size:20px;margin:0;padding:0}.work-status{font-size:14px;color:#526051;margin:8px 0}.work-rows{display:grid;gap:9px}.work-row{display:flex;justify-content:space-between;align-items:center;gap:16px;border:1px solid #d2d8ce;border-left:4px solid #ac2925;border-radius:7px;padding:12px}.work-row strong,.work-row small{display:block}.work-row small{font-size:14px;color:#526051;overflow-wrap:anywhere}.work-row a{flex-shrink:0;text-decoration:none;border-radius:7px;padding:9px 13px;min-height:44px}.work-row .work-local{display:block;font-size:14px;color:#8c3131}.work-pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}.work-empty{margin:8px 0;color:#526051}.work-item-next{padding:12px;border-left:4px solid #ac2925;background:#fff5f2;margin:12px 0}.work-item-next strong{display:block}.work-item-next small{color:#64403c}.work-neutral{background:#fff!important;color:#253820!important;border:1px solid #899583!important}.work-focus{scroll-margin-top:calc(var(--shell-height) + 64px)}.work-table-target{border-left:4px solid #ac2925}.work-note-summary{font-size:14px;color:#8c3131}.work-tasks details{margin-top:10px;color:#526051}.work-tasks summary{min-height:44px;cursor:pointer;padding:8px 0}
#lotteryTable tr.work-selected{background:#fff2cf;outline:3px solid #a96500;outline-offset:-3px}.work-selected-label{display:block;width:max-content;margin-top:6px;padding:1px 7px;border-radius:4px;background:#744800;color:#fff;font-size:13px;font-weight:700}
@media(max-width:650px){.admin-nav a{min-height:64px}.work-nav-name{gap:3px}.work-nav-state{gap:3px}.work-count{font-size:12px;padding:1px 5px}.work-here{font-size:11px}.work-row{align-items:stretch;flex-direction:column;gap:8px}.work-row a{text-align:center}.work-tasks{padding:12px}.work-tasks-head button{font-size:14px!important}.work-legend{font-size:13px}}
`;

export const workActionClient=String.raw`
(() => {
 const ui=window.AdminUI,main=document.getElementById('admin-content');if(!ui||!main)return;
 const node=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;if(parent)parent.append(e);return e};
 const credential=()=>window.AdminSession?.credential()||document.getElementById('adminKey')?.value.trim()||'';
 let data=null,error='',loading=false,controller=null,generation=0,timer=null,debounce=null,page=0,lastRead=0;
 const drafts=new Map();
 const panel=node('section',undefined,undefined,'work-tasks');panel.id='admin-work-actions';panel.hidden=true;
 const title=main.querySelector('h1');if(title)title.after(panel);else main.prepend(panel);
 const head=node('div',undefined,panel,'work-tasks-head');node('h2','人が進める作業',head);const refresh=node('button','作業状況を更新',head);refresh.type='button';
 const status=node('p','作業状況を確認しています…',panel,'work-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const rows=node('div',undefined,panel,'work-rows'),pager=node('div',undefined,panel,'work-pager');
 const waitBox=node('details',undefined,panel),waitLabel=node('summary','提出待ち',waitBox),waitList=node('div',undefined,waitBox);
 const legend=node('p',undefined,document.getElementById('admin-current').parentElement,'work-legend');legend.innerHTML='<span><strong>緑：現在地</strong></span><span class="work-red">赤：人の作業が必要</span><span>灰：完了・待機</span>';
 const navs=[...document.querySelectorAll('.admin-nav a')];for(const a of navs){const name=node('span',undefined,undefined,'work-nav-name');while(a.firstChild)name.append(a.firstChild);a.append(name);const markers=node('span',undefined,a,'work-nav-state'),here=node('span','現在地',markers,'work-here'),badge=node('span','',markers,'work-count');here.hidden=badge.hidden=true;}
 const route=()=>{const p=new URL(location.href).searchParams;return {view:location.pathname.endsWith('registration-numbers')?'numbers':p.get('ap')?'applications':p.get('view')||'dashboard',ap:p.get('ap')||'',item:p.get('item')||'',work:p.get('work')||''}};
 const href=t=>t.view==='numbers'?'/admin/registration-numbers?'+new URLSearchParams({number:t.number}):'/admin?'+new URLSearchParams(t.kind==='lottery'?{view:'lottery',work:t.kind,target:t.ap}:{view:'applications',ap:t.ap,item:t.item,work:t.kind});
 const allTasks=()=>{const list=[...(data?.tasks||[])],ids=new Set(list.map(t=>t.id));for(const group of drafts.values())for(const task of group)if(!ids.has(task.id)){ids.add(task.id);list.push(task)}return list};
 const relevant=(t,r)=>r.ap?t.ap===r.ap&&(!r.item||t.item===r.item):r.view==='dashboard'||t.view===r.view;
 const date=n=>new Date(n-1).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 function paintNav(){const r=route(),tasks=allTasks();for(const a of navs){const current=a.getAttribute('aria-current')==='page',view=a.dataset.view,count=tasks.filter(t=>view==='dashboard'||t.view===view).length;a.querySelector('.work-here').hidden=!current;const badge=a.querySelector('.work-count');badge.hidden=!credential()||!count;badge.textContent=(error?'前回 ':'')+'要作業 '+count;}return r;}
 function render(){
  panel.hidden=!credential();const r=paintNav();if(panel.hidden)return;refresh.disabled=loading;
  const tasks=allTasks().filter(t=>relevant(t,r));page=Math.min(page,Math.max(0,Math.ceil(tasks.length/20)-1));rows.replaceChildren();pager.replaceChildren();
  status.textContent=error||(loading&&!data?'作業状況を確認しています…':tasks.length+'件。期限がある作業を先に、同じ条件では受付順に表示します。'+(loading?' 更新中…':''));
  for(const t of tasks.slice(page*20,(page+1)*20)){const row=node('div',undefined,rows,'work-row'),copy=node('div',undefined,row);node('strong',t.label,copy);node('small',t.ap+(t.item?' ／ 資料 '+t.item:'')+' ／ '+t.name,copy);if(t.deadline)node('small','提出期限：'+date(t.deadline)+(t.kind==='expired'?'（期限超過）':t.kind==='supplement'?'（提出済み）':''),copy);if(t.local)node('span','この画面の未保存内容',copy,'work-local');const a=node('a',t.kind==='document'?'登録書の作業へ':t.local?'未保存内容へ':'確認・作業へ',row,'work-action');a.href=href(t);a.dataset.workTask=t.id;}
  if(data&&!tasks.length&&!error)node('p','今この画面で進める作業はありません。',rows,'work-empty');
  if(tasks.length>20){node('span',(page*20+1)+'〜'+Math.min((page+1)*20,tasks.length)+'件 / '+tasks.length+'件',pager);for(const [label,delta]of [['前の20件',-1],['次の20件',1]]){const b=node('button',label,pager);b.type='button';b.disabled=delta<0?page===0:(page+1)*20>=tasks.length;b.onclick=()=>{page+=delta;render()}}}
  const waits=(data?.waiting||[]).filter(t=>relevant(t,r));waitBox.hidden=!waits.length;waitLabel.textContent='申請者からの提出待ち '+waits.length+'件（今は作業不要）';waitList.replaceChildren();for(const t of waits.slice(0,20))node('p',t.ap+' ／ 資料 '+t.item+' ／ '+t.name+(t.deadline?' ／ '+date(t.deadline):''),waitList);if(waits.length>20)node('p','ほか '+(waits.length-20)+'件。①要対応の追加提出一覧で確認できます。',waitList);
  decorate();
 }
 async function load(){
  const key=credential();if(!key){clear();return}controller?.abort();const own=++generation;controller=new AbortController();const active=controller;loading=true;render();const deadline=setTimeout(()=>active.abort(),20000);
  try{const response=await fetch('/admin/work-actions',{headers:{'X-Admin-Key':key},cache:'no-store',signal:active.signal});const result=await response.json();if(own!==generation||credential()!==key)return;if(!response.ok||!result.success){if(response.status===401)window.dispatchEvent(new Event('admin-auth-required'));throw Error(result.message||'作業状況を確認できませんでした。')}data=result;error='';lastRead=Date.now();}
  catch(e){if(own===generation&&credential()===key)error=active.signal.aborted?'作業状況の通信が時間切れになりました。「作業状況を更新」で再確認してください。':e.message;}
  finally{clearTimeout(deadline);if(own===generation){loading=false;render()}}
 }
 function schedule(){clearTimeout(debounce);debounce=setTimeout(()=>void load(),150)}
 function clear(){generation++;controller?.abort();clearTimeout(debounce);data=null;error='';loading=false;drafts.clear();render();}
 function mark(el,on){if(el)el.classList.toggle('work-action',Boolean(on));}
 function decorate(){
  const tasks=allTasks();
  for(const a of document.querySelectorAll('#appsTable a.table-action,#regsTable a.table-action')){const u=new URL(a.href,location.href),ap=u.searchParams.get('ap'),item=u.searchParams.get('item');mark(a,Boolean(ap&&tasks.some(t=>t.ap===ap&&(!item||t.item===item))&&!a.classList.contains('code')))}
  const r=route(),requested=new URL(location.href).searchParams.get('target');
  for(const row of document.querySelectorAll('#lotteryTable tbody tr')){
    const cell=row.cells?.[0],ap=cell?.textContent.match(/AP-[A-Z0-9]{8}/)?.[0];if(ap)row.id='lottery-'+ap;
    row.classList.toggle('work-table-target',tasks.some(t=>t.kind==='lottery'&&t.ap===ap));
    const selected=Boolean(ap&&r.view==='lottery'&&r.work==='lottery'&&ap===requested);row.classList.toggle('work-selected',selected);
    const badge=row.querySelector('.work-selected-label');if(selected){if(!badge)node('span','選択中',cell,'work-selected-label');row.setAttribute('tabindex','-1');row.setAttribute('aria-label','選択中の抽選申込 '+ap);}else{badge?.remove();row.removeAttribute('tabindex');row.removeAttribute('aria-label');}
  }
  for(const w of document.querySelectorAll('#detail>.item')){
    const task=tasks.find(t=>t.ap===w.dataset.ap&&t.item===w.dataset.item&&!t.local);let note=w.querySelector('.work-item-next');
    if(task){if(!note){note=node('div',undefined,undefined,'work-item-next');w.querySelector('h3').after(note)}note.replaceChildren();node('strong','要作業：'+task.label,note);node('small','確認・保存が完了するまで要作業として残ります。',note);}else note?.remove();
    mark(w.querySelector('.uploadIssued'),Boolean(task?.kind==='document'||w.querySelector('.issuedFile')?.files?.length));
    for(const b of w.querySelectorAll('[data-review]')){b.classList.remove('work-action');b.classList.add('work-neutral')}
    for(const area of [w.querySelector('.actions'),w.querySelector('.uploadArea'),w.querySelector('.detail[data-revision]')])area?.classList.add('work-focus');
    const cancel=w.querySelector('button.cancel');if(cancel&&!cancel.textContent.startsWith('注意：'))cancel.textContent='注意：登録取消';
  }
 }
 function focusRequested(){const r=route();if(!r.work)return false;let target;if(r.work==='lottery'){if(r.view!=='lottery')return false;const ap=new URL(location.href).searchParams.get('target');if(/^AP-[A-Z0-9]{8}$/.test(ap||''))target=document.getElementById('lottery-'+ap);}else{const w=document.getElementById('admin-item-'+r.item);target=r.work==='document'?w?.querySelector('.uploadArea'):['supplement','expired'].includes(r.work)?w?.querySelector('.detail[data-revision]'):w?.querySelector('.actions');}if(!target)return false;target.classList.add('work-focus');target.scrollIntoView({block:'start'});if(r.work==='lottery'){target.focus({preventScroll:true});ui.say('抽選申込 '+new URL(location.href).searchParams.get('target')+' の行を表示しました。');}return true;}
 window.AdminActions={refresh:schedule,decorate,focusRequested,setDrafts(group,items){if(JSON.stringify(drafts.get(group)||[])===JSON.stringify(items))return;if(items.length)drafts.set(group,items);else drafts.delete(group);render();},setDraft(group,item){this.setDrafts(group,item?[item]:[])}};
 const current=ui.setCurrent;ui.setCurrent=view=>{current(view);page=0;render()};
 const tables=ui.decorateTables;ui.decorateTables=()=>{tables();decorate()};
 refresh.onclick=()=>void load();window.addEventListener('admin-authenticated',schedule);window.addEventListener('admin-auth-required',clear);document.getElementById('adminKey')?.addEventListener('input',clear);
 document.addEventListener('change',e=>{if(e.target.matches('.issuedFile'))decorate()});
 window.addEventListener('focus',()=>{if(credential()&&Date.now()-lastRead>60000)schedule()});
 const tick=()=>{if(!document.hidden&&credential())schedule();timer=setTimeout(tick,60000)};timer=setTimeout(tick,60000);
 window.addEventListener('pagehide',()=>{clearTimeout(timer);clearTimeout(debounce);controller?.abort()});
 if(credential())schedule();render();
})();
`;
