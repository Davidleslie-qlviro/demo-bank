// api/chat.js — live AI front desk for every demo in demo-bank.
// Setup once in Vercel: Settings → Environment Variables → ANTHROPIC_API_KEY = your key. Then redeploy.

const MODEL = "claude-haiku-4-5-20251001";
const ALLOWED = [/\.vercel\.app$/, /(^|\.)qlviro\.com$/, /^localhost$/];

function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }

function systemPrompt(b, today) {
  return `You are the front-desk assistant for ${clip(b.name, 80)}, a ${b.trade === "hvac" ? "heating and cooling (HVAC)" : "water, fire and mold damage restoration"} company in ${clip(b.city, 60)}.
Phone: ${clip(b.phone, 20)}. Open 24/7. Address: ${clip(b.address, 120)}.${b.owner ? ` The owner is ${clip(b.owner, 30)}.` : ""}
Services: ${clip((b.services || []).join("; "), 600)}.
Areas served: ${clip(b.areas, 300)}.
Today is ${today}.

Your job, in this order: understand the problem, check how urgent it is, collect the customer's name, phone number and town or ZIP, then offer two or three appointment windows in the next day and book the one they pick.
Rules:
- Sound like a calm, friendly local front desk. Keep every reply to 1–3 short sentences. Ask one question at a time.
- If there is active water, no heat in freezing weather, gas smell, sparking or any danger, tell them to call ${clip(b.phone, 20)} right now, and give one quick safety step (e.g. shut the main water valve, leave the house if they smell gas).
- Never quote prices or promise insurance outcomes. Say a technician confirms pricing on site before any work.
- Only talk about this company's services. If asked anything unrelated, steer back politely.
- Don't invent facts about the company beyond what's written here.
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
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .filter(m => m && (m.role === "user" || m.role === "assistant"))
    .map(m => ({ role: m.role, content: clip(m.content, 800) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return res.status(400).json({ error: "no messages" });

  const today = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: systemPrompt(b, today), messages: msgs })
    });
    if (!r.ok) return res.status(502).json({ error: "upstream " + r.status });
    const data = await r.json();
    let text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    let lead = null;
    const m = text.match(/<<LEAD\s*(\{[\s\S]*?\})\s*>>/);
    if (m) { try { lead = JSON.parse(m[1]); } catch (e) {} text = text.replace(m[0], "").trim(); }
    return res.status(200).json({ reply: text, lead });
  } catch (e) {
    return res.status(502).json({ error: "failed" });
  }
};

module.exports.systemPrompt = systemPrompt;
