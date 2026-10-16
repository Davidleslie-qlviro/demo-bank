/* Fabino Coffee back end (one Vercel serverless function). Nothing secret is ever sent to the customer app.
   ENV (set in Vercel > Settings > Environment Variables):
   OWNER_EMAIL, ADMIN_EMAIL, SESSION_SECRET (long random text), RESEND_API_KEY, MAIL_FROM,
   KV_REST_API_URL + KV_REST_API_TOKEN (added automatically by the Upstash Redis integration), GHL_WEBHOOK_URL (optional).
   NEVER set DEV_CODES in production. */
const crypto = require('crypto');
const ENV = process.env;
const SECRET = ENV.SESSION_SECRET || '';
const KV_URL = ENV.KV_REST_API_URL || ENV.UPSTASH_REDIS_REST_URL, KV_TOKEN = ENV.KV_REST_API_TOKEN || ENV.UPSTASH_REDIS_REST_TOKEN;

/* ---------- storage (Upstash Redis REST; in-memory only for local tests) ---------- */
const mem = new Map();
async function kv(cmd) {
  if (!KV_URL) { // local test store
    const [c, k, a, b, d] = cmd;
    const now = Date.now(); const e = mem.get(k);
    if (e && e.x && e.x < now) mem.delete(k);
    switch (c) {
      case 'GET': return mem.has(k) ? mem.get(k).v : null;
      case 'SET': mem.set(k, { v: a, x: b === 'EX' ? now + d * 1000 : 0 }); return 'OK';
      case 'DEL': mem.delete(k); return 1;
      case 'INCR': { const v = (mem.has(k) ? +mem.get(k).v : 0) + 1; mem.set(k, { v: String(v), x: mem.has(k) ? mem.get(k).x : 0 }); return v; }
      case 'EXPIRE': if (mem.has(k)) mem.get(k).x = now + a * 1000; return 1;
      case 'LPUSH': { const l = mem.has(k) ? mem.get(k).v : []; l.unshift(a); mem.set(k, { v: l, x: 0 }); return l.length; }
      case 'LTRIM': { const l = mem.has(k) ? mem.get(k).v : []; mem.set(k, { v: l.slice(a, b + 1), x: 0 }); return 'OK'; }
      case 'LRANGE': { const l = mem.has(k) ? mem.get(k).v : []; return l.slice(a, b + 1); }
    }
  }
  const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}
const getJ = async k => { const v = await kv(['GET', k]); return v ? JSON.parse(v) : null; };
const setJ = (k, o, ex) => ex ? kv(['SET', k, JSON.stringify(o), 'EX', ex]) : kv(['SET', k, JSON.stringify(o)]);

/* ---------- defaults (prices incl. VAT). The live values are stored in the database and changed only through approval ---------- */
const DEFAULT_CONFIG = {
  v: 1,
  business: { name: 'Fabino Coffee', tagline: "Say it. We'll brew the rest.", city: 'Johannesburg, Gauteng', phone: '', email: '', vatReg: true, vatNo: '', vatRate: 15 },
  bank: { bankName: '', accHolder: '', accNo: '', branch: '', accType: 'Cheque', payRef: 'Use your invoice number' },
  prices: { beans250: 105, beans500: 200, beans1000: 390, jdark: 214, jmed: 214, jdec: 250 },
  rules: { deliveryFee: 75, freeOver: 600, subDisc: 10, cutoffHour: 14, window: '08:00 – 13:00' },
  specials: [
    { t: 'Recipe: Iced Forte', x: 'Cold brew over ice with a splash of milk. Add 500 g Forte, plunger grind.', pid: 'forte', size: 500, grind: 'plunger' },
    { t: 'Pairs well: Jovo Decaf', x: 'A box of 50 decaf capsules for the evening cup.', pid: 'jdec' }
  ]
};
const PIDS = ['house', 'allora', 'forte', 'espresso', 'cafe', 'mokka', 'jdark', 'jmed', 'jdec'];
const isBean = p => ['house', 'allora', 'forte', 'espresso', 'cafe', 'mokka'].includes(p);
const GRINDS = ['whole', 'espresso', 'filter', 'plunger', 'moka'];
const getConfig = async () => (await getJ('fab:config')) || DEFAULT_CONFIG;
const publicConfig = c => ({ v: c.v, business: { ...c.business, vatNo: c.business.vatNo }, prices: c.prices, rules: c.rules, specials: c.specials });

/* ---------- helpers ---------- */
const b64u = b => Buffer.from(b).toString('base64url');
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const lc = s => String(s || '').trim().toLowerCase();
const mailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
const phoneOk = v => /^(?:\+27|0027|27|0)[6-8]\d{8}$/.test(String(v || '').replace(/[\s\-()]/g, ''));
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const ip = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
async function limit(key, max, secs) { const n = await kv(['INCR', key]); if (n === 1) await kv(['EXPIRE', key, secs]); if (n > max) { const e = new Error('Too many attempts. Try again later.'); e.status = 429; throw e; } }
const fail = (status, msg) => { const e = new Error(msg); e.status = status; return e; };

async function roles() { return (await getJ('fab:roles')) || { owner: lc(ENV.OWNER_EMAIL), admin: lc(ENV.ADMIN_EMAIL) }; }
async function roleOf(email) { const r = await roles(); email = lc(email); return email && email === r.owner ? 'owner' : email && email === r.admin ? 'admin' : null; }

async function sendMail(to, subject, text) {
  if (ENV.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + ENV.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ENV.MAIL_FROM || 'Fabino Security <onboarding@resend.dev>', to: [to], subject, text }) });
    if (!r.ok) throw fail(502, 'Could not send the email');
  } else console.log('[mail not configured]', to, subject);
}
async function audit(who, action, id, summary) { await kv(['LPUSH', 'fab:audit', JSON.stringify({ at: new Date().toISOString(), who, action, id: id || '', summary: str(summary, 300) })]); await kv(['LTRIM', 'fab:audit', 0, 199]); }
async function notifyBoth(subject, text) { const r = await roles(); for (const e of [r.owner, r.admin]) if (e) { try { await sendMail(e, subject, text); } catch (x) { } } }

/* ---------- sessions & one-time codes ---------- */
function setCookie(res, name, val, maxAge) { res.setHeader('Set-Cookie', `${name}=${val}; HttpOnly; Secure; SameSite=Strict; Path=/api/fabino; Max-Age=${maxAge}`); }
async function session(req) {
  const m = /(?:^|;\s*)fabs=([^;]+)/.exec(req.headers.cookie || ''); if (!m || !SECRET) return null;
  const [p, sig] = m[1].split('.'); if (!p || !sig || !eq(hmac(p), sig)) return null;
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
  if (!o.exp || o.exp < Date.now()) return null;
  const role = await roleOf(o.e); if (!role) return null;
  return { email: o.e, role };
}
const need = async (req) => { const s = await session(req); if (!s) throw fail(401, 'Please log in'); return s; };
async function issueCode(email, purpose) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex');
  await setJ(`fab:otp:${sha(email + purpose)}`, { h: sha(salt + code), salt, tries: 0 }, 600);
  return code;
}
async function checkCode(email, purpose, code) {
  const k = `fab:otp:${sha(email + purpose)}`, o = await getJ(k);
  if (!o) throw fail(400, 'Code expired. Ask for a new one.');
  if (o.tries >= 5) { await kv(['DEL', k]); throw fail(429, 'Too many wrong codes. Ask for a new one.'); }
  if (!eq(sha(o.salt + str(code, 10)), o.h)) { o.tries++; await setJ(k, o, 600); throw fail(400, 'Wrong code'); }
  await kv(['DEL', k]);
}

/* ---------- validation of a proposed change ---------- */
function cleanPatch(p) {
  const out = {}, num = (v, lo, hi) => { v = +v; if (!isFinite(v) || v < lo || v > hi) throw fail(400, 'A number is out of range'); return Math.round(v * 100) / 100; };
  if (p.prices) { out.prices = {}; for (const k of ['beans250', 'beans500', 'beans1000', 'jdark', 'jmed', 'jdec']) if (p.prices[k] !== undefined) out.prices[k] = num(p.prices[k], 1, 100000); }
  if (p.rules) { out.rules = {}; const r = p.rules;
    if (r.deliveryFee !== undefined) out.rules.deliveryFee = num(r.deliveryFee, 0, 5000); if (r.freeOver !== undefined) out.rules.freeOver = num(r.freeOver, 0, 100000);
    if (r.subDisc !== undefined) out.rules.subDisc = num(r.subDisc, 0, 50); if (r.cutoffHour !== undefined) out.rules.cutoffHour = Math.round(num(r.cutoffHour, 0, 23)); if (r.window !== undefined) out.rules.window = str(r.window, 40); }
  if (p.business) { out.business = {}; const b = p.business; for (const k of ['name', 'tagline', 'city', 'phone', 'email', 'vatNo']) if (b[k] !== undefined) out.business[k] = str(b[k], 120);
    if (b.vatReg !== undefined) out.business.vatReg = !!b.vatReg; if (b.vatRate !== undefined) out.business.vatRate = num(b.vatRate, 0, 30); }
  if (p.bank) { out.bank = {}; for (const k of ['bankName', 'accHolder', 'accNo', 'branch', 'accType', 'payRef']) if (p.bank[k] !== undefined) out.bank[k] = str(p.bank[k], 80); }
  if (p.specials) { if (!Array.isArray(p.specials) || p.specials.length > 5) throw fail(400, 'Up to 5 specials'); out.specials = p.specials.map(s => {
    if (!PIDS.includes(s.pid)) throw fail(400, 'Unknown product in a special'); const o = { t: str(s.t, 60), x: str(s.x, 200), pid: s.pid };
    if (isBean(s.pid)) { o.size = [250, 500, 1000].includes(+s.size) ? +s.size : 500; o.grind = GRINDS.includes(s.grind) ? s.grind : 'whole'; } return o; }); }
  for (const g of Object.keys(out)) if (!Object.keys(out[g]).length && !Array.isArray(out[g])) delete out[g];
  if (!Object.keys(out).length) throw fail(400, 'Nothing to change');
  return out;
}
const mask = s => s ? '••••' + String(s).slice(-3) : '(empty)';
function summarise(patch, cur) {
  const bits = [];
  if (patch.prices) for (const k in patch.prices) bits.push(`${k}: R${cur.prices[k]} → R${patch.prices[k]}`);
  if (patch.rules) for (const k in patch.rules) bits.push(`${k}: ${cur.rules[k]} → ${patch.rules[k]}`);
  if (patch.business) for (const k in patch.business) bits.push(`business ${k}: ${cur.business[k]} → ${patch.business[k]}`);
  if (patch.bank) for (const k in patch.bank) bits.push(`BANK ${k}: ${k === 'accNo' ? mask(cur.bank[k]) + ' → ' + mask(patch.bank[k]) : (cur.bank[k] || '(empty)') + ' → ' + patch.bank[k]}`);
  if (patch.specials) bits.push(`specials: ${patch.specials.length} item(s)`);
  return bits.join('; ');
}
const merge = (cur, patch) => { const n = JSON.parse(JSON.stringify(cur)); for (const g of ['prices', 'rules', 'business', 'bank']) if (patch[g]) Object.assign(n[g], patch[g]); if (patch.specials) n.specials = patch.specials; n.v = (cur.v || 1) + 1; return n; };

/* ---------- approvals (maker-checker) ---------- */
const getPending = async () => (await getJ('fab:pending')) || [];
async function applyDue() { // role changes apply after the 24 hour hold
  const list = await getPending(); let ch = false;
  for (const p of list) if (p.status === 'holding' && p.applyAfter <= Date.now()) {
    const r = await roles(); await setJ('fab:roles', { owner: p.patch.owner || r.owner, admin: p.patch.admin || r.admin });
    p.status = 'applied'; ch = true; await audit('system', 'roles-applied', p.id, `owner=${p.patch.owner || 'same'} admin=${p.patch.admin || 'same'}`);
    await notifyBoth('Fabino: role change applied', 'The approved change of owner/admin has now taken effect.');
  }
  if (ch) await setJ('fab:pending', list.slice(0, 50));
}

/* ---------- order maths (server is the only authority on prices) ---------- */
function priceOf(c, it) { const pr = c.prices; return isBean(it.pid) ? pr['beans' + it.size] : pr[it.pid]; }
function orderTotals(c, items, sub, mode) {
  const subtotal = items.reduce((a, l) => a + priceOf(c, l) * l.qty, 0), disc = sub ? Math.round(subtotal * c.rules.subDisc) / 100 : 0, after = subtotal - disc;
  const fee = mode === 'collect' || after === 0 || after > c.rules.freeOver ? 0 : c.rules.deliveryFee, total = after + fee;
  const vat = c.business.vatReg ? total * c.business.vatRate / (100 + c.business.vatRate) : 0;
  return { subtotal, subscriptionDiscount: disc, deliveryFee: fee, total, vatIncluded: Math.round(vat * 100) / 100, currency: 'ZAR' };
}
async function hook(event, data) {
  if (!ENV.GHL_WEBHOOK_URL) return;
  try { await fetch(ENV.GHL_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, source: 'Fabino Order App', sentAt: new Date().toISOString(), ...data }) }); } catch (e) { }
}

/* ---------- the handler ---------- */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const a = (req.query && req.query.a) || new URL(req.url, 'http://x').searchParams.get('a');
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : (req.body || {});
  const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (req.method === 'POST' && req.headers['x-fab'] !== '1') throw fail(403, 'Blocked');
    if (!SECRET || SECRET.length < 24) throw fail(500, 'Server is not set up yet (SESSION_SECRET)');
    await applyDue();

    /* ===== public ===== */
    if (a === 'menu') return send(200, publicConfig(await getConfig()));
    if (a === 'lead' && req.method === 'POST') {
      await limit('fab:rl:lead:' + ip(req), 20, 3600); const c = body.customer || {};
      if (!str(c.name, 80).trim() || !mailOk(c.email) || !phoneOk(c.display)) throw fail(400, 'Check your details');
      const lead = { name: str(c.name, 80), email: lc(c.email), whatsapp: '+' + '27' + String(c.display).replace(/[\s\-()]/g, '').replace(/^(?:\+27|0027|27|0)/, ''), company: str(c.company, 80), marketingConsent: !!c.marketingConsent, at: new Date().toISOString() };
      await kv(['LPUSH', 'fab:leads', JSON.stringify(lead)]); await hook('registration', { customer: lead }); return send(200, { ok: true });
    }
    if (a === 'service' && req.method === 'POST') { // JURA machine service / repair request
      await limit('fab:rl:svc:' + ip(req), 10, 3600);
      const nm = str(body.name, 80).trim(), em = lc(body.email), ph = str(body.phone, 30), ty = ['Service', 'Repair', 'Not sure'].includes(body.type) ? body.type : 'Not sure';
      if (nm.length < 2 || !mailOk(em) || !phoneOk(ph)) throw fail(400, 'Check your details');
      const ref = 'SVC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const r = { ref, at: new Date().toISOString(), name: nm, email: em, phone: ph, model: str(body.model, 80), type: ty, notes: str(body.notes, 500), when: str(body.when, 80), status: 'new' };
      await kv(['LPUSH', 'fab:svc', JSON.stringify(r)]); await kv(['LTRIM', 'fab:svc', 0, 499]); await hook('service_request', { request: r });
      return send(200, { ok: true, ref });
    }
    if (a === 'order' && req.method === 'POST') {
      await limit('fab:rl:order:' + ip(req), 30, 3600); const c = await getConfig(), cu = body.customer || {};
      if (!str(cu.name, 80).trim() || !mailOk(cu.email) || !phoneOk(cu.phone)) throw fail(400, 'Check your details');
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) throw fail(400, 'Empty order');
      const items = body.items.map(i => { if (!PIDS.includes(i.pid)) throw fail(400, 'Unknown product'); const q = Math.round(+i.qty); if (!(q >= 1 && q <= 99)) throw fail(400, 'Bad quantity');
        return isBean(i.pid) ? { pid: i.pid, qty: q, size: [250, 500, 1000].includes(+i.size) ? +i.size : 500, grind: GRINDS.includes(i.grind) ? i.grind : 'whole' } : { pid: i.pid, qty: q, size: 0, grind: null }; });
      const mode = body.mode === 'collect' ? 'collect' : 'deliver', sub = !!body.sub;
      if (mode === 'deliver' && str(body.addr, 200).trim().length < 6) throw fail(400, 'Delivery address needed');
      const no = 'FAB-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
      const order = { no, at: new Date().toISOString(), items, mode, addr: str(body.addr, 200), slot: str(body.slot, 60), sub, freq: [2, 3, 4].includes(+body.freq) ? +body.freq : 2,
        customer: { name: str(cu.name, 80), email: lc(cu.email), phone: str(cu.phone, 30), company: str(cu.company, 80), marketingConsent: !!cu.marketingConsent }, totals: orderTotals(c, items, sub, mode), status: 'unpaid', cfgV: c.v };
      await setJ('fab:order:' + no, order, 60 * 60 * 24 * 400); await kv(['LPUSH', 'fab:orders', no]); await kv(['LTRIM', 'fab:orders', 0, 999]);
      return send(200, { no, totals: order.totals, bank: c.bank.bankName ? c.bank : null });
    }
    if (a === 'pay' && req.method === 'POST') { // SIMULATED. Replace this block with a Yoco / PayFast checkout + signed webhook confirmation.
      await limit('fab:rl:pay:' + ip(req), 30, 3600); const o = await getJ('fab:order:' + str(body.no, 20)); if (!o) throw fail(404, 'Order not found');
      if (o.status !== 'paid') { o.status = 'paid'; o.paidAt = new Date().toISOString(); o.payment = { method: 'DEMO', reference: 'SIM-' + crypto.randomBytes(3).toString('hex').toUpperCase() }; await setJ('fab:order:' + o.no, o, 60 * 60 * 24 * 400); await hook('order', { order: o }); }
      return send(200, { status: o.status, reference: o.payment.reference });
    }

    /* ===== login ===== */
    if (a === 'otp_request' && req.method === 'POST') {
      const email = lc(body.email); await limit('fab:rl:otp:ip:' + ip(req), 15, 3600); await limit('fab:rl:otp:' + sha(email), 5, 3600);
      let dev; if (await roleOf(email)) { const code = await issueCode(email, 'login'); await sendMail(email, 'Your Fabino sign-in code', `Your code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.`); if (ENV.DEV_CODES === '1') dev = code; }
      return send(200, { ok: true, dev }); // same answer whether or not the email is known
    }
    if (a === 'otp_verify' && req.method === 'POST') {
      const email = lc(body.email); await limit('fab:rl:ver:' + ip(req), 30, 3600); const role = await roleOf(email); if (!role) throw fail(400, 'Wrong code');
      await checkCode(email, 'login', body.code);
      const p = b64u(JSON.stringify({ e: email, exp: Date.now() + 8 * 3600e3 })); setCookie(res, 'fabs', p + '.' + hmac(p), 8 * 3600);
      await audit(email, 'login', '', role); return send(200, { ok: true, role });
    }
    if (a === 'logout') { setCookie(res, 'fabs', '', 0); return send(200, { ok: true }); }

    /* ===== admin portal ===== */
    const me = await need(req);
    if (a === 'state') {
      const list = (await getPending()).filter(p => p.status !== 'rejected'), ids = await kv(['LRANGE', 'fab:orders', 0, 49]), orders = [];
      for (const n of ids) { const o = await getJ('fab:order:' + n); if (o) orders.push(o); }
      return send(200, { me, config: await getConfig(), roles: await roles(), pending: list.slice(0, 20).map(p => ({ ...p, patch: p.patch })), audit: (await kv(['LRANGE', 'fab:audit', 0, 39])).map(JSON.parse), orders, services: (await kv(['LRANGE', 'fab:svc', 0, 49])).map(JSON.parse) });
    }
    if (a === 'stepup_request' && req.method === 'POST') {
      await limit('fab:rl:su:' + sha(me.email), 10, 3600); const code = await issueCode(me.email, 'stepup:' + str(body.id, 30));
      await sendMail(me.email, 'Fabino security approval code', `Your approval code is ${code}. It expires in 10 minutes. Only use it if YOU are approving this change.`);
      return send(200, { ok: true, dev: ENV.DEV_CODES === '1' ? code : undefined });
    }
    if (a === 'propose' && req.method === 'POST') {
      const cur = await getConfig(); const id = crypto.randomBytes(5).toString('hex'); let p;
      if (body.kind === 'roles') {
        const r = await roles(), patch = {}; if (body.owner) { if (!mailOk(body.owner)) throw fail(400, 'Bad owner email'); patch.owner = lc(body.owner); } if (body.admin) { if (!mailOk(body.admin)) throw fail(400, 'Bad admin email'); patch.admin = lc(body.admin); }
        if (!Object.keys(patch).length) throw fail(400, 'Nothing to change'); if ((patch.owner || r.owner) === (patch.admin || r.admin)) throw fail(400, 'Owner and admin must be different people');
        await checkCode(me.email, 'stepup:new', body.code);
        p = { id, kind: 'roles', risk: 'highest', patch, summary: `ROLE CHANGE: ${patch.owner ? 'owner → ' + patch.owner : ''} ${patch.admin ? 'admin → ' + patch.admin : ''}`, by: me.email, at: Date.now(), status: 'pending' };
      } else {
        const patch = cleanPatch(body.patch || {}); const risk = patch.bank ? 'high' : 'normal';
        if (risk === 'high') await checkCode(me.email, 'stepup:new', body.code);
        p = { id, kind: 'config', risk, patch, summary: summarise(patch, cur), by: me.email, at: Date.now(), status: 'pending' };
      }
      const list = await getPending(); list.unshift(p); await setJ('fab:pending', list.slice(0, 50)); await audit(me.email, 'proposed', id, p.summary);
      const other = (await roles())[me.role === 'owner' ? 'admin' : 'owner']; if (other) { try { await sendMail(other, 'Fabino: change waiting for your approval', `${me.role} proposed:\n\n${p.summary}\n\nOpen the Fabino admin portal to review it.`); } catch (e) { } }
      return send(200, { ok: true, id });
    }
    if ((a === 'approve' || a === 'reject') && req.method === 'POST') {
      const list = await getPending(), p = list.find(x => x.id === body.id); if (!p || !['pending', 'holding'].includes(p.status)) throw fail(404, 'Not found');
      if (a === 'reject') { p.status = 'rejected'; await setJ('fab:pending', list); await audit(me.email, 'rejected', p.id, p.summary); if (p.risk !== 'normal') await notifyBoth('Fabino: change rejected/cancelled', p.summary); return send(200, { ok: true }); }
      if (p.status !== 'pending') throw fail(400, 'Already approved and on hold');
      if (lc(p.by) === me.email) throw fail(403, 'You cannot approve your own change. The other person must.');
      if (p.risk !== 'normal') await checkCode(me.email, 'stepup:' + p.id, body.code);
      if (p.kind === 'roles') { p.status = 'holding'; p.approvedBy = me.email; p.applyAfter = Date.now() + 24 * 3600e3; await setJ('fab:pending', list); await audit(me.email, 'approved-hold', p.id, p.summary);
        await notifyBoth('Fabino: role change approved, 24 hour hold', p.summary + '\n\nIt takes effect in 24 hours. Either of you can cancel it in the portal until then.'); return send(200, { ok: true, holdUntil: p.applyAfter }); }
      const cur = await getConfig(); await setJ('fab:config', merge(cur, p.patch)); p.status = 'applied'; p.approvedBy = me.email; await setJ('fab:pending', list); await audit(me.email, 'approved', p.id, p.summary);
      if (p.risk !== 'normal') await notifyBoth('Fabino: bank details changed', p.summary); return send(200, { ok: true });
    }
    if (a === 'export') { // orders as CSV for the GAAP point of sale / accountant
      const ids = await kv(['LRANGE', 'fab:orders', 0, 999]), rows = [['order', 'date', 'status', 'name', 'phone', 'email', 'items', 'mode', 'total', 'vat', 'reference'].join(',')];
      for (const n of ids) { const o = await getJ('fab:order:' + n); if (!o) continue; const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
        rows.push([o.no, o.at, o.status, q(o.customer.name), q(o.customer.phone), q(o.customer.email), q(o.items.map(i => `${i.qty}x ${i.pid}${i.size ? ' ' + i.size + 'g' : ''}${i.grind ? ' ' + i.grind : ''}`).join('; ')), o.mode, o.totals.total, o.totals.vatIncluded, o.payment ? o.payment.reference : ''].join(',')); }
      await audit(me.email, 'export', '', rows.length - 1 + ' orders'); res.statusCode = 200; res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="fabino-orders.csv"'); return res.end(rows.join('\n'));
    }
    throw fail(404, 'Unknown action');
  } catch (e) { return send(e.status || 500, { error: e.status ? e.message : 'Server error' }); }
};
