// CDL+BS Verification and Update: screens. Data and rules are in store.js (CDL_STORE).
(function () {
  const S = window.CDL_STORE;
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app'), drawer = $('#drawer'), scrim = $('#scrim'), modal = $('#modal');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const STATUS = { missing: 'Missing info', ready: 'Ready to verify', problem: 'Problem', confirmed: 'Verified', remove: 'Removal pending', removed: 'Removed' };
  const SHORT = { 'Cleaning/Sweeping/Maintenance': 'Cleaning / Maint.', 'Forest Protection and Patrolling': 'Protection & Patrolling',
    'Human-Animal Conflict Management': 'Human-Animal Conflict', 'Night Guard/Security': 'Night Guard / Security' };
  const short = d => SHORT[d] || d;

  // view state for the division page
  // keep: people edited under the current filter stay in view until the filter changes
  // edit: the row being edited in the table { id, d: draft, newRange }
  // cadre: the tab in view (DL / CDL or Ban Sahayak); track: show what changed from the return (off unless switched on)
  const ui = { div: '', filter: 'all', range: '', q: '', edit: null, keep: new Set(), steps: true, cadre: 'CDL', track: false };
  try {
    ui.steps = localStorage.getItem('cdl-steps') !== 'off';
    ui.cadre = localStorage.getItem('cdl-cadre') === 'BS' ? 'BS' : 'CDL';
    ui.track = localStorage.getItem('cdl-track') === 'on';
  } catch (e) { /* keep defaults */ }
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* fine */ } };
  const isBS = () => ui.cadre === 'BS';
  const people = n => isBS() ? (n === 1 ? 'Ban Sahayak' : 'Ban Sahayaks') : (n === 1 ? 'person' : 'people');
  // DL / CDL | Ban Sahayak tabs; inScope picks the divisions counted (all, one circle, one division)
  function tabs(inScope) {
    const n = c => S.divisions(c).filter(inScope).reduce((a, d) => a + d.counts.active, 0);
    return `<div class="tabs" role="tablist">${[['CDL', 'DL / CDL'], ['BS', 'Ban Sahayaks']].map(([c, t]) =>
      `<button role="tab" aria-selected="${ui.cadre === c}" class="tab ${ui.cadre === c ? 'on' : ''}" data-act="cadre" data-v="${c}">${t}<span class="k">${n(c).toLocaleString('en-IN')}</span></button>`).join('')}</div>`;
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
  }
  const pill = (s, p) => `<span class="pill ${s}">${STATUS[s]}</span>${p && p.state === 'add-pending' ? ' <span class="pill added">New · awaiting approval</span>' : ''}`;
  function bar(c) {
    const t = c.active || 1, w = n => (n / t * 100).toFixed(1) + '%';
    return `<div class="bar"><i class="c" style="width:${w(c.confirmed)}"></i><i class="r" style="width:${w(c.ready)}"></i><i class="m" style="width:${w(c.missing)}"></i><i class="p" style="width:${w(c.problem)}"></i></div>`;
  }
  const legend = `<div class="legend"><span><i style="background:var(--good)"></i>Verified</span><span><i style="background:#9fd4a9"></i>Ready to verify</span><span><i style="background:var(--warn)"></i>Missing info</span><span><i style="background:var(--bad)"></i>Problem</span></div>`;

  /* ------------------------------------------------------------ header */
  function header() {
    const u = S.user, h = location.hash;
    $('#nav').innerHTML = u && u.role === 'admin' ? [
      ['#/', 'Dashboard', h === '#/' || h === ''], ['#/divisions', 'Divisions', h.startsWith('#/divisions') || h.startsWith('#/d/') || h.startsWith('#/c/')],
      ['#/approvals', 'Approvals' + (S.pendingCount ? `<span class="count">${S.pendingCount}</span>` : ''), h === '#/approvals'],
      ['#/users', 'Users', h === '#/users'], ['#/log', 'Changes', h === '#/log']].map(([href, t, on]) => `<a href="${href}" class="${on ? 'on' : ''}">${t}</a>`).join('') : '';
    $('#who').innerHTML = u ? `<button class="menu-btn" data-act="menu"><span class="av">${esc(u.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span><span class="hide-sm">${esc(u.name)}</span></button>` : '';
  }
  function menu() {
    const u = S.user, m = $('#who .menu');
    if (m) { m.remove(); return; }
    $('#who').insertAdjacentHTML('beforeend', `<div class="menu"><div class="who-line"><b>${esc(u.name)}</b>${u.role === 'admin' ? 'Admin' : u.division ? esc(u.division) : 'Division operator'}${S.LIVE ? '' : ' · demo'}</div>
      ${S.LIVE ? '' : '<button data-act="reset">Reset the demo</button>'}<button data-act="signout">Sign out</button></div>`);
  }

  /* ------------------------------------------------------------ login */
  function login() {
    if (S.LIVE) { authScreen(); return; }
    app.innerHTML = `<div class="login card">
      <h1>Sign in</h1><p class="muted">DL / CDL and Ban Sahayak details and duties, division by division.</p>
      <div class="banner info">This is the demo: the names are made up and changes stay in this browser. Choose how you want to see it.</div>
      <div class="role">
        <button class="btn primary block" data-act="as-op">Try as a division operator</button>
        <button class="btn block" data-act="as-admin">Try as an admin (Aranya Bhawan)</button>
      </div></div>`;
  }

  /* ------------------------------------------------------------ division picker */
  function divCard(d) {
    const k = d.counts;
    return `<a class="div-card" href="#/d/${enc(d.division)}"><h3>${esc(d.division)}</h3>
      ${!k.all && isBS() ? '<div class="muted">No Ban Sahayaks added yet</div><div class="bar"></div><div class="faint">Open to add them</div>' : `
      <div class="muted">${k.active} ${people(k.active)} · <b style="color:var(--ink)">${k.confirmed}</b> verified</div>${bar(k)}
      <div class="faint">${d.certified ? '✔ Certified by ' + esc(d.certified.name) + ' on ' + esc(d.certified.on.slice(0, 10)) : k.missing + ' missing info · ' + k.ready + ' ready · ' + k.problem + ' problem'}</div>`}</a>`;
  }
  const sum = ds => ds.reduce((a, d) => { Object.keys(d.counts).forEach(k => { a[k] = (a[k] || 0) + d.counts[k]; }); return a; }, {});
  function picker() {
    const ds = S.divisions(ui.cadre), byC = {}, t = sum(ds);
    ds.forEach(d => (byC[d.circle] = byC[d.circle] || []).push(d));
    const mine = S.user.division;
    app.innerHTML = `<div class="head"><div class="grow"><h1>${mine ? 'All divisions' : 'Choose your division'}</h1><p class="muted">${ds.length} divisions · ${(t.active || 0).toLocaleString('en-IN')} ${people(t.active)}.</p></div>${legend}</div>
      ${mine ? `<a class="mine-link card" href="#/d/${enc(mine)}">Your division: <b>${esc(mine)}</b> ›</a>` : ''}
      ${tabs(() => true)}` +
      Object.keys(byC).map(c => `<section class="circle"><h2><a href="#/c/${enc(c)}">${esc(c)} circle ›</a></h2><div class="divs">${byC[c].map(divCard).join('')}</div></section>`).join('');
  }
  function circlePage(c) {
    const ds = S.divisions(ui.cadre).filter(d => d.circle === c);
    if (!ds.length) { app.innerHTML = '<p>Circle not found. <a href="#/">Back</a></p>'; return; }
    const t = sum(ds);
    app.innerHTML = `<div class="crumbs"><a href="#/${S.user.role === 'admin' ? 'divisions' : ''}">All divisions</a> › ${esc(c)} circle</div>
      <div class="head"><div class="grow"><h1>${esc(c)} circle</h1><p class="muted">${ds.length} divisions</p></div>${legend}</div>
      ${tabs(d => d.circle === c)}
      <div class="kpis">
        <div class="kpi"><div class="v num">${(t.active || 0).toLocaleString('en-IN')}</div><div class="l">${isBS() ? 'Ban Sahayaks' : 'People working'}</div></div>
        <div class="kpi"><div class="v num" style="color:var(--good-ink)">${t.confirmed || 0}</div><div class="l">Verified</div></div>
        <div class="kpi"><div class="v num" style="color:var(--warn-ink)">${t.missing || 0}</div><div class="l">Missing info</div></div>
        <div class="kpi"><div class="v num" style="color:var(--bad-ink)">${t.problem || 0}</div><div class="l">Problems</div></div>
        <div class="kpi"><div class="v num">${ds.filter(d => d.certified).length} / ${ds.length}</div><div class="l">Divisions certified</div></div></div>
      ${t.active ? `<div class="card" style="margin-bottom:18px">${bar(t)}</div>` : ''}
      <div class="divs">${ds.map(divCard).join('')}</div>`;
  }

  /* ------------------------------------------------------------ division page */
  function visible() {
    const q = ui.q.trim().toLowerCase();
    return S.people(ui.div, ui.cadre).filter(p => {
      const s = S.status(p);
      if (ui.keep.has(p.id)) return true;
      if (ui.filter === 'added' ? p.state !== 'add-pending' : ui.filter === 'changed' ? !S.changed(p).length : ui.filter !== 'all' && s !== ui.filter) return false;
      if (ui.range && p.range !== ui.range) return false;
      if (q && !(p.name.toLowerCase().includes(q) || (p.beat || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function division(div) {
    if (ui.div !== div) Object.assign(ui, { div, filter: 'all', range: '', q: '', edit: null, keep: new Set() });
    const info = S.divisions().find(d => d.division === div);
    if (!info) { app.innerHTML = '<p>Division not found. <a href="#/">Back</a></p>'; return; }
    const all = S.people(div, ui.cadre), bs = isBS();
    const c = S.counts(all), cert = S.certifiedBy(div, ui.cadre), mine = canEdit(div), lock = !!cert || !mine;
    const addBtn = lock ? '' : `<button class="btn soft" data-act="add">${bs ? '+ Add a Ban Sahayak' : '+ Add a person not in the list'}</button>`;
    const rc = S.counts(ui.range ? all.filter(p => p.range === ui.range) : all);
    const ranges = [...new Set(all.map(p => p.range).filter(Boolean))].sort();
    const list = visible();
    const readyHere = list.filter(p => S.status(p) === 'ready');
    const chips = [['all', 'All'], ['missing', 'Missing info'], ['ready', 'Ready to verify'], ['problem', 'Problem'], ['confirmed', 'Verified'], ['remove', 'Removal pending'], ['added', 'New'], ['changed', 'Changed']]
      .filter(([k]) => k === 'all' || (k === 'changed' ? ui.track && rc[k] : rc[k]) || ui.filter === k)
      .map(([k, t]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${t}<span class="k">${rc[k === 'all' ? 'all' : k]}</span></button>`).join('');

    app.innerHTML = `
      <div class="crumbs"><a href="#/${S.user.role === 'admin' ? 'divisions' : ''}">All divisions</a> › <a href="#/c/${enc(info.circle)}">${esc(info.circle)} circle</a></div>
      <div class="head"><div class="grow"><h1>${esc(div)}</h1><p class="muted">${c.active} ${bs ? people(c.active) : 'people working'} · ${ranges.length} ranges</p></div>
        <div class="prog card"><div class="row" style="justify-content:space-between"><div><span class="big num">${c.confirmed}</span> <span class="muted">of ${c.active} verified</span></div>
          ${lock ? '' : `<button class="btn sm ${S.canCertify(div, ui.cadre) ? 'good' : ''}" data-act="certify" ${S.canCertify(div, ui.cadre) ? '' : 'disabled title="Verify everyone first"'}>Certify list</button>`}</div>${bar(c)}${legend}</div></div>
      ${tabs(d => d.division === div)}
      ${mine ? '' : `<div class="banner info" style="margin-bottom:14px">You are looking at ${esc(div)}. You can change only <a href="#/d/${enc(S.user.division)}">${esc(S.user.division)}</a>, your own division.</div>`}
      ${cert ? `<div class="cert" style="margin-bottom:14px">✔ Certified by ${esc(cert.name)}, ${esc(cert.desig)} on ${esc(cert.on)}. The list is locked.
          <div class="row" style="margin-top:8px"><button class="btn sm" data-act="print">Print certified list</button>${S.user.role === 'admin' ? '<button class="btn sm ghost" data-act="reopen">Reopen for changes</button>' : ''}</div></div>` : ''}
      ${ui.steps && !lock ? `<div class="steps">
        ${bs ? '<div class="step"><b><span class="n">1</span>Add your Ban Sahayaks</b>“+ Add a Ban Sahayak”. “Add &amp; next” keeps the form open for the next one.</div>'
          : '<div class="step"><b><span class="n">1</span>Pick a range</b>Work one range at a time.</div>'}
        <div class="step"><b><span class="n">2</span>Fill what is orange</b>Press Edit on a row, fill it in the table, then Save.</div>
        <div class="step"><b><span class="n">3</span>Verify</b>Press Verify on the row. It works once everything is filled.</div>
        <div class="step"><b><span class="n">4</span>Certify</b>When everyone is verified, the DFO certifies the division. <a href="#" data-act="hide-steps">Hide tips</a></div></div>` : ''}
      <div class="tools">
        <select data-act="range" aria-label="Range"><option value="">All ranges (${c.all})</option>${ranges.map(r => `<option ${r === ui.range ? 'selected' : ''} value="${esc(r)}">${esc(r)} (${all.filter(p => p.range === r).length})</option>`).join('')}</select>
        <input type="search" data-act="q" placeholder="Search name or beat" value="${esc(ui.q)}">
        ${bs ? '' : `<label class="switch"><input type="checkbox" data-act="track" ${ui.track ? 'checked' : ''}><span class="sl"></span>Track changes</label>`}
        <span class="sp"></span>
        ${addBtn}
      </div>
      <div class="chips">${chips}${ui.track && !bs ? `<span class="chg-key"><i></i>${rc.changed ? 'Changed from the return — point at it to see the old value' : 'Nothing changed from the return yet'}</span>` : ''}</div>
      <div class="tbl-wrap"><table class="people"><thead><tr>
        <th>Name</th>${lock ? '' : '<th class="acts-col"></th>'}${bs ? '' : '<th>Mode</th>'}<th>Engaged</th><th>District</th><th>Range / Beat</th><th>Place of work</th><th>Main duty</th><th>Other duties</th><th style="text-align:right">Pay (Rs)</th><th>Remarks</th></tr></thead>
        <tbody>${list.length ? list.map(p => rowHtml(p, lock)).join('') : `<tr><td colspan="12" class="empty-row">${bs && !all.length ? 'No Ban Sahayaks added yet. Press “+ Add a Ban Sahayak”.' : 'No one here with this filter.'}</td></tr>`}</tbody></table></div>
      <div class="below"><div class="row">${addBtn}<span class="faint">${list.length} shown. Click a name to open all the details.</span></div>
        ${!lock && readyHere.length ? `<button class="btn good" data-act="confirm-ready">Verify all ${readyHere.length} ready${ui.range ? ' in ' + esc(ui.range) : ''}</button>` : ''}</div>
      `;
  }
  // Range picker: the division's ranges, or type a new one
  function rangeCtl(attr, ranges, val, isNew, dis = '') {
    return isNew || (val && !ranges.includes(val))
      ? `<input type="text" ${attr} value="${esc(val)}" placeholder="Name of the new range" ${dis}>`
      : `<select ${attr} ${dis}><option value="">— Choose —</option>${ranges.map(r => `<option ${r === val ? 'selected' : ''}>${esc(r)}</option>`).join('')}<option value="__new">+ New range…</option></select>`;
  }
  const ICON = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    cancel: '<path d="M6 6l12 12M18 6L6 18"/>' };
  // icon button; the label shows on hover
  const ibtn = (icon, tip, attrs, cls = '') => `<button type="button" class="ib ${cls}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" ${attrs}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg></button>`;
  const DATE_OK = /^(\d{2}-\d{2}-\d{4}|\d{4})$/;
  const canVerify = (p, d) => !p.flag && !S.missing(d).length && !(d._dateRaw && !DATE_OK.test(d._dateRaw));

  function rowHtml(p, lock) {
    const ed = ui.edit && ui.edit.id === p.id ? ui.edit : null;
    if (ed) return rowEditHtml(p, ed);
    const s = S.status(p), m = S.missing(p), fill = f => m.includes(f) ? '<span class="fill">Fill</span>' : '';
    const gone = s === 'remove', id = esc(p.id);
    const date = p.date ? esc(p.date) + (/^\d{4}$/.test(p.date) ? ' <span class="sub">(year)</span>' : '') : fill('date');
    const vOk = s === 'ready';
    const acts = lock ? '' : `<td class="acts-col">${gone ? '' : `<div class="racts">
        ${ibtn('edit', 'Edit', `data-act="r-edit" data-id="${id}"`)}
        ${p.ver ? ibtn('tick', 'Verified', 'disabled', 'on') : ibtn('tick', vOk ? 'Verify' : p.flag ? 'Verify — resolve the problem first' : 'Verify — fill everything first', `data-act="r-verify" data-id="${id}" ${vOk ? '' : 'disabled'}`, 'verify')}</div>`}</td>`;
    // a cell whose fields differ from the return is marked; pointing at it shows the old value and who changed it
    const chg = ui.track ? S.changed(p) : [], o = S.original(p.id), bs = p.cadre === 'BS';
    const td = (fs, inner, cls = '', st = '') => {
      const f = fs.filter(x => chg.includes(x)), e = f.length && S.lastEdit(p.id, f[0]);
      const tip = f.map(x => `${S.LABEL[x]} was: ${S.show(x, o[x]) || '(blank)'}`).join('\n') + (e ? `\nChanged by ${e.by} on ${e.on}` : '');
      return `<td class="${cls}${f.length ? ' chg' : ''}"${f.length ? ` title="${esc(tip)}"` : ''}${st ? ` style="${st}"` : ''}>${inner}</td>`;
    };
    return `<tr data-id="${id}" class="${gone ? 'gone' : ''}">
      ${td(['name'], `<button class="nm linkish" data-act="open" data-id="${id}">${esc(p.name)}</button>${pill(s, p)}`)}${acts}
      ${bs ? '' : td(['mode', 'agency'], `${p.mode ? esc(p.mode) : fill('mode')}${p.agency ? `<div class="sub">${esc(p.agency)}</div>` : ''}`)}${td(['date'], date, 'num')}${td(['district'], p.district ? esc(p.district) : fill('district'))}
      ${td(['range', 'beat'], `${p.range ? esc(p.range) : fill('range')}<div class="sub">${esc(p.beat)}</div>`)}
      ${td(['place', 'placeName'], `${p.place ? esc(p.place) : fill('place')}${p.placeName ? `<div class="sub">${esc(p.placeName)}</div>` : ''}`)}
      ${td(['duty', 'details'], `${p.duty ? esc(short(p.duty)) : fill('duty')}${p.duty === 'Others' ? (m.includes('details') ? '<div class="sub" style="color:var(--warn-ink)">Write the duty details</div>' : `<div class="sub">${esc(p.details)}</div>`) : ''}`)}
      ${td(['other'], (p.other || []).map(x => `<span class="tag">${esc(short(x))}</span>`).join(''))}
      ${td(['pay'], p.pay != null ? Number(p.pay).toLocaleString('en-IN') : fill('pay'), 'num', 'text-align:right')}
      ${td(['remarks'], p.remarks ? `<div class="rmk">${esc(p.remarks)}</div>` : '')}</tr>`;
  }
  // The row in edit mode: every field right in the table
  function rowEditHtml(p, ed) {
    const d = ed.d, m = S.missing(d), id = esc(p.id), mc = f => m.includes(f) ? 'miss' : '';
    const all = S.people(ui.div, null);
    const ranges = [...new Set(all.map(x => x.range).filter(r => r && r !== S.HQ))].sort();
    const beats = [...new Set(all.filter(x => x.range === d.range).map(x => x.beat).filter(Boolean))].sort();
    const at = atOf(d, ed);
    const sel = (f, opts, ph = '— Choose —') => `<select data-r="${f}" class="${mc(f)}"><option value="">${ph}</option>${opts.map(o => `<option ${o === d[f] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const inp = (f, ph, extra = '') => `<input type="text" data-r="${f}" value="${esc(d[f])}" placeholder="${ph}" class="${mc(f)}" ${extra}>`;
    return `<tr data-id="${id}" class="editing">
      <td><button class="nm linkish" data-act="open" data-id="${id}" disabled>${esc(p.name)}</button>${pill(S.status(p), p)}</td>
      <td class="acts-col"><div class="racts">
        ${ibtn('cancel', 'Cancel', 'data-act="r-cancel"')}
        ${ibtn('save', 'Save', `data-act="r-save" data-id="${id}"`, 'save')}
        ${ibtn('tick', 'Save and verify', `data-act="r-verify" data-id="${id}" ${canVerify(p, d) ? '' : 'disabled'}`, 'verify')}</div></td>
      ${p.cadre === 'BS' ? '' : `<td>${sel('mode', S.MODES)}${d.mode === 'Through agency' ? inp('agency', 'Agency name') : ''}</td>`}
      <td><input type="text" data-r="date" value="${esc(d._dateRaw != null ? d._dateRaw : d.date)}" placeholder="dd-mm-yyyy or yyyy" class="${mc('date')}" size="11"></td>
      <td>${sel('district', S.DISTRICTS)}</td>
      <td><select data-r="at" class="${mc('range')}"><option value="">— Posted at —</option>${['Division HQ', 'Range'].map(o => `<option ${o === at ? 'selected' : ''}>${o}</option>`).join('')}</select>
        ${at === 'Range' ? `${rangeCtl(`data-r="range" class="${mc('range')}"`, ranges, d.range, ed.newRange)}${inp('beat', 'Beat (if any)', 'list="dl-rbeat"')}<datalist id="dl-rbeat">${beats.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}</td>
      <td>${sel('place', placesOf(d.range, at))}${d.place && d.place !== 'Beat' ? inp('placeName', 'Name of the place') : ''}</td>
      <td>${sel('duty', S.DUTIES, '— Main duty —')}${d.duty === 'Others' ? inp('details', 'Write the actual work') : ''}</td>
      <td>${(d.other || []).map(o => `<span class="tag">${esc(short(o))}</span>`).join('')}<div class="sub">Change in the full details</div></td>
      <td class="num" style="text-align:right">${p.cadre === 'BS' ? S.BS_PAY.toLocaleString('en-IN') + '<div class="sub">fixed</div>' : `<input type="number" data-r="pay" value="${d.pay == null ? '' : esc(d.pay)}" class="${mc('pay')}" min="0" style="width:90px;text-align:right">`}</td>
      <td><input type="text" data-r="remarks" class="optional" value="${esc(d.remarks)}" placeholder="${REMARK_HINT}" title="Optional" style="min-width:220px"></td></tr>`;
  }
  // Posted at: Division HQ is kept as the range value; "Range" waits for a range to be picked
  const atOf = (d, h) => d.range === S.HQ ? 'Division HQ' : d.range || h.at === 'Range' ? 'Range' : '';
  const placesOf = (range, at) => range === S.HQ ? S.DIV_PLACES : at === 'Range' ? S.RANGE_PLACES : S.PLACES;
  function setAt(d, h, v) {
    if (v === 'Division HQ') { d.range = S.HQ; d.beat = ''; h.at = ''; }
    else { if (d.range === S.HQ) d.range = ''; h.at = v; }
    if (d.place && !placesOf(d.range, atOf(d, h)).includes(d.place)) d.place = '';
  }
  function readRow(t) {
    const d = ui.edit.d, f = t.dataset.r, v = t.value;
    if (f === 'at') setAt(d, ui.edit, v);
    else if (f === 'date') { const x = v.trim(); d._dateRaw = x; d.date = DATE_OK.test(x) ? x : ''; }
    else if (f === 'pay') d.pay = v === '' ? null : Number(v);
    else if (f === 'duty') { d.duty = v; d.other = (d.other || []).filter(o => o !== v); }
    else d[f] = v;
  }
  function rowVerifyState() {
    const b = $('tr.editing [data-act=r-verify]'); if (b) b.disabled = !canVerify(S.find(ui.edit.id), ui.edit.d);
  }
  const FIELDS = ['name', 'mode', 'agency', 'date', 'district', 'range', 'beat', 'place', 'placeName', 'duty', 'other', 'details', 'pay', 'remarks'];
  const REMARK_HINT = 'Add if you want to add anything here, otherwise leave it blank';
  function saveRow(thenVerify) {
    const ed = ui.edit, d = ed.d, id = ed.id;
    if (d._dateRaw && !DATE_OK.test(d._dateRaw)) { toast('Engaged date: write it as dd-mm-yyyy, or just the year'); return; }
    const ch = {}; FIELDS.forEach(f => { ch[f] = d[f]; });
    if (d.cadre === 'BS') Object.assign(ch, { mode: 'Direct', pay: S.BS_PAY });
    if (ch.mode !== 'Through agency') ch.agency = '';
    if (ch.place === 'Beat' || !ch.place) ch.placeName = '';
    if (ch.range) ch.range = ch.range.trim();
    const n = S.update(id, ch); ui.edit = null; ui.keep.add(id);
    if (thenVerify) { verifyOne(id); return; }
    render(); toast(n ? 'Saved' : 'No changes');
    if (S.status(S.find(id)) === 'ready') askVerify(id);
  }
  function verifyOne(id) {
    ui.keep.add(id); const r = S.confirm([id]);
    toast(r.done ? 'Verified' : 'Saved. Fill everything to verify'); render();
  }
  function askVerify(id) {
    const p = S.find(id);
    openModal(`<h2>Verify ${esc(p.name)}?</h2><p class="muted">All the details are filled. Verify them now if they are correct.</p>
      <div class="acts"><button class="btn" data-act="mclose">Not now</button><button class="btn good" data-act="av-yes" data-id="${esc(id)}">Verify</button></div>`);
  }

  /* ------------------------------------------------------------ person drawer */
  let dr = null;   // { id | null (new), draft, list: ids for prev/next }
  function openPerson(id, list) {
    const p = S.find(id); if (!p) return;
    dr = { id, draft: JSON.parse(JSON.stringify(p)), list: list || visible().map(x => x.id) };
    drawRender(); drawer.classList.add('on'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
  }
  function openNew() {
    const info = S.divisions().find(x => x.division === ui.div), near = S.people(ui.div, null).find(x => x.district) || {};
    dr = { id: null, list: [], draft: { cadre: ui.cadre, name: '', circle: info.circle, division: ui.div, mode: isBS() ? 'Direct' : '', agency: '', date: '', district: near.district || '',
      range: ui.range || '', beat: '', place: '', placeName: '', duty: '', other: [], details: '', pay: isBS() ? S.BS_PAY : null, remarks: '' } };
    drawRender(); drawer.classList.add('on'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const n = $('[data-f=name]', drawer); n && n.focus(); }, 260);
  }
  function closeDrawer() { dr = null; drawer.classList.remove('on'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); }

  function drawRender() {
    const d = dr.draft, p = dr.id ? S.find(dr.id) : null, s = p ? S.status(Object.assign({}, p, d, { ver: p.ver })) : 'missing';
    const bs = d.cadre === 'BS', certified = S.locked(d.division, d.cadre);
    const lock = certified || (p && p.state === 'remove-pending') || !canEdit(d.division);
    const m = S.missing(d), miss = f => m.includes(f) ? 'miss' : '';
    const req = f => (bs ? S.REQUIRED_BS : S.REQUIRED).includes(f) ? ' <span class="req">*</span>' : '';
    const dis = lock ? 'disabled' : '';
    const i = dr.list.indexOf(dr.id);
    const yearOnly = /^\d{4}$/.test(d.date || '');
    const isoDate = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.date || '');
    const ranges = [...new Set(S.people(d.division, null).map(x => x.range).filter(r => r && r !== S.HQ))].sort();
    const at = atOf(d, dr), o = p && S.original(p.id), chg = p && ui.track ? S.changed(Object.assign({}, p, d)) : [];
    const was = f => chg.includes(f) ? `<div class="was">Was: ${esc(S.show(f, o[f]) || '(blank)')}</div>` : '';
    const beats = [...new Set(S.people(d.division, null).filter(x => x.range === d.range).map(x => x.beat).filter(Boolean))].sort();
    const sim = !p ? S.similar(d.division, d.name, d.cadre) : [];
    const field = (f, inner, extra = '') => `<div class="field ${miss(f)}"><label>${S.LABEL[f]}${req(f)}</label>${inner}${extra}${was(f)}</div>`;
    const text = (f, list) => `<input type="text" data-f="${f}" value="${esc(d[f])}" ${dis} ${list ? `list="dl-${f}"` : ''}>${list ? `<datalist id="dl-${f}">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    const sel = (f, opts) => `<select data-f="${f}" ${dis}><option value="">— Choose —</option>${opts.map(o => `<option ${o === d[f] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

    drawer.innerHTML = `
      <div class="dr-head"><div style="flex:1;min-width:0"><h2>${p ? esc(p.name) : bs ? 'Add a Ban Sahayak' : 'Add a person'}</h2>
        <div class="row" style="gap:6px;margin-top:3px">${bs ? '<span class="pill bs">Ban Sahayak</span>' : ''}${p ? pill(s, p) : bs ? '' : '<span class="pill added">New person</span>'}${p && p.updOn ? `<span class="faint">Last change ${esc(p.updOn)} by ${esc(p.updBy)}</span>` : ''}</div></div>
        ${p ? `<button class="btn sm ghost" data-act="prev" ${i <= 0 ? 'disabled' : ''} aria-label="Previous">‹</button><button class="btn sm ghost" data-act="next" ${i < 0 || i >= dr.list.length - 1 ? 'disabled' : ''} aria-label="Next">›</button>` : ''}
        <button class="btn sm ghost" data-act="close" aria-label="Close">✕</button></div>
      <div class="dr-body">
        ${p && p.flag ? `<div class="banner bad"><b>Problem:</b> ${esc(p.flag)}<div class="row"><button class="btn sm" data-act="flag-keep">They are different people</button><button class="btn sm danger" data-act="flag-dup">This one is the duplicate — remove</button></div></div>` : ''}
        ${p && p.state === 'remove-pending' ? `<div class="banner warn"><b>Marked as not working:</b> ${esc(p.removal.reason)}${p.removal.remark ? ' — ' + esc(p.removal.remark) : ''}. Waiting for admin approval.
          ${certified ? '' : '<div class="row"><button class="btn sm" data-act="undo-remove">Undo — still working</button></div>'}</div>` : ''}
        ${p && p.state === 'add-pending' ? '<div class="banner info">Added by the division. The admin approves new people before they count.</div>' : ''}
        ${certified ? '<div class="banner good">This list is certified. Details are locked.</div>' : ''}
        ${m.length && !lock ? `<div class="banner warn">Still to fill: ${m.map(f => S.LABEL[f]).join(', ')}.</div>` : ''}

        <div class="sec"><h3>Person</h3>
          ${field('name', text('name'), sim.length ? `<div class="sim banner warn">Already in this division? ${sim.slice(0, 4).map(x => `<b>${esc(x.name)}</b> (${esc(x.range)}${x.beat ? ', ' + esc(x.beat) : ''}, ${esc(x.date || 'date not known')})`).join('; ')}</div>` : '')}
          ${bs ? '' : `<div class="field ${miss('mode')}"><span class="lab">${S.LABEL.mode}${req('mode')}</span><div class="seg">${S.MODES.map(o => `<button type="button" data-set="mode" data-v="${o}" class="${d.mode === o ? 'on' : ''}" ${dis}>${o}</button>`).join('')}</div>${was('mode')}</div>
          ${d.mode === 'Through agency' ? field('agency', text('agency')) : ''}`}
          <div class="field ${miss('date')}"><label>${S.LABEL.date}${req('date')}</label>
            ${yearOnly ? `<input type="number" data-f="year" min="1970" max="2026" value="${esc(d.date)}" placeholder="Year, e.g. 2009" ${dis}>` : `<input type="date" data-f="isodate" max="2026-12-31" value="${isoDate ? `${isoDate[3]}-${isoDate[2]}-${isoDate[1]}` : ''}" ${dis}>`}
            <label class="check"><input type="checkbox" data-act="yearonly" ${yearOnly ? 'checked' : ''} ${dis}> Only the year is known</label></div>
        </div>

        <div class="sec"><h3>Place of work</h3>
          ${field('district', sel('district', S.DISTRICTS))}
          <div class="field ${miss('range')}"><span class="lab">Posted at${req('range')}</span><div class="seg">${['Division HQ', 'Range'].map(x => `<button type="button" data-act="at" data-v="${x}" class="${at === x ? 'on' : ''}" ${dis}>${x}</button>`).join('')}</div>${at !== 'Range' ? was('range') : ''}</div>
          ${at === 'Range' ? `<div class="two">${field('range', rangeCtl('data-f="range"', ranges, d.range, dr.newRange, dis))}${field('beat', text('beat', beats))}</div>` : ''}
          ${at ? `<div class="two">${field('place', sel('place', placesOf(d.range, at)))}${d.place && d.place !== 'Beat' ? field('placeName', text('placeName')) : ''}</div>` : ''}
        </div>

        <div class="sec duty-sec"><h3>Nature of duty</h3>
          <div class="field ${miss('duty')}"><span class="lab">${S.LABEL.duty}${req('duty')} <span class="faint">— the work they do most</span></span>
            ${d.duty && !dr.openDuty ? `<div class="picked"><span class="chosen">✓ ${esc(d.duty)}</span>${lock ? '' : '<button type="button" class="linkbtn" data-act="duty-open">Change</button>'}</div>`
              : `<div class="tiles">${S.DUTIES.map(o => `<button type="button" class="tile ${d.duty === o ? 'on' : ''}" data-set="duty" data-v="${esc(o)}" ${dis}>${esc(o)}</button>`).join('')}</div>`}</div>
          ${d.duty ? `<div class="field"><span class="lab">${S.LABEL.other} <span class="faint">— only if they also do other work</span></span>
            <div class="toggles">${(d.other || []).map(o => `<span class="tog on">${esc(o)}${lock ? '' : ` <button type="button" class="x" data-tog="${esc(o)}" aria-label="Remove ${esc(o)}">×</button>`}</span>`).join('')}
              ${lock || dr.openOther ? '' : `<button type="button" class="tog add" data-act="other-open">+ Add${(d.other || []).length ? ' more' : ''}</button>`}</div>
            ${dr.openOther && !lock ? `<div class="other-pick"><div class="toggles">${S.DUTIES.filter(o => o !== d.duty && !(d.other || []).includes(o)).map(o => `<button type="button" class="tog" data-tog="${esc(o)}">+ ${esc(o)}</button>`).join('')}</div>
              <button type="button" class="linkbtn" data-act="other-done">Done</button></div>` : ''}</div>` : ''}
          ${d.duty === 'Others' || d.details ? field('details', `<textarea data-f="details" ${dis} placeholder="${d.duty === 'Others' ? 'Write the actual work, e.g. Mahut of elephant Champa; office peon in DFO office' : 'Optional'}">${esc(d.details)}</textarea>`,
            d.duty === 'Others' ? '<div class="err">Required for “Others”. Words like “various”, “misc” or “do” are not accepted.</div>' : '') : ''}
        </div>

        <div class="sec"><h3>Pay</h3>${bs ? `<div class="fixed-pay">Rs ${S.BS_PAY.toLocaleString('en-IN')} a month <span class="faint">— fixed for Ban Sahayaks</span></div>` : field('pay', `<input type="number" data-f="pay" min="0" step="1" value="${d.pay == null ? '' : esc(d.pay)}" ${dis} placeholder="e.g. 8580">`)}</div>

        <div class="sec"><h3>Remarks</h3>
          <div class="field"><label>Remarks <span class="opt">optional</span></label>
            <textarea data-f="remarks" class="optional" rows="2" placeholder="${REMARK_HINT}" ${dis}>${esc(d.remarks)}</textarea>${was('remarks')}</div></div>
      </div>
      <div class="dr-foot">
        ${lock ? '<button class="btn" data-act="close">Close</button>' : p ? `
          ${p.state === 'active' || p.state === 'add-pending' ? '<button class="btn danger sm" data-act="not-working">Mark as not working</button>' : ''}
          <span class="sp"></span>
          ${p.ver ? '<button class="btn ghost" data-act="unconfirm">Undo verify</button>' : ''}
          <button class="btn" data-act="save">Save</button>
          ${p.ver ? '' : `<button class="btn good" data-act="save-confirm" ${m.length || p.flag ? `disabled title="${p.flag ? 'Resolve the problem first' : 'Fill the orange fields first'}"` : ''}>Save &amp; verify ›</button>`}`
        : `<span class="sp"></span><button class="btn" data-act="close">Cancel</button>${bs ? `<button class="btn" data-act="add-save" data-v="next" ${d.name.trim().length < 3 ? 'disabled' : ''}>Add &amp; next</button>` : ''}<button class="btn primary" data-act="add-save" ${d.name.trim().length < 3 ? 'disabled' : ''}>${bs ? 'Add' : 'Add person'}</button>`}
      </div>`;
  }
  // keeps "Save & verify" in step while typing, without redrawing the panel
  function drawFootState() {
    const b = $('[data-act=save-confirm]', drawer), p = dr.id && S.find(dr.id); if (b && p) b.disabled = !!(S.missing(dr.draft).length || p.flag);
  }
  function drawRerender() { const b = $('.dr-body', drawer), y = b ? b.scrollTop : 0; drawRender(); const nb = $('.dr-body', drawer); if (nb) nb.scrollTop = y; }
  function changes() {
    const p = S.find(dr.id), d = dr.draft, ch = {};
    FIELDS.forEach(f => { ch[f] = d[f]; });
    if (p.cadre === 'BS') Object.assign(ch, { mode: 'Direct', pay: S.BS_PAY });
    if (ch.mode !== 'Through agency') ch.agency = p.agency && ch.mode === p.mode ? p.agency : '';
    if (ch.place === 'Beat' || !ch.place) ch.placeName = '';
    return ch;
  }
  function saveDrawer(andConfirm) {
    ui.keep.add(dr.id);
    const n = S.update(dr.id, changes());
    let msg = n ? 'Saved' : 'No changes';
    if (andConfirm && !S.find(dr.id).ver) { const r = S.confirm([dr.id]); msg = r.done ? 'Verified' : 'Saved — fill the missing fields to verify'; }
    toast(msg);
    if (andConfirm) {   // jump to the next person in this view who is not verified yet
      const i = dr.list.indexOf(dr.id), next = dr.list.slice(i + 1).find(id => { const x = S.find(id); return x && !x.ver && x.state !== 'remove-pending'; });
      render(); next ? openPerson(next, dr.list) : closeDrawer();
    } else { render(); openPerson(dr.id, dr.list); if (S.status(S.find(dr.id)) === 'ready') askVerify(dr.id); }
  }

  /* ------------------------------------------------------------ modals */
  function openModal(html) { modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; modal.classList.add('on'); }
  function closeModal() { modal.classList.remove('on'); modal.innerHTML = ''; }
  function help() {
    openModal(`<h2>How it works</h2><p class="muted">Each division checks its DLs / CDLs and enters its Ban Sahayaks. The DL / CDL list is already filled from the July 2026 returns; Ban Sahayaks are added by the division (pay is fixed at Rs 12,000).</p>
      <ol><li><b>Pick your division, then a range.</b></li>
      <li><b>Orange means missing.</b> Press <b>Edit</b> on the row, fill it right in the table, then <b>Save</b>. Click a name to see all the details.</li>
      <li><b>Verify.</b> Press <b>Verify</b> on the row. It works only when everything is filled. A range not in the list can be added with “+ New range”.</li>
      <li><b>Someone no longer working?</b> Open them and “Mark as not working”; the admin approves it. <b>A DL / CDL missing?</b> “Add a person”; the admin approves it too. Ban Sahayaks you add count straight away.</li>
      <li><b>Track changes</b> (DL / CDL tab) colours every cell changed from the return.</li>
      <li><b>Problem</b> (red) means a possible double entry. Say whether they are different people.</li>
      <li><b>Certify.</b> When everyone is verified, the DFO certifies the division and the list is locked.</li></ol>
      <div class="acts"><button class="btn primary" data-act="mclose">OK</button></div>`);
  }
  function notWorking() {
    openModal(`<h2>Mark as not working</h2><p class="muted">${esc(dr.draft.name)} will be taken off the list once the admin approves.</p>
      <div class="field"><label>Reason <span class="req">*</span></label><select id="nwReason"><option value="">— Choose —</option>${S.REASONS.map(r => `<option>${r}</option>`).join('')}</select></div>
      <div class="field"><label>Remark</label><input type="text" id="nwRemark" placeholder="e.g. left in June 2026"></div>
      <div class="acts"><button class="btn" data-act="mclose">Cancel</button><button class="btn danger" data-act="nw-ok">Mark as not working</button></div>`);
  }
  function certifyModal() {
    const c = S.counts(S.people(ui.div, ui.cadre));
    openModal(`<h2>Certify ${esc(ui.div)} — ${isBS() ? 'Ban Sahayaks' : 'DLs / CDLs'}</h2><p class="muted">${c.confirmed} ${people(c.confirmed)} verified. After this the list is locked; only the admin can reopen it.</p>
      <div class="field"><label>Name of the DFO <span class="req">*</span></label><input type="text" id="cName"></div>
      <div class="field"><label>Designation <span class="req">*</span></label><input type="text" id="cDesig" value="DFO, ${esc(ui.div)}"></div>
      <label class="check"><input type="checkbox" id="cOk"> I certify that the details of the ${isBS() ? 'Ban Sahayaks' : 'DLs / CDLs'} of this division are correct.</label>
      <div class="acts"><button class="btn" data-act="mclose">Cancel</button><button class="btn good" data-act="cert-ok">Certify</button></div>`);
  }
  function printList() {
    const what = isBS() ? 'Ban Sahayaks' : 'DLs / CDLs';
    const cert = S.certifiedBy(ui.div, ui.cadre), list = S.people(ui.div, ui.cadre).filter(p => p.state !== 'remove-pending').sort((a, b) => (a.range + a.name).localeCompare(b.range + b.name));
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(ui.div)} — ${what}</title><style>body{font:12px Arial,sans-serif;margin:24px}h1{font-size:17px;margin:0}
      table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}.sig{margin-top:40px;text-align:right}</style></head><body>
      <h1>${what} of ${esc(ui.div)} division (${esc(list[0] ? list[0].circle : '')} circle)</h1><div>Directorate of Forests, West Bengal · ${list.length} people</div>
      <table><tr><th>#</th><th>Name</th><th>Mode</th><th>Engaged</th><th>District</th><th>Range</th><th>Beat</th><th>Place of work</th><th>Main duty</th><th>Other duties</th><th>Pay (Rs)</th><th>Remarks</th></tr>
      ${list.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.mode)}</td><td>${esc(p.date)}</td><td>${esc(p.district)}</td><td>${esc(p.range)}</td><td>${esc(p.beat)}</td><td>${esc(p.place)}${p.placeName ? ' (' + esc(p.placeName) + ')' : ''}</td><td>${esc(p.duty)}${p.details ? ': ' + esc(p.details) : ''}</td><td>${esc((p.other || []).join(', '))}</td><td>${p.pay != null ? p.pay : ''}</td><td>${esc(p.remarks)}</td></tr>`).join('')}</table>
      <div class="sig">Certified on ${esc(cert ? cert.on : '')}<br><br><b>${esc(cert ? cert.name : '')}</b><br>${esc(cert ? cert.desig : '')}</div><script>print()<\/script></body></html>`);
    w.document.close();
  }

  /* ------------------------------------------------------------ loading animation (as in UPMC): a tree that draws itself, a moving bar, rotating messages and tips */
  const TREE = `<svg class="tree" viewBox="0 0 64 64" aria-hidden="true">
    <path class="canopy" d="M32 7c-8 0-14 6-14 13.5 0 1.6.3 3 .8 4.4C14.2 27 11 31.3 11 36.5 11 43.4 16.8 49 24 49h16c7.2 0 13-5.6 13-12.5 0-5.2-3.2-9.5-7.8-11.6.5-1.4.8-2.8.8-4.4C46 13 40 7 32 7Z"/>
    <path class="trunk" d="M32 57V30M32 42l-7-6M32 37l6-5"/>
    <path class="ground" d="M17 57h30"/></svg>`;
  const TIPS = [
    'Tip: press ✏️ on a row to edit it right in the table, then 💾 to save.',
    'Tip: ✓ verifies a person. It works once everything is filled.',
    'Tip: “Missing info” shows only the people who still need something filled.',
    'Tip: Ban Sahayaks you add count straight away; their pay is fixed at Rs 12,000.',
    'Tip: “Posted at” comes first: Division HQ or a range. The places of work follow from it.',
    'Tip: when everyone is verified, the DFO certifies the list and it is locked.',
  ];
  const STEPS = {
    circles: ['Opening the divisions…', 'Counting DLs / CDLs and Ban Sahayaks…', 'Checking what has been verified…', 'Almost there…'],
    division: ['Opening the division…', 'Reading each person’s details…', 'Arranging them range by range…', 'Almost there…'],
    admin: ['Collecting from all divisions…', 'Putting it in order…', 'Almost there…'],
    signup: ['Getting the list of divisions…', 'Almost there…'],
  };
  function loaderHtml(kind, title) {
    const st = STEPS[kind] || STEPS.circles;
    return `<div class="loader" data-kind="${kind}">${TREE}
      <b class="ld-title">${esc(title || st[0])}</b>
      <div class="ibar"><i></i></div>
      <p class="ld-step">${esc(st[1] || '')}</p>
      <p class="ld-tip">${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}</p>
      <p class="ld-slow faint"></p></div>`;
  }
  const skeleton = kind => kind === 'division' ? `<div class="sk-rows">${'<div class="skeleton row"></div>'.repeat(8)}</div>`
    : kind === 'admin' ? `<div class="sk-rows">${'<div class="skeleton row"></div>'.repeat(5)}</div>` : `<div class="divs">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
  /** Rotates the messages of the loader on screen; stops by itself when the loader is gone. */
  function animateLoader(root) {
    const el = root.querySelector('.loader'); if (!el) return;
    const steps = STEPS[el.dataset.kind] || STEPS.circles, t0 = Date.now();
    let i = 1, tip = Math.floor(Math.random() * TIPS.length);
    const timer = setInterval(() => {
      if (!document.body.contains(el)) return clearInterval(timer);
      const secs = (Date.now() - t0) / 1000;
      if (i < steps.length - 1) { i++; swapText(el.querySelector('.ld-step'), steps[i]); }
      if (Math.round(secs) % 6 < 3) { tip = (tip + 1) % TIPS.length; swapText(el.querySelector('.ld-tip'), TIPS[tip]); }
      if (secs > 8) el.querySelector('.ld-slow').textContent = 'The first visit after a quiet spell can take up to 20 seconds. Thank you for waiting.';
    }, 2600);
  }
  function swapText(node, text) {
    if (!node || node.textContent === text) return;
    node.classList.add('out');
    setTimeout(() => { node.textContent = text; node.classList.remove('out'); }, 220);
  }

  /* ------------------------------------------------------------ sign in, sign up, forgot password (live) */
  // view: signin | signup | verify | forgot | reset; form: the sign-up details kept for "Send a new code"
  const auth = { view: 'signin', msg: '', email: '', form: null, lists: null };
  const canEdit = div => !S.user || S.user.isAdmin || !S.user.division || S.user.division === div;
  function authScreen() {
    const v = auth.view, msg = auth.msg ? `<div class="banner good">${esc(auth.msg)}</div>` : '';
    const f = (id, label, type = 'text', extra = '') => `<div class="field"><label for="${id}">${label}</label><input type="${type}" id="${id}" ${extra}></div>`;
    const card = (title, sub, body, key, btn) => `<form class="login card" data-auth="${key}" novalidate>
      <h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}${msg}${body}
      <div class="err" id="aerr" role="alert"></div><button class="btn primary block" type="submit" id="ago">${btn}</button>`;
    if (v === 'signup') {
      if (!auth.lists) { app.innerHTML = loaderHtml('signup'); animateLoader(app); S.api.open('lists').then(d => { auth.lists = d.divisions; render(); }, x => { auth.msg = ''; app.innerHTML = `<div class="card"><p class="muted">${esc(x.message)}</p><button class="btn primary" data-act="retry">Try again</button></div>`; }); return; }
      const circles = [...new Set(auth.lists.map(d => d.circle))];
      const ff = auth.form || {};
      app.innerHTML = card('Create an account', '', `
        <div class="banner warn"><b>Only 1 person per division.</b> Please sign up for your own division.</div>
        <div class="two"><div class="field"><label for="su-circle">Circle</label><select id="su-circle"><option value="">— Choose —</option>${circles.map(c => `<option ${c === ff.circle ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="su-division">Division</label><select id="su-division" ${ff.circle ? '' : 'disabled'}><option value="">— Choose —</option>${auth.lists.filter(d => d.circle === ff.circle).map(d => `<option ${d.division === ff.division ? 'selected' : ''}>${esc(d.division)}</option>`).join('')}</select></div></div>
        <div id="su-taken"></div>
        ${f('su-email', 'Email <span class="faint">(you will sign in with it)</span>', 'email', `autocomplete="email" value="${esc(ff.email || '')}"`)}
        ${f('su-name', 'Your name', 'text', `autocomplete="name" value="${esc(ff.name || '')}"`)}
        <div class="two">${f('su-desig', 'Designation', 'text', `value="${esc(ff.desig || '')}" placeholder="e.g. Head Clerk"`)}${f('su-phone', 'Mobile number', 'tel', `autocomplete="tel" inputmode="numeric" value="${esc(ff.phone || '')}"`)}</div>
        <div class="two">${f('su-pw', 'Password <span class="faint">(8+ characters)</span>', 'password', 'autocomplete="new-password"')}${f('su-pw2', 'Password again', 'password', 'autocomplete="new-password"')}</div>`,
        'signup', 'Send me a code') + `<p class="alt">Already have an account? <a href="#" data-act="auth" data-v="signin">Sign in</a></p></form>`;
      if (ff.division) authFormChange($('#su-division'));
      return;
    }
    if (v === 'verify') {
      app.innerHTML = card('Check your email', `We sent a 6-digit code to <b>${esc(auth.email)}</b>. It may be in the spam folder.`,
        f('code', 'Code', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"'), 'verify', 'Create my account')
        + `<p class="alt"><a href="#" data-act="resend">Send a new code</a> · <a href="#" data-act="auth" data-v="signup">Change the details</a></p></form>`;
    } else if (v === 'forgot') {
      app.innerHTML = card('Forgot password', 'We will email you a code to set a new password.', f('fg-email', 'Email you signed up with', 'email', `autocomplete="email" value="${esc(auth.email)}"`), 'forgot', 'Send me a code')
        + `<p class="alt"><a href="#" data-act="auth" data-v="signin">Back to sign in</a></p></form>`;
    } else if (v === 'reset') {
      app.innerHTML = card('Set a new password', `If <b>${esc(auth.email)}</b> has an account, a code is on its way. It may be in the spam folder.`,
        f('code', 'Code', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"') +
        `<div class="two">${f('rs-pw', 'New password <span class="faint">(8+ characters)</span>', 'password', 'autocomplete="new-password"')}${f('rs-pw2', 'New password again', 'password', 'autocomplete="new-password"')}</div>`, 'reset', 'Set the new password')
        + `<p class="alt"><a href="#" data-act="auth" data-v="forgot">Send a new code</a> · <a href="#" data-act="auth" data-v="signin">Back to sign in</a></p></form>`;
    } else {
      app.innerHTML = card('Sign in', 'DL / CDL and Ban Sahayak details and duties, division by division.',
        f('lu', 'Email', 'text', `autocomplete="username" autocapitalize="none" value="${esc(auth.email)}"`) + f('lp', 'Password', 'password', 'autocomplete="current-password"'), 'signin', 'Sign in')
        + `<p class="alt"><a href="#" data-act="auth" data-v="forgot">Forgot password?</a></p><p class="alt">New here? <a href="#" data-act="auth" data-v="signup">Create an account</a></p></form>`;
    }
    setTimeout(() => { const i = $('form[data-auth] input'); i && i.focus(); }, 50);
  }
  function authFormChange(t) {
    const c = $('#su-circle').value, ds = $('#su-division');
    if (t.id === 'su-circle') {
      ds.innerHTML = `<option value="">— Choose —</option>` + auth.lists.filter(d => d.circle === c).map(d => `<option>${esc(d.division)}</option>`).join('');
      ds.disabled = !c; $('#su-taken').innerHTML = ''; return;
    }
    const d = ds.value, box = $('#su-taken'); box.innerHTML = '';
    if (!d) return;
    S.api.open('divisionUsers', { division: d }).then(r => {
      if (r.count && $('#su-division') && $('#su-division').value === d)
        box.innerHTML = `<div class="banner warn">${esc(d)} already has ${r.count} user${r.count > 1 ? 's' : ''}. Continue only if you also work for ${esc(d)}.</div>`;
    }, () => {});
  }
  async function authSubmit(form, how) {
    const v = how === 'resend' ? 'signup' : form.dataset.auth, er = $('#aerr'), go = $('#ago');
    const val = id => ($('#' + id) || {}).value || '';
    const busy = (on, text) => { if (go) { go.disabled = on; if (text) go.textContent = text; } };
    if (er) er.textContent = '';
    const label = go && go.textContent;
    busy(true); if (go) go.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(v === 'signin' ? 'Signing in…' : 'Please wait…');
    try {
      if (v === 'signin') {
        auth.email = val('lu').trim();
        const u = await S.api.signIn(auth.email, val('lp'));
        signedIn(u); return;
      }
      if (v === 'signup') {
        const ff = how === 'resend' ? auth.form : { circle: val('su-circle'), division: val('su-division'), email: val('su-email').trim(), name: val('su-name'), desig: val('su-desig'), phone: val('su-phone'), password: val('su-pw') };
        if (how !== 'resend') {
          auth.form = Object.assign({}, ff, { password: '' });
          if (!ff.circle || !ff.division) throw new Error('Choose your circle and division.');
          if (ff.password !== val('su-pw2')) throw new Error('The two passwords are not the same.');
          auth.pw = ff.password;
        }
        await S.api.open('signupStart', Object.assign({}, ff, { password: auth.pw }));
        auth.email = ff.email; auth.view = 'verify'; auth.msg = how === 'resend' ? 'A new code has been sent.' : ''; render(); return;
      }
      if (v === 'verify') {
        const d = await S.api.open('signupVerify', { email: auth.email, code: val('code') });
        auth.pw = ''; auth.form = null; toast('Welcome! Your account is ready.'); signedIn(d.user); return;
      }
      if (v === 'forgot') {
        auth.email = val('fg-email').trim();
        await S.api.open('forgotStart', { email: auth.email }); auth.view = 'reset'; auth.msg = ''; render(); return;
      }
      if (v === 'reset') {
        if (val('rs-pw') !== val('rs-pw2')) throw new Error('The two passwords are not the same.');
        await S.api.open('forgotVerify', { email: auth.email, code: val('code'), password: val('rs-pw') });
        auth.view = 'signin'; auth.msg = 'Your password has been changed. Please sign in.'; render(); return;
      }
    } catch (x) {
      const e2 = $('#aerr'); if (e2) e2.textContent = x.message; else toast(x.message);
      busy(false, label);
    }
  }
  function signedIn(u) {
    S.signIn(u); auth.view = 'signin'; auth.msg = '';
    location.hash = u.division && !u.isAdmin ? '#/d/' + enc(u.division) : '#/';
    render();
  }

  /* ------------------------------------------------------------ admin: users */
  let usersData = null;
  const usersUi = { filter: 'all', open: '' };
  async function loadUsers() { usersData = await S.api.call('users'); }
  function usersPage() {
    const by = {}; usersData.rows.forEach(u => (by[u.division] = by[u.division] || []).push(u));
    const act = d => (by[d] || []).filter(u => u.status === 'Active').length;
    const ds = usersData.divisions.slice().sort((a, b) => (a.circle + a.division).localeCompare(b.circle + b.division)), none = ds.filter(d => !act(d.division)), many = ds.filter(d => act(d.division) > 1);
    const show = usersUi.filter === 'none' ? none : usersUi.filter === 'many' ? many : ds;
    const chip = (k, t, n) => `<button class="chip ${usersUi.filter === k ? 'on' : ''}" data-act="u-filter" data-v="${k}">${t}<span class="k">${n}</span></button>`;
    app.innerHTML = `<div class="head"><div class="grow"><h1>Users</h1><p class="muted">Division users sign up themselves with their email. Only active users are counted.</p></div></div>
      <div class="kpis">
        <div class="kpi"><div class="v num">${ds.length - none.length} / ${ds.length}</div><div class="l">Divisions with a user</div></div>
        <div class="kpi"><div class="v num">${usersData.rows.filter(u => u.status === 'Active').length}</div><div class="l">Active users</div></div>
        <div class="kpi"><div class="v num" style="color:var(--warn-ink)">${none.length}</div><div class="l">Divisions with no user</div></div>
        <div class="kpi"><div class="v num">${many.length}</div><div class="l">Divisions with more than 1</div></div></div>
      <div class="chips">${chip('all', 'All divisions', ds.length)}${chip('none', 'No user yet', none.length)}${chip('many', 'More than 1', many.length)}</div>
      <div class="card"><div style="overflow-x:auto"><table class="plain users"><thead><tr><th>Division</th><th>Users</th><th>Who</th></tr></thead><tbody>
      ${show.map(d => {
        const list = by[d.division] || [], n = act(d.division), open = usersUi.open === d.division;
        return `<tr class="u-row ${n ? '' : 'none'}" data-act="u-open" data-v="${esc(d.division)}"><td><b>${esc(d.division)}</b><div class="faint">${esc(d.circle)}</div></td>
          <td><span class="ucount ${n === 0 ? 'zero' : n > 1 ? 'many' : 'one'}">${n}</span>${n > 1 ? ' <span class="faint">more than 1</span>' : ''}</td>
          <td>${list.length ? list.map(u => `${esc(u.name)} <span class="faint">${esc(u.desig)}${u.status !== 'Active' ? ' · disabled' : ''}</span>`).join('<br>') : '<span class="faint">No one has signed up yet</span>'}</td></tr>
          ${open ? list.map(u => `<tr class="u-detail"><td colspan="3"><div class="row" style="justify-content:space-between;align-items:flex-start">
            <div><b>${esc(u.name)}</b>, ${esc(u.desig)} ${u.status === 'Active' ? '<span class="pill confirmed">Active</span>' : '<span class="pill remove">Disabled</span>'}
              <div class="faint">${esc(u.email)} · ${esc(u.phone)} · signed up ${esc(u.on)} · last sign-in ${esc(u.last || '—')}</div></div>
            <div class="row" style="flex-wrap:nowrap">${u.status === 'Active' ? `<button class="btn sm danger" data-act="u-status" data-v="off" data-email="${esc(u.email)}">Disable</button>` : `<button class="btn sm" data-act="u-status" data-v="on" data-email="${esc(u.email)}">Enable</button>`}
              <button class="btn sm" data-act="u-pass" data-email="${esc(u.email)}">Set a new password</button></div></div></td></tr>`).join('') : ''}`;
      }).join('')}</tbody></table></div></div>`;
  }
  async function userStatus(email, on) {
    try { usersData = await S.api.call('userStatus', { email, active: on }); toast(on ? 'User enabled' : 'User disabled; they are signed out'); render(); }
    catch (x) { toast(x.message); }
  }
  function userPassModal(email) {
    openModal(`<h2>Set a new password</h2><p class="muted">For ${esc(email)}. Tell them the new password; they can change it later with “Forgot password”.</p>
      <div class="field"><label for="upw">New password <span class="faint">(8+ characters)</span></label><input type="text" id="upw" autocomplete="off"></div>
      <div class="acts"><button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="u-pass-ok" data-email="${esc(email)}">Set password</button></div>`);
    setTimeout(() => $('#upw').focus(), 50);
  }
  async function userPassSave(email) {
    const pw = $('#upw').value;
    if (pw.length < 8) { toast('At least 8 characters'); return; }
    try { await S.api.call('userPassword', { email, password: pw }); closeModal(); toast('Password set'); }
    catch (x) { toast(x.message); }
  }

  /* ------------------------------------------------------------ admin screens */
  function dashboard() {
    const ds = S.divisions(ui.cadre), tot = sum(ds), dk = S.dutyCounts(ui.cadre);
    const dc = {}; S.DUTIES.forEach(d => { dc[d] = dk.duty[d] || 0; }); const blank = dk.blank;
    const mx = Math.max(blank, ...Object.values(dc), 1);
    const pct = n => tot.active ? Math.round(n / tot.active * 100) + '%' : '0%';
    app.innerHTML = `<div class="head"><div class="grow"><h1>Dashboard</h1><p class="muted">All divisions${S.LIVE ? '' : ' · demo'}</p></div>${legend}</div>
      ${tabs(() => true)}
      <div class="kpis">
        <div class="kpi"><div class="v num">${tot.active}</div><div class="l">${isBS() ? 'Ban Sahayaks' : 'People working'}</div></div>
        <div class="kpi"><div class="v num" style="color:var(--good-ink)">${tot.confirmed} <span style="font-size:15px">${pct(tot.confirmed)}</span></div><div class="l">Verified</div></div>
        <div class="kpi"><div class="v num" style="color:var(--warn-ink)">${tot.missing}</div><div class="l">Missing info</div></div>
        <div class="kpi"><div class="v num" style="color:var(--bad-ink)">${tot.problem}</div><div class="l">Problems</div></div>
        <div class="kpi"><div class="v num">${S.pendingCount}</div><div class="l"><a href="#/approvals">Waiting for approval</a></div></div>
        <div class="kpi"><div class="v num">${ds.filter(d => d.certified).length} / ${ds.length}</div><div class="l">Divisions certified</div></div>
        ${S.meta && S.meta.userCounts ? `<div class="kpi"><div class="v num">${ds.filter(d => S.meta.userCounts[d.division]).length} / ${ds.length}</div><div class="l"><a href="#/users">Divisions with a user</a></div></div>` : ''}
        ${isBS() ? `<div class="kpi"><div class="v num">${(tot.active * S.BS_PAY / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh</div><div class="l">Monthly pay (Rs)</div></div>` : ''}</div>
      <div class="dash">
        <div class="card"><h2 style="margin-bottom:10px">Divisions</h2><div style="overflow-x:auto"><table class="plain"><thead><tr><th>Division</th><th>People</th><th>Progress</th><th>Verified</th><th>Missing</th><th>Problem</th><th>Status</th></tr></thead><tbody>
          ${ds.map(d => `<tr><td><a href="#/d/${enc(d.division)}"><b>${esc(d.division)}</b></a><div class="faint"><a href="#/c/${enc(d.circle)}">${esc(d.circle)}</a></div></td><td class="num">${d.counts.active}</td><td>${bar(d.counts)}</td>
            <td class="num">${d.counts.confirmed}</td><td class="num">${d.counts.missing}</td><td class="num">${d.counts.problem}</td>
            <td>${d.certified ? '<span class="pill confirmed">Certified</span>' : d.last ? '<span class="faint">Last change ' + esc(d.last.slice(0, 10)) + '</span>' : '<span class="pill missing">Not started</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="card"><h2>Main duty</h2><p class="faint" style="margin:2px 0 12px">People working, by the duty they do most</p>
          ${S.DUTIES.slice().sort((a, b) => dc[b] - dc[a]).map(d => `<div class="hbar"><span>${esc(short(d))}</span><span class="t"><i style="width:${dc[d] / mx * 100}%"></i></span><span class="n">${dc[d]}</span></div>`).join('')}
          <div class="hbar blank"><span><b>Not filled yet</b></span><span class="t"><i style="width:${blank / mx * 100}%"></i></span><span class="n">${blank}</span></div></div>
      </div>`;
  }
  function approvals() {
    const list = S.pending();
    app.innerHTML = `<div class="head"><div class="grow"><h1>Approvals</h1><p class="muted">Divisions' edits save straight away. Only new people and removals wait here.</p></div>
      ${list.length > 1 ? `<button class="btn good" data-act="approve-all">Approve all ${list.length}</button>` : ''}</div>
      <div class="card">${list.length ? `<div style="overflow-x:auto"><table class="plain"><thead><tr><th>Request</th><th>Person</th><th>Division</th><th>Details</th><th>By</th><th></th></tr></thead><tbody>
        ${list.map(p => `<tr><td>${p.state === 'add-pending' ? '<span class="pill added">Add new person</span>' : '<span class="pill remove">Not working</span>'}${p.cadre === 'BS' ? ' <span class="pill bs">Ban Sahayak</span>' : ''}</td>
          <td><b>${esc(p.name)}</b><div class="faint">${esc(p.range)}${p.beat ? ', ' + esc(p.beat) : ''}</div></td><td>${esc(p.division)}</td>
          <td>${p.state === 'add-pending' ? esc(p.duty || 'Duty not filled') + (p.pay != null ? ' · Rs ' + esc(p.pay) : '') : esc(p.removal.reason) + (p.removal.remark ? ' — ' + esc(p.removal.remark) : '')}</td>
          <td class="faint">${esc(p.state === 'add-pending' ? p.updBy : p.removal.by)}<br>${esc(p.state === 'add-pending' ? p.updOn : p.removal.on)}</td>
          <td><div class="row" style="flex-wrap:nowrap"><button class="btn sm good" data-act="approve" data-id="${esc(p.id)}">Approve</button><button class="btn sm" data-act="reject" data-id="${esc(p.id)}">Reject</button></div></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted" style="margin:0">Nothing waiting. Try it: as an operator, mark someone as not working or add a person.</p>'}</div>`;
  }
  function changeLog() {
    const l = S.log.slice(0, 300);
    app.innerHTML = `<div class="head"><div class="grow"><h1>Changes</h1><p class="muted">Every edit, verification and approval, newest first. In the real app this is the Change Log sheet.</p></div></div>
      <div class="card">${l.length ? `<div style="overflow-x:auto"><table class="plain"><thead><tr><th>When</th><th>By</th><th>Division</th><th>Person</th><th>What</th><th>Old</th><th>New</th></tr></thead><tbody>
        ${l.map(x => `<tr><td class="faint num" style="white-space:nowrap">${esc(x.on)}</td><td>${esc(x.by)}</td><td>${esc(x.division)}</td><td>${esc(x.name)}${x.cadre === 'BS' && x.name ? ' <span class="pill bs">BS</span>' : ''}</td><td><b>${esc(x.type)}</b>${x.field ? ' · ' + esc(x.field) : ''}</td>
          <td style="color:var(--bad-ink);text-decoration:${x.old ? 'line-through' : 'none'}">${esc(x.old)}</td><td style="color:var(--good-ink)">${esc(x.new)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted" style="margin:0">No changes yet.</p>'}</div>`;
  }

  /* ------------------------------------------------------------ router */
  const route = () => decodeURIComponent(location.hash.slice(1) || '/');
  // live: shows the loading animation until what the page needs has come from the API (once); later visits refresh in the background
  function need(ready, load, label, kind) {
    if (ready) return false;
    app.innerHTML = loaderHtml(kind || 'circles', label) + skeleton(kind);
    animateLoader(app);
    load().then(render, err => {
      if (err.auth) { S.signOut(); render(); return; }
      app.innerHTML = `<div class="card"><h2>Could not load</h2><p class="muted">${esc(err.message)}</p><button class="btn primary" data-act="retry">Try again</button></div>`;
    });
    return true;
  }
  function render() {
    header();
    const h = route();
    $('#flag').hidden = S.LIVE;
    if (!S.user) { login(); return; }
    if (S.LIVE) {
      const div = h.startsWith('/d/') ? h.slice(3) : '';
      // a division and the summary are fetched together
      if (div && need(S.meta && S.isLoaded(div), () => Promise.all([S.meta ? null : S.loadMeta(), S.isLoaded(div) ? null : S.loadDivision(div)]), `Opening ${div}…`, 'division')) return;
      if (need(!!S.meta, S.loadMeta, 'Opening the divisions…', 'circles')) return;
      if (h === '/approvals' && need(S.pendingLoaded, S.loadPending, 'Collecting the requests…', 'admin')) return;
      if (h === '/log' && need(S.logLoaded, S.loadLog, 'Reading the change log…', 'admin')) return;
      if (h === '/users' && need(!!usersData, loadUsers, 'Counting the users…', 'admin')) return;
      refresh();
    }
    if (h.startsWith('/d/')) division(h.slice(3));
    else if (h.startsWith('/c/')) circlePage(h.slice(3));
    else if (S.user.role === 'admin' && h === '/divisions') picker();
    else if (S.user.role === 'admin' && h === '/approvals') approvals();
    else if (S.user.role === 'admin' && h === '/log') changeLog();
    else if (S.user.role === 'admin' && h === '/users') usersPage();
    else if (S.user.role === 'admin') dashboard();
    else picker();
  }
  // live: fetches again in the background what is more than a minute old (or came from this device), then redraws if nothing is being edited.
  // force (on changing page): the admin lists too
  const inflight = {};
  function refresh(force) {
    const h = route(), at = location.hash, old = t => Date.now() - t > 60000;
    const again = () => { if (location.hash === at && !ui.edit && !dr && !S.saving && !modal.classList.contains('on')) render(); };
    const bg = (key, fn) => { if (inflight[key]) return; inflight[key] = 1; fn().then(again, () => {}).finally(() => { delete inflight[key]; }); };
    if (h.startsWith('/d/')) { const div = h.slice(3); if (old(S.loadedAt(div))) bg('d|' + div, () => S.loadDivision(div)); }
    else if (old(S.metaAt)) bg('meta', S.loadMeta);
    if (force && h === '/approvals') bg('pending', S.loadPending);
    if (force && h === '/log') bg('log', S.loadLog);
    if (force && h === '/users') bg('users', loadUsers);
  }
  window.addEventListener('hashchange', () => { closeDrawer(); window.scrollTo(0, 0); if (S.LIVE && S.user && S.meta) refresh(true); render(); });
  // live: a refused save brings the division back as the sheet has it; an expired sign-in goes back to the sign-in page
  S.onError(err => {
    if (err.auth) { S.signOut(); closeDrawer(); render(); toast('Please sign in again.'); return; }
    ui.edit = null; closeDrawer(); render();
    toast(err.conflict ? err.message : 'Not saved: ' + err.message);
  });
  S.onBusy(n => {
    const el = $('#sync'); if (!el) return;
    clearTimeout(el.t); el.hidden = false;
    el.textContent = n ? 'Saving…' : 'All changes saved'; el.className = 'sync' + (n ? ' on' : '');
    if (!n) el.t = setTimeout(() => { el.hidden = true; }, 2500);
  });
  window.addEventListener('beforeunload', e => { if (S.saving) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('submit', e => { if (e.target.dataset.auth) { e.preventDefault(); authSubmit(e.target); } });

  /* ------------------------------------------------------------ events */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-set],[data-tog]');
    if (!t) {
      const row = e.target.closest('table.people tbody tr[data-id]');
      if (row && !(ui.edit && ui.edit.id === row.dataset.id)) openPerson(row.dataset.id);
      if (!e.target.closest('.who')) { const m = $('#who .menu'); m && m.remove(); }
      return;
    }
    if (t.dataset.set) { dr.draft[t.dataset.set] = t.dataset.v; if (t.dataset.set === 'duty') dr.openDuty = false, dr.draft.other = (dr.draft.other || []).filter(x => x !== t.dataset.v); drawRerender(); return; }
    if (t.dataset.tog) { const o = dr.draft.other || [], v = t.dataset.tog; dr.draft.other = o.includes(v) ? o.filter(x => x !== v) : o.concat(v); drawRerender(); return; }
    const a = t.dataset.act, id = t.dataset.id;
    switch (a) {
      case 'duty-open': dr.openDuty = true; drawRerender(); break;
      case 'at': setAt(dr.draft, dr, t.dataset.v); drawRerender(); break;
      case 'other-open': dr.openOther = true; drawRerender(); break;
      case 'other-done': dr.openOther = false; drawRerender(); break;
      case 'menu': menu(); break;
      case 'help': help(); break;
      case 'mclose': closeModal(); break;
      case 'reset': S.reset(); ui.div = ''; toast('All changes reset'); render(); break;
      case 'signout': S.signOut(); location.hash = '#/'; render(); break;
      case 'retry': render(); break;
      case 'auth': e.preventDefault(); auth.view = t.dataset.v; auth.msg = ''; render(); break;
      case 'resend': e.preventDefault(); authSubmit(null, 'resend'); break;
      case 'u-filter': usersUi.filter = t.dataset.v; render(); break;
      case 'u-open': usersUi.open = usersUi.open === t.dataset.v ? '' : t.dataset.v; render(); break;
      case 'u-status': userStatus(t.dataset.email, t.dataset.v === 'on'); break;
      case 'u-pass': userPassModal(t.dataset.email); break;
      case 'u-pass-ok': userPassSave(t.dataset.email); break;
      case 'as-op': S.signIn({ role: 'operator', name: 'Demo Operator' }); location.hash = '#/'; render(); break;
      case 'as-admin': S.signIn({ role: 'admin', name: 'Demo Admin' }); location.hash = '#/'; render(); break;
      case 'cadre': if (ui.cadre !== t.dataset.v) { ui.cadre = t.dataset.v; remember('cdl-cadre', ui.cadre); Object.assign(ui, { filter: 'all', range: '', q: '', edit: null, keep: new Set() }); render(); } break;
      case 'filter': ui.filter = t.dataset.v; ui.edit = null; ui.keep.clear(); render(); break;
      case 'hide-steps': e.preventDefault(); ui.steps = false; try { localStorage.setItem('cdl-steps', 'off'); } catch (x) { /* fine */ } render(); break;
      case 'r-edit': {
        if (ui.edit && ui.edit.id !== id) { toast('Save or cancel the row you are editing first'); break; }
        const p = S.find(id); ui.edit = { id, d: JSON.parse(JSON.stringify(p)), newRange: false }; ui.keep.add(id); render();
        const f = $(`tr[data-id="${CSS.escape(id)}"] [data-r]`); f && f.focus(); break;
      }
      case 'r-cancel': ui.edit = null; render(); break;
      case 'r-save': saveRow(false); break;
      case 'r-verify': if (ui.edit && ui.edit.id === id) saveRow(true); else verifyOne(id); break;
      case 'av-yes': { const vid = t.dataset.id; closeModal(); verifyOne(vid); if (dr && dr.id === vid) openPerson(vid, dr.list); break; }
      case 'confirm-ready': { const ids = visible().filter(p => S.status(p) === 'ready').map(p => p.id); ids.forEach(x => ui.keep.add(x)); const r = S.confirm(ids); toast(`${r.done} verified`); render(); break; }
      case 'open': if (!(ui.edit && ui.edit.id === id)) openPerson(id); break;
      case 'range-new': dr.newRange = true; dr.draft.range = ''; drawRerender(); { const n = $('[data-f=range]', drawer); n && n.focus(); } break;
      case 'add': openNew(); break;
      case 'certify': certifyModal(); break;
      case 'cert-ok': {
        const n = $('#cName').value.trim(), d = $('#cDesig').value.trim();
        if (!n || !d || !$('#cOk').checked) { toast('Fill the name and designation, and tick the box'); break; }
        S.certify(ui.div, ui.cadre, n, d); closeModal(); toast('List certified'); render(); break;
      }
      case 'reopen': S.reopen(ui.div, ui.cadre); toast('Reopened for changes'); render(); break;
      case 'print': printList(); break;
      case 'close': closeDrawer(); break;
      case 'prev': case 'next': { const i = dr.list.indexOf(dr.id) + (a === 'next' ? 1 : -1); if (dr.list[i]) openPerson(dr.list[i], dr.list); break; }
      case 'yearonly': { const d = dr.draft; d.date = t.checked ? (/(\d{4})$/.exec(d.date || '') || [, ''])[1] : ''; drawRerender(); break; }
      case 'save': saveDrawer(false); break;
      case 'save-confirm': saveDrawer(true); break;
      case 'unconfirm': S.unconfirm(dr.id); toast('Verification removed'); render(); openPerson(dr.id, dr.list); break;
      case 'not-working': notWorking(); break;
      case 'nw-ok': { const r = $('#nwReason').value; if (!r) { toast('Choose a reason'); break; } S.update(dr.id, changes()); S.markNotWorking(dr.id, r, $('#nwRemark').value.trim()); closeModal(); toast('Sent to the admin for approval'); render(); openPerson(dr.id, dr.list); break; }
      case 'undo-remove': S.undoRemoval(dr.id); render(); openPerson(dr.id, dr.list); break;
      case 'flag-keep': S.resolveFlag(dr.id, false); toast('Marked as different people'); render(); openPerson(dr.id, dr.list); break;
      case 'flag-dup': S.resolveFlag(dr.id, true); toast('Sent to the admin for removal'); render(); openPerson(dr.id, dr.list); break;
      case 'add-save': {
        const d = dr.draft; if (d.name.trim().length < 3) break;
        const p = S.addPerson({ cadre: d.cadre, circle: d.circle, division: d.division, name: d.name.trim(), mode: d.mode, agency: d.mode === 'Through agency' ? d.agency : '', date: d.date, district: d.district,
          range: d.range, beat: d.beat, place: d.place, placeName: d.place && d.place !== 'Beat' ? d.placeName : '', duty: d.duty, other: d.other, details: d.details, remarks: (d.remarks || '').trim(), pay: d.pay === '' || d.pay == null ? null : Number(d.pay) });
        ui.keep.add(p.id);
        if (d.cadre !== 'BS') { toast('Added. The admin will approve it.'); render(); openPerson(p.id, [p.id]); break; }
        toast(`${p.name} added`); render();
        if (t.dataset.v === 'next') openNew(); else { openPerson(p.id, [p.id]); if (S.status(p) === 'ready') askVerify(p.id); }
        break;
      }
      case 'approve': case 'reject': S.decide(id, a === 'approve'); toast(a === 'approve' ? 'Approved' : 'Rejected'); render(); break;
      case 'approve-all': S.pending().forEach(p => S.decide(p.id, true)); toast('All approved'); render(); break;
      default: break;
    }
  });
  scrim.addEventListener('click', closeDrawer);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (modal.classList.contains('on')) closeModal(); else if (dr) closeDrawer(); } });

  document.addEventListener('change', e => {
    const t = e.target, a = t.dataset.act;
    if (a === 'track') { ui.track = t.checked; remember('cdl-track', ui.track ? 'on' : 'off'); if (!ui.track && ui.filter === 'changed') ui.filter = 'all'; render(); return; }
    if (t.id === 'su-circle' || t.id === 'su-division') { authFormChange(t); return; }
    if (a === 'range') { ui.range = t.value; ui.edit = null; ui.keep.clear(); render(); return; }
    if (ui.edit && t.dataset.r) {   // selects change what the row shows; typed fields are read on input
      if (t.dataset.r === 'range' && t.value === '__new') { ui.edit.newRange = true; ui.edit.d.range = ''; render(); const n = $('tr.editing [data-r=range]'); n && n.focus(); return; }
      readRow(t); if (t.tagName === 'SELECT') render(); return;
    }
    if (dr && t.dataset.f) {
      if (t.dataset.f === 'range' && t.value === '__new') { dr.newRange = true; dr.draft.range = ''; drawRerender(); const n = $('[data-f=range]', drawer); n && n.focus(); return; }
      readField(t); if (t.tagName === 'SELECT' || t.type === 'checkbox') drawRerender();
    }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'q') { ui.q = t.value; const pos = t.selectionStart; render(); const n = $('[data-act=q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (ui.edit && t.dataset.r) { readRow(t); rowVerifyState(); return; }
    if (dr && t.dataset.f) {
      readField(t); drawFootState();
      if (t.dataset.f === 'name' && !dr.id) {   // live "already listed?" check and the Add button
        const y = $('.dr-body', drawer).scrollTop; drawRender(); $('.dr-body', drawer).scrollTop = y;
        const n = $('[data-f=name]', drawer); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
      }
    }
  });
  function readField(t) {
    const d = dr.draft, f = t.dataset.f, v = t.value;
    if (f === 'isodate') { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); d.date = m ? `${m[3]}-${m[2]}-${m[1]}` : ''; }
    else if (f === 'year') d.date = /^\d{4}$/.test(v) ? v : '';
    else if (f === 'pay') d.pay = v === '' ? null : Number(v);
    else d[f] = v;
  }

  render();
})();
