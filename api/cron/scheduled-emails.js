// api/cron/scheduled-emails.js
//
// Runs once per day (configured in vercel.json) and sends two kinds of
// calendar-based emails:
//   1. Check-in instructions, for bookings whose checkinEmailScheduledFor
//      date is today (set by mark-lease-signed.js when the lease was
//      signed more than 7 days before check-in).
//   2. Arrival reminders, for bookings whose check-in date is TODAY --
//      a short note hitting the most important house rules.
//
// IMPORTANT -- idempotency: Vercel cron delivery can occasionally invoke
// the same scheduled run more than once in a day. Each booking has a
// checkinEmailSent / arrivalReminderSent flag that's checked BEFORE
// sending and set immediately AFTER -- so even if this endpoint runs
// twice today, a given booking's email only goes out once. This matters
// more than it might seem: without this, a duplicate cron run would
// duplicate real emails to real guests.

const { listAllConfirmedBookings, updateBookingStatus } = require("../../lib/bookings");
const { key } = require("../../lib/pricing");
const { sendEmail } = require("../../lib/sendEmail");
const { checkinInstructionsEmail } = require("../../lib/emailTemplates");

const ARRIVAL_HOUSE_RULES_REMINDER = [
  "Quiet hours are 11:00 PM - 7:00 AM.",
  "No smoking, vaping, or drugs anywhere on the property.",
  "No parties or loud music, and no unregistered pets or guests.",
  "Please don't flush anything but toilet paper -- guests are responsible for plumbing costs from clogs.",
];

function isAuthorizedCronRequest(req) {
  // Vercel automatically sends the CRON_SECRET value as the Authorization
  // header when it invokes this endpoint -- see vercel.json. This also
  // allows manual testing by calling with the same header yourself.
  const auth = req.headers["authorization"];
  return auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}

module.exports = async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = key(new Date());
  const results = { checkinEmailsSent: [], arrivalRemindersSent: [], errors: [] };

  let bookings;
  try {
    bookings = await listAllConfirmedBookings();
  } catch (e) {
    console.error("scheduled-emails: could not list bookings:", e.message);
    return res.status(500).json({ error: "Could not list bookings." });
  }

  for (const booking of bookings) {
    // ---- Scheduled check-in instructions ----
    if (
      booking.checkinEmailScheduledFor === today &&
      !booking.checkinEmailSent &&
      booking.status === "confirmed"
    ) {
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
        await updateBookingStatus(booking.confirmationCode, { checkinEmailSent: true });
        results.checkinEmailsSent.push(booking.confirmationCode);
      } catch (e) {
        console.error("scheduled check-in email failed for", booking.confirmationCode, e.message);
        results.errors.push({ confirmationCode: booking.confirmationCode, step: "checkin", error: e.message });
      }
    }

    // ---- Arrival day reminder ----
    if (
      booking.checkIn === today &&
      !booking.arrivalReminderSent &&
      booking.status === "confirmed"
    ) {
      try {
        await sendEmail({
          to: booking.guestEmail,
          subject: `Welcome! A few reminders for your stay - RISE Furnished Stays`,
          replyTo: "risefurnishedstays@gmail.com",
          html: arrivalReminderEmailHtml(booking),
        });
        await updateBookingStatus(booking.confirmationCode, { arrivalReminderSent: true });
        results.arrivalRemindersSent.push(booking.confirmationCode);
      } catch (e) {
        console.error("arrival reminder email failed for", booking.confirmationCode, e.message);
        results.errors.push({ confirmationCode: booking.confirmationCode, step: "arrival", error: e.message });
      }
    }
  }

  return res.status(200).json({ date: today, ...results });
};

// Small standalone arrival-day template -- short and focused, distinct from
// the full check-in instructions email (which already covered address,
// door code, wifi, full house rules a week earlier). This is just a
// friendly "you're checking in today, quick reminders" nudge.
function arrivalReminderEmailHtml(booking) {
  const { unitDisplayName } = require("../../lib/emailTemplates");
  const unitName = unitDisplayName(booking.unitCode);
  const rulesHtml = ARRIVAL_HOUSE_RULES_REMINDER.map((r) => `<li>${r}</li>`).join("");
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width:600px; margin:0 auto; padding:24px;">
      <h2 style="color:#2b2926;">Welcome to ${unitName}!</h2>
      <p style="color:#6f6a63; font-size:15px; line-height:1.6;">Today's the day! Just a quick reminder of a few important house rules as you settle in:</p>
      <ul style="color:#6f6a63; font-size:14px; line-height:1.7;">${rulesHtml}</ul>
      <p style="color:#6f6a63; font-size:14px; line-height:1.6;">We hope you have a wonderful stay. Questions? Reach out to risefurnishedstays@gmail.com -- this address is not monitored, so please don't reply directly to this email.</p>
    </div>`;
}
