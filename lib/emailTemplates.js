// lib/emailTemplates.js
// Inline-styled HTML email templates (email clients strip <style> blocks).

function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function money(n) {
  const num = Number(n);
  return "$" + (isNaN(num) ? n : num.toLocaleString("en-US"));
}

function scheduleRows(schedule) {
  if (!schedule || !schedule.length) {
    return '<tr><td colspan="2" style="padding:8px 0;color:#888;">Paid in full at booking — no future installments.</td></tr>';
  }
  return schedule.map(function (s) {
    return '<tr><td style="padding:6px 0;">' + escapeHtml(s.date) +
      ' (' + escapeHtml(s.nights) + ' nights)</td>' +
      '<td style="padding:6px 0;text-align:right;">' + money(s.amount) +
      '</td></tr>';
  }).join("");
}

function contactFormEmail({ name, email, phone, message }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#2c3e50;">New Contact Form Submission</h2>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td style="padding:8px 0; font-weight:bold; width:120px;">Name:</td><td style="padding:8px 0;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Email:</td><td style="padding:8px 0;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Phone:</td><td style="padding:8px 0;">${escapeHtml(phone || "Not provided")}</td></tr>
      </table>
      <p style="font-weight:bold; margin-top:16px;">Message:</p>
      <p style="background:#f5f5f5; padding:12px; border-radius:6px; white-space:pre-wrap;">${escapeHtml(message)}</p>
      <p style="color:#888; font-size:12px; margin-top:24px;">Submitted via the Contact form on risefurnishedstays.com</p>
    </div>`;
}

function guestConfirmationEmail({ guestName, unitName, checkIn, checkOut, nights, dueToday, fullTotal, schedule, confirmationCode }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#2c3e50;">Your Stay is Confirmed!</h2>
      <p>Hi ${escapeHtml(guestName)},</p>
      <p>Thanks for booking directly with RISE Furnished Stays. Here are your details:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:8px 0; font-weight:bold; width:150px;">Confirmation #:</td><td style="padding:8px 0;">${escapeHtml(confirmationCode)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Unit:</td><td style="padding:8px 0;">${escapeHtml(unitName)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Check-in:</td><td style="padding:8px 0;">${escapeHtml(checkIn)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Check-out:</td><td style="padding:8px 0;">${escapeHtml(checkOut)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Total nights:</td><td style="padding:8px 0;">${escapeHtml(nights)}</td></tr>
      </table>
      <h3 style="color:#2c3e50; margin-top:20px;">Payment</h3>
      <p style="margin:4px 0;"><strong>Paid today:</strong> ${money(dueToday)} (first 30 nights + cleaning${schedule && schedule.length ? "" : ""})</p>
      <p style="margin:4px 0;"><strong>Full stay total:</strong> ${money(fullTotal)}</p>
      ${schedule && schedule.length ? `
      <p style="margin-top:16px; font-weight:bold;">Upcoming installments (charged automatically to your card on file):</p>
      <table style="width:100%; border-collapse:collapse;">
        <tr style="border-bottom:1px solid #ddd;"><th style="text-align:left; padding:6px 0;">Due date</th><th style="text-align:right; padding:6px 0;">Amount</th></tr>
        ${scheduleRows(schedule)}
      </table>
      <p style="color:#666; font-size:13px; margin-top:8px;">Each installment will be charged to the same card you used today. You'll receive a receipt from Stripe for each payment.</p>
      ` : ""}
      <p style="margin-top:20px;">We'll send check-in instructions closer to your arrival. Questions? Just reply to this email.</p>
      <p style="color:#888; font-size:12px; margin-top:24px;">RISE Furnished Stays</p>
    </div>`;
}

function ownerNotificationEmail({ guestName, guestEmail, guestPhone, guestCountry, guestComments, unitName, checkIn, checkOut, nights, dueToday, fullTotal, schedule, confirmationCode }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#2c3e50;">New Booking Received</h2>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td style="padding:8px 0; font-weight:bold; width:150px;">Confirmation #:</td><td style="padding:8px 0;">${escapeHtml(confirmationCode)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Guest:</td><td style="padding:8px 0;">${escapeHtml(guestName)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Guest Email:</td><td style="padding:8px 0;">${escapeHtml(guestEmail)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Guest Phone:</td><td style="padding:8px 0;">${escapeHtml(guestPhone || "Not provided")}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Country:</td><td style="padding:8px 0;">${escapeHtml(guestCountry || "Not provided")}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Unit:</td><td style="padding:8px 0;">${escapeHtml(unitName)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Check-in:</td><td style="padding:8px 0;">${escapeHtml(checkIn)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Check-out:</td><td style="padding:8px 0;">${escapeHtml(checkOut)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Nights:</td><td style="padding:8px 0;">${escapeHtml(nights)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Paid today:</td><td style="padding:8px 0;">${money(dueToday)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Full total:</td><td style="padding:8px 0;">${money(fullTotal)}</td></tr>
      </table>${guestComments ? `
      <p style="font-weight:bold; margin-top:16px;">Guest comments:</p>
      <p style="background:#f5f5f5; padding:12px; border-radius:6px; white-space:pre-wrap;">${escapeHtml(guestComments)}</p>` : ""}
      ${schedule && schedule.length ? `
      <p style="margin-top:16px; font-weight:bold;">Scheduled installments (auto-charge):</p>
      <table style="width:100%; border-collapse:collapse;">
        ${scheduleRows(schedule)}
      </table>` : "<p style='margin-top:12px;'>Paid in full at booking.</p>"}
    </div>`;
}

function paymentFailedOwnerEmail({ confirmationCode, unitCode, installmentDate, amount, guestEmail }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#c0392b;">Installment Payment Failed</h2>
      <p>An automatic installment charge did not go through. Stripe will retry per your dunning settings, but you may want to follow up.</p>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td style="padding:8px 0; font-weight:bold; width:150px;">Confirmation #:</td><td style="padding:8px 0;">${escapeHtml(confirmationCode)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Unit:</td><td style="padding:8px 0;">${escapeHtml(unitCode)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Installment date:</td><td style="padding:8px 0;">${escapeHtml(installmentDate)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Amount:</td><td style="padding:8px 0;">${money(amount)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Guest email:</td><td style="padding:8px 0;">${escapeHtml(guestEmail)}</td></tr>
      </table>
      <p style="color:#888; font-size:12px; margin-top:24px;">Manage this in your Stripe dashboard under Invoices.</p>
    </div>`;
}

const UNIT_NAMES = { A: "Unit A", B: "Unit B", D: "Unit D" };
function unitDisplayName(unitCode) {
  return UNIT_NAMES[unitCode] || (unitCode ? `Unit ${unitCode}` : "your unit");
}

function outcomeSummaryRow(outcome) {
  if (outcome.branch === "full-refund") {
    return `<tr><td style="padding:8px 0; font-weight:bold; width:170px;">Refund amount:</td><td style="padding:8px 0;">${money(outcome.refundAmount)}</td></tr>`;
  }
  if (outcome.branch === "non-refundable") {
    return `<tr><td style="padding:8px 0; font-weight:bold; width:170px;">Refund amount:</td><td style="padding:8px 0;">$0 — first month's rent is non-refundable inside 30 days of check-in</td></tr>`;
  }
  // midstay
  return `<tr><td style="padding:8px 0; font-weight:bold; width:170px;">Liable through:</td><td style="padding:8px 0;">${escapeHtml(outcome.liabilityEndDate)} (${escapeHtml(outcome.liableNights)} nights)</td></tr>`;
}

function cancellationGuestEmail({ guestName, unitCode, confirmationCode, outcome }) {
  const unitName = unitDisplayName(unitCode);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#2c3e50;">Your Cancellation is Confirmed</h2>
      <p>Hi ${escapeHtml(guestName || "there")},</p>
      <p>This confirms your stay at ${escapeHtml(unitName || "RISE Furnished Stays")} has been cancelled. Here's a summary:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr><td style="padding:8px 0; font-weight:bold; width:170px;">Confirmation #:</td><td style="padding:8px 0;">${escapeHtml(confirmationCode)}</td></tr>
        ${outcomeSummaryRow(outcome)}
      </table>
      <p style="background:#f5f5f5; padding:12px; border-radius:6px;">${escapeHtml(outcome.message)}</p>
      ${outcome.branch === "full-refund" ? `<p style="color:#666; font-size:13px;">Your refund has been issued to the original payment method. Please allow 5–10 business days for it to appear on your statement, depending on your bank.</p>` : ""}
      ${outcome.branch === "midstay" ? `<p style="color:#666; font-size:13px;">No further charges will be made beyond the date above. If you have questions about this, just reply to this email.</p>` : ""}
      <p style="margin-top:20px;">Questions? Just reply to this email.</p>
      <p style="color:#888; font-size:12px; margin-top:24px;">RISE Furnished Stays</p>
    </div>`;
}

function cancellationOwnerEmail({ booking, outcome, refund, voidedInvoiceIds }) {
  const unitName = unitDisplayName(booking.unitCode);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color:#2c3e50;">Booking Cancelled</h2>
      <table style="width:100%; border-collapse:collapse;">
        <tr><td style="padding:8px 0; font-weight:bold; width:170px;">Confirmation #:</td><td style="padding:8px 0;">${escapeHtml(booking.confirmationCode)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Guest:</td><td style="padding:8px 0;">${escapeHtml(booking.guestName)} (${escapeHtml(booking.guestEmail)})</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Unit:</td><td style="padding:8px 0;">${escapeHtml(unitName)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Original check-in:</td><td style="padding:8px 0;">${escapeHtml(booking.checkIn)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Original check-out:</td><td style="padding:8px 0;">${escapeHtml(booking.checkOut)}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Policy branch:</td><td style="padding:8px 0;">${escapeHtml(outcome.branch)}</td></tr>
        ${outcomeSummaryRow(outcome)}
        <tr><td style="padding:8px 0; font-weight:bold;">Stripe refund:</td><td style="padding:8px 0;">${refund ? escapeHtml(refund.id) : "None issued"}</td></tr>
        <tr><td style="padding:8px 0; font-weight:bold;">Invoices voided:</td><td style="padding:8px 0;">${voidedInvoiceIds && voidedInvoiceIds.length ? escapeHtml(voidedInvoiceIds.join(", ")) : "None"}</td></tr>
      </table>
      <p style="background:#f5f5f5; padding:12px; border-radius:6px; margin-top:16px;">${escapeHtml(outcome.message)}</p>
      ${outcome.branch === "midstay" ? `<p style="color:#c0392b; font-size:13px;">Mid-stay cancellation — confirm any nights owed beyond what's already been charged are collected manually if needed; this flow only voids future installments, it does not create a new charge for partial periods.</p>` : ""}
      <p style="color:#888; font-size:12px; margin-top:24px;">Processed via the cancel-booking endpoint on risefurnishedstays.com.</p>
    </div>`;
}

module.exports = {
  contactFormEmail,
  guestConfirmationEmail,
  ownerNotificationEmail,
  paymentFailedOwnerEmail,
  cancellationGuestEmail,
  cancellationOwnerEmail,
};
