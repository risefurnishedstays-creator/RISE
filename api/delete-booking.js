// api/delete-booking.js
//
// Owner-only. PERMANENTLY deletes a booking record from Redis -- this is
// for cleaning up test-mode bookings, not for processing real guest
// cancellations (use cancel-booking.js for that, which keeps a record and
// handles Stripe refunds/invoices). This endpoint does NOT touch Stripe at
// all -- it only removes the Redis record. If the booking has a real
// Stripe charge behind it, that charge is untouched; this only affects
// what shows as "booked" on your own availability calendar and outbound
// iCal feed.
//
// POST body: { unitCode, confirmationCode }
// Both are required -- unitCode because Redis keys are booking:{unit}:{code},
// so this can't accidentally match a same-coded booking under a different
// unit (confirmation codes are derived from Stripe session IDs and could in
// principle collide across units, however unlikely).

const { deleteBooking } = require("../lib/bookings");

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

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
    console.error("delete-booking failed for", unitCode, confirmationCode, e.message);
    return res.status(500).json({ error: "Could not delete booking." });
  }
};
