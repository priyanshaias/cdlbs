// CDL + BS store: the people list, the rules for "complete", and every change.
// Live (an API_URL in config.js): divisions are loaded from the Apps Script API and each change is applied on screen at once,
// then sent to the API one at a time; if the API refuses one, that division is loaded again.
// Demo (no API_URL, or ?demo in the address): made-up names, kept in this browser only.
(function () {
  const API = window.CDL_API, LIVE = !!(API && !API.DEMO);
  const KEY = 'cdl-demo-v2';

  const DUTIES = ['Cleaning/Sweeping/Maintenance', 'Nursery Operations', 'Timber Depot', 'Driver', 'Mali/Gardener',
    'Forest Protection and Patrolling', 'Human-Animal Conflict Management', 'Night Guard/Security', 'Others'];
  const PLACES = ['Beat', 'Range office', 'Division office', 'Camp', 'Check post', 'Watch tower', 'Timber depot', 'Nursery', 'Rest house', 'Other'];
  // "Posted at" comes first: Division HQ (kept as the range value) or a range, and each has its own places of work
  const HQ = 'Division HQ';
  const DIV_PLACES = ['Division office', 'Camp', 'Timber depot', 'Nursery', 'Rest house', 'Other'];
  const RANGE_PLACES = PLACES.filter(x => x !== 'Division office');
  const MODES = ['Direct', 'Through agency'];
  const DISTRICTS = ['Alipurduar', 'Bankura', 'Birbhum', 'Cooch Behar', 'Dakshin Dinajpur', 'Darjeeling', 'Hooghly', 'Howrah', 'Jalpaiguri', 'Jhargram',
    'Kalimpong', 'Kolkata', 'Malda', 'Murshidabad', 'Nadia', 'North 24 Parganas', 'Paschim Bardhaman', 'Paschim Medinipur', 'Purba Bardhaman',
    'Purba Medinipur', 'Purulia', 'South 24 Parganas', 'Uttar Dinajpur', 'Outside West Bengal'];
  const REASONS = ['Left the work', 'Deceased', 'Regularised', 'Duplicate entry', 'Other'];

  // field key -> label (also the order of the form)
  const LABEL = { name: 'Name', mode: 'Mode of engagement', agency: 'Agency name', date: 'Engagement date', district: 'District', range: 'Range',
    beat: 'Beat', place: 'Place of work', placeName: 'Name of the place', duty: 'Main duty', other: 'Other duties', details: 'Duty details',
    pay: 'Monthly pay, July 2026 (Rs)', remarks: 'Remarks' };
  const REQUIRED = ['name', 'mode', 'date', 'district', 'range', 'place', 'duty', 'pay'];
  // Ban Sahayaks: no return to start from, engaged directly, pay fixed
  const BS_PAY = 12000;
  const REQUIRED_BS = ['name', 'date', 'district', 'range', 'place', 'duty'];
  const CADRES = { CDL: 'DL / CDL', BS: 'Ban Sahayak' };
  const VAGUE = /^\s*(do|d\.o\.?|various|variouss|misc\.?|miscellaneous|other|others|field work|field duty|forestry work|general|all work|-)?\s*$/i;

  let st = null;
  const now = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const save = () => { if (LIVE) return; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* still works for this visit */ } };
  const hex8 = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  function fresh() {
    return { user: null, log: [], certified: {}, seq: 1,
      people: (window.CDL_DEMO || []).map(p => Object.assign({ cadre: 'CDL', ver: '', state: 'active', updOn: '', updBy: '' }, p, { other: (p.other || []).slice() })) };
  }
  function load() {
    if (LIVE) { st = { user: API.user, log: [], certified: {}, people: [], meta: null, metaAt: 0, loaded: {}, pendingRows: null }; fromDevice(); return; }
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || !st.people) { st = fresh(); save(); }
    st.people.forEach(p => {   // lists saved before "Posted at" and Ban Sahayaks
      if (p.place === 'Division office' && p.range !== HQ) { p.range = HQ; p.beat = ''; }
      if (!p.cadre) p.cadre = 'CDL';
    });
  }
  function reset() { if (LIVE) return; const u = st && st.user; st = fresh(); st.user = u; save(); }

  /* ---- live: talking to the API */
  // saves go one after another, so each is sent with the person's latest "Last updated on" from the server
  let queue = Promise.resolve(), waiting = 0;
  const hooks = { error: () => {}, busy: () => {} };
  function normal(r) {
    r.other = r.other || []; r._srv = r.updOn || '';
    if (r.place === 'Division office' && r.range !== HQ) r.range = HQ;
    return r;
  }
  /** Puts rows from the API in place of ours (a removed person leaves the list). */
  function apply(rows) {
    (rows || []).forEach(r => {
      normal(r);
      const i = st.people.findIndex(p => p.id === r.id);
      if (r.state === 'removed') { if (i >= 0) st.people.splice(i, 1); }
      else if (i >= 0) st.people[i] = r;
      else if (st.loaded[r.division]) st.people.push(r);
    });
  }
  function send(action, body, div) {
    if (!LIVE) return;
    waiting++; hooks.busy(waiting);
    queue = queue.then(() => API.call(action, typeof body === 'function' ? body() : body))
      .then(res => { apply(res && res.rows); toDevice(); if (res && res.cert) st.certified[ck(div, body.cadre)] = res.cert; if (action === 'decide' && st.pendingRows) st.pendingRows = st.pendingRows.filter(p => p.id !== body.id); })
      .catch(err => (div && !err.auth ? loadDivision(div).catch(() => {}) : Promise.resolve()).then(() => hooks.error(err)))
      .finally(() => { waiting--; hooks.busy(waiting); });
  }
  // live: the summary and the last 3 divisions opened are kept on this device for this user, so the next visit shows them at once
  // (marked old, so they are fetched again in the background). Signing out removes them.
  const DKEY = () => 'cdlbs_cache|' + ((st.user && st.user.username) || '');
  let deviceTimer = 0;
  function toDevice() {
    clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => {
      try {
        const divs = Object.keys(st.loaded).sort((a, b) => st.loaded[b] - st.loaded[a]).slice(0, 3), d = {};
        divs.forEach(x => { d[x] = { rows: st.people.filter(p => p.division === x), certs: { CDL: st.certified[ck(x, 'CDL')] || null, BS: st.certified[ck(x, 'BS')] || null } }; });
        localStorage.setItem(DKEY(), JSON.stringify({ meta: st.meta, divs: d }));
      } catch (e) { /* full or blocked: the next visit simply loads from the API */ }
    }, 400);
  }
  function fromDevice() {
    if (!st.user) return;
    try {
      const c = JSON.parse(localStorage.getItem(DKEY()) || 'null'); if (!c) return;
      st.meta = c.meta || null;
      Object.keys(c.divs || {}).forEach(x => {
        st.people = st.people.concat(c.divs[x].rows.map(normal)); st.loaded[x] = 1;
        ['CDL', 'BS'].forEach(k => { if (c.divs[x].certs[k]) st.certified[ck(x, k)] = c.divs[x].certs[k]; });
      });
    } catch (e) { /* ignore a damaged copy */ }
  }
  async function loadDivision(div) {
    const res = await API.call('load', { division: div });
    st.people = st.people.filter(p => p.division !== div).concat(res.rows.map(normal));
    ['CDL', 'BS'].forEach(c => { if (res.certs[c]) st.certified[ck(div, c)] = res.certs[c]; else delete st.certified[ck(div, c)]; });
    st.loaded[div] = Date.now(); toDevice();
  }
  async function loadMeta() { st.meta = await API.call('meta'); st.metaAt = Date.now(); toDevice(); }
  async function loadPending() { st.pendingRows = (await API.call('pending')).rows.map(normal); }
  async function loadLog() { st.log = (await API.call('log')).rows; st.logAt = Date.now(); }

  const blank = v => v == null || (Array.isArray(v) ? !v.length : !String(v).trim());
  function missing(p) {
    const m = (p.cadre === 'BS' ? REQUIRED_BS : REQUIRED).filter(f => blank(p[f]));
    if (p.duty === 'Others' && (blank(p.details) || VAGUE.test(p.details) || String(p.details).trim().length < 10)) m.push('details');
    return m;
  }
  // removed > removal pending > problem > confirmed > missing > ready
  function status(p) {
    if (p.state === 'removed') return 'removed';
    if (p.state === 'remove-pending') return 'remove';
    if (p.flag) return 'problem';
    if (p.ver) return 'confirmed';
    return missing(p).length ? 'missing' : 'ready';
  }
  const fmt = (f, v) => f === 'other' ? (v || []).join(', ') : f === 'pay' ? (v == null || v === '' ? '' : String(v)) : String(v == null ? '' : v);

  function log(p, type, field, oldV, newV) {
    st.log.unshift({ on: now(), by: st.user ? st.user.name : '', division: p.division, cadre: p.cadre, id: p.id, name: p.name, type, field, old: oldV, new: newV });
  }
  const find = id => st.people.find(p => p.id === id);

  // Track changes: compare with the list as it came from the returns
  // (live: each row carries its values from the return in .orig)
  const ORIG = {}; (window.CDL_DEMO || []).forEach(p => { ORIG[p.id] = p; });
  const TRACK = ['name', 'mode', 'agency', 'date', 'district', 'range', 'beat', 'place', 'placeName', 'duty', 'other', 'details', 'pay', 'remarks'];
  const original = id => { const p = LIVE && find(id); return LIVE ? (p && p.orig) || null : ORIG[id] || null; };
  function changed(p) { const o = LIVE ? p.orig : ORIG[p.id]; return o ? TRACK.filter(f => fmt(f, o[f]) !== fmt(f, p[f])) : []; }
  // live: the person's last change (the log of each field stays in the sheet)
  function lastEdit(id, f) {
    if (LIVE) { const p = find(id); return p && p.updOn ? { by: p.updBy, on: p.updOn } : null; }
    const l = st.log.find(x => x.id === id && x.type === 'Edit' && x.field === LABEL[f]); return l ? { by: l.by, on: l.on } : null;
  }
  // certificates are kept per division and cadre (DL / CDL keeps the plain division name)
  const ck = (div, cadre) => cadre === 'BS' ? div + ' · BS' : div;
  const locked = (div, cadre) => !!st.certified[ck(div, cadre)];

  /** Saves changed fields. A confirmed person stays confirmed only while still complete. */
  function update(id, ch) {
    const p = find(id); if (!p || locked(p.division, p.cadre)) return 0;
    let n = 0; const sent = {};
    Object.keys(ch).forEach(f => {
      let v = ch[f];
      if (f === 'pay') v = v === '' || v == null ? null : Number(v);
      if (f === 'other') v = (v || []).filter(x => x !== (ch.duty || p.duty));
      if (fmt(f, p[f]) === fmt(f, v)) return;
      log(p, 'Edit', LABEL[f] || f, fmt(f, p[f]), fmt(f, v));
      p[f] = v; sent[f] = v; n++;
    });
    if (n) send('update', () => ({ id, ch: sent, base: (find(id) || p)._srv }), p.division);
    if (p.other && p.duty) p.other = p.other.filter(x => x !== p.duty);
    if (n) { p.updOn = now(); p.updBy = st.user.name; if (p.ver && missing(p).length) { p.ver = ''; log(p, 'Verification removed', '', 'Verified', ''); } }
    save(); return n;
  }
  /** Confirms everyone in ids who is complete and has no open problem. */
  function confirm(ids) {
    let done = 0, skipped = 0; const ok = [];
    ids.forEach(id => {
      const p = find(id); if (!p || locked(p.division, p.cadre)) return;
      const s = status(p);
      if (s === 'ready') { p.ver = 'Confirmed'; p.updOn = now(); p.updBy = st.user.name; log(p, 'Verified', '', '', 'Verified'); done++; ok.push(p); }
      else if (s !== 'confirmed') skipped++;
    });
    if (ok.length) send('confirm', { ids: ok.map(p => p.id) }, ok[0].division);
    save(); return { done, skipped };
  }
  function unconfirm(id) { const p = find(id); if (p && p.ver && !locked(p.division, p.cadre)) { p.ver = ''; log(p, 'Verification removed', '', 'Verified', ''); send('unconfirm', { id }, p.division); save(); } }

  /** Same value for many people at once (main duty, other duty, place of work). */
  function bulk(ids, field, value) {
    let n = 0;
    ids.forEach(id => {
      const p = find(id); if (!p || p.state === 'removed') return;
      if (field === 'addOther') { if (value !== p.duty && !p.other.includes(value)) n += update(id, { other: p.other.concat(value) }); }
      else n += update(id, { [field]: value });
    });
    return n;
  }

  function markNotWorking(id, reason, remark, quiet) {
    const p = find(id); if (!p || locked(p.division, p.cadre)) return;
    if (!quiet) send('notWorking', { id, reason, remark }, p.division);
    if (p.state === 'add-pending') { p.state = 'removed'; log(p, 'New person withdrawn', '', '', reason); save(); return; }
    p.state = 'remove-pending'; p.removal = { reason, remark, by: st.user.name, on: now() };
    log(p, 'Marked not working', 'Reason', '', reason + (remark ? ' (' + remark + ')' : ''));
    save();
  }
  function undoRemoval(id) { const p = find(id); if (p && p.state === 'remove-pending') { p.state = 'active'; delete p.removal; log(p, 'Removal withdrawn', '', '', ''); send('undoRemoval', { id }, p.division); save(); } }

  /** Double entry: either both are real people, or this one is the duplicate. */
  function resolveFlag(id, isDuplicate) {
    const p = find(id); if (!p) return;
    const twins = st.people.filter(x => x.flag && x.division === p.division && x.name === p.name && x.date === p.date);
    twins.forEach(x => { x.flag = ''; });
    send('resolveFlag', { id, dup: !!isDuplicate }, p.division);
    if (isDuplicate) markNotWorking(id, 'Duplicate entry', '', true);
    else { log(p, 'Problem resolved', '', '', 'Different people'); save(); }
  }

  /** A DL / CDL not in the list waits for the admin; Ban Sahayaks are entered by the division and count straight away. */
  function addPerson(d) {
    const bs = d.cadre === 'BS', id = (bs ? 'BS-' : 'NEW-') + hex8();
    const p = Object.assign({ id, cadre: 'CDL', ver: '', state: bs ? 'active' : 'add-pending', flag: '', other: [], mode: '', agency: '', beat: '', placeName: '', details: '',
      updOn: now(), updBy: st.user.name }, d, bs ? { mode: 'Direct', agency: '', pay: BS_PAY } : {});
    st.people.push(p); log(p, 'Added', '', '', bs ? 'Ban Sahayak' : 'New person');
    send('add', { person: Object.assign({}, p) }, p.division);
    save(); return p;
  }

  // Admin approvals: additions and removals only
  const pending = () => LIVE ? (st.pendingRows || []) : st.people.filter(p => p.state === 'add-pending' || p.state === 'remove-pending');
  function decide(id, approve) {
    if (LIVE) { const r = pending().find(x => x.id === id); if (r) { r.state = approve === (r.state === 'add-pending') ? 'active' : 'removed'; send('decide', { id, approve }, r.division); st.pendingRows = st.pendingRows.filter(x => x.id !== id); if (st.meta) st.meta.pending = Math.max(0, st.meta.pending - 1); } return; }
    const p = find(id); if (!p) return;
    if (p.state === 'add-pending') { p.state = approve ? 'active' : 'removed'; log(p, approve ? 'Addition approved' : 'Addition rejected', '', '', ''); }
    else if (p.state === 'remove-pending') { p.state = approve ? 'removed' : 'active'; log(p, approve ? 'Removal approved' : 'Removal rejected', '', '', ''); if (!approve) delete p.removal; }
    save();
  }

  // Names that look alike in one division (for the "already listed?" check)
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  const key = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  function similar(div, name, cadre) {
    const k = key(name); if (k.length < 4) return [];
    return st.people.filter(p => p.division === div && p.cadre === cadre && p.state !== 'removed' && lev(key(p.name), k) <= Math.max(1, Math.floor(k.length / 6)));
  }

  // cadre: 'CDL' or 'BS'; null for both (range and beat suggestions)
  function people(div, cadre = 'CDL') { return st.people.filter(p => p.division === div && p.state !== 'removed' && (!cadre || p.cadre === cadre)); }
  function counts(list) {
    const c = { all: 0, missing: 0, ready: 0, problem: 0, confirmed: 0, remove: 0, added: 0, changed: 0 };
    list.forEach(p => { const s = status(p); if (s === 'removed') return; c.all++; c[s]++; if (p.state === 'add-pending') c.added++; if (changed(p).length) c.changed++; });
    c.active = c.all - c.remove;
    return c;
  }
  /** Every division (from the DL / CDL list), with counts for one cadre. */
  function divisions(cadre = 'CDL') {
    if (LIVE) {
      if (!st.meta) return [];
      return st.meta.divisions.map(d => {
        const here = st.loaded[d.division], key = d.division + '|' + cadre;
        return { circle: d.circle, division: d.division, counts: here ? counts(people(d.division, cadre)) : d[cadre],
          certified: here ? st.certified[ck(d.division, cadre)] || null : st.meta.certs[key] || null, last: d.last[cadre] || '' };
      }).sort((a, b) => (a.circle + a.division).localeCompare(b.circle + b.division));
    }
    const m = {};
    st.people.forEach(p => { (m[p.division] = m[p.division] || { circle: p.circle, division: p.division }); });
    return Object.values(m).sort((a, b) => (a.circle + a.division).localeCompare(b.circle + b.division)).map(d => {
      const last = st.log.find(l => l.division === d.division && (l.cadre || 'CDL') === cadre);
      return Object.assign(d, { counts: counts(people(d.division, cadre)), certified: st.certified[ck(d.division, cadre)] || null, last: last ? last.on : '' });
    });
  }
  /** A division can be certified when everyone still working is confirmed and no problem is open. */
  function canCertify(div, cadre) { const c = counts(people(div, cadre)); return c.active > 0 && c.confirmed === c.active; }
  function certify(div, cadre, name, desig) {
    if (!canCertify(div, cadre)) return false;
    st.certified[ck(div, cadre)] = { name, desig, on: now(), by: st.user.name };
    send('certify', { division: div, cadre, name, desig }, div);
    st.log.unshift({ on: now(), by: st.user.name, division: div, cadre, id: '', name: '', type: CADRES[cadre] + ' list certified', field: '', old: '', new: name + ', ' + desig });
    save(); return true;
  }
  function reopen(div, cadre) { delete st.certified[ck(div, cadre)]; send('reopen', { division: div, cadre }, div); st.log.unshift({ on: now(), by: st.user.name, division: div, cadre, id: '', name: '', type: CADRES[cadre] + ' list reopened', field: '', old: '', new: '' }); save(); }

  function signIn(u) { st.user = u; save(); if (LIVE) fromDevice(); }
  function signOut() { if (LIVE) { try { localStorage.removeItem(DKEY()); } catch (e) { /* fine */ } API.signOut(); load(); return; } st.user = null; save(); }
  /**
   * Dashboard: every division with its counts and figures for both cadres (same shape as summary_ in Code.gs).
   * Live: from the API's summary. Demo: added up here.
   */
  const payBand = n => n < 6000 ? '<6k' : n < 8000 ? '6-8k' : n < 10000 ? '8-10k' : n < 12000 ? '10-12k' : n < 15000 ? '12-15k' : n < 20000 ? '15-20k' : '20k+';
  const x0 = () => ({ other: {}, place: {}, at: { HQ: 0, Range: 0, none: 0 }, years: {}, pay: {}, paySum: 0, payN: 0, mode: {}, miss: {}, vday: {}, changed: 0 });
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  function dashX(rows) {
    const o = { duty: { CDL: {}, BS: {} }, blank: { CDL: 0, BS: 0 }, x: { CDL: x0(), BS: x0() } };
    rows.forEach(p => {
      const c = p.cadre === 'BS' ? 'BS' : 'CDL', st = status(p); if (st === 'removed' || st === 'remove') return;
      const x = o.x[c], y = /(\d{4})$/.exec(p.date || '');
      if (p.duty) inc(o.duty[c], p.duty); else o.blank[c]++;
      (p.other || []).forEach(d => inc(x.other, d));
      inc(x.place, p.place || '');
      x.at[p.range === HQ ? 'HQ' : p.range ? 'Range' : 'none']++;
      if (y) inc(x.years, y[1]);
      if (p.pay) { x.paySum += p.pay; x.payN++; inc(x.pay, payBand(p.pay)); }
      inc(x.mode, p.mode || '');
      missing(p).forEach(f => inc(x.miss, f));
      if (p.ver && p.updOn) inc(x.vday, p.updOn.slice(0, 10));
      if (changed(p).length) x.changed++;
    });
    return o;
  }
  function dashData() {
    if (LIVE) {
      if (!st.meta) return [];
      return st.meta.divisions.map(d => Object.assign({ x: { CDL: x0(), BS: x0() }, duty: { CDL: {}, BS: {} }, blank: { CDL: 0, BS: 0 } }, d, {
        certs: { CDL: st.meta.certs[d.division + '|CDL'] || null, BS: st.meta.certs[d.division + '|BS'] || null },
        users: st.meta.userCounts ? st.meta.userCounts[d.division] || 0 : null }));
    }
    return divisions('CDL').map(d => Object.assign({ circle: d.circle, division: d.division, CDL: counts(people(d.division, 'CDL')), BS: counts(people(d.division, 'BS')),
      last: { CDL: d.last, BS: '' }, certs: { CDL: st.certified[ck(d.division, 'CDL')] || null, BS: st.certified[ck(d.division, 'BS')] || null }, users: null },
      dashX(people(d.division, null))));
  }
  /** People working by main duty: counted here in the demo, by the API when live. */
  function dutyCounts(cadre) {
    if (LIVE) return { duty: (st.meta && st.meta.duty[cadre]) || {}, blank: (st.meta && st.meta.blank[cadre]) || 0 };
    const duty = {}; let blank = 0;
    st.people.forEach(p => { if (p.cadre !== cadre || p.state === 'removed' || p.state === 'remove-pending') return; if (p.duty) duty[p.duty] = (duty[p.duty] || 0) + 1; else blank++; });
    return { duty, blank };
  }

  load();
  window.CDL_STORE = { LIVE, loadDivision, loadMeta, loadPending, loadLog, dutyCounts, dashData,
    isLoaded: div => !LIVE || !!st.loaded[div], loadedAt: div => st.loaded && st.loaded[div] || 0, get meta() { return LIVE ? st.meta : true; },
    get metaAt() { return LIVE ? st.metaAt : Date.now(); },
    get pendingLoaded() { return !LIVE || !!st.pendingRows; }, get logLoaded() { return !LIVE || !!st.logAt; }, api: API, get saving() { return waiting; },
    onError: fn => { hooks.error = fn; }, onBusy: fn => { hooks.busy = fn; }, BS_PAY, CADRES, DUTIES, PLACES, HQ, DIV_PLACES, RANGE_PLACES, MODES, show: fmt, original, changed, lastEdit, DISTRICTS, REASONS, LABEL, REQUIRED, REQUIRED_BS,
    get user() { return st.user; }, get log() { return st.log; }, get all() { return st.people; }, get pendingCount() { return LIVE ? (st.meta ? st.meta.pending : 0) : pending().length; },
    find, people, counts, divisions, status, missing, update, confirm, unconfirm, bulk, markNotWorking, undoRemoval, resolveFlag,
    addPerson, pending, decide, similar, canCertify, certify, reopen, locked, certifiedBy: (div, cadre) => st.certified[ck(div, cadre)] || null, signIn, signOut, reset };
})();
