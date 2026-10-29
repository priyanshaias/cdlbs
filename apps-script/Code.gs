/**
 * CDL+BS Verification and Update — JSON API for the GitHub-hosted website.
 * Divisions check their DLs / CDLs (pre-filled from the July 2026 returns) and enter their Ban Sahayaks.
 * Edits save straight in, one person at a time; new DLs / CDLs and removals wait for an admin; the DFO certifies each list.
 * Every change is written to the Change Log with who made it.
 * Data: its own Google Sheet — tabs DL-CDL, Ban Sahayak, Change Log, Certificates, Lists, Users.
 * Auth: division users sign up with their email (confirmed by a code sent to it) and a password, kept as a salted hash in the Users tab;
 * admins are in Config.local.gs (not in GitHub). The server issues a session token kept in the script cache.
 * A division user can change only their own division.
 * Deploy: Web app · Execute as: Me · Who has access: Anyone.
 */

const CONFIG = { TZ: 'Asia/Kolkata', PROP: 'CDLBS_SHEET_ID', TAB: { CDL: 'DL-CDL', BS: 'Ban Sahayak' }, LOG: 'Change Log', CERT: 'Certificates', LISTS: 'Lists', USERS: 'Users' };
const SESSION_HOURS = 6, MAX_FAILS = 5, LOCK_MIN = 15, CACHE_SEC = 6 * 3600, CODE_MIN = 30, HASH_ROUNDS = 500;
const APP_NAME = 'CDL+BS Verification and Update';
const USER_HEADERS = ['Email', 'Circle', 'Division', 'Name', 'Designation', 'Phone', 'Status', 'Signed up on', 'Last sign-in', 'Salt', 'Password hash'];

// [key, sheet header]; the order is the column order of both people tabs. Columns are found by heading, so moving one is safe.
const COLS = [
  ['id', 'ID'], ['circle', 'Circle'], ['division', 'Division'], ['name', 'Name'], ['mode', 'Mode of engagement'], ['agency', 'Agency name'],
  ['date', 'Engagement date'], ['district', 'District'], ['range', 'Range (or Division HQ)'], ['beat', 'Beat'], ['place', 'Place of work'],
  ['placeName', 'Name of the place'], ['duty', 'Main duty'], ['other', 'Other duties'], ['details', 'Duty details'], ['pay', 'Monthly pay (Rs)'],
  ['remarks', 'Remarks'], ['ver', 'Verification'], ['state', 'Status'], ['flag', 'Problem'], ['removal', 'Removal request'],
  ['updOn', 'Last updated on'], ['updBy', 'Last updated by'], ['orig', 'As in the return (do not edit)'],
];
const LABEL = { name: 'Name', mode: 'Mode of engagement', agency: 'Agency name', date: 'Engagement date', district: 'District', range: 'Range',
  beat: 'Beat', place: 'Place of work', placeName: 'Name of the place', duty: 'Main duty', other: 'Other duties', details: 'Duty details',
  pay: 'Monthly pay, July 2026 (Rs)', remarks: 'Remarks' };
const EDITABLE = Object.keys(LABEL);
const LOG_HEADERS = ['When', 'Username', 'By', 'Circle', 'Division', 'Cadre', 'ID', 'Person', 'Action', 'Field', 'Old value', 'New value'];
const CERT_HEADERS = ['Division', 'Cadre', 'Certified by', 'Designation', 'On', 'Entered by'];
// Status column: words in the sheet, codes in the website
const STATE = { active: 'Working', 'add-pending': 'New - awaiting approval', 'remove-pending': 'Removal pending', removed: 'Removed' };
const STATE_OF = Object.keys(STATE).reduce((a, k) => (a[STATE[k]] = k, a), {});

// the same rules as store.js in the website
const DUTIES = ['Cleaning/Sweeping/Maintenance', 'Nursery Operations', 'Timber Depot', 'Driver', 'Mali/Gardener',
  'Forest Protection and Patrolling', 'Human-Animal Conflict Management', 'Night Guard/Security', 'Others'];
const HQ = 'Division HQ', BS_PAY = 12000;
const REQUIRED = { CDL: ['name', 'mode', 'date', 'district', 'range', 'place', 'duty', 'pay'], BS: ['name', 'date', 'district', 'range', 'place', 'duty'] };
const VAGUE = /^\s*(do|d\.o\.?|various|variouss|misc\.?|miscellaneous|other|others|field work|field duty|forestry work|general|all work|-)?\s*$/i;
const CADRE_NAME = { CDL: 'DL / CDL', BS: 'Ban Sahayak' };

function local_() {
  const L = (typeof LOCAL_CONFIG !== 'undefined') ? LOCAL_CONFIG : {};
  return { accounts: L.ACCOUNTS || {}, sheetId: L.SHEET_ID || '' };
}

/* ============================================================ HTTP */

function doGet() { return json_({ ok: true, app: 'CDL+BS API', time: now_() }); }

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'logout') { logout_(body.token); return json_({ ok: true, data: {} }); }
    // before sign-in
    const open = { login: login_, lists: lists_, divisionUsers: divisionUsers_, signupStart: signupStart_, signupVerify: signupVerify_,
      forgotStart: forgotStart_, forgotVerify: forgotVerify_ };
    if (open[body.action]) return json_({ ok: true, data: open[body.action](body) });
    const user = authenticate_(body.token);
    const handlers = { meta: meta_, load: load_, update: update_, confirm: confirm_, unconfirm: unconfirm_, notWorking: notWorking_,
      undoRemoval: undoRemoval_, resolveFlag: resolveFlag_, add: add_, certify: certify_,
      pending: pending_, decide: decide_, reopen: reopen_, log: log_, users: users_, userStatus: userStatus_, userPassword: userPassword_ };
    const fn = handlers[body.action];
    if (!fn) throw new Error('Unknown action: ' + body.action);
    if (['pending', 'decide', 'reopen', 'log', 'users', 'userStatus', 'userPassword'].indexOf(body.action) >= 0 && !user.isAdmin) throw new Error('Only administrators can do this.');
    return json_({ ok: true, data: fn(body, user) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err), conflict: !!(err && err.conflict) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ============================================================ auth */

function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

/** Division users' passwords: salted SHA-256, repeated, so a copied sheet does not give the passwords away. */
function pwHash_(salt, pw) {
  let h = sha256hex_(salt + pw);
  for (let i = 1; i < HASH_ROUNDS; i++) h = sha256hex_(salt + h);
  return h;
}
const newSalt_ = () => Utilities.getUuid().replace(/-/g, '');
const who_ = u => u.name + (u.desig ? ' (' + u.desig + ')' : '');
const cleanEmail_ = s => String(s || '').trim().toLowerCase();
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * {username or email, password} -> {token, user}. Admins (Config.local.gs) sign in with their username,
 * division users with their email. Wrong attempts lock that name for LOCK_MIN minutes.
 */
function login_(body) {
  const cache = CacheService.getScriptCache();
  const u = cleanEmail_(body.username), pw = String(body.password || '');
  if (!u || !pw) throw new Error('Enter your email and password.');
  const failKey = 'fail_' + u, fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Try again after ' + LOCK_MIN + ' minutes, or reset your password.');
  const wrong = () => { cache.put(failKey, String(fails + 1), LOCK_MIN * 60); return new Error('Wrong email or password.'); };
  let user;
  const acc = local_().accounts[u];
  if (acc) {
    if (sha256hex_(acc.salt + pw) !== acc.hash) throw wrong();
    user = { name: acc.name || u, role: acc.role === 'admin' ? 'admin' : 'operator', isAdmin: acc.role === 'admin', username: u };
    PropertiesService.getScriptProperties().setProperty('last|' + u, now_());   // shown on the admin Users page
  } else {
    const t = readUsers_(), r = t.rows.find(x => x.email === u);
    if (!r || pwHash_(r.salt, pw) !== r.hash) throw wrong();
    if (r.status !== 'Active') throw new Error('This account is disabled. Please contact the PMC admin.');
    t.sh.getRange(r._r, USER_HEADERS.indexOf('Last sign-in') + 1).setNumberFormat('@').setValue(now_());
    CacheService.getScriptCache().remove('off|' + u);
    user = userOf_(r);
  }
  cache.remove(failKey);
  return session_(user);
}
function userOf_(r) {
  return { name: r.name, role: 'operator', isAdmin: false, username: r.email, email: r.email, circle: r.circle, division: r.division, desig: r.desig, phone: r.phone };
}
function session_(user) {
  const token = 'cb.' + Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(user), SESSION_HOURS * 3600);
  return { token, user };
}
function logout_(token) { if (token) CacheService.getScriptCache().remove('sess_' + token); }
function authenticate_(token) {
  if (!token || String(token).indexOf('cb.') !== 0) throw new Error('Please sign in.');
  const cache = CacheService.getScriptCache(), s = cache.get('sess_' + token);
  if (!s) throw new Error('Your sign-in has expired. Please sign in again.');
  const user = JSON.parse(s);
  if (user.email && cache.get('off|' + user.email)) { cache.remove('sess_' + token); throw new Error('This account is disabled. Please sign in again.'); }
  return user;
}
/** A division user may change only their own division (admins and the older shared accounts: any). */
function mayEdit_(user, division) {
  if (user.isAdmin || !user.division || user.division === division) return;
  throw new Error('You can change only ' + user.division + '. ' + division + ' is for its own users.');
}

/* ============================================================ sign-up, password reset, users */

function readUsers_() {
  const sh = tab_(CONFIG.USERS), v = sh.getDataRange().getValues(), rows = [];
  const head = (v[0] || []).map(h => String(h).trim()), at = k => head.indexOf(k);
  const keys = ['email', 'circle', 'division', 'name', 'desig', 'phone', 'status', 'on', 'last', 'salt', 'hash'];
  for (let r = 1; r < v.length; r++) {
    const o = { _r: r + 1 }; keys.forEach((k, j) => { const i = at(USER_HEADERS[j]); o[k] = i < 0 ? '' : fmtTs_(v[r][i]); });
    o.email = cleanEmail_(o.email); if (o.email) rows.push(o);
  }
  return { sh, rows };
}
/** Circles and divisions for the sign-up form. */
function lists_() { return { divisions: divisions_() }; }
/** How many users a division already has (for the "only 1 person per division" note). */
function divisionUsers_(body) {
  const d = String(body.division || '');
  return { count: readUsers_().rows.filter(r => r.division === d && r.status === 'Active').length };
}
function code6_() { return String(Math.floor(100000 + Math.random() * 900000)); }
function mail_(to, subject, text) { MailApp.sendEmail({ to, subject, body: text, name: APP_NAME }); }
/** Checks a code sent by email; five wrong tries and it is gone. */
function takeCode_(key, code) {
  const cache = CacheService.getScriptCache(), s = cache.get(key);
  if (!s) throw new Error('The code has expired. Please ask for a new one.');
  const o = JSON.parse(s);
  if (String(code || '').trim() !== o.code) {
    o.tries = (o.tries || 0) + 1;
    if (o.tries >= 5) cache.remove(key); else cache.put(key, JSON.stringify(o), CODE_MIN * 60);
    throw new Error(o.tries >= 5 ? 'Too many wrong codes. Please ask for a new one.' : 'That code is not right. Please check the email.');
  }
  cache.remove(key);
  return o;
}

/** Step 1 of sign-up: checks the form and emails a 6-digit code. Nothing is saved until the code is entered. */
function signupStart_(body) {
  const email = cleanEmail_(body.email), name = String(body.name || '').replace(/\s+/g, ' ').trim();
  const desig = String(body.desig || '').replace(/\s+/g, ' ').trim(), phone = String(body.phone || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const pw = String(body.password || '');
  const div = divisions_().find(d => d.division === String(body.division || '') && d.circle === String(body.circle || ''));
  if (!div) throw new Error('Choose your circle and division.');
  if (!EMAIL_OK.test(email)) throw new Error('Write a valid email address.');
  if (name.length < 3) throw new Error('Write your name.');
  if (desig.length < 2) throw new Error('Write your designation.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Write a 10-digit mobile number.');
  if (pw.length < 8) throw new Error('The password must have at least 8 characters.');
  if (local_().accounts[email] || readUsers_().rows.some(r => r.email === email)) throw new Error('This email already has an account. Sign in, or use "Forgot password".');
  const code = code6_(), salt = newSalt_();
  CacheService.getScriptCache().put('su|' + email, JSON.stringify({ code, user: { email, circle: div.circle, division: div.division, name, desig, phone, salt, hash: pwHash_(salt, pw) } }), CODE_MIN * 60);
  mail_(email, APP_NAME + ': your sign-up code', 'Your sign-up code is ' + code + '.\nIt is valid for ' + CODE_MIN + ' minutes.\n\nDivision: ' + div.division + '\n\nIf you did not sign up, ignore this email.');
  return { sent: true };
}
/** Step 2 of sign-up: the code from the email creates the account and signs in. */
function signupVerify_(body) {
  const email = cleanEmail_(body.email), o = takeCode_('su|' + email, body.code), u = o.user;
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = readUsers_();
    if (t.rows.some(r => r.email === email)) throw new Error('This email already has an account. Please sign in.');
    const row = USER_HEADERS.map(() => ''), set = (h, v) => { row[USER_HEADERS.indexOf(h)] = v; };
    set('Email', email); set('Circle', u.circle); set('Division', u.division); set('Name', u.name); set('Designation', u.desig); set('Phone', u.phone);
    set('Status', 'Active'); set('Signed up on', now_()); set('Last sign-in', now_()); set('Salt', u.salt); set('Password hash', u.hash);
    t.sh.getRange(t.sh.getLastRow() + 1, 1, 1, USER_HEADERS.length).setNumberFormat('@').setValues([row]);
  } finally { lock.releaseLock(); }
  return session_(userOf_(u));
}
/** Forgot password, step 1: emails a code if the account exists (the answer is the same either way). */
function forgotStart_(body) {
  const email = cleanEmail_(body.email);
  if (!EMAIL_OK.test(email)) throw new Error('Write the email you signed up with.');
  const r = readUsers_().rows.find(x => x.email === email && x.status === 'Active');
  if (r) {
    const code = code6_();
    CacheService.getScriptCache().put('rs|' + email, JSON.stringify({ code }), CODE_MIN * 60);
    mail_(email, APP_NAME + ': password reset code', 'Your password reset code is ' + code + '.\nIt is valid for ' + CODE_MIN + ' minutes.\n\nIf you did not ask for this, ignore this email; your password stays the same.');
  }
  return { sent: true };
}
/** Forgot password, step 2: the code and a new password. */
function forgotVerify_(body) {
  const email = cleanEmail_(body.email), pw = String(body.password || '');
  if (pw.length < 8) throw new Error('The password must have at least 8 characters.');
  takeCode_('rs|' + email, body.code);
  setPassword_(email, pw);
  CacheService.getScriptCache().remove('fail_' + email);
  return { done: true };
}
function setPassword_(email, pw) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = readUsers_(), r = t.rows.find(x => x.email === email);
    if (!r) throw new Error('No account with this email.');
    const salt = newSalt_();
    t.sh.getRange(r._r, USER_HEADERS.indexOf('Salt') + 1, 1, 2).setNumberFormat('@').setValues([[salt, pwHash_(salt, pw)]]);
  } finally { lock.releaseLock(); }
}

/**
 * Admins: every division user (without password hashes) and the accounts in Config.local.gs (admins and shared ones),
 * which are not tied to a division and are changed only in that file.
 */
function users_() {
  const rows = readUsers_().rows.map(r => ({ email: r.email, circle: r.circle, division: r.division, name: r.name, desig: r.desig, phone: r.phone, status: r.status, on: r.on, last: r.last }));
  const props = PropertiesService.getScriptProperties(), accs = local_().accounts;
  const accounts = Object.keys(accs).map(u => ({ username: u, name: accs[u].name || u, role: accs[u].role === 'admin' ? 'admin' : 'operator', last: props.getProperty('last|' + u) || '' }));
  return { rows, accounts, divisions: divisions_() };
}
function userStatus_(body, user) {
  const email = cleanEmail_(body.email), on = !!body.active;
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const t = readUsers_(), r = t.rows.find(x => x.email === email);
    if (!r) throw new Error('No account with this email.');
    t.sh.getRange(r._r, USER_HEADERS.indexOf('Status') + 1).setNumberFormat('@').setValue(on ? 'Active' : 'Disabled');
    if (on) CacheService.getScriptCache().remove('off|' + email); else CacheService.getScriptCache().put('off|' + email, '1', SESSION_HOURS * 3600);
    log_rows_(user, [{ circle: r.circle, division: r.division, type: on ? 'User enabled' : 'User disabled', new: r.name + ' <' + email + '>' }]);
  } finally { lock.releaseLock(); }
  return users_();
}
function userPassword_(body, user) {
  const email = cleanEmail_(body.email), pw = String(body.password || '');
  if (pw.length < 8) throw new Error('The password must have at least 8 characters.');
  setPassword_(email, pw);
  const r = readUsers_().rows.find(x => x.email === email);
  log_rows_(user, [{ circle: r.circle, division: r.division, type: 'Password set by admin', new: r.name + ' <' + email + '>' }]);
  return { done: true };
}

/* ============================================================ helpers */

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function fmt_(v) {
  if (v === null || v === undefined) return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CONFIG.TZ, 'dd-MM-yyyy');
  return String(v).trim();
}
function fmtTs_(v) { return isDate_(v) ? Utilities.formatDate(v, CONFIG.TZ, 'dd-MM-yyyy HH:mm') : fmt_(v); }
// seconds too, so two saves in the same minute are still told apart
function now_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'dd-MM-yyyy HH:mm:ss'); }
function cadreOf_(id) { return /^BS-/.test(String(id)) ? 'BS' : 'CDL'; }
function err_(msg, conflict) { const e = new Error(msg); e.conflict = !!conflict; return e; }
/** "dd-mm-yyyy HH:mm" -> sortable "yyyymmddHHmm" */
function sortKey_(s) { const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?/.exec(s || ''); return m ? m[3] + m[2] + m[1] + (m[4] || '00') + (m[5] || '00') : ''; }

/** Value as the website keeps it (same as fmt in store.js), for comparing and logging. */
function show_(f, v) { return f === 'other' ? (v || []).join(', ') : v == null ? '' : String(v); }

/* ============================================================ sheet */

/**
 * Run once from the editor (and again after updating the script): checks the sheet, logs its link and the numbers in it,
 * fills the cache, and sets up the 10-minute timer that keeps the cache filled (warm).
 */
function cdlSetup() {
  const ss = ss_();
  Logger.log('CDL+BS sheet: ' + ss.getUrl());
  Logger.log('DL / CDL rows: ' + readTab_('CDL').rows.length + ' · Ban Sahayaks: ' + readTab_('BS').rows.length + ' · divisions: ' + divisions_(true).length);
  Logger.log('Users: ' + Object.keys(local_().accounts).join(', '));
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'warm')) {
    ScriptApp.newTrigger('warm').timeBased().everyMinutes(10).create();
    Logger.log('Timer set: warm() runs every 10 minutes.');
  }
  buildAll_();
  Logger.log('Cache filled.');
}
/** Every 10 minutes (timer from cdlSetup): refills the cache before it expires, so no one waits for the whole sheet to be read. */
function warm() {
  if (gzGet_('meta') && CacheService.getScriptCache().get('warm')) return;
  buildAll_();
}

/**
 * The CDL+BS sheet: SHEET_ID from Config.local.gs, else the sheet this script was opened from
 * (Extensions → Apps Script), else the one cdlSetup() created earlier, else a new one. Missing tabs are added.
 */
let SS_ = null;   // opened once per request
function ss_() {
  if (SS_) return SS_;
  const props = PropertiesService.getScriptProperties();
  const fixed = local_().sheetId || props.getProperty(CONFIG.PROP);
  if (fixed) return (SS_ = tabs_(SpreadsheetApp.openById(fixed)));
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) { props.setProperty(CONFIG.PROP, bound.getId()); return tabs_(bound); }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const id = props.getProperty(CONFIG.PROP);
    if (id) return tabs_(SpreadsheetApp.openById(id));
    const ss = SpreadsheetApp.create('CDL+BS Verification and Update');
    props.setProperty(CONFIG.PROP, ss.getId());
    return tabs_(ss);
  } finally { lock.releaseLock(); }
}
/** Adds any missing tab with its headings. */
function tabs_(ss) {
  const want = [[CONFIG.TAB.CDL, COLS.map(c => c[1])], [CONFIG.TAB.BS, COLS.map(c => c[1])], [CONFIG.LOG, LOG_HEADERS],
    [CONFIG.CERT, CERT_HEADERS], [CONFIG.LISTS, ['Circle', 'Division']], [CONFIG.USERS, USER_HEADERS]];
  if (want.every(w => ss.getSheetByName(w[0]))) return ss;
  want.forEach(([name, headers]) => {
    if (ss.getSheetByName(name)) return;
    const first = ss.getSheets()[0];
    const sh = ss.getSheets().length === 1 && first.getLastRow() === 0 && want.every(w => w[0] !== first.getName()) ? first.setName(name) : ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setWrap(true);
    sh.setFrozenRows(1);
  });
  return ss;
}
function tab_(name) { return ss_().getSheetByName(name); }

/** All rows of one people tab, each with _r (its row number in the sheet). */
function readTab_(cadre) {
  const sh = tab_(CONFIG.TAB[cadre]), v = sh.getDataRange().getValues();
  const head = (v[0] || []).map(h => String(h).trim()), at = COLS.map(c => head.indexOf(c[1]));
  const rows = [];
  for (let r = 1; r < v.length; r++) { const o = rowObj_(cadre, at, v[r], r + 1); if (o.id) rows.push(o); }
  return { sh, head, rows };
}
function rowObj_(cadre, at, row, r) {
  const o = { cadre, _r: r };
  COLS.forEach((c, j) => { o[c[0]] = at[j] < 0 ? '' : (c[0] === 'updOn' ? fmtTs_(row[at[j]]) : fmt_(row[at[j]])); });
  return fromSheet_(o);
}
/** One person by ID without reading the whole tab: the ID column, then that one row. Same shape as readTab_. */
function findPerson_(id) {
  const cadre = cadreOf_(id), sh = tab_(CONFIG.TAB[cadre]), last = sh.getLastRow();
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const t = { sh, head, rows: [] };
  if (last < 2) return t;
  const ids = sh.getRange(2, head.indexOf('ID') + 1, last - 1, 1).getValues(), at = COLS.map(c => head.indexOf(c[1]));
  for (let i = 0; i < ids.length; i++) {
    if (fmt_(ids[i][0]) === id) { t.rows.push(rowObj_(cadre, at, sh.getRange(i + 2, 1, 1, head.length).getValues()[0], i + 2)); break; }
  }
  return t;
}
function fromSheet_(o) {
  o.other = o.other ? o.other.split(/\s*;\s*/).filter(Boolean) : [];
  o.pay = o.pay === '' ? null : Number(String(o.pay).replace(/[^\d.]/g, '')) || null;
  o.state = STATE_OF[o.state] || o.state || 'active';
  o.ver = o.ver ? 'Confirmed' : '';
  o.removal = o.removal ? safeJson_(o.removal) : null;
  o.orig = o.orig ? safeJson_(o.orig) : null;
  if (o.cadre === 'BS') { o.pay = BS_PAY; o.mode = 'Direct'; }
  return o;
}
function safeJson_(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function toSheet_(o, head) {
  const val = {
    other: (o.other || []).join('; '), pay: o.pay == null ? '' : o.pay, ver: o.ver ? 'Verified' : '', state: STATE[o.state] || o.state,
    removal: o.removal ? JSON.stringify(o.removal) : '', orig: o.orig ? JSON.stringify(o.orig) : '' };
  const row = head.map(() => '');
  COLS.forEach(c => { const i = head.indexOf(c[1]); if (i >= 0) row[i] = c[0] in val ? val[c[0]] : (o[c[0]] == null ? '' : o[c[0]]); });
  return row;
}
/** Writes rows that already exist in the sheet (each by its _r) and appends new ones. Everything is plain text. */
function writeRows_(t, rows) {
  rows.forEach(o => {
    const values = [toSheet_(o, t.head)];
    if (!o._r) o._r = t.sh.getLastRow() + 1;
    t.sh.getRange(o._r, 1, 1, t.head.length).setNumberFormat('@').setValues(values);
  });
}
/** What the website gets: everything except the row number. */
function pub_(o) { const p = Object.assign({}, o); delete p._r; return p; }

/** Circles and divisions from the Lists tab (quick: the people tabs are not read). withPeople: also any division that has people. */
function divisions_(withPeople) {
  const out = [], seen = {};
  const add = (c, d) => { if (c && d && !seen[d]) { seen[d] = 1; out.push({ circle: c, division: d }); } };
  tab_(CONFIG.LISTS).getDataRange().getValues().slice(1).forEach(r => add(fmt_(r[0]), fmt_(r[1])));
  if (withPeople) ['CDL', 'BS'].forEach(c => readTab_(c).rows.forEach(r => add(r.circle, r.division)));
  return out;
}

function certs_() {
  const v = tab_(CONFIG.CERT).getDataRange().getValues(), out = {};
  v.slice(1).forEach(r => { const d = fmt_(r[0]); if (d) out[d + '|' + (fmt_(r[1]) || 'CDL')] = { name: fmt_(r[2]), desig: fmt_(r[3]), on: fmtTs_(r[4]), by: fmt_(r[5]) }; });
  return out;
}
const locked_ = (div, cadre) => !!certs_()[div + '|' + cadre];

function log_rows_(user, entries) {
  if (!entries.length) return;
  const when = now_(), lg = tab_(CONFIG.LOG);
  const by = (user.name || '') + (user.desig ? ' (' + user.desig + (user.division ? ', ' + user.division : '') + ')' : '');
  const rows = entries.map(x => [when, user.username || '', by, x.p ? x.p.circle : x.circle || '', x.p ? x.p.division : x.division || '',
    CADRE_NAME[x.p ? x.p.cadre : x.cadre] || '', x.p ? x.p.id : '', x.p ? x.p.name : '', x.type, x.field || '', x.old || '', x.new || '']);
  lg.getRange(lg.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setNumberFormat('@').setValues(rows);
}

/* ============================================================ cache */

// Each division's people and the summary are cached (gzipped, split into pieces under the 100 KB limit).
// A change updates the cached division and its line of the summary instead of throwing them away, so reads stay quick.
const PIECE = 90000;
function gzPut_(key, obj) {
  const s = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
  const parts = {}, n = Math.ceil(s.length / PIECE) || 1;
  for (let i = 0; i < n; i++) parts[key + '#' + i] = s.slice(i * PIECE, (i + 1) * PIECE);
  parts[key] = 'parts:' + n;
  CacheService.getScriptCache().putAll(parts, CACHE_SEC);
}
function gzGet_(key) {
  const c = CacheService.getScriptCache(), head = c.get(key);
  if (!head || head.indexOf('parts:') !== 0) return null;
  const keys = []; for (let i = 0; i < +head.slice(6); i++) keys.push(key + '#' + i);
  const got = c.getAll(keys); if (keys.some(k => !got[k])) return null;
  try { return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(keys.map(k => got[k]).join('')), 'application/x-gzip')).getDataAsString()); } catch (e) { return null; }
}
/** Reads both people tabs once and caches every division and the summary. */
function buildAll_() {
  const divs = divisions_(), seen = {}, by = {};
  divs.forEach(d => { seen[d.division] = 1; by[d.division] = []; });
  ['CDL', 'BS'].forEach(c => readTab_(c).rows.forEach(p => {
    if (!seen[p.division]) { seen[p.division] = 1; divs.push({ circle: p.circle, division: p.division }); by[p.division] = []; }
    if (p.state !== 'removed') by[p.division].push(pub_(p));
  }));
  divs.forEach(d => gzPut_('div|' + d.division, by[d.division]));
  const m = { divisions: divs.map(d => Object.assign({ circle: d.circle, division: d.division }, summary_(by[d.division]))), certs: certs_() };
  gzPut_('meta', m);
  CacheService.getScriptCache().put('warm', '1', CACHE_SEC - 3600);
  return { m, by };
}
/** A division's line of the summary, from its people (both cadres). */
function summary_(rows) {
  const o = { CDL: count0_(), BS: count0_(), last: { CDL: '', BS: '' }, duty: { CDL: {}, BS: {} }, blank: { CDL: 0, BS: 0 }, pending: 0 };
  rows.forEach(p => {
    const c = p.cadre === 'BS' ? 'BS' : 'CDL', s = status_(p); if (s === 'removed') return;
    const k = o[c]; k.all++; k[s]++; if (p.state === 'add-pending') k.added++;
    if (p.state === 'add-pending' || p.state === 'remove-pending') o.pending++;
    if (s !== 'remove') { if (p.duty) o.duty[c][p.duty] = (o.duty[c][p.duty] || 0) + 1; else o.blank[c]++; }
    if (sortKey_(p.updOn) > sortKey_(o.last[c])) o.last[c] = p.updOn;
  });
  ['CDL', 'BS'].forEach(c => { o[c].active = o[c].all - o[c].remove; });
  return o;
}
/** After a change: puts the changed people into the cached division and updates its line of the summary. */
function refreshCache_(division, changed) {
  const rows = gzGet_('div|' + division);
  if (!rows) { CacheService.getScriptCache().remove('meta'); return; }   // rebuilt on the next read
  changed.forEach(p => {
    const q = pub_(p), i = rows.findIndex(r => r.id === q.id);
    if (q.state === 'removed') { if (i >= 0) rows.splice(i, 1); } else if (i >= 0) rows[i] = q; else rows.push(q);
  });
  gzPut_('div|' + division, rows);
  const m = gzGet_('meta'), d = m && m.divisions.find(x => x.division === division);
  if (!d) { CacheService.getScriptCache().remove('meta'); return; }
  Object.assign(d, summary_(rows));
  gzPut_('meta', m);
}
/** After certifying or reopening: the certificates in the cached summary. */
function refreshCerts_() { const m = gzGet_('meta'); if (m) { m.certs = certs_(); gzPut_('meta', m); } }

/* ============================================================ rules (same as store.js) */

const blank_ = v => v == null || (Array.isArray(v) ? !v.length : !String(v).trim());
function missing_(p) {
  const m = REQUIRED[p.cadre === 'BS' ? 'BS' : 'CDL'].filter(f => blank_(p[f]));
  if (p.duty === 'Others' && (blank_(p.details) || VAGUE.test(p.details) || String(p.details).trim().length < 10)) m.push('details');
  return m;
}
function status_(p) {
  if (p.state === 'removed') return 'removed';
  if (p.state === 'remove-pending') return 'remove';
  if (p.flag) return 'problem';
  if (p.ver) return 'confirmed';
  return missing_(p).length ? 'missing' : 'ready';
}

/* ============================================================ actions */

/** Summary for the division picker, circle pages and the dashboard. */
function meta_(body, user) {
  const m = gzGet_('meta') || buildAll_().m;
  // state totals, added up from the divisions' lines
  const duty = { CDL: {}, BS: {} }, blank = { CDL: 0, BS: 0 };
  let pending = 0;
  m.divisions.forEach(d => {
    pending += d.pending || 0;
    ['CDL', 'BS'].forEach(c => { blank[c] += d.blank[c]; Object.keys(d.duty[c]).forEach(k => { duty[c][k] = (duty[c][k] || 0) + d.duty[c][k]; }); });
  });
  const out = { user, certs: m.certs, duty, blank, pending,
    divisions: m.divisions.map(d => ({ circle: d.circle, division: d.division, CDL: d.CDL, BS: d.BS, last: d.last })) };
  if (user.isAdmin) { out.userCounts = {}; readUsers_().rows.forEach(r => { if (r.status === 'Active') out.userCounts[r.division] = (out.userCounts[r.division] || 0) + 1; }); }
  return out;
}
function count0_() { return { all: 0, missing: 0, ready: 0, problem: 0, confirmed: 0, remove: 0, added: 0, changed: 0, active: 0 }; }

/** One division: both cadres and its certificates. */
function load_(body) {
  const division = String(body.division || '');
  if (!division) throw new Error('Choose a division.');
  const rows = gzGet_('div|' + division) || buildAll_().by[division] || [];
  const certs = certs_(), mine = {};
  ['CDL', 'BS'].forEach(c => { if (certs[division + '|' + c]) mine[c] = certs[division + '|' + c]; });
  return { division, rows, certs: mine };
}

/**
 * Runs fn(t, p) on one person under the script lock: t is their tab, p their row. fn returns log entries.
 * base: the person's "Last updated on" as the website last saw it; if someone saved after that, nothing is written.
 */
function withPerson_(id, base, user, fn) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const cadre = cadreOf_(id), t = findPerson_(id), p = t.rows[0];
    if (!p) throw err_('This person is no longer in the list. The page has been refreshed.', true);
    mayEdit_(user, p.division);
    if (base != null && String(base) !== String(p.updOn || ''))
      throw err_(p.name + ' was changed by ' + (p.updBy || 'someone') + ' at ' + p.updOn + '. The list has been refreshed; please check and try again.', true);
    if (locked_(p.division, cadre)) throw new Error('This list is certified and locked.');
    const before = JSON.stringify(p), entries = fn(t, p) || [];
    if (JSON.stringify(p) !== before) { p.updOn = now_(); p.updBy = who_(user); writeRows_(t, [p]); refreshCache_(p.division, [p]); }
    log_rows_(user, entries);
    return { rows: [pub_(p)] };
  } finally { lock.releaseLock(); }
}

/** Saves changed fields. A verified person stays verified only while still complete. */
function update_(body, user) {
  const ch = body.ch || {};
  return withPerson_(String(body.id), body.base, user, (t, p) => {
    const out = [];
    Object.keys(ch).forEach(f => {
      if (EDITABLE.indexOf(f) < 0) return;
      let v = ch[f];
      if (f === 'pay') v = v === '' || v == null ? null : Number(v);
      else if (f === 'other') v = (Array.isArray(v) ? v : []).map(String).filter(x => DUTIES.indexOf(x) >= 0 && x !== (ch.duty || p.duty));
      else v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
      if (f === 'duty' && v && DUTIES.indexOf(v) < 0) throw new Error('Unknown duty: ' + v);
      if (f === 'date' && v && !/^(\d{2}-\d{2}-\d{4}|\d{4})$/.test(v)) throw new Error('Engagement date: use dd-mm-yyyy or just the year');
      if (p.cadre === 'BS' && (f === 'pay' || f === 'mode' || f === 'agency')) return;
      if (show_(f, p[f]) === show_(f, v)) return;
      out.push({ p, type: 'Edit', field: LABEL[f], old: show_(f, p[f]), new: show_(f, v) });
      p[f] = v;
    });
    if (p.other && p.duty) p.other = p.other.filter(x => x !== p.duty);
    if (out.length && p.ver && missing_(p).length) { p.ver = ''; out.push({ p, type: 'Verification removed', old: 'Verified' }); }
    return out;
  });
}

/** Verifies everyone in ids who is complete and has no open problem. */
function confirm_(body, user) {
  const ids = (body.ids || []).map(String);
  if (!ids.length) return { rows: [], done: 0, skipped: 0 };
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const out = [], log = [], divs = {}, certs = certs_();
    let done = 0, skipped = 0;
    ['CDL', 'BS'].forEach(cadre => {
      const mine = ids.filter(id => cadreOf_(id) === cadre); if (!mine.length) return;
      const t = readTab_(cadre), changed = [];
      mine.forEach(id => {
        const p = t.rows.find(r => r.id === id); if (!p || certs[p.division + '|' + cadre]) return;
        mayEdit_(user, p.division);
        const s = status_(p);
        if (s === 'ready') { p.ver = 'Confirmed'; p.updOn = now_(); p.updBy = who_(user); log.push({ p, type: 'Verified', new: 'Verified' }); changed.push(p); done++; divs[p.division] = 1; }
        else if (s !== 'confirmed') skipped++;
        out.push(pub_(p));
      });
      writeRows_(t, changed);
      Object.keys(divs).forEach(d => refreshCache_(d, changed.filter(p => p.division === d)));
    });
    log_rows_(user, log);
    return { rows: out, done, skipped };
  } finally { lock.releaseLock(); }
}

function unconfirm_(body, user) {
  return withPerson_(String(body.id), null, user, (t, p) => {
    if (!p.ver) return [];
    p.ver = ''; return [{ p, type: 'Verification removed', old: 'Verified' }];
  });
}

/** "Not working": a new person not yet approved is simply withdrawn; anyone else waits for the admin. */
function notWorking_(body, user) {
  const reason = String(body.reason || '').trim(), remark = String(body.remark || '').trim();
  if (!reason) throw new Error('Choose a reason.');
  return withPerson_(String(body.id), null, user, (t, p) => {
    if (p.state === 'add-pending') { p.state = 'removed'; return [{ p, type: 'New person withdrawn', new: reason }]; }
    if (p.state !== 'active') return [];
    p.state = 'remove-pending'; p.removal = { reason, remark, by: who_(user), on: now_() };
    return [{ p, type: 'Marked not working', field: 'Reason', new: reason + (remark ? ' (' + remark + ')' : '') }];
  });
}
function undoRemoval_(body, user) {
  return withPerson_(String(body.id), null, user, (t, p) => {
    if (p.state !== 'remove-pending') return [];
    p.state = 'active'; p.removal = null; return [{ p, type: 'Removal withdrawn' }];
  });
}

/** Double entry: either both are real people, or this one is the duplicate (then it waits for the admin to remove). */
function resolveFlag_(body, user) {
  const id = String(body.id), dup = !!body.dup;
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const cadre = cadreOf_(id), t = readTab_(cadre), p = t.rows.find(r => r.id === id);
    if (!p) throw err_('This person is no longer in the list.', true);
    mayEdit_(user, p.division);
    if (locked_(p.division, cadre)) throw new Error('This list is certified and locked.');
    const twins = t.rows.filter(x => x.flag && x.division === p.division && x.name === p.name && x.date === p.date);
    twins.forEach(x => { x.flag = ''; if (x !== p) { x.updOn = now_(); x.updBy = who_(user); } });
    p.updOn = now_(); p.updBy = who_(user);
    const log = [];
    if (dup && p.state === 'active') { p.state = 'remove-pending'; p.removal = { reason: 'Duplicate entry', remark: '', by: who_(user), on: now_() }; log.push({ p, type: 'Marked not working', field: 'Reason', new: 'Duplicate entry' }); }
    else log.push({ p, type: 'Problem resolved', new: 'Different people' });
    const changed = twins.indexOf(p) < 0 ? twins.concat(p) : twins;
    writeRows_(t, changed);
    refreshCache_(p.division, changed);
    log_rows_(user, log);
    return { rows: twins.concat(twins.indexOf(p) < 0 ? [p] : []).map(pub_) };
  } finally { lock.releaseLock(); }
}

/** A DL / CDL not in the list waits for the admin; Ban Sahayaks count straight away. The website picks the ID. */
function add_(body, user) {
  const d = body.person || {}, cadre = d.cadre === 'BS' ? 'BS' : 'CDL';
  const id = String(d.id || '');
  if (!(cadre === 'BS' ? /^BS-[0-9A-F]{8}$/ : /^NEW-[0-9A-F]{8}$/).test(id)) throw new Error('Bad ID for a new person.');
  const name = String(d.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) throw new Error('Write the name.');
  const div = divisions_().find(x => x.division === d.division);
  if (!div) throw new Error('Unknown division: ' + d.division);
  mayEdit_(user, div.division);
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    if (locked_(div.division, cadre)) throw new Error('This list is certified and locked.');
    const t = findPerson_(id);
    if (t.rows.length) return { rows: [pub_(t.rows[0])] };   // sent twice
    const p = { id, cadre, circle: div.circle, division: div.division, name, ver: '', state: cadre === 'BS' ? 'active' : 'add-pending', flag: '', removal: null, orig: null,
      updOn: now_(), updBy: who_(user) };
    EDITABLE.forEach(f => { if (f !== 'name') p[f] = f === 'other' ? (d.other || []).filter(x => DUTIES.indexOf(x) >= 0) : f === 'pay' ? (d.pay == null || d.pay === '' ? null : Number(d.pay)) : String(d[f] || '').trim(); });
    if (cadre === 'BS') Object.assign(p, { mode: 'Direct', agency: '', pay: BS_PAY });
    writeRows_(t, [p]);
    refreshCache_(p.division, [p]);
    log_rows_(user, [{ p, type: 'Added', new: cadre === 'BS' ? 'Ban Sahayak' : 'New person' }]);
    return { rows: [pub_(p)] };
  } finally { lock.releaseLock(); }
}

/** The DFO certifies one cadre's list of a division once everyone working is verified. */
function certify_(body, user) {
  const division = String(body.division || ''), cadre = body.cadre === 'BS' ? 'BS' : 'CDL';
  const name = String(body.name || '').trim(), desig = String(body.desig || '').trim();
  if (!name || !desig) throw new Error('Write the name and designation of the DFO.');
  mayEdit_(user, division);
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    if (locked_(division, cadre)) throw new Error('Already certified.');
    const mine = (gzGet_('div|' + division) || readTab_(cadre).rows).filter(p => p.division === division && (p.cadre || 'CDL') === cadre && p.state !== 'removed');
    const active = mine.filter(p => p.state !== 'remove-pending');
    if (!active.length || active.some(p => status_(p) !== 'confirmed')) throw new Error('Verify everyone first.');
    const cert = { name, desig, on: now_(), by: who_(user) };
    const sh = tab_(CONFIG.CERT);
    sh.getRange(sh.getLastRow() + 1, 1, 1, CERT_HEADERS.length).setNumberFormat('@').setValues([[division, cadre, name, desig, cert.on, who_(user)]]);
    log_rows_(user, [{ division, circle: mine[0].circle, cadre, type: CADRE_NAME[cadre] + ' list certified', new: name + ', ' + desig }]);
    refreshCerts_();
    return { cert };
  } finally { lock.releaseLock(); }
}
function reopen_(body, user) {
  const division = String(body.division || ''), cadre = body.cadre === 'BS' ? 'BS' : 'CDL';
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const sh = tab_(CONFIG.CERT), v = sh.getDataRange().getValues();
    for (let r = v.length - 1; r >= 1; r--) if (fmt_(v[r][0]) === division && (fmt_(v[r][1]) || 'CDL') === cadre) sh.deleteRow(r + 1);
    log_rows_(user, [{ division, cadre, type: CADRE_NAME[cadre] + ' list reopened' }]);
    refreshCerts_();
    return {};
  } finally { lock.releaseLock(); }
}

/** Admins: new people and removals waiting for a decision. */
function pending_() {
  const rows = [];
  ['CDL', 'BS'].forEach(c => readTab_(c).rows.forEach(p => { if (p.state === 'add-pending' || p.state === 'remove-pending') rows.push(pub_(p)); }));
  return { rows };
}
function decide_(body, user) {
  return withPerson_(String(body.id), null, user, (t, p) => {
    const ok = !!body.approve;
    if (p.state === 'add-pending') { p.state = ok ? 'active' : 'removed'; return [{ p, type: ok ? 'Addition approved' : 'Addition rejected' }]; }
    if (p.state === 'remove-pending') { p.state = ok ? 'removed' : 'active'; if (!ok) p.removal = null; return [{ p, type: ok ? 'Removal approved' : 'Removal rejected' }]; }
    return [];
  });
}

/** Admins: the change log, newest first (up to 1000 entries). */
function log_() {
  const sh = tab_(CONFIG.LOG), last = sh.getLastRow(), n = Math.min(1000, last - 1);
  if (n < 1) return { rows: [], total: 0 };
  const v = sh.getRange(last - n + 1, 1, n, LOG_HEADERS.length).getValues().reverse();
  const cadre = { 'DL / CDL': 'CDL', 'Ban Sahayak': 'BS' };
  return { total: last - 1, rows: v.map(x => ({ on: fmtTs_(x[0]), username: fmt_(x[1]), by: fmt_(x[2]), circle: fmt_(x[3]), division: fmt_(x[4]), cadre: cadre[fmt_(x[5])] || '',
    id: fmt_(x[6]), name: fmt_(x[7]), type: fmt_(x[8]), field: fmt_(x[9]), old: fmt_(x[10]), new: fmt_(x[11]) })) };
}
