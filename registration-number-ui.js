import {numberRecords,numberPage,numberRoute} from './registration-number-view.js';

export const registrationNumbersClient = String.raw`
(() => {
  const makeRecords = ${numberRecords.toString()};
  const selectPage = ${numberPage.toString()};
  const routeFor = ${numberRoute.toString()};
  const byId = id => document.getElementById(id);
  const keyInput = byId('adminKey'), loadButton = byId('load'), status = byId('status');
  const sections = ['owner', 'publicPool', 'publicIssued'];
  let notes = new Map(), loadedKey = '', loading = false, records = [], cards = [];
  let page = 0, loadController = null, activeSaves = 0, searchTimer;
  const dateFormatter = new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
  const viewKey='bunkaNumberView';
  let previous={};try{previous=JSON.parse(sessionStorage.getItem(viewKey))||{}}catch{}
  const initialRoute=routeFor(location.search,previous);
  if(new URLSearchParams(location.search).has('scope')||new URLSearchParams(location.search).has('number'))previous.scrollY=0;
  keyInput.value=window.AdminSession?window.AdminSession.initialKey():sessionStorage.getItem('bunkaAdminKey')||'';
  const currentKey=()=>window.AdminSession?window.AdminSession.credential():keyInput.value;
  const title=document.querySelector('h1');title.textContent='番号・メモ';title.className='admin-main-title';
  const toolbar=node('div',undefined,byId('summary').parentElement,'toolbar');
  byId('summary').after(toolbar);
  const searchLabel=node('label','番号・AP番号・メモを検索',toolbar),search=node('input',undefined,searchLabel);
  search.type='search';search.placeholder='番号、AP番号、メモの内容';
  search.value=initialRoute.search;
  const filterLabel=node('label','表示する番号',toolbar),filter=node('select',undefined,filterLabel);
  for(const [value,text]of [['all','すべて'],['owner','自己所有品'],['public','一般申請'],['pool','一般番号プール'],['issued','発行済み'],['unused','未発行'],['test','テスト消費']]){const option=node('option',text,filter);option.value=value}
  filter.value=initialRoute.filter;
  const countLabel=node('p','管理情報を読み込むと一覧が表示されます。',toolbar,'result-count');countLabel.setAttribute('role','status');
  const ledger=node('div',undefined,toolbar.parentElement);toolbar.after(ledger);
  for(const section of sections)byId(section).closest('section').hidden=true;
  const pager=node('nav',undefined,ledger.parentElement,'number-pagination');pager.hidden=true;pager.setAttribute('aria-label','番号一覧のページ移動');ledger.before(pager);
  const pagePrev=node('button','前の50件',pager),pageStatus=node('span','',pager),pageNext=node('button','次の50件',pager);
  const stopButton=node('button','読み込みを中止',status.parentElement);stopButton.type='button';stopButton.hidden=true;stopButton.onclick=()=>loadController?.abort();
  page=initialRoute.page;
  const scopeNames={all:'全番号・メモ',owner:'自己所有品プール',pool:'一般番号プール',public:'一般申請の番号',issued:'発行済み番号',unused:'未発行の番号',test:'テスト消費番号'};
  function showScope(){title.textContent=scopeNames[filter.value]||'番号・メモ';window.AdminUI?.setNumberScope?.(filter.value)}
  const searchNow=()=>{clearTimeout(searchTimer);page=0;filterCards()};
  search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchNow,120)});filter.addEventListener('change',searchNow);
  const turn=delta=>{clearTimeout(searchTimer);page+=delta;filterCards();pager.scrollIntoView({block:'start'})};pagePrev.onclick=()=>turn(-1);pageNext.onclick=()=>turn(1);
  const dirty = () => [...notes.values()].some(note => note.text !== note.savedText);
  const saving = () => activeSaves > 0;
  const authorized = () => loadedKey && currentKey() === loadedKey;
  const formatDate = value => {if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'日時不明':dateFormatter.format(date)};
  const isTest = r => Boolean(r && (r.isTest === true || /^AP-TEST/i.test(String(r.ap || '')) || /(^|[-_])test($|[-_])/i.test(String(r.source || ''))));

  function node(tag, text, parent, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (className) el.className = className;
    if (parent) parent.append(el);
    return el;
  }

  async function api(path, key, body, parentSignal) {
    const controller=new AbortController(),abort=()=>controller.abort();
    if(parentSignal?.aborted)controller.abort();else parentSignal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,15000);
    try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal:controller.signal,
      headers: {'X-Admin-Key': key, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      if(response.status===401)window.AdminSession?.expire();
      const error = new Error(data.message || '読み込み・保存に失敗しました。');
      error.current = response.status === 409 ? data.current : null;
      throw error;
    }
    return data;
    } catch(error) {
      if(controller.signal.aborted)throw new Error(parentSignal?.aborted?'読み込みを中止しました。必要ならもう一度表示してください。':'通信が時間内に完了しませんでした。入力は残っています。もう一度お試しください。');
      throw error;
    } finally {clearTimeout(timeout);parentSignal?.removeEventListener('abort',abort)}
  }

  function refresh(note) {
    const changed = note.text !== note.savedText;
    for (const view of note.views) {
      if (view.input.value !== note.text) view.input.value = note.text;
      view.input.disabled = loading || !authorized();
      view.save.disabled = loading || !authorized() || note.saving || !changed || Boolean(note.conflict);
      view.save.textContent = note.saving ? '保存中…' : '保存';
      view.save.classList.toggle('work-action',changed);
      view.message.textContent = note.error || (note.saving ? '保存中…' : changed ? '未保存' : note.updatedAt ? '保存済み · ' + formatDate(note.updatedAt) : 'メモなし');
      view.message.className = 'memo-status ' + (note.error ? 'err' : changed ? 'unsaved' : 'ok');
      view.conflict.hidden = !note.conflict;
      view.latest.textContent = note.conflict ? note.conflict.text || '（空のメモ）' : '';
      view.restore.disabled = loading || !authorized() || note.saving;
    }
    loadButton.disabled = loading || saving();
    const number=note.number;if(number)window.AdminActions?.setDraft('memo:'+number,changed?{id:'memo:'+number,number,ap:'',item:'',view:'numbers',kind:'memo',label:'メモの変更を保存',name:number,local:true}:null);
  }

  function refreshAll() { for (const {record} of cards) {const note=notes.get(record.number);if(note)refresh(note)}loadButton.disabled=loading||saving(); }

  async function save(number) {
    const note = notes.get(number);
    if (!note || note.saving || loading || !authorized() || note.conflict || note.text === note.savedText) return;
    const text = note.text, revision = note.revision;
    note.saving = true; activeSaves++; note.error = ''; refresh(note);
    try {
      const data = await api('/admin/registration-numbers/notes', loadedKey, {number, text, revision});
      note.savedText = data.note.text;
      note.revision = data.note.revision;
      note.updatedAt = data.note.updatedAt;
      // Typing while a save is in flight remains an unsaved draft.
    } catch (error) {
      note.error = error.message;
      note.conflict = error.current || null;
    } finally { note.saving = false; activeSaves--; refresh(note); }
  }

  function editor(cell, number) {
    const note = notes.get(number);
    if (!note) { node('span', 'この番号のメモは利用できません。', cell); return; }
    note.number=number;
    cell.className = 'memo-cell';
    const input = node('textarea', undefined, cell, 'memo-input');
    input.rows = 3; input.maxLength = 5000;
    input.setAttribute('aria-label', number + ' のメモ');
    input.placeholder = '資料名、保管場所、用途など';
    const actions = node('div', undefined, cell, 'memo-actions');
    const button = node('button', '保存', actions, 'memo-save');
    button.type = 'button'; button.setAttribute('aria-label', number + ' のメモを保存');
    const message = node('span', '', actions, 'memo-status');
    message.setAttribute('role', 'status');
    const conflict = node('div', undefined, cell, 'memo-conflict');
    node('p', 'ほかの画面で保存された最新のメモ：', conflict);
    const latest = node('p', '', conflict, 'memo-latest');
    const restore = node('button', '最新のメモを取り込む', conflict);
    restore.type = 'button';
    note.views.push({input, save: button, message, conflict, latest, restore});
    input.addEventListener('input', () => { note.text = input.value; if (!note.conflict) note.error = ''; refresh(note); });
    button.addEventListener('click', () => { void save(number); });
    restore.addEventListener('click', async () => {
      if (!note.conflict) return;
      const choice=await window.AdminUI.choose('最新のメモに置き換えます',number+' の入力中の内容を最新のメモに置き換えます。',[['最新のメモを取り込む','replace'],['編集を続ける','stay','secondary']]);
      if(choice!=='replace')return;
      const current = note.conflict;
      note.text = note.savedText = current.text;
      note.revision = current.revision; note.updatedAt = current.updatedAt;
      note.conflict = null; note.error = ''; refresh(note);
    });
    refresh(note);
  }

  const statusNames={issued:'発行済み',reserved:'番号予約済み',available:'未使用',collision:'重複のため使用不可',cancelled:'取消済み'};
  function rememberView(){const view={search:search.value,filter:filter.value,page,scrollY};try{sessionStorage.setItem(viewKey,JSON.stringify(view));history.replaceState({...history.state,numberView:view},'',location.href)}catch{}}
  function filterCards(){
    showScope();
    if(!loadedKey)return;
    pager.hidden=false;
    const result=selectPage(records,notes,search.value,filter.value,page);page=result.page;
    for(const {record}of cards){const note=notes.get(record.number);if(note)note.views=[];}
    ledger.replaceChildren();cards=[];
    countLabel.textContent=result.start+'〜'+result.end+'件を表示 ／ 検索結果 '+result.total+'件（全 '+records.length+'番号）';
    pageStatus.textContent=(page+1)+' / '+result.pageCount+'ページ';pagePrev.disabled=page===0;pageNext.disabled=page+1>=result.pageCount;
    const fragment=document.createDocumentFragment();
    for(const record of result.rows){

      const card=node('article',undefined,fragment,'ledger-card');card.id='number-'+record.number;
      const head=node('div',undefined,card,'ledger-card-header'),h=node('h2',undefined,head);node('code',record.number,h,'record-number');
      const owner=record.rows.some(r=>r.scope==='owner'),issued=record.rows.some(r=>r.scope==='publicIssued'||r.status==='issued');
      node('span',owner?'自己所有品':issued?'一般申請・発行済み':'一般申請・未発行',head,'queue-status');
      if(record.rows.some(isTest))node('span','テスト消費',head,'test-badge');
      const linked=record.rows.find(r=>/^AP-[A-Z0-9]{8}$/.test(r.ap||''));
      if(linked){const a=node('a',linked.ap+' ／ 資料 '+(linked.item||'')+' の申請を開く',card,'table-action code');a.href='/admin?'+new URLSearchParams({view:'applications',ap:linked.ap,...(linked.item?{item:linked.item}:{})});}
      editor(node('div',undefined,card),record.number);
      const details=node('details',undefined,card,'ledger-records');node('summary','生成・発行の履歴と保存情報',details);
      for(const r of record.rows){node('h3',{owner:'自己所有品の番号',publicPool:'番号の生成履歴',publicIssued:'番号の発行履歴'}[r.scope],details);const dl=node('dl',undefined,details);for(const [label,text]of [['状態',owner?'自己所有品':statusNames[r.status]||r.status||'未設定'],['生成日時',formatDate(r.generatedAt)],['発行日時',formatDate(r.issuedAt)],['AP番号',r.ap],['資料番号',r.item],['保存情報',r.location]])if(text){node('dt',label,dl);node('dd',text,dl);}}
      cards.push({el:card,record});
    }
    ledger.append(fragment);
    if(!result.total)node('p','該当する登録番号はありません。',ledger,'empty-state');
    rememberView();
  }
  function renderLedger(data){records=makeRecords(data);filterCards();}

  loadButton.addEventListener('click', async () => {
    if (loading || saving()) return;
    if(dirty()){const choice=await window.AdminUI.choose('未保存のメモがあります','入力中の変更を破棄して、一覧を読み込み直します。',[['破棄して再読込','reload','danger'],['編集を続ける','stay','secondary']]);if(choice!=='reload')return;}
    if(window.AdminSession&&!await window.AdminSession.login())return;
    const key = currentKey();
    if (!key.trim()) { status.textContent = '管理キーを入力してください。'; status.className = 'note err'; return; }
    loading = true; loadButton.disabled = true; refreshAll();
    const controller=new AbortController();loadController=controller;stopButton.hidden=false;
    const overallTimeout=setTimeout(()=>controller.abort(),60000);
    status.textContent = '番号とメモを読み込み中…'; status.className = 'note';
    try {
      const data = await api('/admin/registration-numbers/data', key,undefined,controller.signal);
      const numbers = [...new Set(sections.flatMap(section => data[section].map(r => r.number)))].filter(n => typeof n === 'string' && /^[A-Z0-9]{8}$/.test(n));
      const saved = new Map();
      let next=0,completed=0;
      status.textContent='番号 '+numbers.length+'件のメモを読み込み中… 0 / '+numbers.length+'件';
      const reader=async()=>{while(next<numbers.length){if(controller.signal.aborted)throw Error('読み込みを中止しました。必要ならもう一度表示してください。');const batch=numbers.slice(next,next+100);next+=100;const result=await api('/admin/registration-numbers/notes/read',key,{numbers:batch},controller.signal);for(const number of batch){const note=result.notes[number];if(!note)throw Error('一部のメモを確認できませんでした。もう一度読み込んでください。');saved.set(number,{...note,savedText:note.text,saving:false,error:'',conflict:null,views:[]});}completed+=batch.length;status.textContent='メモを読み込み中… '+completed+' / '+numbers.length+'件';}};
      const readers=await Promise.allSettled(Array.from({length:Math.min(3,Math.ceil(numbers.length/100))},()=>reader().catch(error=>{controller.abort();throw error})));
      const failed=readers.find(r=>r.status==='rejected');if(failed)throw failed.reason;
      if(controller.signal.aborted)throw Error('読み込みを中止しました。必要ならもう一度表示してください。');
      if (currentKey() !== key) throw new Error('管理キーが変更されました。もう一度一覧を読み込んでください。');
      notes = saved; loadedKey = key;
      byId('summary').replaceChildren();
      for (const [label, count, scope, test] of [['自己所有品プール', data.counts.owner,'owner'], ['一般番号プール', data.counts.publicPool,'pool'], ['発行済み番号', data.counts.publicIssued,'issued'], ['テスト消費', data.counts.testConsumed || 0,'test',true]]) {
        const card = node('a', undefined, byId('summary'), 'card' + (test ? ' test-card' : ''));card.href='/admin/registration-numbers?scope='+scope;
        node('div', label, card); node('strong', count + '件', card);
      }
      renderLedger(data);
      status.textContent = '読み込みました。メモを編集したら、番号ごとの「保存」を押してください。'; status.className = 'note ok';
      const target=new URLSearchParams(location.search).get('number');if(target&&/^[A-Z0-9]{8}$/.test(target)){const el=byId('number-'+target);if(el){el.classList.add('is-target');requestAnimationFrame(()=>el.scrollIntoView({block:'start'}))}else status.textContent='指定された番号は見つかりませんでした。検索条件を確認してください。'}else if(previous.scrollY){requestAnimationFrame(()=>scrollTo(0,previous.scrollY));previous.scrollY=0;}
    } catch (error) {
      status.textContent = '確認できませんでした: ' + error.message; status.className = 'note err';
    } finally {clearTimeout(overallTimeout);loadController=null;stopButton.hidden=true;loading = false; loadButton.disabled = false; refreshAll(); }
  });

  keyInput.addEventListener('input', () => {
    loadController?.abort();
    refreshAll();
    if (loadedKey && !authorized()) { status.textContent = '管理キーが変更されました。一覧を読み込み直してください。'; status.className = 'note'; }
  });
  window.addEventListener('beforeunload', event => {
    rememberView();
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide',()=>loadController?.abort());
  function navigateNumbers(url,push=false,restore){
    clearTimeout(searchTimer);if(push)rememberView();
    const view=restore||routeFor(url.search,{filter:filter.value,search:search.value,page});
    if(push)history.pushState({},'',url.pathname+url.search);
    search.value=view.search||'';filter.value=view.filter||'all';page=view.page||0;
    previous.scrollY=0;showScope();filterCards();rememberView();
    requestAnimationFrame(()=>scrollTo(0,restore?.scrollY||0));
  }
  window.addEventListener('popstate',event=>navigateNumbers(new URL(location.href),false,event.state?.numberView));
  window.addEventListener('DOMContentLoaded',()=>{
    window.AdminUI.navigateNumbers=navigateNumbers;showScope();
    if(window.AdminUI)window.AdminUI.beforeLeave=async()=>{
      if(saving()){window.AdminUI.say('メモの保存が終わるまでお待ちください。');return false}
      if(!dirty()){loadController?.abort();rememberView();return true;}
      const choice=await window.AdminUI.choose('未保存のメモがあります','移動する前にメモを保存できます。',[['すべて保存して移動','save'],['変更を破棄して移動','discard','danger'],['編集を続ける','stay','secondary']]);
      if(choice==='stay')return false;
      if(choice==='save'){for(const [number,note]of notes)if(note.text!==note.savedText)await save(number);if(dirty()){window.AdminUI.say('保存できていないメモがあります。内容を確認してください。');return false}}
      else for(const note of notes.values()){note.text=note.savedText;note.conflict=null;note.error='';refresh(note)}
      loadController?.abort();rememberView();return true;
    };
    if(currentKey())loadButton.click();
  });
})();
`;
