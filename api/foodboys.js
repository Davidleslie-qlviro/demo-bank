/* Food Boys back end (one Vercel serverless function, twin of api/hornhooves.js). Nothing secret is ever sent to the customer app.
   ENV (set in Vercel > Settings > Environment Variables):
   FB_OWNER_EMAIL, FB_ADMIN_EMAIL (the two approvers), plus the shared SESSION_SECRET (long random text), RESEND_API_KEY, MAIL_FROM,
   KV_REST_API_URL + KV_REST_API_TOKEN (added automatically by the Upstash Redis integration), FB_GHL_WEBHOOK_URL (optional).
   Every database key starts with "fb:" so Food Boys data never mixes with the butchery ("hh:") or Fabino ("fab:").
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

/* ---------- defaults (prices incl. VAT, copied from foodboys.co.za/shop on 16 Nov 2026). The live values are stored in the database and changed only through approval ---------- */
/* The product list. The id is the Food Boys shop product number. Everything is a fixed-price item (pack, box, case or piece). */
const CATALOG = [
  { id: "3285", name: "Beef Biltong Dry Wors 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3283", name: "Beef Biltong Sliced 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "4174", name: "Beef Biltong Stokkies Chilli 200g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3287", name: "Beef Biltong Stokkies Plain 200g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3289", name: "Beef Boerewors 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3291", name: "Beef Burger Patties 4x150g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3315", name: "Beef Carpaccio Sliced 100g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3321", name: "Beef Chalmar Rib Eye Portions 1x350g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3319", name: "Beef Chalmar Rump Portions 1x300g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3317", name: "Beef Chalmar Sirloin Portions 1x300g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3323", name: "Beef Chalmar T-Bone Portions 1x500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "4464", name: "Beef Chalmar Tomahawk Steak 700g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3293", name: "Beef Cubes 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3295", name: "Beef Mince 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3311", name: "Beef Mince Lean/Steak 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3297", name: "Beef Oxtail Sliced 1kg", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3299", name: "Beef Rump Portioned 2x250g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3313", name: "Beef Short Rib Sliced 1kg", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3301", name: "Beef Sirloin Portioned 2x250g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3303", name: "Beef Steak Tenderized 4x100g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3305", name: "Beef Stewing Meat 1kg", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3307", name: "Beef Stir-Fry / Strogonoff 500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3309", name: "Beef T-Bone Steaks 1x500g", cat: "Beef", kind: 'pack', preps: [] },
  { id: "3369", name: "Lamb / Mutton Stewing Meat 1kg", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3375", name: "Lamb Burgers 4x150g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3363", name: "Lamb Chops Braai 4x150g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3365", name: "Lamb Chops Loin 4x100g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3367", name: "Lamb Cubes 500g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "4819", name: "Lamb Leg Deboned Roll (2.2–2.6 Kg)", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3373", name: "Lamb Mince 500g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "4063", name: "Lamb Shank Sliced 1x1kg Pack", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "4061", name: "Lamb Shanks Whole 2 X +-500g Total 1kg", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3371", name: "Lamb Stirfry 500g", cat: "Lamb", kind: 'pack', preps: [] },
  { id: "3377", name: "Pork Bacon Back 1kg", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3393", name: "Pork Bacon Bits 1kg", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3395", name: "Pork Bacon Shoulder/Prime 1kg", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3379", name: "Pork Bacon Streaky 1kg", cat: "Pork", kind: 'pack', preps: [] },
  { id: "4065", name: "Pork Belly 1x1kg Piece", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3381", name: "Pork Chops 4x250g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3383", name: "Pork Cubes 500g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "4067", name: "Pork Eisbein Pickled 1 Large 1.1-1.3kg", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3606", name: "Pork Kassler Steaks 4x150g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3385", name: "Pork Mince 500g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3387", name: "Pork Rashes Spiced 500g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3399", name: "Pork Ribs Cocktail Ribs Marinated 2kg Pack", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3389", name: "Pork Ribs Marinated B/IN Loin 2kg Pack", cat: "Pork", kind: 'pack', preps: [] },
  { id: "4069", name: "Pork Smoked Gammon D/B 1.6-2kg Piece", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3391", name: "Pork Stir-fry 500g", cat: "Pork", kind: 'pack', preps: [] },
  { id: "3325", name: "Chicken Breast Fillet 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4099", name: "Chicken Breast Fillet No Injection (5x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3329", name: "Chicken Breast Smoked 2kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3343", name: "Chicken Burgers 4x150g", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4535", name: "Chicken Crispy Cheesy Bites 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3357", name: "Chicken Crispy Strips 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4533", name: "Chicken Crispy Wings Plain 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3359", name: "Chicken Crispy Wings Spicy 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3355", name: "Chicken Crumbed Burgers 36x80g Case", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3341", name: "Chicken Cubes 500g", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4047", name: "Chicken Drumsticks No Injection (8x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3327", name: "Chicken Feet 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3347", name: "Chicken Giblets 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3345", name: "Chicken Gizzards 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4045", name: "Chicken Leg 1/4 No Injection (4x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3335", name: "Chicken Liver 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3339", name: "Chicken Mince 500g", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3337", name: "Chicken Mixed Portions 2kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3331", name: "Chicken Necks 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3351", name: "Chicken Nuggets 3kg Case", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3333", name: "Chicken Schnitzel 4kg Case", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3349", name: "Chicken Stirfry 500g", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3353", name: "Chicken Thighs D/B S/ON No Injection 1kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4049", name: "Chicken Thighs No Injection (6x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4043", name: "Chicken Whole No Injection 1x 1.2-1.4kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4051", name: "Chicken Wings No Injection (10x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4055", name: "Duck Breast (4x Per Pack)", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "4059", name: "Duck Whole 1x 1.6-2 Kg", cat: "Chicken & Duck", kind: 'pack', preps: [] },
  { id: "3407", name: "Sausage Beef Bangers 1kg", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4021", name: "Sausage Beef Breakfast Thin (1kg Pack)", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4019", name: "Sausage Bockwurst 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4027", name: "Sausage Cheese Griller Cocktail 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4031", name: "Sausage Cheese Griller Large 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "3409", name: "Sausage Chicken Bangers 1kg", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4023", name: "Sausage Chicken Breakfast (1kg Pack)", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "3910", name: "Sausage Chicken Cheese Grillers Footlong 4x Per Pack", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4035", name: "Sausage Cook Bratwurst-Grillwurst 1kg", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4029", name: "Sausage Frankfurters 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "3411", name: "Sausage Lamb Bangers 1kg", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4037", name: "Sausage Lamb Breakfast (1kg Pack)", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "3413", name: "Sausage Pork Bangers 1kg", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4033", name: "Sausage Pork Breakfast (1kg Pack)", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4015", name: "Sausage Pork Choriso (1x Per Pack)", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4008", name: "Sausage Pork Russian 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4017", name: "Sausage Vienna Chicken 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4011", name: "Sausage Vienna Cocktail 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "4013", name: "Sausage Vienna Smoked 500g", cat: "Sausages", kind: 'pack', preps: [] },
  { id: "3481", name: "Sliced Beef Pastrami 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3477", name: "Sliced Black Forest 100g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3475", name: "Sliced Bresaola Air Dried Beef 100g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3483", name: "Sliced Chicken Loaf 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3479", name: "Sliced Chicken Pastrami 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3461", name: "Sliced Gypsy Ham 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3485", name: "Sliced Hickory Ham 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3471", name: "Sliced Pancetta Flat 100g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3465", name: "Sliced Parma Ham 100g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3467", name: "Sliced Roast Beef 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3473", name: "Sliced Salami 500g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3463", name: "Sliced Sandwich Ham 1kg", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3405", name: "Venison Springbok Carpaccio 80g", cat: "Cold Meats", kind: 'pack', preps: [] },
  { id: "3435", name: "Fish Battered 60x 150g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3433", name: "Fish Battered Hake 12x150g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3431", name: "Fish Cakes 40x 50g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3415", name: "Fish Crab Sticks 1 Pack 800g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3820", name: "Fish Fingers 2kg Cases (±72 Portions)", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "4006", name: "Fish Marinara Mix 700g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3987", name: "Fish Mussels 1/2 Shell 700g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3427", name: "Fish Prawn Meat 20/40 1 Pack 800g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3417", name: "Fish Prawn Meat 40/60 1 Pack 800g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3423", name: "Fish Prawns 16-20 1 Pack 700g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3425", name: "Fish Prawns 21-25 1 Pack 700g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "4531", name: "Fish Prawns Vannamei Head On (41–50 Pieces Per 800g) Uncleaned", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "4753", name: "Fish Shrimps Cooked 240g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3429", name: "Fish Smoked Salmon Trout Sliced 1 Pack 500g", cat: "Fish & Seafood", kind: 'pack', preps: [] },
  { id: "3455", name: "Cheese Cheddar Grated 1kg", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "4039", name: "Cheese Loaf Cheddar (2–2.5kg Loaf)", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "4041", name: "Cheese Loaf Mozzarella (2–2.5kg Loaf)", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "3457", name: "Cheese Mozzarella Grated 1kg", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "3459", name: "Cheese Pizza Mix Moz/Ched 1kg", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "3487", name: "McCain Mozzarella Sticks 1kg", cat: "Dairy", kind: 'pack', preps: [] },
  { id: "3998", name: "Cocktail Beef Samosas (100 x 20g per box)", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3451", name: "Cocktail Beef Sausage Rolls 48's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4002", name: "Cocktail Cheese Samosas (100 x 20g per box)", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4004", name: "Cocktail Chicken Samosas (100 x 20g per box)", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4000", name: "Cocktail Vegetale Samosas (100 x 20g per box)", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4347", name: "Halaal Bobotie Pies 50x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4349", name: "Halaal Chicken Mayo Pies Mini 48x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4345", name: "Halaal Duck & Cherry Pie 50x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4365", name: "Halaal Falafel 50s", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4353", name: "Halaal Kofta Lamb 60x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4355", name: "Halaal Meatballs Keftedes 100x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3453", name: "Halaal Mini Pizza 48's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4361", name: "Halaal Spanakopita 96x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "4351", name: "Halaal Stolen Lamb Pie 50x Per Box", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3996", name: "Puff Pastry 2kg Pack", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3447", name: "Unbaked Beef Sausage Rolls 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3437", name: "Unbaked Chicken & Mushroom 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3445", name: "Unbaked Chicken Mayo 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3449", name: "Unbaked Cornish Pies 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3441", name: "Unbaked Pepper Steak 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3443", name: "Unbaked Steak & Kidney 24's", cat: "Snacks & Pies", kind: 'pack', preps: [] },
  { id: "3541", name: "Baked Cheesecake 24 X 120g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3527", name: "Bar One Choc Mousse 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3531", name: "Bar One Choc Mousse 24x100g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3529", name: "Black Forest Gateau 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3563", name: "Carrot Cake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3555", name: "Chocolate Brownies 18x110g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3557", name: "Chocolate Lava Puddings 20x120g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3547", name: "Death By Choc Cake 24 X 100g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3525", name: "Death By Choc Mousse 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3561", name: "English Toffee Pudding 12x110g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3539", name: "Lemon Cheesecake 18 x 130g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3523", name: "Lemon Cheesecake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3559", name: "Malva Puddings 12x120g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3537", name: "Mississippi Mud Cake 24 X 90g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3567", name: "Mississippi Mud Cake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3549", name: "Red Velvet Cake 24 X 100g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3543", name: "Red Velvet Cake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3533", name: "Strawberry Cheesecake 18 x 130g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3573", name: "Strawberry Cheesecake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3551", name: "Two Tier Choc Mousse Cake 24 x90g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3569", name: "Two Tier Choc Mousse Cake 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3535", name: "White Choc Almond Cake 24 X 90g", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3571", name: "White Choc Almond Mousse 24cm 1x Cake", cat: "Desserts & Cakes", kind: 'pack', preps: [] },
  { id: "3878", name: "Baby Carrots 1kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3515", name: "Breaded Mushrooms 1kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3495", name: "Cut Corn 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3507", name: "French Fries 7mm 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3501", name: "Garden Peas 1kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3503", name: "Hashbrowns Triangle 750g Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3880", name: "McCain Cut Green Beans 1kg", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3876", name: "McCains French Fries 7mm 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "4343", name: "McCains Sweet Potato Fries 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "4878", name: "Mini Potato Rosti 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3491", name: "Steak House Chips 2kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3489", name: "Straight Cut 10/12mm 2.5kg Pack", cat: "Veg & Chips", kind: 'pack', preps: [] },
  { id: "3517", name: "Pizza Bases 30cm 12x Per Pack", cat: "Wraps & Pizza", kind: 'pack', preps: [] },
  { id: "3521", name: "White Wraps 25cm 50x Per Box", cat: "Wraps & Pizza", kind: 'pack', preps: [] },
  { id: "5644", name: "Coffee Fabino Allora Cafe Beans 1kg", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5645", name: "Coffee Fabino Forte Cafe Beans 1kg", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5588", name: "Coffee Jovo Dark Beans 1kg", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5647", name: "Coffee Jovo Dark Coffee Capsules 50's", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5649", name: "Coffee Jovo Decaf Coffee Capsules 50's", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5646", name: "Coffee Jovo Medium Beans 1kg", cat: "Coffee", kind: 'pack', preps: [] },
  { id: "5648", name: "Coffee Jovo Medium Coffee Capsules 50's", cat: "Coffee", kind: 'pack', preps: [] }
];
const CAT = Object.fromEntries(CATALOG.map(p => [p.id, p]));
const PIDS = CATALOG.map(p => p.id);
const isWeight = p => CAT[p] && CAT[p].kind === 'weight';
const PREPS = [];
const prepFor = (pid, v) => { const l = CAT[pid].preps; return l.length ? (l.includes(v) ? v : l[0]) : null; };
const FULFIL = ['new', 'preparing', 'out', 'delivered', 'cancelled'];
/* PLACEHOLDER values (marked) must be confirmed with Food Boys and set in the admin portal before going live. */
const DEFAULT_CONFIG = {
  v: 1,
  business: { name: 'Food Boys', tagline: 'Quality food, delivered.', city: '', phone: '', email: '', vatReg: true, vatNo: '', vatRate: 15 },   // PLACEHOLDER: tagline, city, phone, email, VAT number
  bank: { bankName: '', accHolder: '', accNo: '', branch: '', accType: 'Cheque', payRef: 'Use your invoice number' },
  prices: {
    "3285": 185,
    "3283": 201,
    "4174": 101.9,
    "3287": 101.9,
    "3289": 75.5,
    "3291": 85.9,
    "3315": 51.5,
    "3321": 176.5,
    "3319": 85,
    "3317": 122.5,
    "3323": 197.5,
    "4464": 268,
    "3293": 87.5,
    "3295": 70.5,
    "3311": 76.9,
    "3297": 203,
    "3299": 107.5,
    "3313": 114.9,
    "3301": 107.5,
    "3303": 70,
    "3305": 127.5,
    "3307": 91.9,
    "3309": 127.5,
    "3369": 172.5,
    "3375": 107,
    "3363": 137.9,
    "3365": 136.5,
    "3367": 158.9,
    "4819": 750,
    "3373": 89.5,
    "4063": 223.5,
    "4061": 219.9,
    "3371": 158.9,
    "3377": 132.9,
    "3393": 130,
    "3395": 96.9,
    "3379": 153,
    "4065": 109.5,
    "3381": 94.5,
    "3383": 50.9,
    "4067": 97.9,
    "3606": 95,
    "3385": 50,
    "3387": 57,
    "3399": 238.9,
    "3389": 262,
    "4069": 232,
    "3391": 53,
    "3325": 77.5,
    "4099": 94.9,
    "3329": 298.9,
    "3343": 57.9,
    "4535": 95.9,
    "3357": 89.5,
    "4533": 113.9,
    "3359": 113.9,
    "3355": 278,
    "3341": 47,
    "4047": 80,
    "3327": 50,
    "3347": 35,
    "3345": 43.5,
    "4045": 105.5,
    "3335": 28,
    "3339": 47,
    "3337": 109.9,
    "3331": 16.9,
    "3351": 306.5,
    "3333": 492.9,
    "3349": 47,
    "3353": 118,
    "4049": 87,
    "4043": 98,
    "4051": 124.6,
    "4055": 361.9,
    "4059": 244.9,
    "3407": 146.9,
    "4021": 164,
    "4019": 74,
    "4027": 90,
    "4031": 86.5,
    "3409": 103.5,
    "4023": 113.9,
    "3910": 53.5,
    "4035": 127,
    "4029": 71.4,
    "3411": 146.9,
    "4037": 167,
    "3413": 114.5,
    "4033": 136.5,
    "4015": 50.5,
    "4008": 67,
    "4017": 74.9,
    "4011": 87.5,
    "4013": 74.9,
    "3481": 132.9,
    "3477": 29,
    "3475": 70,
    "3483": 81,
    "3479": 88.9,
    "3461": 101.5,
    "3485": 101.5,
    "3471": 54,
    "3465": 52.5,
    "3467": 157,
    "3473": 156.5,
    "3463": 98.5,
    "3405": 40.5,
    "3435": 780,
    "3433": 260,
    "3431": 180,
    "3415": 64,
    "3820": 242.5,
    "4006": 75,
    "3987": 142,
    "3427": 228,
    "3417": 197,
    "3423": 202,
    "3425": 187.9,
    "4531": 111,
    "4753": 39.5,
    "3429": 321.9,
    "3455": 158.5,
    "4039": 375,
    "4041": 395.9,
    "3457": 158.5,
    "3459": 158.5,
    "3487": 206,
    "3998": 364,
    "3451": 160,
    "4002": 340,
    "4004": 364,
    "4000": 279,
    "4347": 415,
    "4349": 229,
    "4345": 645,
    "4365": 265,
    "4353": 498,
    "4355": 396,
    "3453": 303,
    "4361": 645,
    "4351": 673,
    "3996": 102,
    "3447": 400,
    "3437": 400,
    "3445": 400,
    "3449": 400,
    "3441": 400,
    "3443": 400,
    "3541": 925,
    "3527": 536,
    "3531": 670,
    "3529": 465,
    "3563": 569,
    "3555": 645,
    "3557": 696,
    "3547": 614,
    "3525": 510,
    "3561": 368,
    "3539": 658,
    "3523": 513,
    "3559": 378,
    "3537": 647,
    "3567": 456,
    "3549": 684,
    "3543": 458,
    "3533": 720,
    "3573": 537,
    "3551": 652,
    "3569": 452,
    "3535": 693,
    "3571": 524,
    "3878": 47,
    "3515": 93.9,
    "3495": 102,
    "3507": 66.4,
    "3501": 44.5,
    "3503": 44.9,
    "3880": 45,
    "3876": 99.5,
    "4343": 203,
    "4878": 83,
    "3491": 45.5,
    "3489": 90,
    "3517": 260.5,
    "3521": 434,
    "5644": 390,
    "5645": 390,
    "5588": 264,
    "5647": 214,
    "5649": 250,
    "5646": 264,
    "5648": 214
  },
  rules: { deliveryFee: 0, freeOver: 0, subDisc: 0, cutoffHour: 14, window: '', deliveryNote: 'We deliver within a 50 km radius of our premises only.' },   // PLACEHOLDER: fee, free-over, discount, cut-off, window
  specials: []
};
const getConfig = async () => { const c = await getJ('fb:config'); if (!c) return DEFAULT_CONFIG; c.prices = { ...DEFAULT_CONFIG.prices, ...c.prices }; c.rules = { ...DEFAULT_CONFIG.rules, ...c.rules }; return c; };
const publicConfig = c => ({ v: c.v, business: { ...c.business, vatNo: c.business.vatNo }, prices: c.prices, rules: c.rules, specials: c.specials, bank: c.bank && c.bank.bankName && c.bank.accNo ? c.bank : null });

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

async function roles() { return (await getJ('fb:roles')) || { owner: lc(ENV.FB_OWNER_EMAIL), admin: lc(ENV.FB_ADMIN_EMAIL) }; }
async function roleOf(email) { const r = await roles(); email = lc(email); return email && email === r.owner ? 'owner' : email && email === r.admin ? 'admin' : null; }

async function sendMail(to, subject, text) {
  if (ENV.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + ENV.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ENV.MAIL_FROM || 'Food Boys Security <onboarding@resend.dev>', to: [to], subject, text }) });
    if (!r.ok) throw fail(502, 'Could not send the email');
  } else console.log('[mail not configured]', to, subject);
}
async function audit(who, action, id, summary) { await kv(['LPUSH', 'fb:audit', JSON.stringify({ at: new Date().toISOString(), who, action, id: id || '', summary: str(summary, 300) })]); await kv(['LTRIM', 'fb:audit', 0, 199]); }
async function notifyBoth(subject, text) { const r = await roles(); for (const e of [r.owner, r.admin]) if (e) { try { await sendMail(e, subject, text); } catch (x) { } } }

/* ---------- sessions & one-time codes ---------- */
function setCookie(res, name, val, maxAge) { res.setHeader('Set-Cookie', `${name}=${val}; HttpOnly; Secure; SameSite=Strict; Path=/api/foodboys; Max-Age=${maxAge}`); }
async function session(req) {
  const m = /(?:^|;\s*)fbs=([^;]+)/.exec(req.headers.cookie || ''); if (!m || !SECRET) return null;
  const [p, sig] = m[1].split('.'); if (!p || !sig || !eq(hmac(p), sig)) return null;
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
  if (!o.exp || o.exp < Date.now()) return null;
  const role = await roleOf(o.e); if (!role) return null;
  return { email: o.e, role };
}
const need = async (req) => { const s = await session(req); if (!s) throw fail(401, 'Please log in'); return s; };
async function issueCode(email, purpose) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex');
  await setJ(`fb:otp:${sha(email + purpose)}`, { h: sha(salt + code), salt, tries: 0 }, 600);
  return code;
}
async function checkCode(email, purpose, code) {
  const k = `fb:otp:${sha(email + purpose)}`, o = await getJ(k);
  if (!o) throw fail(400, 'Code expired. Ask for a new one.');
  if (o.tries >= 5) { await kv(['DEL', k]); throw fail(429, 'Too many wrong codes. Ask for a new one.'); }
  if (!eq(sha(o.salt + str(code, 10)), o.h)) { o.tries++; await setJ(k, o, 600); throw fail(400, 'Wrong code'); }
  await kv(['DEL', k]);
}

/* ---------- validation of a proposed change ---------- */
function cleanPatch(p) {
  const out = {}, num = (v, lo, hi) => { v = +v; if (!isFinite(v) || v < lo || v > hi) throw fail(400, 'A number is out of range'); return Math.round(v * 100) / 100; };
  if (p.prices) { out.prices = {}; for (const k of PIDS) if (p.prices[k] !== undefined) out.prices[k] = num(p.prices[k], 1, 100000); }
  if (p.rules) { out.rules = {}; const r = p.rules;
    if (r.deliveryFee !== undefined) out.rules.deliveryFee = num(r.deliveryFee, 0, 5000); if (r.freeOver !== undefined) out.rules.freeOver = num(r.freeOver, 0, 100000);
    if (r.subDisc !== undefined) out.rules.subDisc = num(r.subDisc, 0, 50); if (r.cutoffHour !== undefined) out.rules.cutoffHour = Math.round(num(r.cutoffHour, 0, 23)); if (r.window !== undefined) out.rules.window = str(r.window, 40); if (r.deliveryNote !== undefined) out.rules.deliveryNote = str(r.deliveryNote, 120); }
  if (p.business) { out.business = {}; const b = p.business; for (const k of ['name', 'tagline', 'city', 'phone', 'email', 'vatNo']) if (b[k] !== undefined) out.business[k] = str(b[k], 120);
    if (b.vatReg !== undefined) out.business.vatReg = !!b.vatReg; if (b.vatRate !== undefined) out.business.vatRate = num(b.vatRate, 0, 30); }
  if (p.bank) { out.bank = {}; for (const k of ['bankName', 'accHolder', 'accNo', 'branch', 'accType', 'payRef']) if (p.bank[k] !== undefined) out.bank[k] = str(p.bank[k], 80); }
  if (p.specials) { if (!Array.isArray(p.specials) || p.specials.length > 5) throw fail(400, 'Up to 5 specials'); out.specials = p.specials.map(s => {
    if (!PIDS.includes(s.pid)) throw fail(400, 'Unknown product in a special'); const o = { t: str(s.t, 60), x: str(s.x, 200), pid: s.pid };
    if (isWeight(s.pid)) { o.size = Math.round(+s.size) >= 50 && Math.round(+s.size) <= 20000 ? Math.round(+s.size) : 1000; const pr = prepFor(s.pid, s.prep); if (pr) o.prep = pr; } return o; }); }
  for (const g of Object.keys(out)) if (!Object.keys(out[g]).length && !Array.isArray(out[g])) delete out[g];
  if (!Object.keys(out).length) throw fail(400, 'Nothing to change');
  return out;
}
const mask = s => s ? '••••' + String(s).slice(-3) : '(empty)';
function summarise(patch, cur) {
  const bits = [];
  if (patch.prices) for (const k in patch.prices) bits.push(`${CAT[k] ? CAT[k].name : k}${isWeight(k) ? ' per kg' : ''}: R${cur.prices[k]} → R${patch.prices[k]}`);
  if (patch.rules) for (const k in patch.rules) bits.push(`${k}: ${cur.rules[k]} → ${patch.rules[k]}`);
  if (patch.business) for (const k in patch.business) bits.push(`business ${k}: ${cur.business[k]} → ${patch.business[k]}`);
  if (patch.bank) for (const k in patch.bank) bits.push(`BANK ${k}: ${k === 'accNo' ? mask(cur.bank[k]) + ' → ' + mask(patch.bank[k]) : (cur.bank[k] || '(empty)') + ' → ' + patch.bank[k]}`);
  if (patch.specials) bits.push(`specials: ${patch.specials.length} item(s)`);
  return bits.join('; ');
}
const merge = (cur, patch) => { const n = JSON.parse(JSON.stringify(cur)); for (const g of ['prices', 'rules', 'business', 'bank']) if (patch[g]) Object.assign(n[g], patch[g]); if (patch.specials) n.specials = patch.specials; n.v = (cur.v || 1) + 1; return n; };

/* ---------- approvals (maker-checker) ---------- */
const getPending = async () => (await getJ('fb:pending')) || [];
async function applyDue() { // role changes apply after the 24 hour hold
  const list = await getPending(); let ch = false;
  for (const p of list) if (p.status === 'holding' && p.applyAfter <= Date.now()) {
    const r = await roles(); await setJ('fb:roles', { owner: p.patch.owner || r.owner, admin: p.patch.admin || r.admin });
    p.status = 'applied'; ch = true; await audit('system', 'roles-applied', p.id, `owner=${p.patch.owner || 'same'} admin=${p.patch.admin || 'same'}`);
    await notifyBoth('Food Boys: role change applied', 'The approved change of owner/admin has now taken effect.');
  }
  if (ch) await setJ('fb:pending', list.slice(0, 50));
}

/* ---------- order maths (server is the only authority on prices) ---------- */
function priceOf(c, it) { const pr = c.prices; return isWeight(it.pid) ? Math.round(pr[it.pid] * it.size / 10) / 100 : pr[it.pid]; }   // per kg x weight, to the cent
function orderTotals(c, items, sub, mode) {
  const subtotal = items.reduce((a, l) => a + priceOf(c, l) * l.qty, 0), disc = sub ? Math.round(subtotal * c.rules.subDisc) / 100 : 0, after = subtotal - disc;
  const fee = mode === 'collect' || after === 0 || after > c.rules.freeOver ? 0 : c.rules.deliveryFee, total = after + fee;
  const vat = c.business.vatReg ? total * c.business.vatRate / (100 + c.business.vatRate) : 0;
  return { subtotal, subscriptionDiscount: disc, deliveryFee: fee, total, vatIncluded: Math.round(vat * 100) / 100, currency: 'ZAR' };
}
async function hook(event, data) {
  if (!ENV.FB_GHL_WEBHOOK_URL) return;
  try { await fetch(ENV.FB_GHL_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, source: 'Food Boys Order App', sentAt: new Date().toISOString(), ...data }) }); } catch (e) { }
}

/* ---------- the handler ---------- */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const a = (req.query && req.query.a) || new URL(req.url, 'http://x').searchParams.get('a');
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch (e) { return {}; } })() : (req.body || {});
  const send = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try {
    if (req.method === 'POST' && req.headers['x-fb'] !== '1') throw fail(403, 'Blocked');
    if (!SECRET || SECRET.length < 24) throw fail(500, 'Server is not set up yet (SESSION_SECRET)');
    await applyDue();

    /* ===== public ===== */
    if (a === 'menu') return send(200, publicConfig(await getConfig()));
    if (a === 'lead' && req.method === 'POST') {
      await limit('fb:rl:lead:' + ip(req), 20, 3600); const c = body.customer || {};
      if (!str(c.name, 80).trim() || !mailOk(c.email) || !phoneOk(c.display)) throw fail(400, 'Check your details');
      const lead = { name: str(c.name, 80), email: lc(c.email), whatsapp: '+' + '27' + String(c.display).replace(/[\s\-()]/g, '').replace(/^(?:\+27|0027|27|0)/, ''), company: str(c.company, 80), marketingConsent: !!c.marketingConsent, at: new Date().toISOString() };
      await kv(['LPUSH', 'fb:leads', JSON.stringify(lead)]); await kv(['LTRIM', 'fb:leads', 0, 1999]); await hook('registration', { customer: lead }); return send(200, { ok: true });
    }
    if (a === 'enquiry' && req.method === 'POST') { // event or custom order enquiry
      await limit('fb:rl:enq:' + ip(req), 10, 3600);
      const nm = str(body.name, 80).trim(), em = lc(body.email), ph = str(body.phone, 30);
      if (nm.length < 2 || !mailOk(em) || !phoneOk(ph)) throw fail(400, 'Check your details');
      const ref = 'ENQ-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const r = { ref, at: new Date().toISOString(), name: nm, email: em, phone: ph, date: str(body.date, 60), guests: str(body.guests, 40), notes: str(body.notes, 500), status: 'new' };
      await kv(['LPUSH', 'fb:enq', JSON.stringify(r)]); await kv(['LTRIM', 'fb:enq', 0, 499]); await hook('event_enquiry', { request: r });
      return send(200, { ok: true, ref });
    }
    if (a === 'order' && req.method === 'POST') {
      await limit('fb:rl:order:' + ip(req), 30, 3600); const c = await getConfig(), cu = body.customer || {};
      if (!str(cu.name, 80).trim() || !mailOk(cu.email) || !phoneOk(cu.phone)) throw fail(400, 'Check your details');
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 80) throw fail(400, 'Empty order');
      const items = body.items.map(i => { if (!PIDS.includes(String(i.pid))) throw fail(400, 'Unknown product'); const pid = String(i.pid), q = Math.round(+i.qty); if (!(q >= 1 && q <= 99)) throw fail(400, 'Bad quantity');
        if (!isWeight(pid)) return { pid, qty: q, size: 0, prep: null };
        const g = Math.round(+i.size); if (!(g >= 50 && g <= 20000)) throw fail(400, 'Bad weight');
        return { pid, qty: q, size: g, prep: prepFor(pid, i.prep) }; });
      const mode = body.mode === 'collect' ? 'collect' : 'deliver', sub = !!body.sub, email = lc(cu.email);
      if (mode === 'deliver' && str(body.addr, 200).trim().length < 6) throw fail(400, 'Delivery address needed');
      /* The invoice number is made in the app so the EFT reference matches. The server keeps it unless it is already used by someone else. */
      let no = /^FB-[A-Z0-9]{6}$/.test(str(body.no, 12)) ? str(body.no, 12) : '', reuse = false;
      if (no) { const ex = await getJ('fb:order:' + no); if (ex) { if (ex.status === 'unpaid' && ex.customer.email === email) reuse = true; else no = ''; } }
      if (!no) no = 'FB-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
      const payMethod = body.payMethod === 'eft' ? 'eft' : 'card';
      const order = { no, at: new Date().toISOString(), items, mode, addr: str(body.addr, 200), slot: str(body.slot, 60), sub, freq: [2, 3, 4].includes(+body.freq) ? +body.freq : 2,
        customer: { name: str(cu.name, 80), email, phone: str(cu.phone, 30), company: str(cu.company, 80), marketingConsent: !!cu.marketingConsent }, totals: orderTotals(c, items, sub, mode), status: 'unpaid', fulfil: 'new', payMethod, cfgV: c.v };
      await setJ('fb:order:' + no, order, 60 * 60 * 24 * 400);
      if (!reuse) { await kv(['LPUSH', 'fb:orders', no]); await kv(['LTRIM', 'fb:orders', 0, 999]); }
      if (payMethod === 'eft') await hook('order_eft', { order });
      return send(200, { no, totals: order.totals, bank: c.bank.bankName ? c.bank : null });
    }
    if (a === 'pay' && req.method === 'POST') { // SIMULATED. Replace this block with a Yoco / PayFast checkout + signed webhook confirmation.
      await limit('fb:rl:pay:' + ip(req), 30, 3600); const o = await getJ('fb:order:' + str(body.no, 20)); if (!o) throw fail(404, 'Order not found');
      if (o.status !== 'paid') { o.status = 'paid'; o.paidAt = new Date().toISOString(); o.payment = { method: 'DEMO', reference: 'SIM-' + crypto.randomBytes(3).toString('hex').toUpperCase() }; await setJ('fb:order:' + o.no, o, 60 * 60 * 24 * 400); await hook('order', { order: o }); }
      return send(200, { status: o.status, reference: o.payment.reference });
    }

    /* ===== login ===== */
    if (a === 'otp_request' && req.method === 'POST') {
      const email = lc(body.email); await limit('fb:rl:otp:ip:' + ip(req), 15, 3600); await limit('fb:rl:otp:' + sha(email), 5, 3600);
      let dev; if (await roleOf(email)) { const code = await issueCode(email, 'login'); await sendMail(email, 'Your Food Boys sign-in code', `Your code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.`); if (ENV.DEV_CODES === '1') dev = code; }
      return send(200, { ok: true, dev }); // same answer whether or not the email is known
    }
    if (a === 'otp_verify' && req.method === 'POST') {
      const email = lc(body.email); await limit('fb:rl:ver:' + ip(req), 30, 3600); const role = await roleOf(email); if (!role) throw fail(400, 'Wrong code');
      await checkCode(email, 'login', body.code);
      const p = b64u(JSON.stringify({ e: email, exp: Date.now() + 8 * 3600e3 })); setCookie(res, 'fbs', p + '.' + hmac(p), 8 * 3600);
      await audit(email, 'login', '', role); return send(200, { ok: true, role });
    }
    if (a === 'logout') { setCookie(res, 'fbs', '', 0); return send(200, { ok: true }); }

    /* ===== admin portal ===== */
    const me = await need(req);
    if (a === 'state') {
      const list = (await getPending()).filter(p => p.status !== 'rejected'), ids = await kv(['LRANGE', 'fb:orders', 0, 99]), orders = [];
      for (const n of ids) { const o = await getJ('fb:order:' + n); if (o) orders.push(o); }
      return send(200, { me, config: await getConfig(), catalog: CATALOG, preps: PREPS, roles: await roles(), pending: list.slice(0, 20).map(p => ({ ...p, patch: p.patch })), audit: (await kv(['LRANGE', 'fb:audit', 0, 39])).map(JSON.parse), orders, enquiries: (await kv(['LRANGE', 'fb:enq', 0, 49])).map(JSON.parse), leads: (await kv(['LRANGE', 'fb:leads', 0, 499])).map(JSON.parse), fulfil: FULFIL });
    }
    if (a === 'order_update' && req.method === 'POST') { // staff move an order along (preparing, out for delivery, delivered, cancelled) or mark an EFT as received
      await limit('fb:rl:ou:' + sha(me.email), 300, 3600); const o = await getJ('fb:order:' + str(body.no, 20)); if (!o) throw fail(404, 'Order not found');
      const notes = [];
      if (body.fulfil !== undefined) { if (!FULFIL.includes(body.fulfil)) throw fail(400, 'Unknown status'); if ((o.fulfil || 'new') !== body.fulfil) { o.fulfil = body.fulfil; o.fulfilAt = new Date().toISOString(); notes.push('status ' + body.fulfil); } }
      if (body.markPaid && o.status !== 'paid') { o.status = 'paid'; o.paidAt = new Date().toISOString(); o.payment = { method: o.payMethod === 'eft' ? 'EFT' : 'MANUAL', reference: 'RECEIVED-' + o.no }; notes.push('marked paid'); }
      if (!notes.length) return send(200, { ok: true, order: o });
      await setJ('fb:order:' + o.no, o, 60 * 60 * 24 * 400); await audit(me.email, 'order', o.no, notes.join('; ')); await hook('order_update', { order: o });
      return send(200, { ok: true, order: o });
    }
    if (a === 'stepup_request' && req.method === 'POST') {
      await limit('fb:rl:su:' + sha(me.email), 10, 3600); const code = await issueCode(me.email, 'stepup:' + str(body.id, 30));
      await sendMail(me.email, 'Food Boys security approval code', `Your approval code is ${code}. It expires in 10 minutes. Only use it if YOU are approving this change.`);
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
      const list = await getPending(); list.unshift(p); await setJ('fb:pending', list.slice(0, 50)); await audit(me.email, 'proposed', id, p.summary);
      const other = (await roles())[me.role === 'owner' ? 'admin' : 'owner']; if (other) { try { await sendMail(other, 'Food Boys: change waiting for your approval', `${me.role} proposed:\n\n${p.summary}\n\nOpen the Food Boys admin portal to review it.`); } catch (e) { } }
      if (p.risk !== 'normal') await notifyBoth('Food Boys: ' + (p.kind === 'roles' ? 'role' : 'bank details') + ' change proposed', p.summary + '\n\nProposed by ' + me.email + '. If this was not expected, reject it in the admin portal.');
      return send(200, { ok: true, id });
    }
    if ((a === 'approve' || a === 'reject') && req.method === 'POST') {
      const list = await getPending(), p = list.find(x => x.id === body.id); if (!p || !['pending', 'holding'].includes(p.status)) throw fail(404, 'Not found');
      if (a === 'reject') { p.status = 'rejected'; await setJ('fb:pending', list); await audit(me.email, 'rejected', p.id, p.summary); if (p.risk !== 'normal') await notifyBoth('Food Boys: change rejected/cancelled', p.summary); return send(200, { ok: true }); }
      if (p.status !== 'pending') throw fail(400, 'Already approved and on hold');
      if (lc(p.by) === me.email) throw fail(403, 'You cannot approve your own change. The other person must.');
      if (p.risk !== 'normal') await checkCode(me.email, 'stepup:' + p.id, body.code);
      if (p.kind === 'roles') { p.status = 'holding'; p.approvedBy = me.email; p.applyAfter = Date.now() + 24 * 3600e3; await setJ('fb:pending', list); await audit(me.email, 'approved-hold', p.id, p.summary);
        await notifyBoth('Food Boys: role change approved, 24 hour hold', p.summary + '\n\nIt takes effect in 24 hours. Either of you can cancel it in the portal until then.'); return send(200, { ok: true, holdUntil: p.applyAfter }); }
      const cur = await getConfig(); await setJ('fb:config', merge(cur, p.patch)); p.status = 'applied'; p.approvedBy = me.email; await setJ('fb:pending', list); await audit(me.email, 'approved', p.id, p.summary);
      if (p.risk !== 'normal') await notifyBoth('Food Boys: bank details changed', p.summary); return send(200, { ok: true });
    }
    if (a === 'export') { // orders as CSV for the GAAP point of sale / accountant
      const ids = await kv(['LRANGE', 'fb:orders', 0, 999]), rows = [['order', 'date', 'payment', 'fulfilment', 'name', 'phone', 'email', 'items', 'mode', 'address', 'total', 'vat', 'reference'].join(',')];
      for (const n of ids) { const o = await getJ('fb:order:' + n); if (!o) continue; const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
        rows.push([o.no, o.at, o.status, o.fulfil || 'new', q(o.customer.name), q(o.customer.phone), q(o.customer.email), q(o.items.map(i => `${i.qty}x ${CAT[i.pid] ? CAT[i.pid].name : i.pid}${i.size ? ' ' + i.size + 'g' : ''}${i.prep ? ' ' + i.prep : ''}`).join('; ')), o.mode, q(o.addr), o.totals.total, o.totals.vatIncluded, o.payment ? o.payment.reference : ''].join(',')); }
      await audit(me.email, 'export', '', rows.length - 1 + ' orders'); res.statusCode = 200; res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="food-boys-orders.csv"'); return res.end(rows.join('\n'));
    }
    throw fail(404, 'Unknown action');
  } catch (e) { return send(e.status || 500, { error: e.status ? e.message : 'Server error' }); }
};
