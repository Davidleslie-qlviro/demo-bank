// api/lead.js — forwards every demo form/chat lead to GHL.
// Setup once in Vercel: Settings → Environment Variables → GHL_WEBHOOK_URL = your GHL inbound webhook URL. Then redeploy.

const ALLOWED = [/\.vercel\.app$/, /(^|\.)qlviro\.com$/, /^localhost$/];
const FIELDS = ["type", "business", "source", "name", "phone", "email", "zip", "service", "issue", "detail", "extra", "details", "slot"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const origin = req.headers.origin || "";
  let host = ""; try { host = new URL(origin).hostname; } catch (e) {}
  if (origin && !ALLOWED.some(r => r.test(host))) return res.status(403).json({ error: "origin" });
  if (!process.env.GHL_WEBHOOK_URL) return res.status(500).json({ error: "no webhook" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) {}
  const lead = {};
  for (const k of FIELDS) if (body[k] != null) lead[k] = String(body[k]).slice(0, 1000);
  if (!lead.name && !lead.phone) return res.status(400).json({ error: "empty" });
  lead.first_name = (lead.name || "").trim().split(/\s+/)[0] || "";
  lead.last_name = (lead.name || "").trim().split(/\s+/).slice(1).join(" ");
  lead.submitted_at = new Date().toISOString();

  try {
    const r = await fetch(process.env.GHL_WEBHOOK_URL, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lead)
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
