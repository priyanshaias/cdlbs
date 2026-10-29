// Talks to the CDL+BS Apps Script API (or the demo backend when no API_URL is set, or the address has ?demo).
(function () {
  const cfg = window.CDL_CONFIG || {};
  const DEMO = !cfg.API_URL || /[?&]demo\b/.test(location.search);
  let token = null, user = null;
  try { token = localStorage.getItem('cdlbs_token'); user = JSON.parse(localStorage.getItem('cdlbs_user') || 'null'); } catch (e) {}

  function setSession(t, u) {
    token = t; user = u;
    try {
      if (t) { localStorage.setItem('cdlbs_token', t); localStorage.setItem('cdlbs_user', JSON.stringify(u)); }
      else { localStorage.removeItem('cdlbs_token'); localStorage.removeItem('cdlbs_user'); }
    } catch (e) {}
  }

  // Reads are retried when Google's servers hiccup; a save is sent once, so a slow reply can never apply it twice.
  const SAFE = ['login', 'logout', 'meta', 'load', 'pending', 'log', 'users', 'lists', 'divisionUsers'];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function post(payload) {
    const tries = SAFE.includes(payload.action) ? 3 : 1;
    let last = 'The server could not be reached. Please check the internet connection and try again.';
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(1500 * i);
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
      try {
        const res = await fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), signal: ctl.signal });
        const txt = await res.text();
        try { return JSON.parse(txt); } catch (e) { last = 'Google’s server is busy. Please try again in a minute.'; }
      } catch (e) {
        last = e.name === 'AbortError' ? 'Google’s server is taking too long. Please try again in a minute.' : last;
      } finally { clearTimeout(t); }
    }
    return { ok: false, error: last };
  }

  async function call(action, body = {}) {
    if (DEMO) throw new Error('The demo keeps everything in this browser.');
    if (!token) throw Object.assign(new Error('Please sign in.'), { auth: true });
    const out = await post(Object.assign({ action, token }, body));
    if (!out.ok) {
      const err = Object.assign(new Error(out.error || 'Something went wrong.'), { conflict: !!out.conflict });
      if (/sign in|sign-in|expired/i.test(out.error || '')) { err.auth = true; setSession(null, null); }
      throw err;
    }
    return out.data;
  }

  window.CDL_API = {
    DEMO, call,
    get user() { return user; },
    async signIn(username, password) {
      const out = await post({ action: 'login', username, password });
      if (!out.ok) throw new Error(out.error || 'Could not sign in.');
      setSession(out.data.token, out.data.user);
      return out.data.user;
    },
    /** Before sign-in: the sign-up and password-reset steps. */
    async open(action, body = {}) {
      const out = await post(Object.assign({ action }, body));
      if (!out.ok) throw new Error(out.error || 'Something went wrong.');
      if (out.data && out.data.token) setSession(out.data.token, out.data.user);   // sign-up signs in
      return out.data;
    },
    signOut() { if (!DEMO && token) post({ action: 'logout', token }).catch(() => {}); setSession(null, null); },
  };
})();
