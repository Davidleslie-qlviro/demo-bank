/* =====================================================================
   FABINO COFFEE: CUSTOMER APP
   Needs, loaded before this file: config.js, assets.js, qr.js

   Sections
     1. Setup and helpers
     2. Pricing and delivery rules (mirrors the server, which is the authority)
     3. Voice / typed text -> order  (parser)
     4. Voice / typed text -> name, email, phone, address
     5. Microphone (non-iPhone only)
     6. Menu, reorder, sheet rendering
     7. Invoice image
     8. Pay and send to server
     9. JURA service request, QR, events, start-up
   ===================================================================== */
(function () {
  'use strict';

  /* ===================================================================
     1. SETUP AND HELPERS
     =================================================================== */
  const CFG = JSON.parse(JSON.stringify(window.FABINO_CONFIG));
  const ASSETS = window.FABINO_ASSETS || { brand: '', panels: [] };
  const PRODUCTS = CFG.products;
  const P = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
  const isBean = pid => P[pid].kind === 'bean';

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NBSP = ' ';
  const grouped = n => n.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const zarf = n => { const [r, c] = n.toFixed(2).split('.'); return 'R ' + grouped(r) + ',' + c; };      // R 1 234,50
  const zar = n => zarf(n).replace(/,00$/, '');                                                           // R 200
  const dateStr = d => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const picture = i => (ASSETS.panels.length ? ASSETS.panels[i % ASSETS.panels.length] : '');

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: carry on without saving */ } }
  };

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }

  /* Platform. iPhone and iPad use the keyboard's own microphone (in-page speech
     recognition is unreliable in iOS Safari); everyone else with speech support
     gets a "Tap to speak" button. */
  const UA = navigator.userAgent || '';
  const PLATFORM = navigator.platform || '';
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) || /iPad|iPhone|iPod/.test(PLATFORM) || (PLATFORM === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/i.test(UA);
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CAN_SPEAK = !IS_IOS && !!SpeechRec;

  /* South African contact checks */
  const phoneOk = v => /^(?:\+27|0027|27|0)[6-8]\d{8}$/.test(String(v || '').replace(/[\s\-()]/g, ''));
  const normPhone = v => '27' + String(v).replace(/[\s\-()]/g, '').replace(/^(?:\+27|0027|27|0)/, '');
  const mailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

  /* ===================================================================
     STATE
     =================================================================== */
  const saved = store.get('fabino_profile') || {};
  const S = {
    cart: [],            // { id, pid, qty, size, grind, def }   def = grind was not spoken, so highlight it
    missed: [],          // phrases the parser could not match
    view: 'order',       // 'order' | 'invoice'
    sub: false, freq: 2,
    mode: 'deliver',     // 'deliver' | 'collect'
    slot: null, addr: '',
    paid: false, no: '', eta: null,
    consent: null,
    cust: { name: saved.name || '', email: saved.email || '', phone: saved.display || '', company: saved.company || '' }
  };
  let profile = saved.name ? saved : null;
  let lineId = 1;
  let LIVE = false;      // true once the server has answered; false = demo mode with fall-back prices

  /* ===================================================================
     2. PRICING AND DELIVERY RULES
     The server recalculates every order itself; these numbers only drive what
     the customer sees before paying.
     =================================================================== */
  const priceOf = l => (isBean(l.pid) ? CFG.prices['beans' + l.size] : CFG.prices[l.pid]);
  const subtotal = () => S.cart.reduce((a, l) => a + priceOf(l) * l.qty, 0);

  function totals() {
    const r = CFG.rules, sub = subtotal();
    const disc = S.sub ? Math.round(sub * r.subDisc) / 100 : 0;
    const after = sub - disc;
    const fee = S.mode === 'collect' || after === 0 || after > r.freeOver ? 0 : r.deliveryFee;
    const total = after + fee;
    const b = CFG.business;
    const vat = b.vatReg ? total * b.vatRate / (100 + +b.vatRate) : 0;
    return { sub, disc, fee, total, vat };
  }

  function addLine(pid, qty, size, grind) {
    const bean = isBean(pid);
    const sz = bean ? (size || CFG.defaultSize) : 0;
    const gr = bean ? (grind || CFG.defaultGrind) : null;
    const same = S.cart.find(l => l.pid === pid && l.size === sz && l.grind === gr);
    if (same) { same.qty = Math.min(99, same.qty + qty); return same; }
    const line = { id: lineId++, pid, qty, size: sz, grind: gr, def: bean && !grind };
    S.cart.push(line);
    return line;
  }

  /* Working days: Monday to Friday */
  function nextWorkingDay(from, n) {
    const d = new Date(from); let c = 0;
    while (c < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) c++; }
    return d;
  }
  const pastCutoff = () => { const n = new Date(); return n.getHours() >= CFG.rules.cutoffHour || n.getDay() === 0 || n.getDay() === 6; };
  const firstDelivery = () => nextWorkingDay(new Date(), pastCutoff() ? 2 : 1);
  const longDate = d => d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });

  function collectionSlots() {
    let d = firstDelivery(); const out = [];
    for (let i = 0; i < 3; i++) {
      const label = d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
      ['09:00', '12:00', '15:00'].forEach(t => out.push(label + ' · ' + t));
      d = nextWorkingDay(d, 1);
    }
    return out;
  }
  const etaFor = () => S.mode === 'collect' ? { date: S.slot, window: '' } : { date: longDate(firstDelivery()), window: CFG.rules.window };

  /* ===================================================================
     3. TEXT -> ORDER (parser)
     The text is cut into tokens (numbers, sizes, grinds, products, separators).
     Tokens are then dealt out into items. An item is complete when the next
     number, product or separator shows up, so "1 jova 1 mocca 1 house" gives
     three items even with no "and" between them.
     =================================================================== */
  const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, another: 1 };
  const ARTICLES = new Set(['a', 'an', 'another']);
  const SIZE_VALUES = [250, 500, 1000];
  const FILLER = new Set(('please thanks thank you the a an of in and for me i i\'d i\'ll i\'m like want need would grind ground bag bags box boxes then my some can get have give ' +
    'let hi hello hey howzit it its it\'s coffee beans bean also with to be at is of order another one').split(' '));

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alternation = words => words.slice().sort((a, b) => b.length - a.length).map(escRe).join('|');
  const numberPattern = Object.keys(WORD_NUMBERS).join('|');
  const parseNumber = s => /^\d+$/.test(s) ? parseInt(s, 10) : WORD_NUMBERS[s];

  const BEAN_WORDS = {}, VARIANT_WORDS = {}, FAMILY_WORDS = {};
  PRODUCTS.forEach(p => p.kw.forEach(w => { (p.kind === 'bean' ? BEAN_WORDS : VARIANT_WORDS)[w] = p.id; }));
  CFG.families.forEach(f => f.words.forEach(w => { FAMILY_WORDS[w] = f.dflt; }));

  const GRIND_PHRASES = [
    ['espresso', /(?:espresso (?:grind|ground)|(?:grind(?:ed)?|ground) (?:for|as) (?:an? )?espresso(?: machine)?|espresso machine grind)\b/y],
    ['filter',   /(?:filter|pour[- ]?over|v60|drip)(?: grind| ground)?\b/y],
    ['plunger',  /(?:plunger|french press|cafetiere)(?: grind| ground)?\b/y],
    ['moka',     /(?:moka|mokka|stove ?top) pot(?: grind| ground)?\b/y],
    ['whole',    /(?:whole ?beans?|beans? whole|unground)\b/y]
  ];
  const sticky = src => new RegExp(src, 'y');
  const RE = {
    space:   /\s+/y,
    sep:     /(?:[,;+]|\.(?!\d)|(?:and|plus|also|then|with)\b)/y,
    oneKilo: sticky('(?:a|one|1)\\s+(?:kilo(?:gram)?s?|kg)\\b'),
    half:    sticky('half[\\s-]*(?:a\\s+)?(?:kilo(?:gram)?s?|kg)\\b'),
    quarter: sticky('quarter(?:\\s+of\\s+a)?[\\s-]*(?:kilo(?:gram)?s?|kg)\\b'),
    grams:   /(250|500|1000)\s*(?:g|grams?)\b/y,
    nKilos:  sticky('(\\d+|' + numberPattern + ')\\s*(?:kg|kilo(?:gram)?s?)\\b'),
    bean:    sticky('(?:' + alternation(Object.keys(BEAN_WORDS)) + ')\\b'),
    variant: sticky('(?:' + alternation(Object.keys(VARIANT_WORDS)) + ')\\b'),
    family:  sticky('(?:' + alternation(Object.keys(FAMILY_WORDS)) + ')\\b'),
    number:  sticky('(?:\\d+(?:\\s*x\\b)?|(?:' + numberPattern + ')\\b)'),
    word:    /[a-z][a-z'’-]*/y
  };

  function tokenize(s) {
    const tokens = []; let i = 0;
    const take = (re, make) => {
      re.lastIndex = i; const m = re.exec(s);
      if (!m || !m[0].length) return false;
      const t = make(m); t.start = i; t.end = i + m[0].length; tokens.push(t); i = t.end; return true;
    };
    while (i < s.length) {
      if (take(RE.space, () => ({ type: 'skip' }))) { tokens.pop(); continue; }
      if (take(RE.sep, () => ({ type: 'sep' }))) continue;
      if (take(RE.oneKilo, () => ({ type: 'size', v: 1000 }))) continue;
      if (take(RE.half, () => ({ type: 'size', v: 500 }))) continue;
      if (take(RE.quarter, () => ({ type: 'size', v: 250 }))) continue;
      if (take(RE.grams, m => ({ type: 'size', v: +m[1] }))) continue;
      if (take(RE.nKilos, m => ({ type: 'size', v: 1000, qty: parseNumber(m[1]) }))) continue;
      let hit = false;
      for (const [grind, re] of GRIND_PHRASES) if (take(re, () => ({ type: 'grind', v: grind }))) { hit = true; break; }
      if (hit) continue;
      if (take(RE.bean, m => ({ type: 'bean', pid: BEAN_WORDS[m[0]] }))) continue;
      if (take(RE.variant, m => ({ type: 'variant', pid: VARIANT_WORDS[m[0]] }))) continue;
      if (take(RE.family, m => ({ type: 'family', pid: FAMILY_WORDS[m[0]] }))) continue;
      if (take(RE.number, m => ({ type: 'num', v: parseNumber(m[0].replace(/\s*x$/, '')), article: ARTICLES.has(m[0]) }))) continue;
      if (take(RE.word, m => ({ type: 'word', w: m[0] }))) continue;
      i++; // any other character
    }
    return tokens;
  }

  function parseOrder(text) {
    const s = text.toLowerCase().replace(/é|è/g, 'e');       // same length, so token positions match the original text
    const items = [], missed = [];
    const blank = () => ({ pid: null, variant: null, family: null, generic: false, qty: null, size: null, grind: null, words: [], first: null });
    let cur = blank();
    const hasProduct = c => !!(c.pid || c.variant || c.family);

    function flush(at) {
      const c = cur; cur = blank();
      let pid = c.pid || (c.family ? (c.variant || c.family) : c.variant);
      if (!pid && c.generic && (c.qty != null || c.size != null || c.grind)) pid = CFG.products.find(p => p.kind === 'bean').id;
      if (pid) {
        const bean = isBean(pid);
        items.push({
          pid, qty: Math.min(Math.max(c.qty || 1, 1), 50),
          size: bean ? (c.size || CFG.defaultSize) : 0, sizeSpoken: bean && c.size != null,
          grind: bean ? c.grind : null, grindSpoken: bean && !!c.grind
        });
        return;
      }
      const left = c.words.filter(w => !FILLER.has(w));
      if (!left.length && (c.grind || c.size != null)) {              // "...forte" then later "filter grind": belongs to the previous item
        const prev = items[items.length - 1];
        if (prev && isBean(prev.pid)) {
          if (c.grind && !prev.grindSpoken) { prev.grind = c.grind; prev.grindSpoken = true; }
          if (c.size != null && !prev.sizeSpoken) { prev.size = c.size; prev.sizeSpoken = true; }
        }
      } else if (left.some(w => w.replace(/[^a-z]/g, '').length >= 4)) {
        missed.push(text.slice(c.first == null ? at : c.first, at).trim().replace(/^[\s,.;+]+|[\s,.;+]+$/g, ''));
      }
    }

    for (const t of tokenize(s)) {
      if (cur.first == null) cur.first = t.start;
      switch (t.type) {
        case 'sep': if (hasProduct(cur)) flush(t.start); break;
        case 'num':
          if (t.v >= 100) {                                    // a bare "500" means 500 g
            if (SIZE_VALUES.includes(t.v)) { if (cur.size != null && hasProduct(cur)) flush(t.start); cur.size = t.v; }
            break;
          }
          if (hasProduct(cur)) flush(t.start);                 // numbers come before what they count
          if (!(t.article && cur.qty != null)) cur.qty = t.v;
          break;
        case 'size':
          if (cur.size != null && hasProduct(cur)) flush(t.start);
          cur.size = t.v;
          if (t.qty != null && cur.qty == null) cur.qty = t.qty;          // "2 kg forte": two 1 kg bags; "1 house 1kg" keeps its qty of 1
          break;
        case 'grind':
          if (cur.grind && hasProduct(cur)) flush(t.start);
          cur.grind = t.v; break;
        case 'bean':
          if (cur.pid && cur.pid !== t.pid) flush(t.start);
          else if (cur.family && cur.pid) flush(t.start);
          cur.pid = t.pid; break;
        case 'family': cur.family = t.pid; break;                   // "jovo dark capsules": all one item
        case 'variant': cur.variant = t.pid; break;
        case 'word':
          if (/^(?:coffee|beans?|bags?)$/.test(t.w)) cur.generic = true;
          cur.words.push(t.w); break;
      }
    }
    flush(s.length);
    return { items, missed };
  }

  /* ===================================================================
     4. TEXT -> NAME, EMAIL, PHONE, ADDRESS
     Takes what the customer said, pulls out their details and returns what is
     left (the order) as `rest`.
     =================================================================== */
  const SPOKEN_DIGITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const NAME_STOP = new Set(('and my email e-mail phone cell mobile number whatsapp from at i is deliver delivery would want need like please a an the some ' +
    'two three four five six seven eight nine ten bags bag box boxes of coffee beans forte allora espresso mokka cafe house blend capsules jovo jova').split(' '));
  const titleCase = s => s.split(/\s+/).map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  const GREETING = /^\s*(?:hi|hello|hey|howzit|good\s+(?:morning|afternoon|evening))[\s,.!]*/i;

  function extractDetails(raw) {
    const out = {};
    let t = ' ' + raw.replace(/\s+/g, ' ') + ' ';

    // spoken digits ("oh eight two ...") -> digits, only for runs of 7 or more
    t = t.replace(/((?:\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[\s,.-]*){7,})/gi,
      run => run.toLowerCase().match(/zero|oh|one|two|three|four|five|six|seven|eight|nine/g).map(w => SPOKEN_DIGITS[w]).join('') + ' ');

    // email: typed ("a@b.co.za") or spoken ("a at b dot co dot za")
    let m = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/);
    if (m) { out.email = m[0].toLowerCase(); t = t.replace(m[0], ' '); }
    else {
      m = t.match(/\b([A-Za-z0-9_-]+(?:(?:\s+dot\s+|\.)[A-Za-z0-9_-]+)*)\s+at\s+([A-Za-z0-9-]+(?:\s+dot\s+[A-Za-z0-9-]+)+)(?![A-Za-z0-9-])/i);
      if (m) { out.email = (m[1] + '@' + m[2]).toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+/g, ''); t = t.replace(m[0], ' '); }
    }

    // SA mobile number
    m = t.match(/(?:^|[^\d])((?:\+?27|0)[\s-]?[6-8](?:[\s-]?\d){8})(?!\d)/);
    if (m) { out.phone = m[1].trim(); t = t.replace(m[1], ' '); }

    // delivery address, or "I'll collect"
    m = t.match(/\b(?:deliver(?:y|ed)?\s+(?:it\s+|them\s+)?to|delivery address(?:\s+is)?|my address is|address is|ship(?:\s+it|\s+them)?\s+to|send(?:\s+it|\s+them)?\s+to)\s+(.+?)(?=\.\s|\.?\s*$)/i);
    if (m) { out.addr = m[1].trim().replace(/[,\s]+$/, ''); t = t.replace(m[0], ' '); }
    else if (/\b(?:i'?ll|i will|will|going to)\s+(?:collect|pick(?: it)? up)\b|\bfor collection\b|\bcollection\b/i.test(t)) out.mode = 'collect';

    // name: "my name is ...", "it's ...", "this is ...", or a capitalised name at the start
    const nameRe = /\b(my name(?:'s| is)|name is|name:|this is|i am|i'm|it's|it is)\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3})/i;
    m = t.match(nameRe);
    if (m) {
      const strong = /name/i.test(m[1]), words = [];
      for (const w of m[2].split(/\s+/)) { if (NAME_STOP.has(w.toLowerCase())) break; words.push(w); }
      if (words.length && (strong || /^[A-Z]/.test(words[0]))) {
        out.name = titleCase(words.join(' '));
        t = t.replace(nameRe, (all, a, b) => ' ' + b.split(/\s+/).slice(words.length).join(' ') + ' ');
      }
    }
    if (!out.name) {
      const lead = t.replace(GREETING, '');
      const mm = lead.match(/^\s*([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2})\s*[,.]/);
      if (mm && !mm[1].split(/\s+/).some(w => NAME_STOP.has(w.toLowerCase()))) { out.name = mm[1]; t = lead.replace(mm[1], ' '); }
    }

    t = t.replace(/\s+/g, ' ');

    // company: "from Jozi Coffee"
    m = t.match(/\bfrom\s+([A-Z][A-Za-z0-9&'’ -]{1,40}?)(?=\s*[,.]|\s+(?:my|email|e-mail|phone|cell|and|deliver|i)\b|\s*$)/);
    if (m && out.name) { out.company = m[1].trim(); t = t.replace(m[0], ' '); }

    // tidy: what is left is the order
    t = t.replace(/\b(?:my\s+)?(?:e-?mail(?:\s+address)?|phone(?:\s+number)?|(?:cell|mobile|whatsapp|contact)(?:\s+number)?)\s*(?:is|:)?/gi, ' ')
      .replace(GREETING, ' ')
      .replace(/(?:\s*[,.]\s*){2,}/g, ', ').replace(/^[\s,.]+|[\s,.]+$/g, '').replace(/^(?:and|then)\s+/i, '');
    out.rest = t;
    return out;
  }

  /* ===================================================================
     "GET INVOICE": the main button
     =================================================================== */
  const detailsOk = () => S.cust.name.trim().length > 1 && mailOk(S.cust.email) && phoneOk(S.cust.phone);

  function getInvoice() {
    stopMic();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const raw = $('orderText').value.trim();
    let heard = 0;
    if (raw) {
      const d = extractDetails(raw);
      ['name', 'email', 'phone', 'company'].forEach(k => { if (d[k]) S.cust[k] = d[k]; });
      if (d.addr) { S.addr = d.addr; S.mode = 'deliver'; } else if (d.mode) S.mode = d.mode;
      const r = parseOrder(d.rest);
      r.items.forEach(i => addLine(i.pid, i.qty, i.size, i.grindSpoken ? i.grind : null));
      heard = r.items.length;
      S.missed = r.missed.filter(x => /[a-z]{4,}/i.test(x));
      $('orderText').value = '';
    }
    showStatus(heard);
    if (!S.cart.length) { renderSheet(); return toast(raw ? 'I did not catch an order. Tap items in the menu or try again' : 'Say or tap what you would like first'); }
    if (!detailsOk()) { renderSheet(); openModal(); return; }
    finishInvoice();
  }

  function showStatus() {
    const c = S.cust, no = txt => `<span class="no">${txt}</span>`;
    const bits = [c.name ? `<b>${esc(c.name)}</b>` : no('name?'), mailOk(c.email) ? esc(c.email) : no('email?'), phoneOk(c.phone) ? esc(c.phone) : no('phone?')];
    const n = S.cart.reduce((a, l) => a + l.qty, 0);
    $('st').innerHTML = '✓ ' + bits.join(' · ') + (n ? ` · ${n} item${n > 1 ? 's' : ''}` : '');
  }

  function finishInvoice() {
    const c = S.cust, prev = store.get('fabino_profile');
    profile = {
      name: c.name.trim(), email: c.email.trim(), display: c.phone.trim(), whatsapp: '+' + normPhone(c.phone), clientNo: normPhone(c.phone), company: c.company || '',
      marketingConsent: S.consent != null ? S.consent : !!(prev && prev.marketingConsent),
      registeredAt: (prev && prev.registeredAt) || new Date().toISOString()
    };
    store.set('fabino_profile', profile);
    const changed = !prev || ['email', 'clientNo', 'name', 'marketingConsent'].some(k => prev[k] !== profile[k]);
    if (changed) sendLead();
    S.view = 'invoice'; S.paid = false;
    if (!S.no) S.no = 'FAB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    renderSheet();
    $('sheetWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearText() { stopMic(); $('orderText').value = ''; $('st').innerHTML = ''; }

  function newOrder() {
    Object.assign(S, { cart: [], paid: false, no: '', sub: false, slot: null, eta: null, missed: [], view: 'order' });
    $('st').innerHTML = '';
    renderReorder(); renderSheet();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ===================================================================
     5. MICROPHONE (everything except iPhone/iPad)
     =================================================================== */
  let recognition = null, micOn = false, micBase = '';

  function setMicLabel(on) {
    const b = $('micBtn'); if (!b) return;
    b.classList.toggle('on', on);
    b.textContent = on ? '⏹ Listening… tap to stop' : '🎤 Tap to speak';
  }
  function stopMic() {
    micOn = false;
    try { if (recognition) recognition.stop(); } catch (e) { /* already stopped */ }
    setMicLabel(false);
  }
  function toggleMic() {
    if (micOn) return stopMic();
    if (!CAN_SPEAK) return;
    const box = $('orderText'); let finals = '';
    recognition = new SpeechRec();
    recognition.lang = 'en-ZA'; recognition.continuous = true; recognition.interimResults = true;
    micBase = box.value ? box.value.replace(/\s+$/, '') + ' ' : '';
    recognition.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      box.value = micBase + finals + interim;
    };
    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { micOn = false; setMicLabel(false); toast('Allow the microphone for this page, or type your order.'); }
    };
    recognition.onend = () => {                       // browsers stop after a pause: carry on while the button is on
      if (!micOn) return setMicLabel(false);
      micBase = box.value.replace(/\s+$/, '') + ' '; finals = '';
      try { recognition.start(); } catch (e) { micOn = false; setMicLabel(false); }
    };
    try { recognition.start(); micOn = true; setMicLabel(true); } catch (e) { toast('Could not start the microphone'); }
  }

  /* ===================================================================
     6. MENU, REORDER, SHEET
     =================================================================== */
  function renderMenu() {
    $('menu').innerHTML = PRODUCTS.map(p => `
      <div class="mi" id="mi-${p.id}" data-act="add" data-pid="${p.id}">
        <div class="im" style="background-image:url('${picture(p.im)}')"></div>
        <div class="nf"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div>
        <div class="pr">${p.kind === 'bean' ? 'from ' + zar(CFG.prices.beans250) : zar(CFG.prices[p.id])}<br><span class="qb" id="qb-${p.id}"></span></div>
        <button type="button" class="add" aria-label="Add ${esc(p.name)}">+</button>
      </div>`).join('');
  }

  function renderReorder() {
    const last = store.get('fabino_last');
    if (!last || !last.items || !last.items.length) { $('reorderCard').innerHTML = ''; return; }
    const txt = last.items.filter(i => P[i.pid]).map(i => `${i.qty}× ${P[i.pid].name}`).join(', ');
    $('reorderCard').innerHTML = `<div class="reorder"><div><small>Reorder last order</small><b>${esc(txt)}</b><small>${zar(last.total)}</small></div><button type="button" class="btn sm" data-act="reorder">Reorder</button></div>`;
  }
  function reorder() {
    const last = store.get('fabino_last'); if (!last) return toast('No previous order found');
    Object.assign(S, { cart: [], paid: false, no: '' });
    last.items.forEach(i => { if (P[i.pid]) addLine(i.pid, i.qty, i.size || CFG.defaultSize, i.grind).def = false; });
    renderSheet(); toast('Last order loaded');
    $('sheetWrap').scrollIntoView({ behavior: 'smooth' });
  }

  /* --- the sheet: first "Your order", then the tax invoice, then "Paid" --- */
  const options = (map, current) => Object.entries(map).map(([k, v]) => `<option value="${k}"${String(k) === String(current) ? ' selected' : ''}>${esc(v)}</option>`).join('');

  function lineHtml(l, readOnly) {
    const p = P[l.pid], bean = isBean(l.pid);
    const detail = bean ? `${CFG.sizes[l.size]} · ${CFG.grinds[l.grind]}` : p.unit;
    if (readOnly) {
      return `<div class="ln"><div class="nm"><b>${esc(p.name)}</b><small>${bean ? 'Coffee beans' : esc(p.unit)}</small></div>
        <div class="nm" style="grid-column:1/3"><small>${bean ? esc(detail) : ''}</small></div>
        <div class="qa"><span>${l.qty} × ${zar(priceOf(l))}</span><span class="am">${zarf(priceOf(l) * l.qty)}</span></div></div>`;
    }
    return `<div class="ln"><div class="nm"><b>${esc(p.name)}</b><small>${bean ? 'Coffee beans' : esc(p.unit)}</small></div>
      <button type="button" class="x" aria-label="Remove ${esc(p.name)}" data-act="remove" data-id="${l.id}">✕</button>
      ${bean ? `<div class="sel2">
        <select aria-label="Size" data-chg="size" data-id="${l.id}">${options(CFG.sizes, l.size)}</select>
        <select aria-label="Grind" class="${l.def ? 'def' : ''}" data-chg="grind" data-id="${l.id}">${options(CFG.grinds, l.grind)}</select></div>` : ''}
      <div class="qa"><span class="qty"><input type="number" inputmode="numeric" min="0" max="99" value="${l.qty}" aria-label="Quantity" data-chg="qty" data-id="${l.id}"><small>× ${zar(priceOf(l))}</small></span><span class="am">${zarf(priceOf(l) * l.qty)}</span></div></div>`;
  }

  function deliveryHtml(readOnly, eta) {
    if (readOnly) {
      return `<div class="dsec"><div class="lab">${S.mode === 'deliver' ? 'Delivery' : 'Collection'}</div>
        <div class="kv"><span>${S.mode === 'deliver' ? 'Delivery date' : 'Slot'}</span><span><b>${esc(eta.date)}</b></span></div>
        ${eta.window ? `<div class="kv"><span>Approx. time</span><span><b>${esc(eta.window)}</b></span></div>` : ''}
        ${S.mode === 'deliver' ? `<div class="kv"><span>Address</span><span style="text-align:right">${esc(S.addr)}</span></div>` : ''}</div>`;
    }
    const where = S.mode === 'deliver'
      ? `<div class="field-gap"><input id="invAddr" autocomplete="street-address" placeholder="Delivery address (street, suburb, city)" value="${esc(S.addr)}" aria-label="Delivery address"></div>
         <div class="notes">Delivery ${zar(CFG.rules.deliveryFee)}, free over ${zar(CFG.rules.freeOver)}.</div>`
      : `<div class="slots field-gap">${collectionSlots().map(x => `<button type="button" class="${S.slot === x ? 'sel' : ''}" data-act="slot" data-slot="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    return `<div class="dsec"><div class="lab">Delivery or collection</div>
      <div class="seg"><button type="button" class="${S.mode === 'deliver' ? 'sel' : ''}" data-act="mode" data-mode="deliver">Delivery</button><button type="button" class="${S.mode === 'collect' ? 'sel' : ''}" data-act="mode" data-mode="collect">Collect</button></div>${where}</div>`;
  }

  function subscriptionHtml(readOnly) {
    const pct = CFG.rules.subDisc;
    if (readOnly) return S.sub ? `<div class="kv"><span>Subscription</span><span>Every ${S.freq} weeks, ${pct}% off</span></div>` : '';
    const saving = Math.round(subtotal() * pct) / 100;
    return `<div class="dsec"><label class="cons big"><input type="checkbox" data-chg="sub"${S.sub ? ' checked' : ''}>
      <span><b>Make this a subscription</b> and save ${pct}% (${zarf(saving)}) on every order. Pause or cancel anytime.</span></label>
      ${S.sub ? `<div class="freq">${[2, 3, 4].map(w => `<button type="button" class="${S.freq === w ? 'sel' : ''}" data-act="freq" data-w="${w}">${w} weeks</button>`).join('')}</div>` : ''}</div>`;
  }

  function specialsHtml(readOnly) {
    if (readOnly || !CFG.specials.length) return '';
    return `<div class="dsec"><div class="lab">Specials &amp; recipes for you</div>${CFG.specials.map((sp, i) =>
      `<div class="spec"><div><b>${esc(sp.t)}</b><small>${esc(sp.x)}</small></div><button type="button" class="btn sm" data-act="special" data-i="${i}">Add</button></div>`).join('')}</div>`;
  }

  function partiesHtml(invoiceView, readOnly) {
    const c = S.cust;
    const who = c.name
      ? `<b>${esc(c.name)}</b>${c.company ? `<div class="small">${esc(c.company)}</div>` : ''}<div class="small">${esc(c.email) || '<span class="ph">email needed</span>'}</div>`
      : '<span class="ph">We ask for your details when you tap Get invoice</span>';
    return `<div class="parties"><div><div class="lab">For</div>${who}${invoiceView && !readOnly ? ` <button type="button" class="linkbtn" data-act="editDetails">Edit</button>` : ''}</div>
      <div><div class="lab">Client no.</div>${c.phone ? `<b>${esc(c.phone)}</b><div class="small">WhatsApp</div>` : '<span class="ph">your WhatsApp number</span>'}</div></div>`;
  }

  function bottomHtml(invoiceView, t, eta) {
    if (!invoiceView) return `<button type="button" class="btn payb dark" data-act="invoice">Get invoice</button>`;
    const first = esc((S.cust.name || '').split(' ')[0]);
    const status = S.paid
      ? `<div class="conf"><span class="pstat paidp">Paid</span> <b>Payment received. Thank you, ${first}!</b>
         <div class="small">Order ${esc(S.no)} is confirmed${S.mode === 'deliver' ? `. Delivery <b>${esc(eta.date)}</b>, ${esc(eta.window)}.` : '.'}</div></div>`
      : `<div class="paybox"><div class="pr1"><span class="pstat">Unpaid</span><b>Amount due ${zarf(t.total)}</b></div>
         <button type="button" class="btn payb" id="payBtn" data-act="pay">💳 Pay now · ${zarf(t.total)}</button>
         <div class="notes">Demo: no money is taken. The live app pays by card, Instant EFT or QR through Yoco or PayFast.</div></div>`;
    return `${status}<div class="acts"><button type="button" class="btn ghost" data-act="image">Save invoice as image</button>
      ${S.paid ? `<button type="button" class="btn ghost" data-act="newOrder">New order</button>` : `<button type="button" class="btn ghost" data-act="backToOrder">Back to order</button>`}</div>`;
  }

  function renderSheet() {
    // menu badges and the sticky "Get invoice" bar
    PRODUCTS.forEach(p => {
      const el = $('mi-' + p.id); if (!el) return;
      const q = S.cart.filter(l => l.pid === p.id).reduce((a, l) => a + l.qty, 0);
      el.classList.toggle('has', q > 0); $('qb-' + p.id).textContent = '× ' + q;
    });
    const n = S.cart.reduce((a, l) => a + l.qty, 0);
    $('sticky').classList.toggle('on', n > 0 && S.view === 'order');
    $('stkMain').textContent = n ? `Get invoice · ${n} item${n > 1 ? 's' : ''} · ${zarf(subtotal())}` : 'Get invoice';
    if (!S.cart.length && S.view !== 'invoice') { $('sheetWrap').innerHTML = ''; return; }

    const invoiceView = S.view === 'invoice', readOnly = S.paid, t = totals(), b = CFG.business;
    const eta = S.eta || etaFor(), early = etaFor();
    const missed = !readOnly && S.missed.length
      ? `<div class="miss"><b>Didn't catch</b><ul>${S.missed.map(m => `<li>“${esc(m)}”</li>`).join('')}</ul>Say it again in the box above, or tap it in the menu.</div>` : '';
    const addSelect = readOnly ? '' : `<select aria-label="Add a product" data-chg="addProduct" class="addsel"><option value="">+ Add product…</option>${PRODUCTS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`;
    const demo = LIVE ? '' : '<div class="notes demo">Demo mode: the server could not be reached, so these are sample prices and nothing is sent.</div>';
    const title = invoiceView ? (S.paid ? 'Paid' : 'Tax invoice') : 'Your order';

    $('sheetWrap').innerHTML = `<article class="sheet" id="sheet">
      <div class="sh-head"><div class="brandl"><img src="${ASSETS.brand}" alt=""><div><b>${esc(b.name)}</b>
        <div class="sh-meta left">${esc(b.city)}${b.phone ? ' · ' + esc(b.phone) : ''}${b.email ? '<br>' + esc(b.email) : ''}${b.vatReg && b.vatNo ? '<br>VAT no. ' + esc(b.vatNo) : ''}</div></div></div>
        <div class="sh-meta"><div class="sh-title ${S.paid ? 'paidt' : ''}">${title}</div>${invoiceView ? `<div><b>${esc(S.no)}</b></div>` : ''}<div>${dateStr(new Date())}</div></div></div>
      ${partiesHtml(invoiceView, readOnly)}
      <div class="lns">${S.cart.map(l => lineHtml(l, readOnly)).join('')}</div>
      ${missed}${addSelect}
      <div class="totals">
        ${t.disc ? `<div class="kv"><span>Subscription saving (${CFG.rules.subDisc}%)</span><span class="good">– ${zarf(t.disc)}</span></div>` : ''}
        <div class="kv"><span>Subtotal</span><span>${zarf(t.sub)}</span></div>
        <div class="kv"><span>${S.mode === 'collect' ? 'Collection' : 'Delivery'}</span><span>${t.fee ? zarf(t.fee) : 'Free'}</span></div>
        ${b.vatReg ? `<div class="kv"><span>VAT ${b.vatRate}% (included)</span><span>${zarf(t.vat)}</span></div>` : ''}
        <div class="tot g"><span>Total</span><span>${zarf(t.total)}</span></div>
      </div>
      ${deliveryHtml(readOnly, eta)}${subscriptionHtml(readOnly)}${specialsHtml(readOnly)}
      ${readOnly ? '' : `<div class="notes">Order before ${CFG.rules.cutoffHour}:00 on a weekday: delivery on ${esc(early.date)}, ${esc(early.window)}. Prices include VAT.</div>`}
      ${demo}${bottomHtml(invoiceView, t, eta)}</article>`;

    const addr = $('invAddr'); if (addr) addr.addEventListener('input', () => { S.addr = addr.value; });
  }

  /* --- details pop-up: only appears when name, email or phone are missing --- */
  const flag = (id, ok) => { $(id).closest('.f').classList.toggle('bad', !ok); return ok; };
  function openModal() {
    $('rName').value = S.cust.name || ''; $('rMail').value = S.cust.email || ''; $('rPhone').value = S.cust.phone || '';
    $('rCons').checked = !!(profile && profile.marketingConsent);
    ['rName', 'rMail', 'rPhone'].forEach(i => $(i).closest('.f').classList.remove('bad'));
    $('modal').hidden = false;
    setTimeout(() => $(!S.cust.name ? 'rName' : !mailOk(S.cust.email) ? 'rMail' : 'rPhone').focus(), 120);
  }
  function submitModal() {
    const n = $('rName').value.trim(), m = $('rMail').value.trim(), p = $('rPhone').value.trim();
    let ok = flag('rName', n.length > 1);
    ok = flag('rMail', mailOk(m)) && ok;
    ok = flag('rPhone', phoneOk(p)) && ok;
    if (!ok) return toast('Please fix the highlighted fields');
    Object.assign(S.cust, { name: n, email: m, phone: p }); S.consent = $('rCons').checked;
    $('modal').hidden = true; showStatus(); finishInvoice();
  }

  /* ===================================================================
     7. INVOICE AS AN IMAGE
     =================================================================== */
  const loadImage = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function invoiceCanvas() {
    const t = totals(), c = S.cust, b = CFG.business, W = 800, pad = 40;
    const rowH = 84, H = 400 + S.cart.length * rowH + 220;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#151008'; x.fillRect(0, 0, W, 110);
    const logo = await loadImage(ASSETS.brand); if (logo) x.drawImage(logo, pad, 15, 80, 80);
    const words = b.name.toUpperCase().split(' '), first = words[0] + ' ';
    x.fillStyle = '#fff'; x.font = '700 34px Georgia,serif'; x.fillText(first, pad + 100, 62);
    x.fillStyle = '#d4a82a'; x.fillText(words.slice(1).join(' '), pad + 100 + x.measureText(first).width, 62);
    x.fillStyle = '#fff'; x.textAlign = 'right'; x.font = '600 20px sans-serif'; x.fillText(S.paid ? 'PAID' : 'TAX INVOICE', W - pad, 50);
    x.font = '16px sans-serif'; x.fillText(S.no + ' · ' + dateStr(new Date()), W - pad, 80); x.textAlign = 'left';

    let y = 160;
    x.fillStyle = '#6b5d48'; x.font = '600 14px sans-serif'; x.fillText('FOR', pad, y); x.fillText('CLIENT NO. (WHATSAPP)', W / 2, y);
    x.fillStyle = '#151008'; x.font = '700 22px sans-serif'; y += 30; x.fillText(c.name, pad, y); x.fillText(c.phone, W / 2, y);
    x.font = '16px sans-serif'; y += 26; x.fillText(c.email, pad, y); if (c.company) x.fillText(c.company, pad, y + 24);
    y += 60; x.fillRect(pad, y, W - 2 * pad, 2); y += 34;

    S.cart.forEach(l => {
      const p = P[l.pid];
      x.fillStyle = '#151008'; x.font = '700 22px Georgia,serif'; x.fillText(p.name, pad, y);
      x.textAlign = 'right'; x.font = '700 22px sans-serif'; x.fillText(zarf(priceOf(l) * l.qty), W - pad, y); x.textAlign = 'left';
      x.fillStyle = '#6b5d48'; x.font = '16px sans-serif'; y += 26;
      x.fillText(`${l.qty} × ${zar(priceOf(l))} · ${isBean(l.pid) ? CFG.sizes[l.size] + ' · ' + CFG.grinds[l.grind] : p.unit}`, pad, y);
      y += 22; x.fillStyle = '#d9cdb2'; x.fillRect(pad, y, W - 2 * pad, 1); y += 32;
    });

    const row = (a, v, big) => {
      x.fillStyle = '#151008'; x.font = (big ? '700 28px' : '18px') + ' sans-serif'; x.fillText(a, pad, y);
      x.textAlign = 'right'; x.fillText(v, W - pad, y); x.textAlign = 'left'; y += big ? 44 : 30;
    };
    if (t.disc) row(`Subscription saving (${CFG.rules.subDisc}%)`, '– ' + zarf(t.disc));
    row(S.mode === 'collect' ? 'Collection' : 'Delivery', t.fee ? zarf(t.fee) : 'Free');
    if (b.vatReg) row(`VAT ${b.vatRate}% (included)`, zarf(t.vat));
    y += 6; row('Total', zarf(t.total), true);
    y += 10; x.fillStyle = '#6b5d48'; x.font = '15px sans-serif';
    if (S.paid && S.eta) x.fillText(S.mode === 'deliver' ? `Delivery: ${S.eta.date}, ${S.eta.window}` : `Collect: ${S.eta.date}`, pad, y);
    else { x.fillText('Unpaid. Pay in the app.', pad, y); if (b.vatReg && b.vatNo) { y += 24; x.fillText('VAT no. ' + b.vatNo, pad, y); } }
    return cv;
  }

  async function saveInvoiceImage() {
    try {
      const cv = await invoiceCanvas();
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const file = new File([blob], `Fabino-invoice-${S.no}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Fabino invoice ' + S.no }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const url = cv.toDataURL('image/png');
      $('imgOut').src = url;
      const dl = $('imgDl'); dl.href = url; dl.download = file.name;
      $('imgView').hidden = false;
    } catch (e) { toast('Could not make the image'); }
  }

  /* ===================================================================
     8. TALKING TO THE SERVER (and demo mode when it cannot be reached)
     =================================================================== */
  async function api(action, body) {
    const r = await fetch(CFG.api + '?a=' + action, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-fab': '1' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong');
    return j;
  }

  function applyBusiness() {
    $('bizName').textContent = CFG.business.name;
    $('bizTag').textContent = CFG.business.tagline;
    document.title = CFG.business.name + ' – ' + CFG.business.tagline;
  }

  async function loadMenu() {
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(CFG.api + '?a=menu', { signal: ctl.signal }); clearTimeout(timer);
      if (!r.ok) throw new Error('menu ' + r.status);
      const c = await r.json();
      Object.assign(CFG.business, c.business); Object.assign(CFG.rules, c.rules); Object.assign(CFG.prices, c.prices);
      CFG.specials = (c.specials || []).filter(x => P[x.pid]);
      LIVE = true;
    } catch (e) { console.log('[Fabino] server not reachable, using demo prices', e.message); }
    applyBusiness(); renderMenu(); renderSheet();
  }

  async function sendLead() {
    if (!LIVE || !profile) return;
    try { await api('lead', { customer: profile }); } catch (e) { console.log('[Fabino] lead not sent', e.message); }
  }

  async function payNow() {
    if (S.mode === 'deliver' && S.addr.trim().length < 6) { toast('Enter your delivery address'); const a = $('invAddr'); if (a) a.focus(); return; }
    if (S.mode === 'collect' && !S.slot) { toast('Pick a collection slot'); return; }
    const btn = $('payBtn'); btn.disabled = true; btn.textContent = 'Paying by card…';
    S.eta = etaFor();
    const items = S.cart.map(l => ({ pid: l.pid, qty: l.qty, size: l.size, grind: l.grind }));
    if (LIVE) {
      try {                                    // the server prices the order itself, so the app cannot change what you pay
        const o = await api('order', {
          customer: { name: profile.name, email: profile.email, phone: profile.display, company: profile.company || '', marketingConsent: !!profile.marketingConsent },
          items, mode: S.mode, addr: S.addr.trim(), slot: S.slot, sub: S.sub, freq: S.freq
        });
        S.no = o.no; await api('pay', { no: o.no });    // SIMULATED on the server until Yoco / PayFast is connected
        store.set('fabino_last', { items, total: o.totals.total, no: o.no, at: new Date().toISOString() });
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '💳 Pay now'; return; }
    } else {
      await new Promise(r => setTimeout(r, 1500));       // demo mode: nothing is sent anywhere
      store.set('fabino_last', { items, total: totals().total, no: S.no, at: new Date().toISOString() });
    }
    S.paid = true; renderReorder(); renderSheet();
    $('sheetWrap').scrollIntoView({ behavior: 'smooth' });
  }

  /* ===================================================================
     9. JURA SERVICE REQUEST, QR, EVENTS, START-UP
     =================================================================== */
  function openService() {
    $('sName').value = S.cust.name || ''; $('sMail').value = S.cust.email || ''; $('sPhone').value = S.cust.phone || '';
    ['sName', 'sMail', 'sPhone'].forEach(i => $(i).closest('.f').classList.remove('bad'));
    $('svcForm').hidden = false; $('svcDone').hidden = true; $('svcModal').hidden = false;
  }
  async function submitService() {
    const n = $('sName').value.trim(), m = $('sMail').value.trim(), p = $('sPhone').value.trim();
    let ok = flag('sName', n.length > 1);
    ok = flag('sMail', mailOk(m)) && ok;
    ok = flag('sPhone', phoneOk(p)) && ok;
    if (!ok) return toast('Please fix the highlighted fields');
    const req = { name: n, email: m, phone: p, model: $('sModel').value, type: $('sType').value, notes: $('sNotes').value, when: $('sWhen').value };
    try {
      const r = LIVE ? await api('service', req) : { ref: 'DEMO' };
      $('svcDoneText').innerHTML = `Thank you, ${esc(n.split(' ')[0])}. Our JURA team will contact you on ${esc(p)}.<br><small>Reference ${esc(r.ref)}${LIVE ? '' : ' (demo: not sent anywhere)'}</small>`;
      $('svcForm').hidden = true; $('svcDone').hidden = false;
    } catch (e) { toast(e.message); }
  }

  function showAppQr() {
    try {
      const url = location.href.split('#')[0].split('?')[0];
      if (!/^https?:/.test(url) || typeof qrcode === 'undefined') throw new Error('no qr');
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      $('appQr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      $('appUrl').textContent = url;
    } catch (e) { $('getApp').hidden = true; }
  }

  /* --- one click handler and one change handler for the whole page --- */
  const ACTIONS = {
    invoice: getInvoice,
    clear: clearText,
    mic: toggleMic,
    add: el => { addLine(el.dataset.pid, 1, CFG.defaultSize, null); renderSheet(); toast(P[el.dataset.pid].name + ' added'); },
    remove: el => { S.cart = S.cart.filter(l => l.id !== +el.dataset.id); renderSheet(); },
    mode: el => { S.mode = el.dataset.mode; renderSheet(); },
    slot: el => { S.slot = el.dataset.slot; renderSheet(); },
    freq: el => { S.freq = +el.dataset.w; renderSheet(); },
    special: el => { const sp = CFG.specials[+el.dataset.i]; addLine(sp.pid, 1, sp.size || CFG.defaultSize, sp.grind || null).def = false; toast(P[sp.pid].name + ' added'); renderSheet(); },
    reorder,
    newOrder,
    backToOrder: () => { S.view = 'order'; renderSheet(); },
    editDetails: openModal,
    pay: payNow,
    image: saveInvoiceImage,
    modalSubmit: submitModal,
    modalCancel: () => { $('modal').hidden = true; },
    openService,
    serviceSubmit: submitService,
    serviceClose: () => { $('svcModal').hidden = true; },
    imageClose: () => { $('imgView').hidden = true; }
  };
  const CHANGES = {
    size: el => { const l = S.cart.find(x => x.id === +el.dataset.id); if (l) { l.size = +el.value; renderSheet(); } },
    grind: el => { const l = S.cart.find(x => x.id === +el.dataset.id); if (l) { l.grind = el.value; l.def = false; renderSheet(); } },
    qty: el => {
      const l = S.cart.find(x => x.id === +el.dataset.id); if (!l) return;
      const n = Math.max(0, Math.min(99, parseInt(el.value, 10) || 0));
      if (!n) S.cart = S.cart.filter(x => x !== l); else l.qty = n;
      renderSheet();
    },
    sub: el => { S.sub = el.checked; renderSheet(); },
    addProduct: el => { if (el.value) { addLine(el.value, 1, CFG.defaultSize, null); renderSheet(); } }
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el);
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-chg]');
    if (el && CHANGES[el.dataset.chg]) CHANGES[el.dataset.chg](el);
  });

  /* --- start-up --- */
  (function init() {
    $('brandImg').src = ASSETS.brand;
    $('micBtn').hidden = !CAN_SPEAK;
    $('micHint').textContent = IS_IOS ? 'iPhone: tap 🎤 at the bottom right of your keyboard.'
      : CAN_SPEAK ? (IS_ANDROID ? 'Android: tap Speak below, or the 🎤 on your keyboard.' : 'Computer: tap Speak below.')
      : 'Tap the 🎤 on your keyboard to dictate.';
    applyBusiness(); renderMenu(); renderReorder(); renderSheet(); showAppQr();
    loadMenu();
  })();
})();
