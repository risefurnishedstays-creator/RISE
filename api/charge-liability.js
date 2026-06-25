// api/charge-liability.js
//
// Owner-only internal tool, used after a mid-stay cancellation has already
// been processed via cancel-booking.js. Creates a Stripe Invoice for the
// guest's liability-period nights (per the "remains liable for the next 30
// nights" policy clause) and sends it to them via Stripe's hosted invoice
// page -- the guest must actively pay it, their saved card is NOT charged
// automatically. This is a deliberate choice: a fresh, unplanned charge for
// a contentious cancellation carries real chargeback risk if pulled from a
// card without the guest's active confirmation. See the long discussion in
// chat history if this behavior is ever revisited.
//
// POST body: { confirmationCode }
//
// Guardrails:
//   - Requires the SAME x-admin-secret auth as the other admin endpoints.
//   - Only runs against a booking already in status "cancelled-midstay" --
//     refuses on any other status, so this can't accidentally fire against
//     an active booking or be used to invent an unrelated charge.
//   - Refuses if a liability invoice has already been created for this
//     booking (tracked via booking.liabilityInvoiceId), so re-clicking the
//     button can't create a duplicate invoice for the same guest.

const Stripe = require("stripe");
const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { CONFIG } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const { liabilityInvoiceOwnerEmail } = require("../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    console.error("charge-liability lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }

  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (booking.status !== "cancelled-midstay") {
    return res.status(409).json({
      error: `This booking's status is "${booking.status}", not "cancelled-midstay". ` +
        "A liability invoice can only be created for a mid-stay cancellation that's already been processed.",
    });
  }

  if (booking.liabilityInvoiceId) {
    return res.status(409).json({
      error: "A liability invoice was already created for this booking.",
      liabilityInvoiceId: booking.liabilityInvoiceId,
    });
  }

  if (!booking.liableNights || booking.liableNights <= 0) {
    return res.status(400).json({ error: "This booking has no recorded liable nights to invoice." });
  }

  if (!booking.stripeCustomerId) {
    return res.status(400).json({ error: "No Stripe customer is on file for this booking -- cannot send an invoice." });
  }

  const amount = booking.liableNights * CONFIG.NIGHTLY;

  let invoice;
  try {
    await stripe.invoiceItems.create({
      customer: booking.stripeCustomerId,
      amount: amount * 100, // cents
      currency: "usd",
      description: `RISE Furnished Stays — mid-stay cancellation liability (${booking.liableNights} nights through ${booking.liabilityEndDate})`,
    });

    invoice = await stripe.invoices.create({
      customer: booking.stripeCustomerId,
      // send_invoice (not charge_automatically): the guest must actively pay
      // via Stripe's hosted invoice page. Their saved card is not touched.
      collection_method: "send_invoice",
      days_until_due: 7,
      auto_advance: true,
      metadata: {
        confirmationCode,
        reason: "midstay-liability",
        liableNights: String(booking.liableNights),
        liabilityEndDate: booking.liabilityEndDate || "",
      },
      description: `RISE Furnished Stays — mid-stay cancellation liability`,
    });

    // Finalizing sends Stripe's invoice email to the guest automatically
    // (send_invoice collection method triggers this on finalize).
    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
  } catch (e) {
    console.error("Stripe liability invoice creation failed for", confirmationCode, e.message);
    return res.status(502).json({ error: "Stripe invoice creation failed: " + e.message });
  }

  try {
    await updateBookingStatus(confirmationCode, {
      liabilityInvoiceId: invoice.id,
      liabilityInvoiceUrl: invoice.hosted_invoice_url,
      liabilityInvoiceCreatedAt: new Date().toISOString(),
    });
  } catch (e) {
    // Stripe invoice already exists and was sent -- don't fail the response
    // over a storage hiccup, but flag loudly since the dedupe guard above
    // depends on this field being saved.
    console.error("CRITICAL: liability invoice created in Stripe but NOT recorded on booking:", confirmationCode, e.message, "invoiceId:", invoice.id);
  }

  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Liability invoice sent: ${confirmationCode}`,
      html: liabilityInvoiceOwnerEmail({ booking, amount, invoice }),
    });
  } catch (e) {
    console.error("Owner notification for liability invoice failed (non-fatal):", confirmationCode, e.message);
  }

  return res.status(200).json({
    confirmationCode,
    invoiceId: invoice.id,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    amount,
    liableNights: booking.liableNights,
  });
};
