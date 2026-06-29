// api/stripe-webhook.js
// Fires when Stripe confirms events. Handles three:
//
// 1. checkout.session.completed  -> the guest finished checkout and their
//    card was AUTHORIZED (held) for the first payment -- NOT yet charged.
//    capture_method: 'manual' on the PaymentIntent (set in
//    create-checkout-session.js) means Stripe holds the funds instead of
//    capturing immediately. We then:
//      a. Grab the saved payment method from the PaymentIntent
//      b. Attach it to a reusable Customer as the default for invoices
//      c. Save the booking with status "pending-capture"
//      d. Send a "your dates are reserved, card not charged yet" email to
//         the guest, and a lighter heads-up to the owner
//    Future installment invoices are NOT created yet here -- that only
//    happens once the first payment is actually captured (see #3 below),
//    since creating them now would be premature if the guest cancels
//    during the 5-day grace window.
//
// 2. invoice.payment_failed -> a future installment charge failed.
//    We email the owner so they can follow up. (Stripe also auto-emails
//    the guest via its built-in dunning if enabled in the dashboard.)
//
// 3. payment_intent.amount_capturable_updated, when amount_capturable
//    drops to 0 after a capture (i.e. the capture itself succeeded) ->
//    the first payment is now actually charged. We then:
//      a. Update the booking status to "confirmed"
//      b. Create one auto-charging invoice per future installment
//      c. Send the real payment-confirmed email to the guest, and the
//         full booking-details email to the owner
//    This event ALSO fires at authorization time (capturable amount goes
//    from 0 to the full amount) -- handleAmountCapturableUpdated ignores
//    that case and only acts when amount_capturable has dropped to 0,
//    which only happens after capture (or after the authorization expires
//    uncaptured, which canceled-booking handling should prevent in
//    practice since the cron captures before that 7-day window closes).

const Stripe = require("stripe");
const { sendEmail } = require("../lib/sendEmail");
const { saveBooking, getBooking, updateBookingStatus, listAllConfirmedBookings, generateConfirmationCode } = require("../lib/bookings");
const { priceParts, key, addDays } = require("../lib/pricing");
const {
  bookingReservedEmail,
  ownerReservationPendingEmail,
  guestConfirmationEmail,
  ownerNotificationEmail,
  paymentFailedOwnerEmail,
  paymentFailedGuestEmail,
} = require("../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  let event;
  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send("Webhook signature verification failed.");
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object);
    } else if (event.type === "invoice.payment_failed") {
      await handleInvoiceFailed(event.data.object);
    } else if (event.type === "payment_intent.amount_capturable_updated") {
      await handleAmountCapturableUpdated(event.data.object);
    }
  } catch (err) {
    // Log but return 200 so Stripe doesn't retry endlessly. We don't want
    // duplicate invoices created if a later step (like email) throws.
    console.error(`Error handling ${event.type}:`, err);
  }

  return res.status(200).json({ received: true });
};

async function handleCheckoutCompleted(session) {
  const meta = session.metadata || {};
  // Confirmation codes are now generated fresh (format: RISE-XXXXXX) and
  // checked for uniqueness against storage, rather than derived from the
  // last 10 characters of the Stripe session id. The old scheme inherited
  // uniqueness for free from Stripe's own session ids, but produced
  // confusing-looking codes (raw Stripe id fragments, not meant for human
  // use) -- this trades that free uniqueness guarantee for an explicit
  // check (see generateConfirmationCode()'s comment in lib/bookings.js)
  // in exchange for a code that's actually meant to be read, typed, and
  // referenced by a guest.
  const confirmationCode = await generateConfirmationCode();

  // Retrieve the PaymentIntent to get the saved payment method. With
  // capture_method: manual, session.payment_status is "unpaid" here --
  // that's expected and correct, NOT an error -- it just means the card
  // is held, not charged. The actual charge happens later via
  // handleAmountCapturableUpdated, once api/cron/scheduled-emails.js
  // calls paymentIntents.capture() on day 5.
  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
  const paymentMethodId = paymentIntent.payment_method;

  const petsCount = meta.pets ? parseInt(meta.pets, 10) || 0 : 0;
  let schedule = [];
  let recomputed = null;
  try {
    recomputed = priceParts(meta.checkIn, meta.checkOut, petsCount);
    schedule = (recomputed.paymentDates || []).map((p) => ({ date: p.dateStr, amount: p.amount, nights: p.nights }));
  } catch (e) {
    console.error("Could not recompute payment schedule for", confirmationCode, e.message);
    try { schedule = JSON.parse(meta.paymentSchedule || "[]"); } catch (_) { schedule = []; }
  }

  // ---- Create a reusable Customer with the saved card as default ----
  let customerId = session.customer;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: meta.guestEmail || session.customer_email,
      name: meta.guestName || undefined,
      metadata: { unitCode: meta.unitCode || "", confirmationCode },
    });
    customerId = customer.id;
  }

  if (paymentMethodId) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (e) {
      if (!String(e.message).includes("already been attached")) throw e;
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // ---- Save the booking as "pending-capture" -- NOT "confirmed" yet ----
  // Still blocks the calendar (listBookings' activeOnly filter only
  // excludes status "cancelled", so this status blocks availability the
  // same as "confirmed" does) and is fully usable for lease-signing and
  // ID upload, which don't gate on status at all. paymentIntentId +
  // stripeCustomerId are required for the day-5 capture step and for
  // cancel-booking.js to cancel the authorization or issue a refund.
  const captureScheduledFor = key(addDays(new Date(), 5));
  try {
    await saveBooking({
      unitCode: meta.unitCode,
      confirmationCode,
      stripeSessionId: session.id,
      guestName: meta.guestName,
      guestEmail: meta.guestEmail || session.customer_email,
      guestPhone: meta.guestPhone,
      guestCountry: meta.guestCountry,
      guestComments: meta.guestComments,
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      pets: meta.pets ? parseInt(meta.pets, 10) || 0 : 0,
      guests: meta.guests ? parseInt(meta.guests, 10) || null : null,
      status: "pending-capture",
      paymentIntentId: session.payment_intent,
      stripeCustomerId: customerId,
      captureScheduledFor,
      dueToday: meta.dueToday,
      fullTotal: meta.fullTotal,
      unitName: meta.unitName,
      // Stash the recomputed schedule so the day-5 capture step (and the
      // eventual confirmation emails) don't need to recompute it again or
      // rely on the metadata's possibly-truncated copy.
      pendingSchedule: schedule,
    });
  } catch (e) {
    console.error("CRITICAL: booking saved in Stripe but NOT in availability store:", e.message, "confirmation:", confirmationCode);
  }

  // ---- Send "reserved, not yet charged" emails ----
  await sendEmail({
    to: meta.guestEmail || session.customer_email,
    subject: `Reservation Held — ${meta.unitName || "RISE Furnished Stays"}`,
    replyTo: "risefurnishedstays@gmail.com",
    html: bookingReservedEmail({
      guestName: meta.guestName || "Guest",
      unitCode: meta.unitCode,
      unitName: meta.unitName || "your unit",
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      // Breakdown fields for the itemized first-payment table -- sourced
      // from the same recomputed priceParts() result the schedule itself
      // comes from, so the numbers can never disagree with each other.
      // Fall back to the dueToday/0 values if recomputation failed above,
      // so the email still sends (with a less detailed breakdown) rather
      // than throwing and losing the guest notification entirely.
      first30: recomputed ? recomputed.first30 : meta.dueToday,
      cleaning: recomputed ? recomputed.cleaning : 0,
      pets: recomputed ? recomputed.pets : petsCount,
      petFee: recomputed ? recomputed.petFee : 0,
      dueToday: meta.dueToday,
      fullTotal: meta.fullTotal,
      schedule,
      confirmationCode,
    }),
  });

  await sendEmail({
    to: "risefurnishedstays@gmail.com",
    subject: `New Reservation (Pending): ${meta.unitName} (${meta.checkIn} to ${meta.checkOut})`,
    html: ownerReservationPendingEmail({
      guestName: meta.guestName || "Guest",
      guestEmail: meta.guestEmail || session.customer_email,
      guestPhone: meta.guestPhone,
      guestCountry: meta.guestCountry,
      unitName: meta.unitName || "Unit",
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      dueToday: meta.dueToday,
      confirmationCode,
      captureScheduledFor,
    }),
  });
}

// =========================================================================
// Fires on every amount_capturable change -- including authorization
// itself (0 -> full amount), which we deliberately ignore here since
// handleCheckoutCompleted already handles that moment. Only acts when
// amount_capturable has dropped to 0, which happens after a successful
// capture (the case we care about) or after cancellation/expiry (where
// there's nothing further to do -- the booking's already been or will be
// marked cancelled through the normal cancel-booking flow).
// =========================================================================
async function handleAmountCapturableUpdated(paymentIntent) {
  if (paymentIntent.amount_capturable !== 0) return; // not a post-capture event

  // Find the booking this PaymentIntent belongs to. We don't have the
  // confirmationCode directly on the PaymentIntent (Checkout-created
  // PaymentIntents don't inherit the Session's metadata automatically),
  // but every booking this matters for was saved with paymentIntentId
  // === this id.
  const confirmationCode = await findConfirmationCodeByPaymentIntent(paymentIntent.id);
  if (!confirmationCode) {
    // Not one of our first-payment PaymentIntents (e.g. a later
    // installment, which never uses manual capture) -- nothing to do.
    return;
  }

  const booking = await getBooking(confirmationCode);
  if (!booking) {
    console.error("CRITICAL: amount_capturable_updated for known paymentIntent but booking not found:", confirmationCode);
    return;
  }

  // Idempotency: if this booking is already confirmed, this event has
  // already been processed (Stripe can redeliver webhooks).
  if (booking.status === "confirmed") return;

  // Only proceed if the PaymentIntent actually succeeded (capture
  // completed) -- amount_capturable can also drop to 0 if the
  // authorization was canceled instead of captured, which the
  // cancellation flow handles separately and shouldn't be treated as a
  // successful payment here.
  if (paymentIntent.status !== "succeeded") return;

  const schedule = booking.pendingSchedule || [];

  // ---- Create one auto-charging invoice per future installment, now
  // that the first payment has actually succeeded ----
  for (const inst of schedule) {
    const dueDate = new Date(inst.date + "T12:00:00Z");
    const nowSec = Math.floor(Date.now() / 1000);
    const dueSec = Math.floor(dueDate.getTime() / 1000);

    await stripe.invoiceItems.create({
      customer: booking.stripeCustomerId,
      amount: inst.amount * 100,
      currency: "usd",
      description: `${booking.unitName || "Unit " + booking.unitCode} — ${inst.nights} nights (installment due ${inst.date})`,
    });

    const invoiceParams = {
      customer: booking.stripeCustomerId,
      collection_method: "charge_automatically",
      auto_advance: true,
      metadata: { confirmationCode, installmentDate: inst.date, unitCode: booking.unitCode || "" },
      description: `RISE Furnished Stays installment — ${booking.unitName || "Unit " + booking.unitCode}`,
    };

    if (dueSec > nowSec + 3600) {
      invoiceParams.automatically_finalizes_at = dueSec;
    }

    await stripe.invoices.create(invoiceParams);
  }

  try {
    await updateBookingStatus(confirmationCode, { status: "confirmed", capturedAt: new Date().toISOString() });
  } catch (e) {
    console.error("CRITICAL: payment captured but booking status NOT updated to confirmed:", confirmationCode, e.message);
  }

  // ---- Send the real payment-confirmed emails ----
  try {
    await sendEmail({
      to: booking.guestEmail,
      subject: `Booking Confirmed — ${booking.unitName || "RISE Furnished Stays"}`,
      replyTo: "risefurnishedstays@gmail.com",
      html: guestConfirmationEmail({
        guestName: booking.guestName || "Guest",
        unitCode: booking.unitCode,
        unitName: booking.unitName || "your unit",
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        dueToday: booking.dueToday,
        fullTotal: booking.fullTotal,
        schedule,
        confirmationCode,
      }),
    });
  } catch (e) {
    console.error("Guest payment-confirmed email failed (non-fatal) for", confirmationCode, e.message);
  }

  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Payment Captured: ${booking.unitName} (${booking.checkIn} to ${booking.checkOut})`,
      html: ownerNotificationEmail({
        guestName: booking.guestName || "Guest",
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        guestCountry: booking.guestCountry,
        guestComments: booking.guestComments,
        unitName: booking.unitName || "Unit",
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        dueToday: booking.dueToday,
        fullTotal: booking.fullTotal,
        schedule,
        confirmationCode,
      }),
    });
  } catch (e) {
    console.error("Owner payment-confirmed email failed (non-fatal) for", confirmationCode, e.message);
  }
}

// Scans for the booking whose paymentIntentId matches -- there's no
// direct "find booking by payment intent" index, but booking volume here
// is small enough that listing every confirmed-or-pending booking and
// filtering in memory is fine. If this ever needs to scale, a
// paymentIntentId -> confirmationCode reverse-index key would be the fix.
async function findConfirmationCodeByPaymentIntent(paymentIntentId) {
  const all = await listAllConfirmedBookings();
  const match = all.find((b) => b.paymentIntentId === paymentIntentId);
  return match ? match.confirmationCode : null;
}

async function handleInvoiceFailed(invoice) {
  const meta = invoice.metadata || {};

  // ---- Owner notification (unchanged) ----
  await sendEmail({
    to: "risefurnishedstays@gmail.com",
    subject: `\u26a0\ufe0f Installment payment FAILED — ${meta.unitCode || "booking"} ${meta.confirmationCode || ""}`,
    html: paymentFailedOwnerEmail({
      confirmationCode: meta.confirmationCode || "(unknown)",
      unitCode: meta.unitCode || "(unknown)",
      installmentDate: meta.installmentDate || "(unknown)",
      amount: (invoice.amount_due / 100).toFixed(2),
      guestEmail: invoice.customer_email || "(unknown)",
    }),
  });

  // ---- Guest notification, with a real Stripe-hosted link to update their card ----
  // The Billing Portal session is created fresh per failure (sessions are
  // single-use-ish and short-lived by design) rather than reusing a saved
  // URL, so it's always valid when the guest actually clicks it.
  if (!invoice.customer) {
    console.error("CRITICAL: invoice.payment_failed with no customer ID, cannot email guest or build portal link:", meta.confirmationCode);
    return;
  }

  let portalUrl = null;
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: invoice.customer,
      return_url: "https://www.risefurnishedstays.com/",
    });
    portalUrl = portalSession.url;
  } catch (e) {
    // If the Billing Portal isn't activated in the Stripe dashboard yet,
    // this call fails -- log it clearly so it's obvious that's the fix
    // needed (Stripe Dashboard > Settings > Billing > Customer portal),
    // but don't block the guest email entirely; send it without the link.
    console.error("Could not create Billing Portal session for", meta.confirmationCode, ":", e.message);
  }

  let booking = null;
  try {
    if (meta.confirmationCode) booking = await getBooking(meta.confirmationCode);
  } catch (e) {
    console.error("Could not look up booking for guest payment-failed email:", meta.confirmationCode, e.message);
  }

  if (invoice.customer_email || (booking && booking.guestEmail)) {
    try {
      await sendEmail({
        to: invoice.customer_email || booking.guestEmail,
        subject: `Action needed: payment issue with your stay - RISE Furnished Stays`,
        replyTo: "risefurnishedstays@gmail.com",
        html: paymentFailedGuestEmail({
          guestName: booking ? booking.guestName : "",
          unitCode: meta.unitCode,
          confirmationCode: meta.confirmationCode || "(unknown)",
          installmentDate: meta.installmentDate || "(unknown)",
          amount: (invoice.amount_due / 100).toFixed(2),
          updatePaymentUrl: portalUrl,
        }),
      });
    } catch (e) {
      console.error("Guest payment-failed email failed (non-fatal) for", meta.confirmationCode, e.message);
    }
  }
}
