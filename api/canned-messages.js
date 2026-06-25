// api/canned-messages.js
//
// Owner-only library of pre-written messages for answering common guest
// inquiries quickly. This is NOT automated -- nothing sends on its own.
// It's a personal reference: you draft a message once, save it here, and
// copy it whenever a matching question comes in.
//
// GET    /api/canned-messages              -> list all
// POST   /api/canned-messages               -> create { title, body }
// PUT    /api/canned-messages?id=...        -> update { title, body }
// DELETE /api/canned-messages?id=...        -> delete

const { Redis } = require("@upstash/redis");
const redis = Redis.fromEnv();

const LIST_KEY = "canned-messages:list"; // a single JSON array, since this is a small, low-write-frequency list

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

async function getAll() {
  const raw = await redis.get(LIST_KEY);
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

async function saveAll(list) {
  await redis.set(LIST_KEY, JSON.stringify(list));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    if (req.method === "GET") {
      const messages = await getAll();
      // Most recently updated first
      messages.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return res.status(200).json({ messages });
    }

    if (req.method === "POST") {
      const { title, body } = req.body || {};
      if (!title || !body) return res.status(400).json({ error: "title and body are required." });
      const messages = await getAll();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const now = new Date().toISOString();
      messages.push({ id, title, body, createdAt: now, updatedAt: now });
      await saveAll(messages);
      return res.status(200).json({ id, title, body, createdAt: now, updatedAt: now });
    }

    if (req.method === "PUT") {
      const id = (req.query && req.query.id || "").toString();
      const { title, body } = req.body || {};
      if (!id) return res.status(400).json({ error: "id query param is required." });
      if (!title || !body) return res.status(400).json({ error: "title and body are required." });
      const messages = await getAll();
      const idx = messages.findIndex((m) => m.id === id);
      if (idx === -1) return res.status(404).json({ error: "Message not found." });
      messages[idx] = { ...messages[idx], title, body, updatedAt: new Date().toISOString() };
      await saveAll(messages);
      return res.status(200).json(messages[idx]);
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id || "").toString();
      if (!id) return res.status(400).json({ error: "id query param is required." });
      const messages = await getAll();
      const filtered = messages.filter((m) => m.id !== id);
      if (filtered.length === messages.length) return res.status(404).json({ error: "Message not found." });
      await saveAll(filtered);
      return res.status(200).json({ deleted: true, id });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("canned-messages error:", e.message);
    return res.status(500).json({ error: "Internal error: " + e.message });
  }
};
