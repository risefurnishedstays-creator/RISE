// api/cancel-booking.js
//
// Cancellation flow:
//   1. Look up the booking.
//   2. Run pricing.cancellationOutcome() to get the policy branch.
//   3. Stripe side:
//        - full-refund      -> refund the original "due today" PaymentIntent
//        - non-refundable   -> no refund call
//        - midstay          -> no refund call (guest already paid for nights they're liable for)
//      In ALL branches: void/cancel every Stripe Invoice for this customer
//      that hasn't been paid yet (covers future installments).
//   4. Update the booking record's status + liabilityEndDate in storage.
//   5. Outbound iCal feed re-derives availability from storage on next
//      request -- nothing to push to Airbnb; it polls on its own schedule.
//   6. Email the guest + owner a summary of what happened.
//
// POST body: { confirmationCode, noticeDate? }
// noticeDate is optional, ISO "YYYY-MM-DD", defaults to today. Mainly useful
// for backdating if a cancellation request came in by email/phone earlier
// than when you're processing it.

const Stripe = require("stripe");
const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { cancellationOutcome } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const {
  cancellationGuestEmail,
  cancellationOwnerEmail,
} = require("../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// This is an OWNER-ONLY internal tool (Richelle triggers it after a guest
// requests cancellation by email/phone) -- it is not guest-facing, and a
// confirmation code alone isn't secret enough to gate a real refund/void
// action behind. Require a shared secret set in Vercel env vars
// (ADMIN_API_SECRET), sent by the admin page as a header.
function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  // Same cross-origin situation as cancel-preview.js -- admin page is on
  // GitHub Pages, this function is on Vercel, and the x-admin-secret header
  // forces a preflight OPTIONS request that must be handled explicitly.
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const { confirmationCode, noticeDate } = req.body || {};
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

  if (!booking) {
    return res.status(404).json({ error: "Booking not found." });
  }
  if (booking.status === "cancelled" || booking.status === "cancelled-midstay") {
    return res.status(409).json({ error: "Booking is already cancelled.", booking });
  }

  const outcome = cancellationOutcome(booking.checkIn, booking.checkOut, noticeDate, booking.pets);

  // ---- Stripe: refund (if applicable) ----
  let refund = null;
  if (outcome.refundable && outcome.refundAmount > 0) {
    if (!booking.paymentIntentId) {
      console.error(
        "CRITICAL: full-refund branch but no paymentIntentId stored for",
        confirmationCode,
        "-- refund must be issued manually in the Stripe dashboard."
      );
    } else {
      try {
        refund = await stripe.refunds.create({
          payment_intent: booking.paymentIntentId,
          amount: outcome.refundAmount * 100, // cents
          metadata: { confirmationCode, reason: "policy:" + outcome.branch },
        });
      } catch (e) {
        console.error("Stripe refund failed for", confirmationCode, e.message);
        return res.status(502).json({ error: "Stripe refund failed: " + e.message });
      }
    }
  }

  // ---- Stripe: cancel every not-yet-paid invoice for this customer ----
  // Covers both the "non-refundable" and "midstay" branches (no future
  // installments should still fire), and also cleans up after a full
  // refund so nothing tries to auto-charge later.
  const voidedInvoiceIds = [];
  if (outcome.cancelFutureInstallments && booking.stripeCustomerId) {
    try {
      const invoices = await stripe.invoices.list({
        customer: booking.stripeCustomerId,
        status: "draft",
        limit: 100,
      });
      const openInvoices = await stripe.invoices.list({
        customer: booking.stripeCustomerId,
        status: "open",
        limit: 100,
      });

      for (const inv of [...invoices.data, ...openInvoices.data]) {
        // For midstay cancellations, only void invoices for installment
        // dates AFTER the liability end date -- nights up through that
        // date are still owed per the policy.
        const instDate = inv.metadata && inv.metadata.installmentDate;
        if (outcome.branch === "midstay" && instDate && outcome.liabilityEndDate) {
          if (instDate <= outcome.liabilityEndDate) continue; // still owed, leave it
        }

        try {
          if (inv.status === "draft") {
            await stripe.invoices.del(inv.id);
          } else {
            await stripe.invoices.voidInvoice(inv.id);
          }
          voidedInvoiceIds.push(inv.id);
        } catch (e) {
          console.error("Could not void/delete invoice", inv.id, e.message);
        }
      }
    } catch (e) {
      console.error("Error listing invoices to cancel for", confirmationCode, e.message);
      // Don't fail the whole request -- refund (if any) already succeeded.
      // Flag loudly so remaining invoices can be voided manually.
    }
  }

  // ---- Update booking record (this is what the outbound iCal feed reads) ----
  const newStatus = outcome.branch === "midstay" ? "cancelled-midstay" : "cancelled";
  try {
    await updateBookingStatus(confirmationCode, {
      status: newStatus,
      cancelledAt: new Date().toISOString(),
      cancellationBranch: outcome.branch,
      refundAmount: outcome.refundAmount,
      refundId: refund ? refund.id : null,
      liabilityEndDate: outcome.liabilityEndDate, // null unless midstay
      liableNights: outcome.liableNights || 0, // needed by charge-liability.js to invoice the right amount later
      voidedInvoiceIds,
    });
  } catch (e) {
    console.error("CRITICAL: Stripe side handled but booking status NOT updated in storage:", confirmationCode, e.message);
    return res.status(500).json({
      error: "Refund/invoice cleanup succeeded but booking record update failed. Update storage manually.",
      outcome,
    });
  }

  // ---- Emails ----
  // Sent independently (not in one shared try/catch) so a bad/bogus guest
  // email address can't silently suppress the owner notification too --
  // that happened in testing: an invalid guest address caused the whole
  // block to throw after only the first await, and since the catch only
  // logs, the response still looked like a clean success despite BOTH
  // emails actually failing to send.
  let guestEmailError = null;
  let ownerEmailError = null;

  try {
    await sendEmail({
      to: booking.guestEmail,
      subject: `Cancellation Confirmed — RISE Furnished Stays`,
      replyTo: "risefurnishedstays@gmail.com", // sender address is unmonitored -- route any reply to the real inbox
      html: cancellationGuestEmail({
        guestName: booking.guestName,
        unitCode: booking.unitCode,
        confirmationCode,
        outcome,
      }),
    });
  } catch (e) {
    guestEmailError = e.message;
    console.error("Guest cancellation email failed (non-fatal) for", confirmationCode, "to", booking.guestEmail, ":", e.message);
  }

  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Cancellation: ${confirmationCode} (${outcome.branch})`,
      html: cancellationOwnerEmail({
        booking,
        outcome,
        refund,
        voidedInvoiceIds,
      }),
    });
  } catch (e) {
    ownerEmailError = e.message;
    console.error("Owner cancellation email failed (non-fatal) for", confirmationCode, ":", e.message);
  }

  return res.status(200).json({
    confirmationCode,
    status: newStatus,
    outcome,
    refundId: refund ? refund.id : null,
    guestEmailError, // null if sent successfully -- surfaced so the admin page can flag it
    ownerEmailError,
    voidedInvoiceIds,
  });
};
