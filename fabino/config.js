/* =====================================================================
   FABINO COFFEE: CLIENT CONFIG
   This is the ONLY file that changes from one client to the next
   (together with assets.js for the logo and pictures).

   The live prices, rules, business details and specials come from the
   server (/api/fabino?a=menu) and are changed in the admin portal with
   two-person approval. The numbers below are only the fall-back used if
   the server cannot be reached, and the product list (names, text and the
   words the voice parser listens for).

   Prices are in South African Rand and include VAT.
   ===================================================================== */
window.FABINO_CONFIG = {
  api: '/api/fabino',

  business: {
    name: 'Fabino Coffee',
    tagline: "Say it. We'll brew the rest.",
    city: 'Johannesburg, Gauteng',
    phone: '',
    email: '',
    vatReg: true,
    vatNo: '',
    vatRate: 15
  },

  rules: {
    deliveryFee: 75,      // Rand, charged when the order is below freeOver
    freeOver: 600,        // delivery is free above this amount
    subDisc: 10,          // subscription discount, percent
    cutoffHour: 14,       // orders after this hour (or on weekends) go out one working day later
    window: '08:00 – 13:00'
  },

  prices: {
    beans250: 105, beans500: 200, beans1000: 390,   // every bean product shares these
    jdark: 214, jmed: 214, jdec: 250                // capsule boxes
  },

  sizes: { 250: '250 g', 500: '500 g', 1000: '1 kg' },
  defaultSize: 500,

  grinds: {
    whole: 'Whole bean',
    espresso: 'Espresso',
    filter: 'Filter / Pour-over',
    plunger: 'Plunger / French press',
    moka: 'Moka pot'
  },
  defaultGrind: 'whole',

  /* kind 'bean': priced by size, has a grind.   kind 'caps': one fixed price per box.
     kw  = words the voice parser accepts for this product (lower case, no accents).
     im  = which of the three pictures in assets.js to show. */
  products: [
    { id: 'house',    kind: 'bean', name: 'House Blend', desc: 'Our everyday roast. Chocolate, caramel, balanced.',   kw: ['house blend', 'house', 'blend', 'everyday'], im: 0 },
    { id: 'allora',   kind: 'bean', name: 'Allora',      desc: 'Smooth and sweet, gentle acidity.',                   kw: ['allora', 'alora'],                           im: 1 },
    { id: 'forte',    kind: 'bean', name: 'Forte',       desc: 'Bold and dark, built for milk drinks.',               kw: ['forte', 'fortay'],                           im: 2 },
    { id: 'espresso', kind: 'bean', name: 'Espresso',    desc: 'Rich crema, classic Italian-style roast.',            kw: ['espresso'],                                  im: 0 },
    { id: 'cafe',     kind: 'bean', name: 'Café',        desc: 'Light-bodied filter-friendly everyday cup.',          kw: ['cafe'],                                      im: 1 },
    { id: 'mokka',    kind: 'bean', name: 'Mokka',       desc: 'Deep, chocolatey, made for the stovetop.',            kw: ['mokka', 'mocha', 'mocca', 'mokha'],          im: 2 },
    { id: 'jdark',    kind: 'caps', name: 'Jovo Dark capsules',   unit: 'box of 50', desc: 'Dark roast, 50 capsules.',   kw: ['dark'],             im: 2 },
    { id: 'jmed',     kind: 'caps', name: 'Jovo Medium capsules', unit: 'box of 50', desc: 'Medium roast, 50 capsules.', kw: ['medium'],           im: 1 },
    { id: 'jdec',     kind: 'caps', name: 'Jovo Decaf capsules',  unit: 'box of 50', desc: 'Decaf, 50 capsules.',        kw: ['decaf', 'decaff'],  im: 0 }
  ],

  /* Words that mean "capsules" ("1 jovo", "two boxes of pods"). If the customer
     does not say which roast, the family's default product is used. */
  families: [
    { words: ['jovo', 'jova', 'capsule', 'capsules', 'pod', 'pods', 'nespresso'], dflt: 'jdark' }
  ],

  /* Shown only if the server cannot be reached. */
  specials: [
    { t: 'Recipe: Iced Forte', x: 'Cold brew over ice with a splash of milk. Add 500 g Forte, plunger grind.', pid: 'forte', size: 500, grind: 'plunger' },
    { t: 'Pairs well: Jovo Decaf', x: 'A box of 50 decaf capsules for the evening cup.', pid: 'jdec' }
  ]
};
