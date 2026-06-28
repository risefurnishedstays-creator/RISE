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
const { cancellationOutcome, checkinEmailTiming, findPaymentPeriod, CONFIG } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const {
  cancellationGuestEmail,
  lateCancellationGuestEmail,
  cancellationOwnerEmail,
  liabilityInvoiceOwnerEmail,
  checkinInstructionsEmail,
  unitCheckinPdfAttachment,
} = require("../lib/emailTemplates");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function isAuthorized(req) {
  const provided = req.headers["x-admin-secret"];
  return provided && process.env.ADMIN_API_SECRET && provided === process.env.ADMIN_API_SECRET;
}

// Determines whether the installment covering a given payment period has
// actually been charged yet, by checking Stripe -- pricing.js can't do this
// itself (no Stripe access there), so this lives here and gets passed into
// cancellationOutcome() as the lastPaymentPaid parameter.
//
// Period 0 (the first 30 nights + cleaning + pet fee) is always "paid" --
// it's charged directly through Stripe Checkout before the booking record
// even exists, so there's no invoice to look up and no scenario where a
// booking exists but period 0 wasn't paid.
//
// Every later period corresponds to an auto-charging Stripe Invoice created
// by stripe-webhook.js, tagged with metadata.installmentDate matching that
// period's start date (the same value priceParts() calls dateStr). "Paid"
// here means the invoice's status is "paid" -- a "draft" or "open" invoice
// hasn't actually been charged yet, regardless of its due date.
async function isPeriodPaid(booking, period) {
  if (!period || period.index === 0) return true;

  if (!booking.stripeCustomerId) {
    // No Stripe customer on file at all (shouldn't normally happen once
    // installments exist) -- can't have been paid without one.
    return false;
  }

  try {
    const paidInvoices = await stripe.invoices.list({
      customer: booking.stripeCustomerId,
      status: "paid",
      limit: 100,
    });
    return paidInvoices.data.some((inv) => inv.metadata && inv.metadata.installmentDate === period.startDate);
  } catch (e) {
    console.error("Could not check Stripe invoice status for", booking.confirmationCode, "period", period.startDate, ":", e.message);
    // Fail safe toward "not paid" -- worse case is the guest is asked to
    // pay an installment that was actually already charged (a billing
    // mistake you'd catch and refund), rather than silently waiving a fee
    // that should have applied because of an API hiccup.
    return false;
  }
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

  const { lastPaymentPaid, finalPeriodPaid } = await determinePaymentStatus(booking, noticeDate);
  const outcome = cancellationOutcome(booking.checkIn, booking.checkOut, noticeDate, booking.pets, lastPaymentPaid, finalPeriodPaid);
  return res.status(200).json({ booking, outcome, alreadyCancelled: false });
}

// Shared by handlePreview and handleCancel so the preview a guest/owner sees
// always matches what actually gets charged when they confirm -- both call
// this the same way, with the same notice date, right before calling
// cancellationOutcome().
//
// Returns both pieces of payment-status info cancellationOutcome() needs:
//   lastPaymentPaid  -- status of the period the NOTICE date falls in
//   finalPeriodPaid  -- status of the TRUE final period (the one ending
//                        at checkout), which can differ from the notice
//                        period whenever the stay's last period is shorter
//                        than 30 nights (e.g. a 65-night stay = 30+30+5 --
//                        notice can fall in the middle 30-night period
//                        while still being within 30 days of checkout,
//                        which is governed by the trailing 5-night period)
async function determinePaymentStatus(booking, noticeDate) {
  const notice = noticeDate ? new Date(noticeDate) : new Date();
  notice.setHours(0, 0, 0, 0);
  const checkInDate = new Date(booking.checkIn + "T00:00:00");
  if (notice < checkInDate) return { lastPaymentPaid: null, finalPeriodPaid: null }; // not a midstay cancellation -- irrelevant

  const checkOutDate = new Date(booking.checkOut + "T00:00:00");
  const noticeLookup = notice < checkOutDate ? notice : new Date(checkOutDate.getTime() - 86400000);
  const period = findPaymentPeriod(booking.checkIn, booking.checkOut, noticeLookup);

  const finalLookup = new Date(checkOutDate.getTime() - 86400000);
  const finalPeriod = findPaymentPeriod(booking.checkIn, booking.checkOut, finalLookup) || period;

  const lastPaymentPaid = await isPeriodPaid(booking, period);
  // Avoid a second identical Stripe lookup when notice already IS in the
  // final period -- they're the same period, so the same answer applies.
  const finalPeriodPaid = (period && finalPeriod && period.index === finalPeriod.index)
    ? lastPaymentPaid
    : await isPeriodPaid(booking, finalPeriod);

  return { lastPaymentPaid, finalPeriodPaid };
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

  const { lastPaymentPaid, finalPeriodPaid } = await determinePaymentStatus(booking, noticeDate);
  const outcome = cancellationOutcome(booking.checkIn, booking.checkOut, noticeDate, booking.pets, lastPaymentPaid, finalPeriodPaid);

  // ---- Stripe: refund (if applicable -- only the pre-arrival branches) ----
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
  // For midstay Rule 3, the final installment is deliberately left out of
  // this cleanup (outcome.cancelFutureInstallments is false in that case) --
  // it gets billed in full just below instead of voided.
  const voidedInvoiceIds = [];
  if (outcome.cancelFutureInstallments && booking.stripeCustomerId) {
    try {
      const draftInvoices = await stripe.invoices.list({
        customer: booking.stripeCustomerId,
        status: "draft",
        limit: 100,
      });
      const openInvoices = await stripe.invoices.list({
        customer: booking.stripeCustomerId,
        status: "open",
        limit: 100,
      });

      for (const inv of [...draftInvoices.data, ...openInvoices.data]) {
        const instDate = inv.metadata && inv.metadata.installmentDate;
        // For Rule 1, leave alone (don't void) any installment that's
        // already due on/before the liability end date -- it covers nights
        // the guest actually paid for and stayed through, so it's not part
        // of the "future, not-yet-owed" set this cleanup targets.
        if (outcome.branch === "midstay" && instDate && outcome.liabilityEndDate) {
          if (instDate <= outcome.liabilityEndDate) continue;
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

  // ---- Stripe: bill the midstay termination fee (Rule 1), the final
  // installment in full (Rule 3), or nothing extra (Rule 2) right now,
  // rather than waiting on a separate manual "charge" step -- these are
  // deterministic, known amounts the moment cancellation is processed.
  // unpaidUsedNightsDue can apply under ANY of the three rules -- it
  // covers an earlier, still-unpaid period's already-used nights, which
  // is a distinct gap from whatever each rule itself bills (see
  // cancellationOutcome()'s comments in lib/pricing.js for when this
  // arises under Rules 2/3 specifically: a short final period). ----
  let billedInvoice = null;
  let billingError = null;
  const unpaidUsedNightsDue = outcome.unpaidUsedNightsDue || 0;
  const ruleAmount = outcome.midstayRule === 1 ? outcome.terminationFee
    : outcome.midstayRule === 3 ? outcome.finalPaymentDue
    : 0; // Rule 2 itself bills nothing -- the already-collected final payment is simply kept
  const amountToBillNow = outcome.branch === "midstay" ? ruleAmount + unpaidUsedNightsDue : 0;

  if (amountToBillNow > 0) {
    if (!booking.stripeCustomerId) {
      billingError = "No Stripe customer on file -- cannot bill automatically. Invoice manually.";
      console.error("CRITICAL:", billingError, confirmationCode);
    } else {
      try {
        if (ruleAmount > 0) {
          await stripe.invoiceItems.create({
            customer: booking.stripeCustomerId,
            amount: ruleAmount * 100,
            currency: "usd",
            description: outcome.midstayRule === 1
              ? "RISE Furnished Stays — early termination fee"
              : "RISE Furnished Stays — final installment (due in full per cancellation policy)",
          });
        }
        if (unpaidUsedNightsDue > 0) {
          await stripe.invoiceItems.create({
            customer: booking.stripeCustomerId,
            amount: unpaidUsedNightsDue * 100,
            currency: "usd",
            description: `RISE Furnished Stays — rent for nights already stayed in an unpaid period`,
          });
        }

        billedInvoice = await stripe.invoices.create({
          customer: booking.stripeCustomerId,
          collection_method: "charge_automatically",
          auto_advance: true,
          metadata: {
            confirmationCode,
            reason: ruleAmount > 0
              ? (outcome.midstayRule === 1 ? "midstay-termination-fee" : "midstay-final-installment")
              : "midstay-unpaid-period-gap",
          },
          description: ruleAmount > 0
            ? (outcome.midstayRule === 1
                ? "RISE Furnished Stays — early termination fee"
                : "RISE Furnished Stays — final installment (due in full per cancellation policy)")
            : "RISE Furnished Stays — rent for nights already stayed in an unpaid period",
        });
        billedInvoice = await stripe.invoices.finalizeInvoice(billedInvoice.id);
      } catch (e) {
        billingError = e.message;
        console.error("CRITICAL: automatic billing failed for", confirmationCode, ":", e.message, "-- bill manually for $" + amountToBillNow);
      }
    }
  }

  // ---- Update booking record ----
  const newStatus = outcome.branch === "midstay" ? "cancelled-midstay" : "cancelled";
  try {
    await updateBookingStatus(confirmationCode, {
      status: newStatus,
      cancelledAt: new Date().toISOString(),
      cancellationBranch: outcome.branch,
      midstayRule: outcome.midstayRule || null,
      refundAmount: outcome.refundAmount,
      refundId: refund ? refund.id : null,
      liabilityEndDate: outcome.liabilityEndDate,
      terminationFee: outcome.terminationFee || 0,
      unpaidUsedNightsDue: outcome.unpaidUsedNightsDue || 0,
      finalPaymentDue: outcome.finalPaymentDue || 0,
      billedInvoiceId: billedInvoice ? billedInvoice.id : null,
      billingError,
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
    const guestEmailHtml = outcome.branch === "non-refundable"
      ? lateCancellationGuestEmail({
          guestName: booking.guestName,
          unitCode: booking.unitCode,
          checkIn: booking.checkIn,
          confirmationCode,
          outcome,
        })
      : cancellationGuestEmail({
          guestName: booking.guestName,
          unitCode: booking.unitCode,
          confirmationCode,
          outcome,
        });
    await sendEmail({
      to: booking.guestEmail,
      subject: `Cancellation Confirmed — RISE Furnished Stays`,
      replyTo: "risefurnishedstays@gmail.com",
      html: guestEmailHtml,
    });
  } catch (e) {
    guestEmailError = e.message;
    console.error("Guest cancellation email failed (non-fatal) for", confirmationCode, "to", booking.guestEmail, ":", e.message);
  }

  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Cancellation: ${confirmationCode} (${outcome.branch}${outcome.midstayRule ? " rule " + outcome.midstayRule : ""})`,
      html: cancellationOwnerEmail({ booking, outcome, refund, voidedInvoiceIds, billedInvoice, billingError }),
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
    billedInvoiceId: billedInvoice ? billedInvoice.id : null,
    billingError,
    guestEmailError,
    ownerEmailError,
    voidedInvoiceIds,
  });
}

// =========================================================================
// action=charge-liability (POST) -- was charge-liability.js
//
// Originally the only way to bill a midstay cancellation (handleCancel just
// voided future invoices and left billing as a manual follow-up step). Now
// that handleCancel bills the termination fee (Rule 1) or final installment
// (Rule 3) automatically at cancellation time, this endpoint exists as a
// manual retry path for the case where that automatic billing failed
// (billingError was set on the booking) -- same Stripe mechanics, just
// triggered by hand instead of inline.
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
        "A charge can only be created for a mid-stay cancellation that's already been processed.",
    });
  }

  if (booking.billedInvoiceId) {
    return res.status(409).json({
      error: "A charge was already created for this booking.",
      billedInvoiceId: booking.billedInvoiceId,
    });
  }

  const ruleAmount = booking.midstayRule === 1 ? (booking.terminationFee || 0)
    : booking.midstayRule === 3 ? (booking.finalPaymentDue || 0)
    : 0; // Rule 2 itself bills nothing
  const amount = ruleAmount + (booking.unpaidUsedNightsDue || 0);
  if (amount <= 0) {
    return res.status(400).json({ error: "This booking has no recorded termination fee or final payment due to invoice." });
  }

  if (!booking.stripeCustomerId) {
    return res.status(400).json({ error: "No Stripe customer is on file for this booking -- cannot send an invoice." });
  }

  const description = ruleAmount > 0
    ? (booking.midstayRule === 1
        ? `RISE Furnished Stays — early termination fee`
        : `RISE Furnished Stays — final installment (due in full per cancellation policy)`)
    : `RISE Furnished Stays — rent for nights already stayed in an unpaid period`;

  let invoice;
  try {
    await stripe.invoiceItems.create({
      customer: booking.stripeCustomerId,
      amount: amount * 100,
      currency: "usd",
      description,
    });

    invoice = await stripe.invoices.create({
      customer: booking.stripeCustomerId,
      collection_method: "send_invoice",
      days_until_due: 7,
      auto_advance: true,
      metadata: {
        confirmationCode,
        reason: ruleAmount > 0
          ? (booking.midstayRule === 1 ? "midstay-termination-fee" : "midstay-final-installment")
          : "midstay-unpaid-period-gap",
      },
      description,
    });

    invoice = await stripe.invoices.finalizeInvoice(invoice.id);
  } catch (e) {
    console.error("Stripe invoice creation failed for", confirmationCode, e.message);
    return res.status(502).json({ error: "Stripe invoice creation failed: " + e.message });
  }

  try {
    await updateBookingStatus(confirmationCode, {
      billedInvoiceId: invoice.id,
      billedInvoiceUrl: invoice.hosted_invoice_url,
      billedInvoiceCreatedAt: new Date().toISOString(),
      billingError: null,
    });
  } catch (e) {
    console.error("CRITICAL: invoice created in Stripe but NOT recorded on booking:", confirmationCode, e.message, "invoiceId:", invoice.id);
  }

  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Invoice sent: ${confirmationCode}`,
      html: liabilityInvoiceOwnerEmail({ booking, amount, invoice }),
    });
  } catch (e) {
    console.error("Owner notification for invoice failed (non-fatal):", confirmationCode, e.message);
  }

  return res.status(200).json({
    confirmationCode,
    invoiceId: invoice.id,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    amount,
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
