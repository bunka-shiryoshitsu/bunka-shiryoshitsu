export const registrationNumbersClient = String.raw`
(() => {
  const byId = id => document.getElementById(id);
  const keyInput = byId('adminKey'), loadButton = byId('load'), status = byId('status');
  const sections = ['owner', 'publicPool', 'publicIssued'];
  let notes = new Map(), loadedKey = '', loading = false;
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

  function table(rows, type, root) {
    root.replaceChildren();
    if (!rows.length) { node('p', '0件', root); return; }
    const wrap = node('div', undefined, root, 'ledger-table');
    const table = node('table', undefined, wrap);
    const header = node('tr', undefined, node('thead', undefined, table));
    const headers = type === 'owner' ? ['番号', 'メモ', '保存場所'] : ['番号', 'メモ', '状態', '生成日時', '発行日時', 'AP', '資料', '保存場所'];
    for (const label of headers) node('th', label, header).scope = 'col';
    const body = node('tbody', undefined, table);
    for (const record of rows) {
      const test = type !== 'owner' && isTest(record);
      const row = node('tr', undefined, body, test ? 'test-row' : '');
      const numberCell = node('td', undefined, row);
      node('code', record.number, numberCell, test ? 'test-number' : '');
      if (test) node('span', 'テスト消費', numberCell, 'test-badge');
      editor(node('td', undefined, row), record.number);
      if (type !== 'owner') {
        for (const field of ['status', 'generatedAt', 'issuedAt', 'ap', 'item']) node('td', record[field] || '', row);
      }
      node('code', record.location, node('td', undefined, row));
    }
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
      notes = saved; loadedKey = key;
      byId('summary').replaceChildren();
      for (const [label, count, test] of [['自己所有品専用', data.counts.owner], ['一般・生成台帳', data.counts.publicPool], ['一般・発行済み', data.counts.publicIssued], ['テスト消費', data.counts.testConsumed || 0, true]]) {
        const card = node('div', undefined, byId('summary'), 'card' + (test ? ' test-card' : ''));
        node('div', label, card); node('strong', count + '件', card);
      }
      for (const section of sections) table(data[section], section, byId(section));
      status.textContent = '読み込みました。メモを編集したら、番号ごとの「保存」を押してください。'; status.className = 'note ok';
    } catch (error) {
      status.textContent = '確認できませんでした: ' + error.message; status.className = 'note err';
    } finally { loading = false; loadButton.disabled = false; refreshAll(); }
  });

  keyInput.addEventListener('input', () => {
    refreshAll();
    if (loadedKey && !authorized()) { status.textContent = '管理キーが変更されました。一覧を読み込み直してください。'; status.className = 'note'; }
  });
  window.addEventListener('beforeunload', event => {
    if (dirty() || saving()) { event.preventDefault(); event.returnValue = ''; }
  });
})();
`;
