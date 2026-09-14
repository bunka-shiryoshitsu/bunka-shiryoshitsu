// These functions also run in the browser. Keep the result data separate from DOM
// cards so a large reserved-number pool never creates one editor per number.
export function numberRecords(data) {
  const unique = new Map();
  for (const scope of ['owner', 'publicPool', 'publicIssued']) {
    for (const row of data[scope] || []) {
      if (typeof row.number !== 'string' || !/^[A-Z0-9]{8}$/.test(row.number)) continue;
      if (!unique.has(row.number)) unique.set(row.number, {number: row.number, rows: []});
      unique.get(row.number).rows.push({...row, scope});
    }
  }
  return [...unique.values()].map(record => ({
    ...record,
    owner: record.rows.some(r => r.scope === 'owner'),
    issued: record.rows.some(r => r.scope === 'publicIssued' || r.status === 'issued'),
    test: record.rows.some(r => r.isTest === true || /^AP-TEST/i.test(r.ap || '') || /(^|[-_])test($|[-_])/i.test(r.source || '')),
    searchText: [record.number, ...record.rows.map(r => r.ap || '')].join(' ').toLowerCase()
  }));
}

export function numberPage(records, notes, query = '', type = 'all', requestedPage = 0) {
  const size = 50, q = String(query).trim().toLowerCase();
  const matches = records.filter(r => {
    const kind = type === 'all' || type === 'owner' && r.owner || type === 'public' && !r.owner ||
      type === 'issued' && r.issued || type === 'unused' && !r.issued || type === 'test' && r.test;
    return kind && (!q || r.searchText.includes(q) || String(notes.get(r.number)?.text || '').toLowerCase().includes(q));
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / size));
  const page = Math.min(pageCount - 1, Math.max(0, Math.trunc(Number(requestedPage)) || 0));
  return {rows: matches.slice(page * size, (page + 1) * size), total: matches.length, page, pageCount, start: matches.length ? page * size + 1 : 0, end: Math.min((page + 1) * size, matches.length)};
}
