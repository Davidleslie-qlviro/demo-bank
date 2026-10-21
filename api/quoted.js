// api/quoted.js — builds a priced quote for Qlviro Quoted from the artisan's spoken job description.
// Uses the ANTHROPIC_API_KEY already set in Vercel (Settings → Environment Variables). No other setup needed.
// The prompt is built here on the server, so the key can't be used for anything except quotes.

const MODEL = "claude-sonnet-5-5";
const ALLOWED = [/\.vercel\.app$/, /(^|\.)qlviro\.com$/, /^localhost$/];
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

function buildPrompt(text, t) {
  const name = clip(t.name, 40) || "trades", main = clip(t.main, 30) || "Tradesperson", helper = clip(t.helper, 30) || "Helper";
  const hf = Math.min(1, Math.max(0.1, Number(t.hf) || 0.45)), rule = clip(t.rule, 400);
  return `You are a quoting assistant for a South African ${name.toLowerCase()} business.
Turn the tradesperson's spoken job description into a structured quote. Prices in South African Rand (ZAR), realistic 2026 trade-counter cost prices EXCLUDING VAT and EXCLUDING markup (markup is added later).
Labour rate is set by the business, so give only HOURS per labour line. The main worker is the "${main}". If a ${helper.toLowerCase()} or other helper is mentioned, add a separate labour line with "rate_factor": ${hf}. If no hours are given, estimate sensibly.
Include sundries where a tradesperson normally would. ${rule} Keep descriptions short (under 50 chars). The job description comes from phone dictation, so silently fix obvious mishearings of trade terms and SA place names (for example "PA board" or "DVD board" means "DB board", "earth leak" means "earth leakage").
Also write the SCOPE OF WORK: the itemised job description the client sees. Group it by area or room. Turn the tradesperson's shorthand into clear, professional work steps in the order they will be done, written so a homeowner understands (for example "strip, seal and replaster" becomes "Remove loose and damp plaster back to brick", "Apply damp-proof sealer", "Re-plaster and float to a smooth finish"). Add the prep, protection, disposal and clean-up steps a good tradesperson would do even if not mentioned (for example "Remove all rubble from site"). Keep each step under 80 characters.
Reply with only JSON in this shape:
{"client":"","site":"","summary":"one sentence of what will be done","scope":[{"area":"room or part of the job","steps":["work step"]}],"labour":[{"desc":"","hours":0,"rate_factor":1}],"materials":[{"desc":"","qty":0,"unit":0}],"notes":"timing, exclusions or conditions in one or two sentences"}

Job description:
"""${clip(text, 4000)}"""`;
}

function parseJSON(s) {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const origin = req.headers.origin || "";
  let host = ""; try { host = new URL(origin).hostname; } catch (e) {}
  if (origin && !ALLOWED.some(r => r.test(host))) return res.status(403).json({ error: "origin" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "no key" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const text = clip(body.text, 4000).trim();
  if (text.length < 15) return res.status(400).json({ error: "too short" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: buildPrompt(text, body.trade || {}) }] })
    });
    if (r.status === 429) return res.status(429).json({ error: "busy" });
    if (!r.ok) return res.status(502).json({ error: "ai " + r.status });
    const j = await r.json();
    const out = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const q = parseJSON(out);
    if (!q || !Array.isArray(q.labour) || !Array.isArray(q.materials)) return res.status(422).json({ error: "invalid_json" });
    return res.status(200).json(q);
  } catch (e) {
    return res.status(502).json({ error: "upstream" });
  }
};
