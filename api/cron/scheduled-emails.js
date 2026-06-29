// api/cron/scheduled-emails.js
//
// Runs once per day (configured in vercel.json) and sends several kinds of
// calendar-based emails, plus one non-email action:
//   0. Day-5 payment capture: for "pending-capture" bookings whose 5-day
//      free-cancellation window has closed, captures the held PaymentIntent.
//      The capture's SUCCESS handling (confirming the booking, creating
//      future installment invoices, sending the real payment-confirmed
//      emails) happens in api/stripe-webhook.js's
//      handleAmountCapturableUpdated, triggered by the resulting Stripe
//      event -- this cron only triggers the capture itself.
//   1. Check-in instructions, for bookings whose checkinEmailScheduledFor
//      date is today (set by sign-lease.js when the lease was signed more
//      than 7 days before check-in).
//   2. Arrival reminders, for bookings whose check-in date is TODAY --
//      a short note hitting the most important house rules.
//   3. Daily lease-signing reminders, for the first LEASE_DEADLINE_DAYS
//      after booking, until the lease is signed. Once that window passes
//      with no signature, instead of continuing to nag the guest forever,
//      a one-time alert goes to the owner for manual review (no automatic
//      cancellation/refund is taken). Applies to "pending-capture" AND
//      "confirmed" bookings, since lease-signing happens during days 1-3,
//      before the day-5 capture/confirmation step above.
//   4. Weekly ID-upload reminders, for as long as the lease is signed but
//      the ID isn't uploaded -- plus one urgent reminder the day before
//      check-in if it's still missing by then.
//   5. Checkout instructions, sent shortly before the checkout date.
//
// IMPORTANT -- idempotency: Vercel cron delivery can occasionally invoke
// the same scheduled run more than once in a day. Each booking has a
// checkinEmailSent / arrivalReminderSent flag that's checked BEFORE
// sending and set immediately AFTER -- so even if this endpoint runs
// twice today, a given booking's email only goes out once. This matters
// more than it might seem: without this, a duplicate cron run would
// duplicate real emails to real guests. The capture step itself is
// naturally idempotent too: a booking only stays in "pending-capture"
// until the capture succeeds, after which status flips to "confirmed" and
// it no longer matches this step's filter on a subsequent run.

const Stripe = require("stripe");
const { listAllConfirmedBookings, updateBookingStatus } = require("../../lib/bookings");
const { key, addDays } = require("../../lib/pricing");
const { sendEmail } = require("../../lib/sendEmail");
const { checkinInstructionsEmail, leaseReminderEmail, idUploadReminderEmail, ownerLeaseOverdueAlertEmail, checkoutInstructionsEmail, unitCheckinPdfAttachment } = require("../../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ARRIVAL_HOUSE_RULES_REMINDER = [
  "Quiet hours are 11:00 PM - 7:00 AM.",
  "No smoking, vaping, or drugs anywhere on the property.",
  "No parties or loud music, and no unregistered pets or guests.",
  "Please don't flush anything but toilet paper -- guests are responsible for plumbing costs from clogs.",
];

// Days to wait after booking before nagging about an unsigned lease, the
// hard deadline at which the daily nag stops and an owner alert fires
// instead, how often to nudge about a missing ID, and how many days
// CHECKOUT-instructions go out before the actual checkout date.
const LEASE_REMINDER_START_DAYS = 1;
const LEASE_DEADLINE_DAYS = 3;
const ID_REMINDER_INTERVAL_DAYS = 7;
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
    capturesAttempted: [], capturesSucceeded: [], captureErrors: [],
    checkinEmailsSent: [], arrivalRemindersSent: [],
    leaseRemindersSent: [], leaseOverdueAlertsSent: [],
    idRemindersSent: [], idUrgentRemindersSent: [],
    checkoutRemindersSent: [],
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
    // ---- Day-5 payment capture ----
    // Captures the held PaymentIntent once captureScheduledFor has
    // arrived. Only acts on "pending-capture" bookings -- once captured
    // (or cancelled within the grace window), the booking's status moves
    // on and this stops matching. captureScheduledFor was set by
    // stripe-webhook.js at booking time to exactly 5 days out, so
    // comparing it to today (both "YYYY-MM-DD" strings) is enough; no
    // separate retry-tracking flag is needed since the only way this
    // booking stops being "pending-capture" is a successful capture (this
    // step or a retry of it) or a cancellation (the admin cancel flow,
    // which cancels the PaymentIntent directly and moves status to
    // "cancelled" itself).
    if (
      booking.status === "pending-capture" &&
      booking.captureScheduledFor &&
      today >= booking.captureScheduledFor &&
      booking.paymentIntentId
    ) {
      results.capturesAttempted.push(booking.confirmationCode);
      try {
        const captured = await stripe.paymentIntents.capture(booking.paymentIntentId);
        if (captured.status === "succeeded") {
          results.capturesSucceeded.push(booking.confirmationCode);
          // Booking status update, future-installment invoice creation,
          // and the real payment-confirmed emails all happen in
          // api/stripe-webhook.js's handleAmountCapturableUpdated, fired
          // by the payment_intent.amount_capturable_updated event this
          // capture call triggers -- not duplicated here, so there's only
          // one place that logic lives.
        } else {
          // Manual captures normally resolve synchronously to
          // "succeeded" -- anything else here is unexpected and worth a
          // loud log, though no further action is taken automatically.
          console.error("Unexpected PaymentIntent status after capture for", booking.confirmationCode, ":", captured.status);
          results.captureErrors.push({ confirmationCode: booking.confirmationCode, status: captured.status });
        }
      } catch (e) {
        // Card declined on capture, authorization expired, or some other
        // Stripe-side failure -- log loudly. The booking stays
        // "pending-capture" so this retries automatically tomorrow, but a
        // human should check in on repeated failures (e.g. the card may
        // need updating, same as a failed installment).
        console.error("CRITICAL: payment capture failed for", booking.confirmationCode, ":", e.message);
        results.captureErrors.push({ confirmationCode: booking.confirmationCode, error: e.message });
      }
    }

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

    // ---- Daily lease-signing reminder, until signed or the deadline passes ----
    // Sent once per day starting LEASE_REMINDER_START_DAYS after booking,
    // for as long as leaseSignedAt remains null AND today is still within
    // the LEASE_DEADLINE_DAYS window. leaseReminderLastSent (a date, not a
    // boolean) is the idempotency guard here -- it lets the SAME booking
    // receive a fresh reminder every day, while still guaranteeing at most
    // one per calendar day even if this cron runs twice (the same
    // protection pattern as checkinEmailSent elsewhere, just date-based
    // instead of boolean since this repeats).
    //
    // Once today is PAST the deadline with still no signature, the daily
    // guest nag stops (continuing to ask after the policy deadline has
    // already passed would be misleading) and a one-time owner alert fires
    // instead, guarded by leaseDeadlineFlaggedAt so it's not repeated every
    // day after that first flag. No automatic cancellation/refund happens
    // here -- see ownerLeaseOverdueAlertEmail's own comment for why.
    if (!booking.leaseSignedAt && (booking.status === "confirmed" || booking.status === "pending-capture")) {
      const createdDate = booking.createdAt ? key(new Date(booking.createdAt)) : null;
      const eligibleFrom = createdDate ? key(addDays(new Date(createdDate), LEASE_REMINDER_START_DAYS)) : today;
      const deadlineDate = createdDate ? key(addDays(new Date(createdDate), LEASE_DEADLINE_DAYS)) : null;
      const pastDeadline = deadlineDate && today > deadlineDate;

      if (pastDeadline) {
        if (!booking.leaseDeadlineFlaggedAt) {
          try {
            const daysOverdue = createdDate ? Math.round((new Date(today) - new Date(deadlineDate)) / 86400000) : null;
            await sendEmail({
              to: "risefurnishedstays@gmail.com",
              subject: `ACTION NEEDED: lease overdue - ${booking.confirmationCode}`,
              html: ownerLeaseOverdueAlertEmail({ booking, daysOverdue }),
            });
            await updateBookingStatus(booking.confirmationCode, { leaseDeadlineFlaggedAt: new Date().toISOString() });
            results.leaseOverdueAlertsSent.push(booking.confirmationCode);
          } catch (e) {
            console.error("lease overdue owner alert failed for", booking.confirmationCode, e.message);
            results.errors.push({ confirmationCode: booking.confirmationCode, step: "lease-overdue-alert", error: e.message });
          }
        }
      } else if (createdDate && today >= eligibleFrom && booking.leaseReminderLastSent !== today) {
        try {
          // The 3-day deadline counts from when the lease was originally
          // sent (booking creation date), not from today, so the stated
          // deadline stays consistent across every reminder rather than
          // appearing to push back each day.
          const signByDate = key(addDays(new Date(createdDate), LEASE_DEADLINE_DAYS));
          await sendEmail({
            to: booking.guestEmail,
            subject: `Reminder: please sign your lease - RISE Furnished Stays`,
            replyTo: "risefurnishedstays@gmail.com",
            html: leaseReminderEmail({
              guestName: booking.guestName,
              unitCode: booking.unitCode,
              confirmationCode: booking.confirmationCode,
              signByDate,
              leaseUrl: `https://www.risefurnishedstays.com/lease.html?confirmation_code=${encodeURIComponent(booking.confirmationCode)}`,
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

    // ---- ID-upload reminders: weekly until uploaded, plus one urgent
    // reminder the day before check-in regardless of the weekly cadence ----
    // Only relevant once the lease is signed (an unsigned-lease booking is
    // already being chased by the block above) and only while the stay is
    // still upcoming -- once check-in has passed there's no point asking.
    if (
      booking.leaseSignedAt &&
      !booking.govIdUploadedAt &&
      booking.status === "confirmed" &&
      booking.checkIn &&
      today <= booking.checkIn
    ) {
      const dayBeforeCheckIn = key(addDays(new Date(booking.checkIn), -1));
      const isUrgentDay = today === dayBeforeCheckIn;

      if (isUrgentDay && !booking.idUrgentReminderSent) {
        try {
          await sendEmail({
            to: booking.guestEmail,
            subject: `Urgent: your ID is still needed before tomorrow's check-in - RISE Furnished Stays`,
            replyTo: "risefurnishedstays@gmail.com",
            html: idUploadReminderEmail({
              guestName: booking.guestName,
              unitCode: booking.unitCode,
              confirmationCode: booking.confirmationCode,
              idUploadUrl: `https://www.risefurnishedstays.com/id-upload.html?confirmation_code=${encodeURIComponent(booking.confirmationCode)}`,
              checkIn: booking.checkIn,
              urgent: true,
            }),
          });
          await updateBookingStatus(booking.confirmationCode, { idUrgentReminderSent: true });
          results.idUrgentRemindersSent.push(booking.confirmationCode);
        } catch (e) {
          console.error("urgent ID reminder email failed for", booking.confirmationCode, e.message);
          results.errors.push({ confirmationCode: booking.confirmationCode, step: "id-reminder-urgent", error: e.message });
        }
      } else if (!isUrgentDay) {
        // Weekly cadence, anchored to when the lease was signed so every
        // booking gets a consistent every-7-days rhythm regardless of when
        // in the week they happened to sign.
        const signedDate = key(new Date(booking.leaseSignedAt));
        const daysSinceSigned = Math.round((new Date(today) - new Date(signedDate)) / 86400000);
        const dueForWeeklyReminder = daysSinceSigned > 0 && daysSinceSigned % ID_REMINDER_INTERVAL_DAYS === 0;

        if (dueForWeeklyReminder && booking.idReminderLastSent !== today) {
          try {
            await sendEmail({
              to: booking.guestEmail,
              subject: `Reminder: please upload your ID - RISE Furnished Stays`,
              replyTo: "risefurnishedstays@gmail.com",
              html: idUploadReminderEmail({
                guestName: booking.guestName,
                unitCode: booking.unitCode,
                confirmationCode: booking.confirmationCode,
                idUploadUrl: `https://www.risefurnishedstays.com/id-upload.html?confirmation_code=${encodeURIComponent(booking.confirmationCode)}`,
                checkIn: booking.checkIn,
                urgent: false,
              }),
            });
            await updateBookingStatus(booking.confirmationCode, { idReminderLastSent: today });
            results.idRemindersSent.push(booking.confirmationCode);
          } catch (e) {
            console.error("ID reminder email failed for", booking.confirmationCode, e.message);
            results.errors.push({ confirmationCode: booking.confirmationCode, step: "id-reminder", error: e.message });
          }
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
