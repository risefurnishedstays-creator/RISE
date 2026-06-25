// api/list-bookings.js
//
// Owner-only. Lists every booking across all units, with full detail, so you
// can spot and clean up test-mode bookings that piled up in Redis during
// Stripe test-mode development. There's no field distinguishing test-mode
// from live-mode bookings (paymentIntentId/stripeCustomerId look identical
// either way), so this deliberately does NOT try to auto-detect "test"
// bookings -- it just gives you full visibility to judge for yourself, and
// a separate delete endpoint (delete-booking.js) to remove the ones you
// identify as test data.
//
// GET /api/list-bookings  (optionally ?unit=A to filter one unit)

const { listBookings } = require("../lib/bookings");

const VALID_UNITS = ["A", "B", "D"];

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const unitFilter = (req.query.unit || "").toString().toUpperCase();
  const units = unitFilter && VALID_UNITS.includes(unitFilter) ? [unitFilter] : VALID_UNITS;

  try {
    const all = [];
    for (const unit of units) {
      // activeOnly=false: we want to see EVERYTHING, including already-
      // cancelled bookings, so you have full visibility for cleanup.
      const bookings = await listBookings(unit, false);
      all.push(...bookings);
    }
    // Most recently created first, so new test bookings are easy to spot
    all.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return res.status(200).json({ count: all.length, bookings: all });
  } catch (e) {
    console.error("list-bookings failed:", e.message);
    return res.status(500).json({ error: "Could not list bookings." });
  }
};
