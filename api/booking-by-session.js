// api/booking-by-session.js
//
// Used by confirmation.html (via rise-confirm.js) to render the real,
// server-side booking record instead of relying on sessionStorage set by
// the checkout page. sessionStorage doesn't survive a new tab/device, a
// cleared session, or a guest revisiting their confirmation link later --
// this endpoint makes the confirmation page reflect what's actually in
// storage, the same source of truth the webhook and iCal feed use.
//
// GET /api/booking-by-session?session_id=cs_test_...
//
// confirmationCode is deterministically derived from the session id the
// same way stripe-webhook.js does it (session.id.slice(-10).toUpperCase()),
// so no new field needs to be added to the booking record and no Stripe
// API call is needed here -- this only touches Redis.

const { getBooking } = require("../lib/bookings");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const sessionId = (req.query && req.query.session_id || "").toString();
  if (!sessionId) {
    return res.status(400).json({ error: "session_id is required." });
  }

  const confirmationCode = sessionId.slice(-10).toUpperCase();

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("booking-by-session lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }

  if (!booking) {
    // Not necessarily an error -- the webhook may not have finished
    // processing yet if the guest landed here within ~1-2s of paying.
    // The frontend should retry briefly before showing an empty state.
    return res.status(404).json({ error: "Booking not found yet." });
  }

  return res.status(200).json({ booking });
};
