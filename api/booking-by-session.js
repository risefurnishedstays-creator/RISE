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
const { priceParts } = require("../lib/pricing");
const { buildLeaseText, buildPetAddendumText } = require("../lib/leaseTemplate");

module.exports = async function handler(req, res) {
  // This endpoint is called cross-origin: confirmation.html is served from
  // GitHub Pages (risefurnishedstays.com) while this function runs on Vercel.
  // Without these headers the browser blocks the response before JS ever
  // sees it (a CORS failure, not a 404 -- different failure mode, same
  // "origin mismatch" root cause as the relative-fetch bug this replaced).
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
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

  // Optional: ?include=leaseText returns the exact lease/addendum text
  // lease.html displays before signing -- generated from the same
  // lib/leaseTemplate.js functions sign-lease.js uses to build the final
  // PDF, so what the guest reads on-screen always matches what gets
  // signed and archived. Folded into this existing endpoint rather than
  // creating a separate one, to stay under Vercel's Hobby function limit.
  let leaseText, petAddendumText;
  if ((req.query.include || "").toString() === "leaseText") {
    try {
      const pets = typeof booking.pets === "number" ? booking.pets : 0;
      const pricing = priceParts(booking.checkIn, booking.checkOut, pets);
      leaseText = buildLeaseText({
        guestName: booking.guestName,
        unitCode: booking.unitCode,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        fullTotal: pricing.fullTotal,
        dueToday: pricing.dueToday,
        paymentDates: pricing.paymentDates,
      });
      petAddendumText = buildPetAddendumText({ pets, petFeeTotal: pricing.petFee });
    } catch (e) {
      console.error("Could not build lease text for", confirmationCode, e.message);
    }
  }

  return res.status(200).json({ booking, leaseText, petAddendumText });
};
