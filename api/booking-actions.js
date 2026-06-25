// api/booking-actions.js
//
// Merges what were four separate functions (cancel-preview.js,
// cancel-booking.js, charge-liability.js, mark-lease-signed.js) into one,
// to stay under Vercel's Hobby-plan 12-serverless-function limit. Behavior
// is unchanged from the originals -- this is a routing consolidation, not
// a feature change. Each action's logic below is the original file's
// logic, verbatim, just gathered under one handler.
//
// GET  /api/booking-actions?action=preview&confirmationCode=...&noticeDate=...
// POST /api/booking-actions?action=cancel        body: { confirmationCode, noticeDate? }
// POST /api/booking-actions?action=charge-liability  body: { confirmationCode }
// POST /api/booking-actions?action=mark-lease-signed body: { confirmationCode }

const Stripe = require("stripe");
const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { cancellationOutcome, checkinEmailTiming, CONFIG } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const {
  cancellationGuestEmail,
  cancellationOwnerEmail,
  liabilityInvoiceOwnerEmail,
  checkinInstructionsEmail,
} = require("../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-secret");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const action = (req.query && req.query.action || "").toString();

  if (req.method === "GET" && action === "preview") return handlePreview(req, res);
  if (req.method === "POST" && action === "cancel") return handleCancel(req, res);
  if (req.method === "POST" && action === "charge-liability") return handleChargeLiability(req, res);
  if (req.method === "POST" && action === "mark-lease-signed") return handleMarkLeaseSigned(req, res);

  return res.status(400).json({ error: "Unknown or missing action. Use ?action=preview|cancel|charge-liability|mark-lease-signed with the matching method." });
};

// =========================================================================
// action=preview (GET) -- was cancel-preview.js
// =========================================================================
async function handlePreview(req, res) {
  const { confirmationCode, noticeDate } = req.query || {};
  if (!confirmationCode) {
    return res.status(400).json({ error: "confirmationCode is required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("booking-actions (preview) lookup failed:", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }

  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (booking.status === "cancelled" || booking.status === "cancelled-midstay") {
    return res.status(200).json({ booking, alreadyCancelled: true });
  }

  const outcome = cancellationOutcome(booking.checkIn, booking.checkOut, noticeDate, booking.pets);
  return res.status(200).json({ booking, outcome, alreadyCancelled: false });
}

// =========================================================================
// action=cancel (POST) -- was cancel-booking.js
// =========================================================================
async function handleCancel(req, res) {
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
    }
  }

  // ---- Update booking record ----
  const newStatus = outcome.branch === "midstay" ? "cancelled-midstay" : "cancelled";
  try {
    await updateBookingStatus(confirmationCode, {
      status: newStatus,
      cancelledAt: new Date().toISOString(),
      cancellationBranch: outcome.branch,
      refundAmount: outcome.refundAmount,
      refundId: refund ? refund.id : null,
      liabilityEndDate: outcome.liabilityEndDate,
      liableNights: outcome.liableNights || 0,
      voidedInvoiceIds,
    });
  } catch (e) {
    console.error("CRITICAL: Stripe side handled but booking status NOT updated in storage:", confirmationCode, e.message);
    return res.status(500).json({
      error: "Refund/invoice cleanup succeeded but booking record update failed. Update storage manually.",
      outcome,
    });
  }

  // ---- Emails (sent independently so one bad address can't suppress the other) ----
  let guestEmailError = null;
  let ownerEmailError = null;

  try {
    await sendEmail({
      to: booking.guestEmail,
      subject: `Cancellation Confirmed — RISE Furnished Stays`,
      replyTo: "risefurnishedstays@gmail.com",
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
      html: cancellationOwnerEmail({ booking, outcome, refund, voidedInvoiceIds }),
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
    guestEmailError,
    ownerEmailError,
    voidedInvoiceIds,
  });
}

// =========================================================================
// action=charge-liability (POST) -- was charge-liability.js
// =========================================================================
async function handleChargeLiability(req, res) {
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
      amount: amount * 100,
      currency: "usd",
      description: `RISE Furnished Stays — mid-stay cancellation liability (${booking.liableNights} nights through ${booking.liabilityEndDate})`,
    });

    invoice = await stripe.invoices.create({
      customer: booking.stripeCustomerId,
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
}

// =========================================================================
// action=mark-lease-signed (POST) -- was mark-lease-signed.js
// =========================================================================
async function handleMarkLeaseSigned(req, res) {
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
}
