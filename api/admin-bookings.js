// api/admin-bookings.js
//
// Merges what were two separate functions (list-bookings.js, delete-booking.js)
// into one, routed by HTTP method, to stay under Vercel's Hobby-plan
// 12-serverless-function limit. Behavior is unchanged from the originals --
// this is a routing consolidation, not a feature change.
//
// GET    /api/admin-bookings              -> list all bookings (optionally ?unit=A)
// DELETE /api/admin-bookings              -> delete one { unitCode, confirmationCode }

const { listBookings, deleteBooking } = require("../lib/bookings");

const VALID_UNITS = ["A", "B", "D"];

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  // ---- GET: list every booking across all units (was list-bookings.js) ----
  if (req.method === "GET") {
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
      console.error("admin-bookings (list) failed:", e.message);
      return res.status(500).json({ error: "Could not list bookings." });
    }
  }

  // ---- DELETE: permanently remove one booking record (was delete-booking.js) ----
  if (req.method === "DELETE") {
    const { unitCode, confirmationCode } = req.body || {};
    if (!unitCode || !confirmationCode) {
      return res.status(400).json({ error: "unitCode and confirmationCode are both required." });
    }
    try {
      const deleted = await deleteBooking(unitCode.toUpperCase(), confirmationCode);
      if (!deleted) {
        return res.status(404).json({ error: "No booking found at that unit + confirmation code." });
      }
      return res.status(200).json({ deleted: true, booking: deleted });
    } catch (e) {
      console.error("admin-bookings (delete) failed for", unitCode, confirmationCode, e.message);
      return res.status(500).json({ error: "Could not delete booking." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
