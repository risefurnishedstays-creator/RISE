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
// GET /api/booking-by-session?confirmation_code=RISE-XXXXXX
//
// confirmationCode is a randomly-generated, storage-checked-unique value
// (see generateConfirmationCode() in lib/bookings.js) rather than derived
// from the session id -- it can no longer be recomputed here the way it
// used to be, so a session_id lookup instead scans stored bookings for a
// matching stripeSessionId field (saved at booking time in
// stripe-webhook.js). This is the same scan-based lookup pattern already
// used elsewhere (e.g. stripe-webhook.js's findConfirmationCodeByPaymentIntent).
//
// confirmation_code exists as a second way in, for links in reminder
// emails sent days after the original checkout session -- the guest's
// actual confirmation code is shown to them right after booking, so by
// the time a reminder email goes out days later, this is the more direct
// path. Both query params are accepted by lease.html/id-upload.html
// themselves; whichever is present is forwarded here as-is.

const { getBooking, listAllConfirmedBookings } = require("../lib/bookings");
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
  const confirmationCodeParam = (req.query && req.query.confirmation_code || "").toString();
  if (!sessionId && !confirmationCodeParam) {
    return res.status(400).json({ error: "session_id or confirmation_code is required." });
  }

  let booking;
  let confirmationCode;
  try {
    if (confirmationCodeParam) {
      confirmationCode = confirmationCodeParam.toUpperCase();
      booking = await getBooking(confirmationCode);
    } else {
      const all = await listAllConfirmedBookings();
      booking = all.find((b) => b.stripeSessionId === sessionId) || null;
      confirmationCode = booking ? booking.confirmationCode : null;
    }
  } catch (e) {
    console.error("booking-by-session lookup failed for", confirmationCode || sessionId, e.message);
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
