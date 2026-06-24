// api/cancel-preview.js
//
// Read-only: looks up a booking and returns what cancel-booking.js WOULD do,
// without touching Stripe or storage. Lets the admin page show you the
// refund/liability outcome before you click the real "Cancel & Refund" button.
//
// GET /api/cancel-preview?confirmationCode=ABC123&noticeDate=2026-09-15
// noticeDate is optional, defaults to today.

const { getBooking } = require("../lib/bookings");
const { cancellationOutcome } = require("../lib/pricing");

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  // admin-cancel-booking.html is served from GitHub Pages while this
  // function runs on Vercel -- genuinely cross-origin. The custom
  // x-admin-secret header forces the browser to preflight with OPTIONS,
  // so that must be handled explicitly or the real GET never fires.
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const { confirmationCode, noticeDate } = req.query || {};
  if (!confirmationCode) {
    return res.status(400).json({ error: "confirmationCode is required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("Error looking up booking:", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }

  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (booking.status === "cancelled" || booking.status === "cancelled-midstay") {
    return res.status(200).json({
      booking,
      alreadyCancelled: true,
    });
  }

  const outcome = cancellationOutcome(booking.checkIn, booking.checkOut, noticeDate, booking.pets);
  return res.status(200).json({ booking, outcome, alreadyCancelled: false });
};
