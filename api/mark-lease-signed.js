// api/mark-lease-signed.js
//
// Marks a booking's lease as signed and decides what happens to the
// check-in instructions email per the 7-day rule:
//   - If check-in is less than 7 days away right now, send check-in
//     instructions IMMEDIATELY.
//   - Otherwise, schedule it for exactly 7 days before check-in -- the
//     daily cron (api/cron/scheduled-emails.js) will pick it up and send
//     it when that date arrives.
//
// This is a MANUAL trigger for now (you call it after a lease is signed,
// however you're tracking that today). Once BoldSign is integrated, its
// "all parties signed" webhook should call this same logic instead of you
// doing it by hand -- the shape of this endpoint is deliberately built to
// match what that webhook payload would look like (confirmationCode in,
// booking updated, email scheduled-or-sent out) so swapping the trigger
// later is a small change, not a rewrite.
//
// POST body: { confirmationCode }

const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { checkinEmailTiming } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const { checkinInstructionsEmail } = require("../lib/emailTemplates");

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

  const { confirmationCode } = req.body || {};
  if (!confirmationCode) {
    return res.status(400).json({ error: "confirmationCode is required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("mark-lease-signed lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (booking.leaseSignedAt) {
    return res.status(409).json({ error: "Lease already marked as signed for this booking.", leaseSignedAt: booking.leaseSignedAt });
  }

  const now = new Date().toISOString();
  const timing = checkinEmailTiming(booking.checkIn, now);

  const updates = { leaseSignedAt: now };
  let emailSentNow = false;

  if (timing.sendNow) {
    try {
      await sendEmail({
        to: booking.guestEmail,
        subject: `Check-in details for your stay - RISE Furnished Stays`,
        replyTo: "risefurnishedstays@gmail.com",
        html: checkinInstructionsEmail({
          guestName: booking.guestName,
          unitCode: booking.unitCode,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          confirmationCode: booking.confirmationCode,
          guidebookUrl: "https://www.risefurnishedstays.com/austin-guidebook.html",
        }),
      });
      updates.checkinEmailSent = true;
      emailSentNow = true;
    } catch (e) {
      console.error("Immediate check-in email failed for", confirmationCode, e.message);
      // Don't fail the whole request over an email hiccup -- the lease IS
      // signed regardless. Leave checkinEmailSent false so it's visible
      // something needs manual follow-up.
    }
  } else {
    updates.checkinEmailScheduledFor = timing.scheduledFor;
  }

  try {
    await updateBookingStatus(confirmationCode, updates);
  } catch (e) {
    console.error("CRITICAL: lease signed but booking record not updated:", confirmationCode, e.message);
    return res.status(500).json({ error: "Lease processing succeeded but storage update failed. Update manually." });
  }

  return res.status(200).json({
    confirmationCode,
    leaseSignedAt: now,
    checkinEmail: emailSentNow ? "sent" : "scheduled",
    scheduledFor: timing.scheduledFor,
  });
};
