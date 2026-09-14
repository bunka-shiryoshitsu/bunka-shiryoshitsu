export const registrationNumbersClient = String.raw`
(() => {
  const byId = id => document.getElementById(id);
  const keyInput = byId('adminKey'), loadButton = byId('load'), status = byId('status');
  const sections = ['owner', 'publicPool', 'publicIssued'];
  let notes = new Map(), loadedKey = '', loading = false, records = [], cards = [];
  const viewKey='bunkaNumberView';
  let previous={};try{previous=JSON.parse(sessionStorage.getItem(viewKey))||{}}catch{}
  keyInput.value=sessionStorage.getItem('bunkaAdminKey')||'';
  const title=document.querySelector('h1');title.textContent='番号・メモ';title.className='admin-main-title';
  const toolbar=node('div',undefined,byId('summary').parentElement,'toolbar');
  byId('summary').after(toolbar);
  const searchLabel=node('label','番号・AP番号・メモを検索',toolbar),search=node('input',undefined,searchLabel);
  search.type='search';search.placeholder='番号、AP番号、メモの内容';
  search.value=new URLSearchParams(location.search).get('number')||previous.search||'';
  const filterLabel=node('label','表示する番号',toolbar),filter=node('select',undefined,filterLabel);
  for(const [value,text]of [['all','すべて'],['owner','自己所有品'],['public','一般申請'],['issued','発行済み'],['unused','未発行'],['test','テスト消費']]){const option=node('option',text,filter);option.value=value}
  filter.value=new URLSearchParams(location.search).has('number')?'all':previous.filter||'all';
  const countLabel=node('p','管理情報を読み込むと一覧が表示されます。',toolbar,'result-count');countLabel.setAttribute('role','status');
  const ledger=node('div',undefined,toolbar.parentElement);toolbar.after(ledger);
  for(const section of sections)byId(section).closest('section').hidden=true;
  search.addEventListener('input',filterCards);filter.addEventListener('change',filterCards);
  const dirty = () => [...notes.values()].some(note => note.text !== note.savedText);
  const saving = () => [...notes.values()].some(note => note.saving);
  const authorized = () => loadedKey && keyInput.value === loadedKey;
  const formatDate = value => value ? new Date(value).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}) : '';
  const isTest = r => Boolean(r && (r.isTest === true || /^AP-TEST/i.test(String(r.ap || '')) || /(^|[-_])test($|[-_])/i.test(String(r.source || ''))));

  function node(tag, text, parent, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (className) el.className = className;
    if (parent) parent.append(el);
    return el;
  }

  async function api(path, key, body) {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: {'X-Admin-Key': key, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      const error = new Error(data.message || '読み込み・保存に失敗しました。');
      error.current = response.status === 409 ? data.current : null;
      throw error;
    }
    return data;
  }

  function refresh(note) {
    const changed = note.text !== note.savedText;
    for (const view of note.views) {
      if (view.input.value !== note.text) view.input.value = note.text;
      view.input.disabled = loading || !authorized();
      view.save.disabled = loading || !authorized() || note.saving || !changed || Boolean(note.conflict);
      view.save.textContent = note.saving ? '保存中…' : '保存';
      view.message.textContent = note.error || (note.saving ? '保存中…' : changed ? '未保存' : note.updatedAt ? '保存済み · ' + formatDate(note.updatedAt) : 'メモなし');
      view.message.className = 'memo-status ' + (note.error ? 'err' : changed ? 'unsaved' : 'ok');
      view.conflict.hidden = !note.conflict;
      view.latest.textContent = note.conflict ? note.conflict.text || '（空のメモ）' : '';
      view.restore.disabled = loading || !authorized() || note.saving;
    }
    loadButton.disabled = loading || saving();
    filterCards();
  }

  function refreshAll() { for (const note of notes.values()) refresh(note); }

  async function save(number) {
    const note = notes.get(number);
    if (!note || note.saving || loading || !authorized() || note.conflict || note.text === note.savedText) return;
    const text = note.text, revision = note.revision;
    note.saving = true; note.error = ''; refresh(note);
    try {
      const data = await api('/admin/registration-numbers/notes', loadedKey, {number, text, revision});
      note.savedText = data.note.text;
      note.revision = data.note.revision;
      note.updatedAt = data.note.updatedAt;
      // Typing while a save is in flight remains an unsaved draft.
    } catch (error) {
      note.error = error.message;
      note.conflict = error.current || null;
    } finally { note.saving = false; refresh(note); }
  }

  function editor(cell, number) {
    const note = notes.get(number);
    if (!note) { node('span', 'この番号のメモは利用できません。', cell); return; }
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
    restore.addEventListener('click', () => {
      if (!note.conflict || !confirm('入力中の内容を、表示されている最新のメモに置き換えますか？必要な内容は先に控えてください。')) return;
      const current = note.conflict;
      note.text = note.savedText = current.text;
      note.revision = current.revision; note.updatedAt = current.updatedAt;
      note.conflict = null; note.error = ''; refresh(note);
    });
    refresh(note);
  }

  const statusNames={issued:'発行済み',reserved:'番号予約済み',available:'未使用',collision:'重複のため使用不可',cancelled:'取消済み'};
  function rememberView(){try{sessionStorage.setItem(viewKey,JSON.stringify({search:search.value,filter:filter.value,scrollY}))}catch{}}
  function filterCards(){if(!cards)return;const q=search.value.trim().toLocaleLowerCase('ja-JP');let visible=0;for(const {el,record}of cards){const issued=record.rows.some(r=>r.scope==='publicIssued'||r.status==='issued'),test=record.rows.some(isTest),owner=record.rows.some(r=>r.scope==='owner');const matchType=filter.value==='all'||filter.value==='owner'&&owner||filter.value==='public'&&!owner||filter.value==='issued'&&issued||filter.value==='unused'&&!issued||filter.value==='test'&&test;const haystack=[record.number,notes.get(record.number)?.text,...record.rows.map(r=>r.ap||'')].join(' ').toLocaleLowerCase('ja-JP');const editing=el.contains(document.activeElement)&&notes.get(record.number)?.text!==notes.get(record.number)?.savedText;el.hidden=!(editing||matchType&&(!q||haystack.includes(q)));if(!el.hidden)visible++}if(loadedKey)countLabel.textContent=visible+'件を表示 ／ 異なる番号 '+cards.length+'件';rememberView()}
  function renderLedger(data){
    ledger.replaceChildren();cards=[];const unique=new Map();
    for(const scope of sections)for(const r of data[scope]){if(!notes.has(r.number))continue;if(!unique.has(r.number))unique.set(r.number,{number:r.number,rows:[]});unique.get(r.number).rows.push({...r,scope});}
    records=[...unique.values()];
    for(const record of records){
      const card=node('article',undefined,ledger,'ledger-card');card.id='number-'+record.number;
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
    filterCards();if(!records.length)node('p','登録番号はありません。',ledger,'empty-state');
  }

  loadButton.addEventListener('click', async () => {
    if (loading || saving()) return;
    if (dirty() && !confirm('未保存のメモがあります。入力中の変更を破棄して一覧を読み込み直しますか？')) return;
    const key = keyInput.value;
    if (!key.trim()) { status.textContent = '管理キーを入力してください。'; status.className = 'note err'; return; }
    loading = true; loadButton.disabled = true; refreshAll();
    status.textContent = '番号とメモを読み込み中…'; status.className = 'note';
    try {
      const data = await api('/admin/registration-numbers/data', key);
      const numbers = [...new Set(sections.flatMap(section => data[section].map(r => r.number)))].filter(n => typeof n === 'string' && /^[A-Z0-9]{8}$/.test(n));
      const saved = new Map();
      for (let i = 0; i < numbers.length; i += 100) {
        const result = await api('/admin/registration-numbers/notes/read', key, {numbers: numbers.slice(i, i + 100)});
        for (const [number, note] of Object.entries(result.notes)) saved.set(number, {...note, savedText: note.text, saving: false, error: '', conflict: null, views: []});
      }
      if (keyInput.value !== key) throw new Error('管理キーが変更されました。もう一度一覧を読み込んでください。');
      notes = saved; loadedKey = key;sessionStorage.setItem('bunkaAdminKey',key);
      byId('summary').replaceChildren();
      for (const [label, count, test] of [['自己所有品専用', data.counts.owner], ['一般・生成台帳', data.counts.publicPool], ['一般・発行済み', data.counts.publicIssued], ['テスト消費', data.counts.testConsumed || 0, true]]) {
        const card = node('div', undefined, byId('summary'), 'card' + (test ? ' test-card' : ''));
        node('div', label, card); node('strong', count + '件', card);
      }
      renderLedger(data);
      status.textContent = '読み込みました。メモを編集したら、番号ごとの「保存」を押してください。'; status.className = 'note ok';
      const target=new URLSearchParams(location.search).get('number');if(target&&/^[A-Z0-9]{8}$/.test(target)){const el=byId('number-'+target);if(el){el.classList.add('is-target');requestAnimationFrame(()=>el.scrollIntoView({block:'start'}))}else status.textContent='指定された番号は見つかりませんでした。検索条件を確認してください。'}else if(previous.scrollY){requestAnimationFrame(()=>scrollTo(0,previous.scrollY));previous.scrollY=0;}
    } catch (error) {
      status.textContent = '確認できませんでした: ' + error.message; status.className = 'note err';
    } finally { loading = false; loadButton.disabled = false; refreshAll(); }
  });

  keyInput.addEventListener('input', () => {
    refreshAll();
    if (loadedKey && !authorized()) { status.textContent = '管理キーが変更されました。一覧を読み込み直してください。'; status.className = 'note'; }
  });
  window.addEventListener('beforeunload', event => {
    rememberView();
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('DOMContentLoaded',()=>{
    if(window.AdminUI)window.AdminUI.beforeLeave=async()=>{
      if(saving()){window.AdminUI.say('メモの保存が終わるまでお待ちください。');return false}
      if(!dirty()){rememberView();return true;}
      const choice=await window.AdminUI.choose('未保存のメモがあります','移動する前にメモを保存できます。',[['すべて保存して移動','save'],['変更を破棄して移動','discard','danger'],['編集を続ける','stay','secondary']]);
      if(choice==='stay')return false;
      if(choice==='save'){for(const [number,note]of notes)if(note.text!==note.savedText)await save(number);if(dirty()){window.AdminUI.say('保存できていないメモがあります。内容を確認してください。');return false}}
      else for(const note of notes.values()){note.text=note.savedText;note.conflict=null;note.error='';refresh(note)}
      rememberView();return true;
    };
    if(keyInput.value)loadButton.click();
  });
})();
`;
