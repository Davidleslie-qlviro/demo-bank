// api/chat.js — live AI front desk for every demo in demo-bank.
// Setup once in Vercel: Settings → Environment Variables → ANTHROPIC_API_KEY = your key. Then redeploy.

const MODEL = "claude-haiku-4-5-20251001";
const ALLOWED = [/\.vercel\.app$/, /(^|\.)qlviro\.com$/, /^localhost$/];

// Verified facts per demo business (from their sites, reviews and BBB). Keyed by business name.
const FACTS = {
  "Boston Restoration Solutions": "Owner Luis Mendes runs jobs personally and works directly with the customer's insurance company and adjuster, including photos, moisture readings and claim paperwork. BBB A+ accredited. Customers can call or text 781-299-6124.",
  "Boston Fire & Flood Restoration": "Works with all insurance companies and helps with the claim documentation. Free, no-obligation estimates. IICRC-certified, licensed and insured. Handles mitigation through reconstruction.",
  "Presidential HVAC & Electrical": "Specialists in ductless mini-splits and heat pumps, including Mitsubishi. Also boilers, furnaces, water heaters and electrical. Free at-home consultation for new system installs. Prefers to repair before recommending replacement.",
  "Clean Remodel": "Owner Enrique Quiñonez. Family-owned, IICRC Certified Firm. Works directly with insurance companies and adjusters with detailed estimates, and also gives clear estimates for private-pay customers. Handles mitigation and full reconstruction.",
  "Service Right": "Owner Jolly. Clear, upfront pricing given before work starts. Carries common parts on the truck so most repairs are done in one visit. Regular hours 6am–8pm, emergency service 24/7."
};

function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }

function systemPrompt(b, today) {
  return `You are the front-desk assistant for ${clip(b.name, 80)}, a ${b.trade === "hvac" ? "heating and cooling (HVAC)" : "water, fire and mold damage restoration"} company in ${clip(b.city, 60)}.
Phone: ${clip(b.phone, 20)}. Open 24/7. Address: ${clip(b.address, 120)}.${b.owner ? ` The owner is ${clip(b.owner, 30)}.` : ""}
Services: ${clip((b.services || []).join("; "), 600)}.
Areas served: ${clip(b.areas, 300)}.
Key facts: ${clip(b.facts || FACTS[b.name] || "", 600)}
Today is ${today}.

Your job, in this order: understand the problem, check how urgent it is, collect the customer's name, phone number and town or ZIP, then offer two or three appointment windows in the next day and book the one they pick.
Rules:
- Sound like a calm, friendly local front desk. Keep every reply to 1–3 short sentences. Ask one question at a time.
- If there is active water, no heat in freezing weather, gas smell, sparking or any danger: give one quick safety step (e.g. shut the main water valve, leave the house if they smell gas), say they can call ${clip(b.phone, 20)} right now, AND in the same reply ask for their name and number so the on-call tech can call them back within minutes. Never end an emergency without trying to get their details. For emergencies the "slot" is "ASAP callback".
- Don't greet again; the conversation has already started with a greeting.
- Never quote prices or promise insurance outcomes. Say a technician confirms pricing on site before any work.
- Only talk about this company's services. If asked anything unrelated, steer back politely.
- Don't invent facts or policies about the company beyond what's written here. If asked something not covered, say the technician will confirm it when they call.
- Once you have name, phone, town/ZIP and they've picked a time, confirm the booking in one sentence and then, on a new final line, output exactly:
<<LEAD {"name":"...","phone":"...","zip":"...","issue":"...","slot":"..."}>>
Output that line only once, only after the time is chosen.`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const origin = req.headers.origin || "";
  let host = ""; try { host = new URL(origin).hostname; } catch (e) {}
  if (origin && !ALLOWED.some(r => r.test(host))) return res.status(403).json({ error: "origin" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "no key" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const b = body.biz || {};
