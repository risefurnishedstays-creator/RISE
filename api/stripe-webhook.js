// api/stripe-webhook.js
// Fires when Stripe confirms events. Handles two:
//
// 1. checkout.session.completed  -> the "due today" payment succeeded.
//    We then:
//      a. Grab the saved payment method from the PaymentIntent
//      b. Attach it to a reusable Customer as the default for invoices
//      c. Create a scheduled, auto-charging Stripe Invoice for each
//         future installment date (Stripe charges the saved card on
//         each due date automatically -- no cron needed on our side)
//      d. Send confirmation emails to guest + owner
//
// 2. invoice.payment_failed -> a future installment charge failed.
//    We email the owner so they can follow up. (Stripe also auto-emails
//    the guest via its built-in dunning if enabled in the dashboard.)

const Stripe = require("stripe");
const { sendEmail } = require("../lib/sendEmail");
const { saveBooking } = require("../lib/bookings");
const {
  guestConfirmationEmail,
  ownerNotificationEmail,
  paymentFailedOwnerEmail,
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
  const confirmationCode = session.id.slice(-10).toUpperCase();

  // Retrieve the PaymentIntent to get the saved payment method
  const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
  const paymentMethodId = paymentIntent.payment_method;

  let schedule = [];
  try { schedule = JSON.parse(meta.paymentSchedule || "[]"); } catch (_) { schedule = []; }

  // ---- Create a reusable Customer with the saved card as default ----
  // (Moved above saveBooking so we have customerId in hand to store on the
  // booking record -- cancel-booking.js needs it later to find/void invoices.)
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
    // Attach the card to the customer (may already be attached; ignore that error)
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (e) {
      if (!String(e.message).includes("already been attached")) throw e;
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // ---- Save the booking to storage (powers availability + outbound iCal) ----
  // paymentIntentId + stripeCustomerId are required for cancel-booking.js to
  // later issue refunds (refunds.create needs a payment_intent) and find/void
  // any not-yet-charged installment invoices (invoices.list needs a customer).
  try {
    await saveBooking({
      unitCode: meta.unitCode,
      confirmationCode,
      guestName: meta.guestName,
      guestEmail: meta.guestEmail || session.customer_email,
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      pets: meta.pets ? parseInt(meta.pets, 10) || 0 : 0, // needed by cancellationOutcome() to refund pet fees correctly
      status: "confirmed",
      paymentIntentId: session.payment_intent,
      stripeCustomerId: customerId,
    });
  } catch (e) {
    // Don't fail the whole webhook if storage hiccups -- payment already went
    // through. Log loudly so you can backfill the booking manually if needed.
    console.error("CRITICAL: booking saved in Stripe but NOT in availability store:", e.message, "confirmation:", confirmationCode);
  }

  // ---- Create one auto-charging invoice per future installment ----
  for (const inst of schedule) {
    const dueDate = new Date(inst.date + "T12:00:00Z");
    const nowSec = Math.floor(Date.now() / 1000);
    const dueSec = Math.floor(dueDate.getTime() / 1000);

    // Invoice item (the line on the invoice)
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: inst.amount * 100,
      currency: "usd",
      description: `${meta.unitName} — ${inst.nights} nights (installment due ${inst.date})`,
    });

    // The invoice itself: charge automatically against the saved card.
    // If the due date is in the future, schedule it; if somehow past, charge now.
    const invoiceParams = {
      customer: customerId,
      collection_method: "charge_automatically",
      auto_advance: true,
      metadata: { confirmationCode, installmentDate: inst.date, unitCode: meta.unitCode || "" },
      description: `RISE Furnished Stays installment — ${meta.unitName}`,
    };

    if (dueSec > nowSec + 3600) {
      // Schedule for the due date (Stripe finalizes & charges then)
      invoiceParams.automatically_finalizes_at = dueSec;
    }

    await stripe.invoices.create(invoiceParams);
  }

  // ---- Send confirmation emails ----
  await sendEmail({
    to: meta.guestEmail || session.customer_email,
    subject: `Booking Confirmed — ${meta.unitName || "RISE Furnished Stays"}`,
    html: guestConfirmationEmail({
      guestName: meta.guestName || "Guest",
      unitName: meta.unitName || "your unit",
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      dueToday: meta.dueToday,
      fullTotal: meta.fullTotal,
      schedule,
      confirmationCode,
    }),
  });

  await sendEmail({
    to: "risefurnishedstays@gmail.com",
    subject: `New Booking: ${meta.unitName} (${meta.checkIn} to ${meta.checkOut})`,
    html: ownerNotificationEmail({
      guestName: meta.guestName || "Guest",
      guestEmail: meta.guestEmail || session.customer_email,
      guestPhone: meta.guestPhone,
      guestCountry: meta.guestCountry,
      guestComments: meta.guestComments,
      unitName: meta.unitName || "Unit",
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      nights: meta.nights,
      dueToday: meta.dueToday,
      fullTotal: meta.fullTotal,
      schedule,
      confirmationCode,
    }),
  });
}

async function handleInvoiceFailed(invoice) {
  const meta = invoice.metadata || {};
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
}
