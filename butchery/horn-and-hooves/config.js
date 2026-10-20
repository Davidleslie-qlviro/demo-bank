/* =====================================================================
   HORN & HOOVES: CLIENT CONFIG
   This is the ONLY file that changes from one client to the next
   (together with assets.js for the logo and pictures).

   The live prices, rules, business details and specials come from the
   server (/api/hornhooves?a=menu) and are changed in the admin portal with
   two-person approval. The numbers below are only the fall-back used if
   the server cannot be reached, and the product list (names, text and the
   words the voice parser listens for).

   Prices are in South African Rand and include VAT.
   Products are numbered 1..N in this order: customers can say "2 kilos of number 3".
   ===================================================================== */
window.HH_CONFIG = {
  api: '/api/hornhooves',

  business: {
    name: 'Horns and Hooves',
    tagline: 'Premium butcher. Say it, we cut it.',
    city: 'Johannesburg, Gauteng',
    phone: '',
    email: '',
    vatReg: true,
    vatNo: '',
    vatRate: 15
  },

  rules: {
    deliveryFee: 60,      // Rand, charged when the order is below freeOver
    freeOver: 750,        // delivery is free above this amount
    subDisc: 5,           // standing-order discount, percent
    cutoffHour: 14,       // orders after this hour (or on weekends) go out one working day later
    window: '10:00 – 16:00'
  },

  /* weight products: price per kg.   each / pack products: price per item. */
  prices: {
    rump: 219, sirloin: 229, ribeye: 289, tbone: 199, mince: 129, chuck: 139, brisket: 149, shortrib: 169,
    lambchops: 279, lambshank: 249, porkbelly: 129, spareribs: 149, thighs: 89,
    boerewors: 139, droewors: 449, biltong: 429,
    sosaties: 32, familypack: 549, feastpack: 899
  },

  /* Weights a customer can pick for meat sold by the kg (grams: label). */
  weights: { 100: '100 g', 250: '250 g', 500: '500 g', 1000: '1 kg', 1500: '1.5 kg', 2000: '2 kg', 2500: '2.5 kg', 3000: '3 kg', 5000: '5 kg' },
  defaultWeight: 1000,

  /* How the butcher can cut it. Each weight product lists the ones it offers (first = default). */
  preps: {
    whole: 'Whole',
    steaks: 'Cut into steaks',
    sliced: 'Sliced',
    cubed: 'Cubed',
    minced: 'Minced',
    bonein: 'Bone-in',
    deboned: 'Deboned'
  },

  categories: ['Beef', 'Lamb', 'Pork', 'Chicken', 'Wors & Biltong', 'Braai Packs'],

  /* kind 'weight': priced per kg, sold by weight, may have preps. Optional piece = what one
                   counted item weighs, so "6 lamb chops" means 6 chops (about 120 g each).
     kind 'each' / 'pack': one fixed price per item.
     kw  = words the voice parser accepts for this product (lower case, no accents, include plurals).
     im  = which of the three pictures in assets.js to show. */
  products: [
    { id: 'rump',      kind: 'weight', cat: 'Beef', name: 'Rump Steak',      desc: 'Lean, full-flavoured steak for the braai.', preps: ['steaks', 'whole', 'cubed', 'sliced'], piece: { g: 300, word: 'steak' }, kw: ['rump steaks', 'rump steak', 'rumps', 'rump'], im: 0 },
    { id: 'sirloin',   kind: 'weight', cat: 'Beef', name: 'Sirloin',         desc: 'Tender steak with a fat cap.',             preps: ['steaks', 'whole'], piece: { g: 300, word: 'steak' }, kw: ['sirloin steaks', 'sirloin steak', 'sirloins', 'sirloin', 'striploin', 'porterhouse'], im: 2 },
    { id: 'ribeye',    kind: 'weight', cat: 'Beef', name: 'Ribeye',          desc: 'Well-marbled, our richest steak.',         preps: ['steaks', 'whole'], piece: { g: 350, word: 'steak' }, kw: ['ribeye steaks', 'ribeye steak', 'rib eye steaks', 'rib eye steak', 'ribeyes', 'rib eyes', 'ribeye', 'rib eye', 'scotch fillet'], im: 0 },
    { id: 'tbone',     kind: 'weight', cat: 'Beef', name: 'T-Bone',          desc: 'Sirloin and fillet on the bone.',          piece: { g: 450, word: 'T-bone' }, kw: ['t-bone steaks', 't-bone steak', 't bone steaks', 't bone steak', 't-bones', 't bones', 'tbones', 't-bone', 't bone', 'tbone', 'tea bones', 'tea bone'], im: 2 },
    { id: 'mince',     kind: 'weight', cat: 'Beef', name: 'Beef Mince',      desc: 'Lean beef mince, ground daily.',           kw: ['beef mince', 'lean mince', 'minced beef', 'ground beef', 'mince meat', 'mince'], im: 1 },
    { id: 'chuck',     kind: 'weight', cat: 'Beef', name: 'Chuck',           desc: 'Slow-cook and stewing beef.',              preps: ['cubed', 'whole', 'sliced'], kw: ['beef chuck', 'chuck steak', 'stewing beef', 'stew beef', 'chuck'], im: 1 },
    { id: 'brisket',   kind: 'weight', cat: 'Beef', name: 'Brisket',         desc: 'For smoking and slow roasting.',           preps: ['whole', 'sliced'], kw: ['beef brisket', 'brisket'], im: 1 },
    { id: 'shortrib',  kind: 'weight', cat: 'Beef', name: 'Short Rib',       desc: 'Meaty ribs for the smoker or oven.',       preps: ['bonein', 'deboned'], kw: ['beef short ribs', 'beef short rib', 'short ribs', 'short rib', 'beef ribs'], im: 1 },
    { id: 'lambchops', kind: 'weight', cat: 'Lamb', name: 'Lamb Chops',      desc: 'Karoo lamb loin chops.',                   piece: { g: 120, word: 'chop' }, kw: ['lamb loin chops', 'lamb chops', 'lamb chop', 'loin chops', 'chops', 'chop'], im: 2 },
    { id: 'lambshank', kind: 'weight', cat: 'Lamb', name: 'Lamb Shank',      desc: 'Slow-braise shanks.',                      piece: { g: 450, word: 'shank' }, kw: ['lamb shanks', 'lamb shank', 'shanks', 'shank'], im: 1 },
    { id: 'porkbelly', kind: 'weight', cat: 'Pork', name: 'Pork Belly',      desc: 'Crackling-ready pork belly.',              preps: ['whole', 'sliced', 'cubed'], kw: ['pork belly', 'pork bellies', 'belly'], im: 1 },
    { id: 'spareribs', kind: 'weight', cat: 'Pork', name: 'Pork Spare Ribs', desc: 'Sticky spare ribs, basted or plain.',       kw: ['pork spare ribs', 'pork ribs', 'spare ribs', 'spareribs', 'sticky ribs', 'ribs'], im: 1 },
    { id: 'thighs',    kind: 'weight', cat: 'Chicken', name: 'Chicken Thighs', desc: 'Free-range thighs.',                     preps: ['bonein', 'deboned'], piece: { g: 150, word: 'thigh' }, kw: ['chicken thighs', 'chicken thigh', 'chicken pieces', 'thighs', 'thigh', 'chicken'], im: 2 },
    { id: 'boerewors', kind: 'weight', cat: 'Wors & Biltong', name: 'Boerewors', desc: 'Traditional coriander wors.',            kw: ['boerewors', 'boerwors', 'boere wors', 'boer wors', 'boerie', 'bull wars', 'boer wars', 'wors'], im: 2 },
    { id: 'droewors',  kind: 'weight', cat: 'Wors & Biltong', name: 'Droëwors',  desc: 'Dried wors, cut to snack.',             kw: ['droewors', 'droe wors', 'dry wors', 'drywors', 'droog wors', 'drew wars'], im: 1 },
    { id: 'biltong',   kind: 'weight', cat: 'Wors & Biltong', name: 'Biltong',   desc: 'Beef biltong, wet or dry.',             preps: ['whole', 'sliced'], kw: ['beef biltong', 'biltong', 'bill tong'], im: 1 },
    { id: 'sosaties',  kind: 'each',   cat: 'Wors & Biltong', name: 'Lamb Sosaties', unit: 'each', desc: 'Marinated lamb skewers.', kw: ['lamb sosaties', 'sosaties', 'sosatie', 'sosatis', 'kebabs', 'kebab', 'skewers'], im: 0 },
    { id: 'familypack', kind: 'pack',  cat: 'Braai Packs', name: 'Family Braai Pack', unit: 'per pack', desc: '1 kg wors, 1 kg chops, 1 kg chicken.', kw: ['family braai packs', 'family braai pack', 'family packs', 'family pack'], im: 2 },
    { id: 'feastpack',  kind: 'pack',  cat: 'Braai Packs', name: 'Weekend Feast Pack', unit: 'per pack', desc: 'Steaks, ribs, wors and sosaties for 8.', kw: ['weekend feast packs', 'weekend feast pack', 'weekend feast', 'feast packs', 'feast pack', 'weekend pack'], im: 0 }
  ],

  /* Words that mean "a braai pack" without saying which one. */
  families: [
    { words: ['braai packs', 'braai pack', 'braai hamper', 'hamper', 'hampers'], dflt: 'familypack' }
  ],

  /* Shown only if the server cannot be reached. */
  specials: [
    { t: 'Braai special: Family Braai Pack', x: '1 kg wors, 1 kg chops and 1 kg chicken. Feeds 4 to 6.', pid: 'familypack' },
    { t: 'Recipe: Reverse-seared rump', x: 'Low oven, then a hot braai. Add 1 kg rump, cut into steaks.', pid: 'rump', size: 1000, prep: 'steaks' }
  ]
};
