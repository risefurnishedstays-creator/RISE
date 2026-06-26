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
const { key, addDays } = require("../../lib/pricing");
const { sendEmail } = require("../../lib/sendEmail");
const { checkinInstructionsEmail, leaseReminderEmail, checkoutInstructionsEmail, unitCheckinPdfAttachment } = require("../../lib/emailTemplates");

const ARRIVAL_HOUSE_RULES_REMINDER = [
  "Quiet hours are 11:00 PM - 7:00 AM.",
  "No smoking, vaping, or drugs anywhere on the property.",
  "No parties or loud music, and no unregistered pets or guests.",
  "Please don't flush anything but toilet paper -- guests are responsible for plumbing costs from clogs.",
];

// Days to wait after booking before nagging about an unsigned lease, and
// how many days CHECKOUT-instructions go out before the actual checkout date.
const LEASE_REMINDER_START_DAYS = 1;
const CHECKOUT_REMINDER_DAYS_BEFORE = 1;

function isAuthorizedCronRequest(req) {
  const auth = req.headers["authorization"];
  return auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}

module.exports = async function handler(req, res) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = key(new Date());
  const results = {
    checkinEmailsSent: [], arrivalRemindersSent: [],
    leaseRemindersSent: [], checkoutRemindersSent: [],
    errors: [],
  };

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
        const pdfAttachment = unitCheckinPdfAttachment(booking.unitCode);
        await sendEmail({
          to: booking.guestEmail,
          subject: `Check-in details for your stay - RISE Furnished Stays`,
          replyTo: "risefurnishedstays@gmail.com",
          attachments: pdfAttachment ? [pdfAttachment] : undefined,
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

    // ---- Daily lease-signing reminder, until signed ----
    // Sent once per day starting LEASE_REMINDER_START_DAYS after booking,
    // for as long as leaseSignedAt remains null. leaseReminderLastSent
    // (a date, not a boolean) is the idempotency guard here -- it lets the
    // SAME booking receive a fresh reminder every day, while still
    // guaranteeing at most one per calendar day even if this cron runs
    // twice (the same protection pattern as checkinEmailSent elsewhere,
    // just date-based instead of boolean since this repeats).
    if (
      !booking.leaseSignedAt &&
      booking.status === "confirmed" &&
      booking.leaseReminderLastSent !== today
    ) {
      const createdDate = booking.createdAt ? key(new Date(booking.createdAt)) : null;
      const eligibleFrom = createdDate ? key(addDays(new Date(createdDate), LEASE_REMINDER_START_DAYS)) : today;
      if (createdDate && today >= eligibleFrom) {
        try {
          // 3-day deadline counts from when the lease was originally sent
          // (booking creation date), same anchor leaseAgreementEmail uses --
          // not from today, so the stated deadline stays consistent across
          // every reminder rather than appearing to push back each day.
          const signByDate = key(addDays(new Date(createdDate), 3));
          await sendEmail({
            to: booking.guestEmail,
            subject: `Reminder: please sign your lease - RISE Furnished Stays`,
            replyTo: "risefurnishedstays@gmail.com",
            html: leaseReminderEmail({
              guestName: booking.guestName,
              unitCode: booking.unitCode,
              confirmationCode: booking.confirmationCode,
              signByDate,
              // No real lease URL exists yet (BoldSign integration is not
              // built) -- point to the contact page as a safe placeholder
              // rather than a dead/fake link. Replace once BoldSign is wired up.
              leaseUrl: "https://www.risefurnishedstays.com/contact.html",
            }),
          });
          await updateBookingStatus(booking.confirmationCode, { leaseReminderLastSent: today });
          results.leaseRemindersSent.push(booking.confirmationCode);
        } catch (e) {
          console.error("lease reminder email failed for", booking.confirmationCode, e.message);
          results.errors.push({ confirmationCode: booking.confirmationCode, step: "lease-reminder", error: e.message });
        }
      }
    }

    // ---- Checkout instructions, sent shortly before checkout ----
    if (
      booking.checkOut &&
      key(addDays(new Date(booking.checkOut), -CHECKOUT_REMINDER_DAYS_BEFORE)) === today &&
      !booking.checkoutEmailSent &&
      booking.status === "confirmed"
    ) {
      try {
        await sendEmail({
          to: booking.guestEmail,
          subject: `Checkout details for your stay - RISE Furnished Stays`,
          replyTo: "risefurnishedstays@gmail.com",
          html: checkoutInstructionsEmail({
            guestName: booking.guestName,
            unitCode: booking.unitCode,
            checkOut: booking.checkOut,
            confirmationCode: booking.confirmationCode,
          }),
        });
        await updateBookingStatus(booking.confirmationCode, { checkoutEmailSent: true });
        results.checkoutRemindersSent.push(booking.confirmationCode);
      } catch (e) {
        console.error("checkout reminder email failed for", booking.confirmationCode, e.message);
        results.errors.push({ confirmationCode: booking.confirmationCode, step: "checkout-reminder", error: e.message });
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
