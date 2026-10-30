// CDL+BS dashboard (admins): one filter row (cadre, circle, division) that every figure below follows.
// Charts are plain HTML: thin bars, 2px gaps, a hover tooltip on every mark, a legend wherever two series meet.
(function () {
  const S = window.CDL_STORE;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const fmt = n => Math.round(n || 0).toLocaleString('en-IN');
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

  // colours: two categorical slots (validated as a pair), the app's status colours, one blue sequential ramp
  const COL = { CDL: '#2a78d6', BS: '#eb6834' };
  const NAME = { CDL: 'DL / CDL', BS: 'Ban Sahayaks' };
  const STATUS = [['confirmed', 'Verified', '#2f9e44'], ['ready', 'Ready to verify', '#9fd4a9'], ['missing', 'Missing info', '#d9731a'], ['problem', 'Problem', '#c2410c']];
  const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  const DUTY_SHORT = { 'Cleaning/Sweeping/Maintenance': 'Cleaning / Maint.', 'Forest Protection and Patrolling': 'Protection & Patrol',
    'Human-Animal Conflict Management': 'Human-Animal Conflict', 'Night Guard/Security': 'Night Guard', 'Nursery Operations': 'Nursery', 'Mali/Gardener': 'Mali / Gardener' };
  const MISS = { name: 'Name', mode: 'Mode of engagement', date: 'Engagement date', district: 'District', range: 'Posted at / range', place: 'Place of work',
    duty: 'Main duty', pay: 'Monthly pay', details: 'Duty details (for Others)' };
  const PAY = ['<6k', '6-8k', '8-10k', '10-12k', '12-15k', '15-20k', '20k+'];
  const PAY_LABEL = { '<6k': 'Under 6,000', '6-8k': '6,000–8,000', '8-10k': '8,000–10,000', '10-12k': '10,000–12,000', '12-15k': '12,000–15,000', '15-20k': '15,000–20,000', '20k+': '20,000 and over' };

  const f = { cadre: 'both', circle: '', division: '', sort: 'verified', dir: 1 };
  let root = null;

  /* ---------------------------------------------------------------- adding up */
  const cadres = () => f.cadre === 'both' ? ['CDL', 'BS'] : [f.cadre];
  const inScope = d => (!f.circle || d.circle === f.circle) && (!f.division || d.division === f.division);
  function counts(divs, cs = cadres()) {
    const o = { all: 0, active: 0, confirmed: 0, ready: 0, missing: 0, problem: 0, remove: 0, added: 0 };
    divs.forEach(d => cs.forEach(c => Object.keys(o).forEach(k => { o[k] += (d[c] && d[c][k]) || 0; })));
    return o;
  }
  /** Sums one map (e.g. duty) per cadre: {CDL: {key: n}, BS: {key: n}} */
  function maps(divs, get) {
    const o = {};
    cadres().forEach(c => { o[c] = {}; divs.forEach(d => { const m = get(d, c) || {}; Object.keys(m).forEach(k => { o[c][k] = (o[c][k] || 0) + m[k]; }); }); });
    return o;
  }
  const sumX = (divs, key) => cadres().reduce((a, c) => a + divs.reduce((b, d) => b + ((d.x && d.x[c] && d.x[c][key]) || 0), 0), 0);

  /* ---------------------------------------------------------------- pieces */
  // a mark's tooltip: title and rows of [colour, value, label]; read back with textContent only
  const tip = (title, rows) => `data-tip="${esc(JSON.stringify([title, rows]))}"`;
  const legend = cs => cs.length < 2 ? '' : `<div class="dlegend">${cs.map(c => `<span><i style="background:${COL[c]}"></i>${NAME[c]}</span>`).join('')}</div>`;
  const statusLegend = `<div class="dlegend">${STATUS.map(s => `<span><i style="background:${s[2]}"></i>${s[1]}</span>`).join('')}</div>`;
  const card = (title, sub, body, cls = '') => `<section class="dcard ${cls}"><div class="dhead"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${body}</section>`;
  const empty = text => `<p class="dempty">${esc(text)}</p>`;

  /** 100% stacked bars of status, one row each; rows: {label, sub, c (counts), pick} */
  function statusRows(rows) {
    return `<div class="srows">${rows.map(r => {
      const t = r.c.active || 0;
      const segs = STATUS.filter(s => r.c[s[0]]).map(s => `<i style="flex:${r.c[s[0]]};background:${s[2]}" ${tip(r.label, [[s[2], fmt(r.c[s[0]]) + ' (' + pct(r.c[s[0]], t) + '%)', s[1]]])}></i>`).join('');
      return `<div class="srow ${r.pick ? 'pick' : ''}" ${r.pick ? `data-d="${r.pick[0]}" data-v="${esc(r.pick[1])}" tabindex="0" role="button"` : ''}>
        <span class="sl">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>
        <span class="sbar">${t ? segs : '<i class="none"></i>'}</span>
        <span class="sv"><b>${pct(r.c.confirmed, t)}%</b> <small>of ${fmt(t)}</small></span></div>`;
    }).join('')}</div>`;
  }
  /** Horizontal bars, stacked by cadre; items: {label, v: {CDL, BS}, note} sorted by total */
  function hbars(items, opts = {}) {
    const cs = cadres(), tot = it => cs.reduce((a, c) => a + (it.v[c] || 0), 0);
    const list = items.filter(it => tot(it) > 0 || opts.keepZero).sort((a, b) => opts.keepOrder ? 0 : tot(b) - tot(a));
    if (!list.length) return empty(opts.empty || 'Nothing to show for this choice.');
    const max = Math.max(...list.map(tot), 1);
    return `<div class="hbars">${list.map(it => {
      const t = tot(it);
      const segs = cs.filter(c => it.v[c]).map(c => `<i style="width:${it.v[c] / max * 100}%;background:${opts.color || COL[c]}" ${tip(it.label,
        cs.filter(k => it.v[k]).map(k => [opts.color || COL[k], fmt(it.v[k]), cs.length > 1 ? NAME[k] : (opts.unit || 'people')]).concat(it.note ? [['', '', it.note]] : []))}></i>`).join('');
      return `<div class="hrow"><span class="hl" title="${esc(it.label)}">${esc(it.short || it.label)}</span><span class="hbar">${segs}<b>${fmt(t)}</b></span></div>`;
    }).join('')}</div>`;
  }
  /** Columns stacked by cadre; cats: [{key, label, v: {CDL, BS}}]; every Nth label shown */
  function columns(cats, opts = {}) {
    const cs = opts.cadres || cadres(), tot = k => cs.reduce((a, c) => a + (k.v[c] || 0), 0);
    if (!cats.some(k => tot(k))) return empty(opts.empty || 'Nothing to show for this choice.');
    const max = Math.max(...cats.map(tot), 1), nice = niceMax(max), every = opts.every || 1;
    const peak = cats.reduce((a, k) => tot(k) > tot(a) ? k : a, cats[0]);
    return `<div class="cols ${opts.cls || ''}" style="--n:${cats.length}">
      <div class="cgrid"><span style="bottom:100%">${fmt(nice)}</span><span style="bottom:50%">${fmt(nice / 2)}</span><span style="bottom:0">0</span></div>
      <div class="cplot">${cats.map((k, i) => {
        const t = tot(k);
        const segs = cs.filter(c => k.v[c]).map(c => `<i style="height:${k.v[c] / nice * 100}%;background:${opts.color || COL[c]}"></i>`).join('');
        return `<div class="col" ${tip(k.title || k.label, cs.filter(c => k.v[c]).map(c => [opts.color || COL[c], fmt(k.v[c]), cs.length > 1 ? NAME[c] : (opts.unit || 'people')]).concat(t ? [] : [['', '0', opts.unit || 'people']]))}>
          <div class="cstack">${k === peak && t && opts.peak ? `<em>${fmt(t)}</em>` : ''}${segs}</div>
          <span class="cx">${i % every === 0 || i === cats.length - 1 ? esc(k.label) : ''}</span></div>`;
      }).join('')}</div></div>`;
  }
  function niceMax(m) { const p = Math.pow(10, Math.floor(Math.log10(m))), r = m / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; }
  /** Heatmap: rows × duties, shaded by the share of the row's people with that main duty */
  function heat(rows, cols) {
    if (!rows.length) return empty('Nothing to show for this choice.');
    const step = s => s <= 0 ? null : SEQ[Math.min(SEQ.length - 1, Math.floor(s * 100 / 9))];
    return `<div class="heat" style="--cols:${cols.length}">
      <div class="hh"></div>${cols.map(c => `<div class="hh" title="${esc(c)}"><span>${esc(DUTY_SHORT[c] || c)}</span></div>`).join('')}
      ${rows.map(r => `<div class="hr" title="${esc(r.label)}">${esc(r.label)}</div>${cols.map(c => {
        const n = r.v[c] || 0, s = r.total ? n / r.total : 0, bg = step(s), dark = s * 100 >= 27;
        return `<div class="hc" style="${bg ? `background:${bg};color:${dark ? '#fff' : '#0b0b0b'}` : ''}" ${tip(r.label + ' · ' + c, [[bg || '#e1e0d9', fmt(n) + ' (' + Math.round(s * 100) + '%)', 'of ' + fmt(r.total) + ' with a main duty']])}>${s >= .15 ? Math.round(s * 100) + '%' : ''}</div>`;
      }).join('')}`).join('')}
    </div>
    <div class="heatkey"><span>Share of the row's people</span>${SEQ.map((c, i) => `<i style="background:${c}" title="${i * 9}–${i * 9 + 9}%"></i>`).join('')}<span>0%</span><span>54%+</span></div>`;
  }
  /** A thin 100% bar of parts [[label, n, colour]] with its own legend */
  function split(parts) {
    const t = parts.reduce((a, p) => a + p[1], 0);
    if (!t) return '';
    return `<div class="split">${parts.filter(p => p[1]).map(p => `<i style="flex:${p[1]};background:${p[2]}" ${tip(p[0], [[p[2], fmt(p[1]) + ' (' + pct(p[1], t) + '%)', 'people']])}></i>`).join('')}</div>
      <div class="dlegend small">${parts.filter(p => p[1]).map(p => `<span><i style="background:${p[2]}"></i>${esc(p[0])} <b>${pct(p[1], t)}%</b></span>`).join('')}</div>`;
  }

  /* ---------------------------------------------------------------- the page */
  function render(el) {
    root = el || root;
    const all = S.dashData(), cs = cadres();
    const circles = [...new Set(all.map(d => d.circle))].sort();
    if (f.circle && !circles.includes(f.circle)) f.circle = '';
    const divsOfCircle = all.filter(d => !f.circle || d.circle === f.circle).map(d => d.division).sort();
    if (f.division && !divsOfCircle.includes(f.division)) f.division = '';
    const divs = all.filter(inScope), c = counts(divs);
    const where = f.division ? f.division : f.circle ? f.circle + ' circle' : 'all divisions';
    const noX = S.LIVE && all.length && !all.some(d => d.x && Object.keys(d.x.CDL.years).length);
    const y = scrollY;

    // headline figures
    const by = { CDL: counts(divs, ['CDL']), BS: counts(divs, ['BS']) };
    const listsWith = divs.reduce((a, d) => a + cs.filter(k => d[k] && d[k].active).length, 0);
    const certified = divs.reduce((a, d) => a + cs.filter(k => d.certs && d.certs[k]).length, 0);
    const bill = cs.reduce((a, k) => a + divs.reduce((b, d) => b + (k === 'BS' ? ((d.BS && d.BS.active) || 0) * S.BS_PAY : ((d.x && d.x.CDL.paySum) || 0)), 0), 0);
    const pending = c.added + c.remove;
    const changed = cs.includes('CDL') ? divs.reduce((a, d) => a + ((d.x && d.x.CDL.changed) || 0), 0) : null;

    // progress rows: circles, or a circle's divisions, or one division's cadres
    let progRows, progTitle;
    if (f.division) { progTitle = 'Verification by cadre'; progRows = ['CDL', 'BS'].map(k => ({ label: NAME[k], c: counts(divs, [k]) })).filter(r => r.c.active); }
    else if (f.circle) { progTitle = 'Verification by division'; progRows = divs.map(d => ({ label: d.division, c: counts([d]), pick: ['division', d.division] })); }
    else { progTitle = 'Verification by circle'; progRows = circles.map(ci => { const ds = all.filter(d => d.circle === ci); return { label: ci, sub: ds.length + ' divisions', c: counts(ds), pick: ['circle', ci] }; }); }
    progRows = progRows.filter(r => r.c.active).sort((a, b) => pct(b.c.confirmed, b.c.active) - pct(a.c.confirmed, a.c.active) || b.c.active - a.c.active);

    // duties
    const duty = maps(divs, (d, k) => d.duty && d.duty[k]), other = maps(divs, (d, k) => d.x && d.x[k].other);
    const blank = cs.reduce((a, k) => a + divs.reduce((b, d) => b + ((d.blank && d.blank[k]) || 0), 0), 0);
    const dutyItems = S.DUTIES.map(dt => ({ label: dt, short: DUTY_SHORT[dt] || dt, v: Object.fromEntries(cs.map(k => [k, duty[k][dt] || 0])),
      note: cs.reduce((a, k) => a + (other[k][dt] || 0), 0) ? '+' + fmt(cs.reduce((a, k) => a + (other[k][dt] || 0), 0)) + ' do it as an other duty' : '' }));
    // heatmap rows
    const heatRows = (f.circle || f.division ? divs.map(d => ({ label: d.division, ds: [d] })) : circles.map(ci => ({ label: ci, ds: all.filter(d => d.circle === ci) })))
      .map(r => { const v = {}; let total = 0; r.ds.forEach(d => cs.forEach(k => Object.keys((d.duty && d.duty[k]) || {}).forEach(dt => { v[dt] = (v[dt] || 0) + d.duty[k][dt]; total += d.duty[k][dt]; }))); return { label: r.label, v, total }; })
      .filter(r => r.total);
    // years
    const years = maps(divs, (d, k) => d.x && d.x[k].years);
    const ys = [...new Set(cs.flatMap(k => Object.keys(years[k])))].map(Number).sort((a, b) => a - b);
    const yearCats = [];
    if (ys.length) for (let yr = Math.min(ys[0], 2026); yr <= Math.max(ys[ys.length - 1], 2000); yr++) yearCats.push({ key: yr, label: String(yr), v: Object.fromEntries(cs.map(k => [k, years[k][yr] || 0])) });
    const engaged = cs.reduce((a, k) => a + Object.values(years[k]).reduce((b, n) => b + n, 0), 0);
    const since2017 = cs.reduce((a, k) => a + Object.keys(years[k]).filter(yr => +yr >= 2017).reduce((b, yr) => b + years[k][yr], 0), 0);
    // pay (DL / CDL only: Ban Sahayaks are fixed)
    const pay = maps(divs, (d, k) => k === 'CDL' && d.x && d.x.CDL.pay);
    const payN = divs.reduce((a, d) => a + ((d.x && d.x.CDL.payN) || 0), 0), paySum = divs.reduce((a, d) => a + ((d.x && d.x.CDL.paySum) || 0), 0);
    // where they work
    const place = maps(divs, (d, k) => d.x && d.x[k].place);
    const at = ['HQ', 'Range', 'none'].map(k => cs.reduce((a, cd) => a + divs.reduce((b, d) => b + ((d.x && d.x[cd].at[k]) || 0), 0), 0));
    const mode = maps(divs, (d, k) => k === 'CDL' && d.x && d.x.CDL.mode);
    const placeItems = [...new Set(cs.flatMap(k => Object.keys(place[k])))].map(p => ({ label: p || 'Not filled', v: Object.fromEntries(cs.map(k => [k, place[k][p] || 0])) }));
    // missing
    const miss = maps(divs, (d, k) => d.x && d.x[k].miss);
    const missItems = Object.keys(MISS).map(m => ({ label: MISS[m], v: Object.fromEntries(cs.map(k => [k, miss[k][m] || 0])) }));
    // verifications per day, last 30 days
    const vday = maps(divs, (d, k) => d.x && d.x[k].vday), days = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 864e5), p2 = n => String(n).padStart(2, '0'), key = `${p2(dt.getDate())}-${p2(dt.getMonth() + 1)}-${dt.getFullYear()}`;
      days.push({ key, label: dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), title: dt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        v: Object.fromEntries(cs.map(k => [k, vday[k][key] || 0])) });
    }
    const last7 = days.slice(-7).reduce((a, k) => a + cs.reduce((b, cd) => b + (k.v[cd] || 0), 0), 0);

    root.innerHTML = `
      <div class="head"><div class="grow"><h1>Dashboard</h1><p class="muted">DL / CDL and Ban Sahayaks${S.LIVE ? '' : ' · demo'}</p></div></div>
      <div class="dfilters" role="toolbar" aria-label="Filters">
        <div class="seg">${[['both', 'Both'], ['CDL', 'DL / CDL'], ['BS', 'Ban Sahayaks']].map(([k, t]) => `<button type="button" data-d="cadre" data-v="${k}" class="${f.cadre === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <select data-d="circle" aria-label="Circle"><option value="">All circles</option>${circles.map(ci => `<option ${ci === f.circle ? 'selected' : ''}>${esc(ci)}</option>`).join('')}</select>
        <select data-d="division" aria-label="Division"><option value="">${f.circle ? 'All divisions of ' + esc(f.circle) : 'All divisions'}</option>${divsOfCircle.map(d => `<option ${d === f.division ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        ${f.circle || f.division || f.cadre !== 'both' ? '<button type="button" class="linkbtn" data-d="clear">Clear filters</button>' : ''}
        <span class="sp"></span>${f.division ? `<a class="btn sm" href="#/d/${enc(f.division)}">Open ${esc(f.division)} ›</a>` : ''}
      </div>
      ${noX ? '<div class="banner warn">Some charts need the latest script. In Apps Script, paste the new Code.gs, run cdlSetup, and deploy a new version.</div>' : ''}

      <div class="dtop">
        <div class="dhero"><span class="lab">People working · ${esc(where)}</span><span class="big">${fmt(c.active)}</span>
          ${cs.length > 1 ? split([[NAME.CDL, by.CDL.active, COL.CDL], [NAME.BS, by.BS.active, COL.BS]]) : `<span class="faint">${NAME[cs[0]]}</span>`}</div>
        <div class="dtiles">
          <div class="dtile"><span class="lab">Verified</span><span class="v">${fmt(c.confirmed)} <small>${pct(c.confirmed, c.active)}%</small></span><span class="meter"><i style="width:${pct(c.confirmed, c.active)}%"></i></span></div>
          <div class="dtile"><span class="lab">Ready to verify</span><span class="v">${fmt(c.ready)}</span><span class="faint">all filled, not yet verified</span></div>
          <div class="dtile"><span class="lab">Missing info</span><span class="v warn">${fmt(c.missing)}</span><span class="faint">${pct(c.missing, c.active)}% still to fill</span></div>
          <div class="dtile"><span class="lab">Problems</span><span class="v bad">${fmt(c.problem)}</span><span class="faint">possible double entries</span></div>
          <div class="dtile"><span class="lab">Waiting for approval</span><span class="v">${fmt(pending)}</span><span class="faint"><a href="#/approvals">new people and removals</a></span></div>
          <div class="dtile"><span class="lab">Lists certified</span><span class="v">${fmt(certified)} <small>/ ${fmt(listsWith)}</small></span><span class="faint">by the DFOs</span></div>
          <div class="dtile"><span class="lab">Monthly pay bill</span><span class="v">${bill >= 1e7 ? 'Rs ' + (bill / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' cr' : 'Rs ' + (bill / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' lakh'}</span><span class="faint">${cs.includes('BS') ? 'Ban Sahayaks at Rs 12,000' : 'as in the July 2026 returns'}</span></div>
          ${changed != null ? `<div class="dtile"><span class="lab">Changed from the return</span><span class="v">${fmt(changed)}</span><span class="faint">DL / CDL edited by divisions</span></div>` : ''}
        </div>
      </div>

      ${card(progTitle, f.division ? '' : 'Sorted by share verified. Click a row to look closer.', statusLegend + (progRows.length ? statusRows(progRows) : empty('No one here yet.')), 'wide')}

      <div class="dgrid">
        ${card('Main duty', 'What they do most' + (blank ? ` · <b>${fmt(blank)}</b> not filled yet` : '') + '. Point at a bar for those who do it as an other duty.', legend(cs) + hbars(dutyItems))}
        ${card('Duty mix', 'Share of each ' + (f.circle || f.division ? 'division' : 'circle') + '’s people by main duty', heat(heatRows, S.DUTIES))}
        ${card('When they were engaged', engaged ? `<b>${pct(since2017, engaged)}%</b> engaged in 2017 or later` : '', legend(cs) + columns(yearCats, { every: 5, peak: true, empty: 'No engagement dates yet.' }))}
        ${card('Monthly pay', cs.includes('CDL') ? (payN ? `DL / CDL · average <b>Rs ${fmt(paySum / payN)}</b> · Ban Sahayaks are fixed at Rs 12,000` : 'DL / CDL') : 'Ban Sahayaks',
          cs.includes('CDL') ? columns(PAY.map(b => ({ key: b, label: b.replace('-', '–'), title: 'Rs ' + PAY_LABEL[b], v: { CDL: pay.CDL[b] || 0 } })), { cadres: ['CDL'], color: COL.CDL, cls: 'wide', empty: 'No pay filled yet.' })
            : empty('Every Ban Sahayak is paid a fixed Rs 12,000 a month.'))}
        ${card('Where they work', 'Posted at, then the place of work', split([['Range', at[1], '#1baf7a'], ['Division HQ', at[0], '#e87ba4'], ['Not filled', at[2], '#c3c2b7']]) +
          (cs.includes('CDL') ? `<p class="dsub">How DL / CDL are engaged</p>` + split([['Direct', mode.CDL.Direct || 0, '#6250d6'], ['Through agency', mode.CDL['Through agency'] || 0, '#eda100'], ['Not filled', mode.CDL[''] || 0, '#c3c2b7']]) : '') +
          `<p class="dsub">Place of work</p>` + legend(cs) + hbars(placeItems))}
        ${card('What is still missing', 'People with each detail not filled. These are what divisions need to fill.', legend(cs) + hbars(missItems, { empty: 'Nothing missing. Everyone has every detail.' }))}
      </div>

      ${card('Verifications in the last 30 days', `<b>${fmt(last7)}</b> in the last 7 days · counted on the day of each verified person’s last save`, legend(cs) + columns(days, { every: 7, unit: 'verified', cls: 'days', empty: 'No verifications in the last 30 days.' }), 'wide')}

      ${card('Divisions', 'Click a heading to sort, a division to open it.', table(divs), 'wide')}
      <div class="dtipbox" role="tooltip" hidden></div>`;
    window.scrollTo(0, y);
  }

  function table(divs) {
    const cs = cadres();
    const key = s => { const m = /^(\d{2})-(\d{2})-(\d{4})\s*(.*)$/.exec(s || ''); return m ? m[3] + m[2] + m[1] + m[4] : ''; };
    const rows = divs.map(d => {
      const c = counts([d]);
      return { d, c, pct: pct(c.confirmed, c.active), last: [d.last && d.last.CDL, d.last && d.last.BS].filter(Boolean).sort((a, b) => key(b).localeCompare(key(a)))[0] || '' };
    }).filter(r => r.c.active || f.division);
    // [value, first click's direction]: names A–Z; numbers and dates largest first
    const val = { division: [r => r.d.division, 1], circle: [r => r.d.circle + r.d.division, 1], people: [r => r.c.active, -1], verified: [r => r.pct * 100000 + r.c.active, -1],
      missing: [r => r.c.missing, -1], problem: [r => r.c.problem, -1], last: [r => key(r.last), -1] };
    const [sv, nat] = val[f.sort] || val.verified;
    rows.sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * nat * f.dir; });
    const th = (k, t) => `<th><button type="button" data-d="sort" data-v="${k}" class="${f.sort === k ? 'on' : ''}">${t}${f.sort === k ? (f.dir > 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
    if (!rows.length) return empty('No one here yet.');
    return `<div style="overflow-x:auto"><table class="plain dtable"><thead><tr>${th('division', 'Division')}${th('circle', 'Circle')}${th('people', 'People')}${th('verified', 'Verified')}${th('missing', 'Missing')}${th('problem', 'Problems')}
      ${rows[0].d.users != null ? '<th>Users</th>' : ''}<th>Certified</th>${th('last', 'Last change')}</tr></thead><tbody>
      ${rows.map(r => `<tr data-d="open" data-v="${esc(r.d.division)}" tabindex="0">
        <td><a href="#/d/${enc(r.d.division)}"><b>${esc(r.d.division)}</b></a></td><td class="faint">${esc(r.d.circle)}</td>
        <td class="num">${fmt(r.c.active)}${cs.length > 1 && r.d.BS && r.d.BS.active ? `<div class="faint nw">${fmt(r.d.CDL.active)} · ${fmt(r.d.BS.active)} BS</div>` : ''}</td>
        <td><span class="tm"><span class="meter"><i style="width:${r.pct}%"></i></span><b>${r.pct}%</b></span></td>
        <td class="num">${r.c.missing ? fmt(r.c.missing) : '<span class="faint">0</span>'}</td><td class="num">${r.c.problem ? `<span class="pill problem">${fmt(r.c.problem)}</span>` : '<span class="faint">0</span>'}</td>
        ${r.d.users != null ? `<td class="num">${r.d.users ? fmt(r.d.users) : '<span class="pill missing">none</span>'}</td>` : ''}
        <td>${cs.map(k => r.d.certs && r.d.certs[k] ? `<span class="pill confirmed">${k === 'BS' ? 'BS' : 'CDL'} ✓</span>` : '').join(' ') || '<span class="faint">—</span>'}</td>
        <td class="faint num">${esc((r.last || '').slice(0, 10)) || '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------------------------------------------------------------- filters and hover */
  function onAct(t) {
    const a = t.dataset.d, v = t.dataset.v;
    if (a === 'cadre') f.cadre = v;
    else if (a === 'circle') { f.circle = v; f.division = ''; }
    else if (a === 'division') { f.division = v; if (v) f.circle = (S.dashData().find(d => d.division === v) || {}).circle || f.circle; }
    else if (a === 'clear') Object.assign(f, { cadre: 'both', circle: '', division: '' });
    else if (a === 'sort') { if (f.sort === v) f.dir = -f.dir; else { f.sort = v; f.dir = 1; } }
    else if (a === 'open') { location.hash = '#/d/' + enc(v); return; }
    else return;
    render();
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-d]'); if (!t || !root || !root.contains(t) || t.tagName === 'SELECT') return;
    if (e.target.closest('a')) return;
    onAct(t);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest && e.target.closest('[data-d][tabindex]'); if (!t || !root || !root.contains(t)) return;
    e.preventDefault(); onAct(t);
  });
  document.addEventListener('change', e => { const t = e.target; if (root && root.contains(t) && t.dataset.d) { t.dataset.v = t.value; onAct(t); } });
  // one tooltip for every mark: value first, then what it is
  function showTip(m, x, y) {
    const box = root && root.querySelector('.dtipbox'); if (!box) return;
    let d; try { d = JSON.parse(m.dataset.tip); } catch (err) { return; }
    box.textContent = '';
    const h = document.createElement('div'); h.className = 'tt'; h.textContent = d[0]; box.appendChild(h);
    d[1].forEach(r => {
      const row = document.createElement('div'); row.className = 'tr';
      if (r[0]) { const k = document.createElement('i'); k.style.background = r[0]; row.appendChild(k); }
      const b = document.createElement('b'); b.textContent = r[1]; row.appendChild(b);
      const s = document.createElement('span'); s.textContent = r[2]; row.appendChild(s);
      box.appendChild(row);
    });
    box.hidden = false;
    const w = box.offsetWidth, hgt = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 14)) + 'px';
    box.style.top = (y + hgt + 24 > innerHeight ? y - hgt - 12 : y + 16) + 'px';
  }
  document.addEventListener('pointermove', e => {
    if (!root) return;
    const m = e.target.closest && e.target.closest('[data-tip]');
    const box = root.querySelector('.dtipbox'); if (!box) return;
    if (m && root.contains(m)) { showTip(m, e.clientX, e.clientY); root.querySelectorAll('.lift').forEach(x => x !== m && x.classList.remove('lift')); m.classList.add('lift'); }
    else { box.hidden = true; root.querySelectorAll('.lift').forEach(x => x.classList.remove('lift')); }
  });
  document.addEventListener('scroll', () => { const box = root && root.querySelector('.dtipbox'); if (box) box.hidden = true; }, true);

  window.CDL_DASH = { render };
})();
