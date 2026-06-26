// lib/emailTemplates.js
// Inline-styled HTML email templates (email clients strip <style> blocks,
// and most don't support modern CSS like oklch() -- everything here uses
// plain hex colors and table-based layout for maximum compatibility,
// including older Outlook desktop versions).

const { cancellationCutoffDates, parseKey } = require("./pricing");

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Matches checkout.html's fmtLong style ("Aug 1, 2026") so dates read the
// same way across the website and every email.
function fmtLong(d) {
  return MONTHS_SHORT[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}
// Builds the exact-dates cancellation policy paragraph, given a check-in
// date string ("YYYY-MM-DD"). Shared across every template that needs to
// state the policy with real dates instead of relative "30 days" language.
function cancellationPolicyParagraph(checkInStr) {
  if (!checkInStr) return "";
  const { fullRefundCutoff, partialRefundCutoff } = cancellationCutoffDates(checkInStr);
  return `Cancel by <strong>${fmtLong(fullRefundCutoff)}</strong> and your first month's rent, cleaning fee, and any pet fees are refunded in full. ` +
    `Cancel between ${fmtLong(addDaysSafe(fullRefundCutoff, 1))} and <strong>${fmtLong(partialRefundCutoff)}</strong> and the first month's rent is non-refundable, but the cleaning fee and any pet fees are still refunded. ` +
    `After check-in, the cleaning fee and any pet fees become non-refundable, and you remain liable for rent through the 30th day following the date notice of termination is provided.`;
}
function addDaysSafe(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const BRAND = {
  orange: "#cc7044",       // hex equivalent of the site's --accent: oklch(0.64 0.13 45)
  orangeDark: "#a85a35",   // slightly darker, for hover-style accents/borders
  ink: "#2b2926",          // matches the site's --ink
  inkSoft: "#6f6a63",      // matches --ink-soft
  paper: "#f4f1ea",        // matches --paper
  paperLine: "#e7e2d6",
  logoUrl: "https://www.risefurnishedstays.com/assets/rise-logo.png",
  siteUrl: "https://www.risefurnishedstays.com",
  supportEmail: "risefurnishedstays@gmail.com",
};

// Cover photo per unit, mirroring gallery[0] in rise-unit-data.js (the same
// "first" photo each unit page itself treats as primary). Unit B/D's source
// photos are .avif, which many email clients (notably Outlook desktop)
// cannot render -- jpg copies of the same images are used here instead.
// These must be uploaded to the repo at the paths below before emails go out.
const UNIT_COVER_PHOTOS = {
  A: "https://www.risefurnishedstays.com/assets/unitA/01-living-open.jpg",
  B: "https://www.risefurnishedstays.com/assets/email/unitB-04-living.jpg",
  D: "https://www.risefurnishedstays.com/assets/email/unitD-01-living.jpg",
};

const UNIT_NAMES = {
  A: "Cozy Home in South Austin",
  B: "Entire Home in South Austin",
  D: "Private Home in South Austin",
};
// Real unit page URLs, so the confirmation email can link straight to the
// listing the guest booked, and the specs shown on that same page (matching
// rise-unit-data.js -- A and D use the 5-item SPECS_BASE including a sofa
// bed, B has its own 4-item override with no sofa bed).
const UNIT_PAGE_URLS = {
  A: "https://www.risefurnishedstays.com/unit-a.html",
  B: "https://www.risefurnishedstays.com/unit-b.html",
  D: "https://www.risefurnishedstays.com/unit-d.html",
};
const UNIT_SPECS = {
  A: ["4 guests", "2 bedrooms", "2 queen beds", "1 sofa bed", "1.5 bathrooms"],
  B: ["4 guests", "2 bedrooms", "2 queen beds", "1.5 bathrooms"],
  D: ["4 guests", "2 bedrooms", "2 queen beds", "1 sofa bed", "1.5 bathrooms"],
};
function unitDisplayName(unitCode) {
  return UNIT_NAMES[unitCode] || (unitCode ? `Unit ${unitCode}` : "your unit");
}
function unitCoverPhoto(unitCode) {
  return UNIT_COVER_PHOTOS[unitCode] || null;
}
function unitPageUrl(unitCode) {
  return UNIT_PAGE_URLS[unitCode] || "https://www.risefurnishedstays.com/";
}
function unitSpecsLine(unitCode) {
  return (UNIT_SPECS[unitCode] || []).join(" - ");
}

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

// ---------------------------------------------------------------------
// Shared layout shell. Every guest-facing email is built from this --
// logo header, optional hero photo, a white content card, and a footer
// with the "don't reply to this address" notice. Owner-facing emails
// (internal, sent to risefurnishedstays@gmail.com) use a lighter-weight
// variant without the hero photo, since they're functional, not brand-facing.
// ---------------------------------------------------------------------

function layout({ heroImageUrl, heroAlt, bodyHtml, preheader }) {
  const hero = heroImageUrl
    ? `<tr><td style="padding:0;">
         <img src="${escapeHtml(heroImageUrl)}" alt="${escapeHtml(heroAlt || "")}" width="600"
              style="display:block; width:100%; max-width:600px; height:auto; border:0;" />
       </td></tr>`
    : "";

  // Preheader: invisible preview text shown in inbox lists, before the
  // email is opened. Doesn't render visually in the email body itself.
  const preheaderHtml = preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${escapeHtml(preheader)}</div>`
    : "";

  return `
  <div style="background:${BRAND.paper}; padding:28px 12px; font-family: Arial, Helvetica, sans-serif;">
    ${preheaderHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid ${BRAND.paperLine};">
      <tr>
        <td style="padding:18px 32px; text-align:center; border-bottom:1px solid ${BRAND.paperLine};">
          <img src="${BRAND.logoUrl}" alt="RISE Furnished Stays" height="90" style="display:inline-block; height:90px; width:auto; border:0;" />
        </td>
      </tr>
      ${hero}
      <tr>
        <td style="padding:32px 32px 24px;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px; background:${BRAND.paper}; border-top:1px solid ${BRAND.paperLine}; text-align:center;">
          <p style="margin:0 0 6px; font-size:13px; color:${BRAND.inkSoft};">
            Questions? Reach out to <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.orange}; text-decoration:none; font-weight:bold;">${BRAND.supportEmail}</a>.
          </p>
          <p style="margin:0; font-size:11.5px; color:${BRAND.inkSoft};">
            This email address is not monitored - please don't reply directly to this message.
          </p>
          <p style="margin:14px 0 0; font-size:11px; color:#a8a39a;">RISE Furnished Stays &middot; South Austin, TX</p>
        </td>
      </tr>
    </table>
  </div>`;
}

// Small reusable building blocks for body content -----------------------

function kicker(text) {
  return `<div style="font-family: ui-monospace, Consolas, monospace; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:${BRAND.orange}; font-weight:bold; margin-bottom:10px;">${escapeHtml(text)}</div>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 14px; font-size:26px; line-height:1.2; color:${BRAND.ink}; font-family: Georgia, 'Times New Roman', serif;">${escapeHtml(text)}</h1>`;
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:10px 0; border-bottom:1px solid ${BRAND.paperLine}; color:${BRAND.inkSoft}; font-size:14px; width:42%;">${escapeHtml(label)}</td>
    <td style="padding:10px 0; border-bottom:1px solid ${BRAND.paperLine}; color:${BRAND.ink}; font-size:14px; font-weight:bold; text-align:right;">${value}</td>
  </tr>`;
}

// Visually emphasized row, used for the full stay total -- bolder, larger,
// and set apart from the standard rows around it with the brand orange and
// a thicker top border, so it doesn't blend in with "Check-in"/"Paid today"/etc.
function detailRowEmphasized(label, value) {
  return `<tr>
    <td style="padding:14px 0 12px; border-top:2px solid ${BRAND.orange}; color:${BRAND.ink}; font-size:15.5px; font-weight:bold; width:42%;">${escapeHtml(label)}</td>
    <td style="padding:14px 0 12px; border-top:2px solid ${BRAND.orange}; color:${BRAND.orange}; font-size:19px; font-weight:bold; text-align:right;">${value}</td>
  </tr>`;
}

function detailTable(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${rowsHtml}</table>`;
}

function calloutBox(html, opts) {
  opts = opts || {};
  const bg = opts.tone === "warn" ? "#fff4e0" : opts.tone === "danger" ? "#fdecea" : "#fbeee5";
  const border = opts.tone === "warn" ? "#e0b04d" : opts.tone === "danger" ? "#e0958c" : BRAND.orange;
  return `<div style="background:${bg}; border:1px solid ${border}; border-radius:8px; padding:16px 18px; margin:18px 0; font-size:14px; color:${BRAND.ink}; line-height:1.55;">${html}</div>`;
}

function ctaButton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr><td style="border-radius:8px; background:${BRAND.orange};">
    <a href="${escapeHtml(url)}" style="display:inline-block; padding:13px 26px; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function scheduleRows(schedule) {
  if (!schedule || !schedule.length) {
    return `<tr><td colspan="2" style="padding:8px 0; color:${BRAND.inkSoft}; font-size:13.5px;">Paid in full at booking - no future installments.</td></tr>`;
  }
  return schedule.map(function (s) {
    return `<tr>
      <td style="padding:6px 0; font-size:13.5px; color:${BRAND.inkSoft};">${escapeHtml(s.date)} (${escapeHtml(s.nights)} nights)</td>
      <td style="padding:6px 0; font-size:13.5px; text-align:right; font-weight:bold; color:${BRAND.ink};">${money(s.amount)}</td>
    </tr>`;
  }).join("");
}

// =========================================================================
// GUEST-FACING TEMPLATES (full branded layout with hero photo where relevant)
// =========================================================================

function guestConfirmationEmail({ guestName, unitCode, unitName, checkIn, checkOut, nights, dueToday, fullTotal, schedule, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const cover = unitCoverPhoto(unitCode);
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const pageUrl = unitPageUrl(unitCode);
  const specsLine = unitSpecsLine(unitCode);

  const body = `
    ${kicker("Payment successful")}
    ${heading("Payment received" + (first ? ", " + first : "") + "!")}
    <p style="margin:0 0 6px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Thanks for booking directly with RISE Furnished Stays. Your payment for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> went through.
    </p>
    ${specsLine ? `<p style="margin:0 0 18px; font-size:13.5px; color:${BRAND.inkSoft};">${escapeHtml(specsLine)}</p>` : ""}
    ${calloutBox(`<strong>Your booking isn't complete yet.</strong> You still need to sign your lease and send a photo ID to <a href="mailto:risefurnishedstays@gmail.com" style="color:${BRAND.orange}; font-weight:bold;">risefurnishedstays@gmail.com</a> before your stay is confirmed. We'll email your lease shortly.`, { tone: "warn" })}
    ${calloutBox(`<strong>Confirmation code:</strong> ${escapeHtml(confirmationCode)}`)}
    ${detailTable(
      detailRow("Check-in", escapeHtml(checkIn)) +
      detailRow("Check-out", escapeHtml(checkOut)) +
      detailRow("Total nights", escapeHtml(nights)) +
      detailRow("Paid today", money(dueToday)) +
      detailRowEmphasized("Full stay total", money(fullTotal))
    )}
    ${schedule && schedule.length ? `
      <p style="margin:22px 0 8px; font-weight:bold; font-size:14px; color:${BRAND.ink};">Upcoming installments</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><th style="text-align:left; padding:6px 0; border-bottom:2px solid ${BRAND.paperLine}; font-size:12px; color:${BRAND.inkSoft}; text-transform:uppercase; letter-spacing:0.04em;">Due date</th><th style="text-align:right; padding:6px 0; border-bottom:2px solid ${BRAND.paperLine}; font-size:12px; color:${BRAND.inkSoft}; text-transform:uppercase; letter-spacing:0.04em;">Amount</th></tr>
        ${scheduleRows(schedule)}
      </table>
      <p style="color:${BRAND.inkSoft}; font-size:12.5px; margin-top:10px;">Each installment is charged automatically to the card you used today. Stripe will email you a receipt each time.</p>
    ` : ""}
    ${ctaButton("View " + displayUnitName, pageUrl)}
    <p style="margin:24px 0 0; font-size:14px; line-height:1.6; color:${BRAND.inkSoft};">
      We'll send check-in details closer to your arrival, once your lease is signed.
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Your stay at ${displayUnitName} is confirmed - ${checkIn} to ${checkOut}`,
    bodyHtml: body,
  });
}

function leaseAgreementEmail({ guestName, unitCode, unitName, checkIn, confirmationCode, leaseUrl, leaseSentDate }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  // The 3-day deadline counts from when THIS email/lease was sent, not from
  // check-in -- a guest who books far in advance still only gets 3 days to
  // sign, same as a guest booking last-minute.
  const sentDate = leaseSentDate ? parseKey(leaseSentDate) : new Date();
  const signByDate = addDaysSafe(sentDate, 3);
  const policyParagraph = checkIn ? cancellationPolicyParagraph(checkIn) : "";

  const body = `
    ${kicker("Action needed")}
    ${heading("Your lease is ready to sign")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, your lease agreement for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}) is ready to review and sign.
    </p>
    ${calloutBox(`<strong>Your booking is not considered complete until the lease is signed.</strong> Please sign by <strong>${fmtLong(signByDate)}</strong> (3 days from today) - if the lease isn't signed by then, your booking will be cancelled.`, { tone: "warn" })}
    ${leaseUrl ? ctaButton("Review & sign your lease", leaseUrl) : ""}
    <p style="margin:18px 0 0; font-size:14px; line-height:1.6; color:${BRAND.inkSoft};">
      As part of signing, you'll also need to send a photo ID to <a href="mailto:risefurnishedstays@gmail.com" style="color:${BRAND.orange}; font-weight:bold;">risefurnishedstays@gmail.com</a> for verification.
    </p>
    ${policyParagraph ? `
      <p style="margin:24px 0 6px; font-weight:bold; font-size:14px; color:${BRAND.ink};">Cancellation policy for your stay</p>
      <p style="margin:0; font-size:13.5px; line-height:1.6; color:${BRAND.inkSoft};">${policyParagraph}</p>
    ` : ""}
    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">
      Once all parties have signed, we'll follow up with your check-in instructions and house rules.
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Your lease for ${displayUnitName} is ready to sign - 3 day deadline`,
    bodyHtml: body,
  });
}

// Full street address per unit -- the fourplex is one street address with
// a unit letter, not three different addresses.
const UNIT_ADDRESSES = {
  A: "5907 Cougar Drive, Unit A, Austin, TX 78745",
  B: "5907 Cougar Drive, Unit B, Austin, TX 78745",
  D: "5907 Cougar Drive, Unit D, Austin, TX 78745",
};
function unitAddress(unitCode) {
  return UNIT_ADDRESSES[unitCode] || null;
}

// Unit-specific check-in instructions PDF (with photos showing exactly
// which door to use). Referenced by URL (Resend's "path" attachment
// option) rather than embedded as base64 in every send -- these files are
// a few hundred KB each, no reason to inflate every API call with that.
// Must be uploaded to the repo at these exact paths.
const UNIT_CHECKIN_PDFS = {
  A: "https://www.risefurnishedstays.com/assets/checkin-pdfs/unit-a-checkin-instructions.pdf",
  B: "https://www.risefurnishedstays.com/assets/checkin-pdfs/unit-b-checkin-instructions.pdf",
  D: "https://www.risefurnishedstays.com/assets/checkin-pdfs/unit-d-checkin-instructions.pdf",
};
function unitCheckinPdfAttachment(unitCode) {
  const url = UNIT_CHECKIN_PDFS[unitCode];
  if (!url) return null;
  return { path: url, filename: `Cougar-Drive-Unit-${unitCode}-Check-in-Instructions.pdf` };
}

function checkinInstructionsEmail({ guestName, unitCode, unitName, checkIn, checkOut, doorCode, houseRules, guidebookUrl, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  const address = unitAddress(unitCode);
  // doorCode is a PLACEHOLDER until the Schlage Home API integration is
  // built (see project notes) -- it generates a real per-guest temporary
  // code scoped to the stay dates. Until then this falls back to a clear
  // note rather than silently showing nothing or a fake-looking blank.
  const doorCodeDisplay = doorCode || "(will be sent separately before your arrival)";

  const rulesHtml = (houseRules && houseRules.length)
    ? `<ul style="margin:6px 0 0; padding-left:20px; color:${BRAND.inkSoft}; font-size:14px; line-height:1.7;">
         ${houseRules.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
       </ul>`
    : "";

  const body = `
    ${kicker("Lease signed - you're all set")}
    ${heading("Check-in details for your stay")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, your lease for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}) has been signed by all parties. Here's everything you need for check-in.
    </p>
    ${detailTable(
      detailRow("Check-in", escapeHtml(checkIn)) +
      detailRow("Check-out", escapeHtml(checkOut)) +
      (address ? detailRow("Address", escapeHtml(address)) : "") +
      detailRow("Door code", escapeHtml(doorCodeDisplay))
    )}
    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">
      We've attached step-by-step check-in instructions with photos to help you find the right door.
    </p>
    ${rulesHtml ? `<p style="margin:22px 0 4px; font-weight:bold; font-size:14px; color:${BRAND.ink};">House rules</p>${rulesHtml}` : ""}
    ${guidebookUrl ? ctaButton("Open the Austin guidebook", guidebookUrl) : ""}
    <p style="margin:22px 0 0; font-size:14px; line-height:1.6; color:${BRAND.inkSoft};">
      We hope you have a wonderful stay!
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Check-in details and house rules for ${displayUnitName}`,
    bodyHtml: body,
  });
}

function outcomeSummaryRow(outcome) {
  if (outcome.branch === "full-refund") {
    return detailRow("Refund amount", money(outcome.refundAmount) + ` (rent: ${money(outcome.rentRefund)} + fees: ${money(outcome.feeRefund)})`);
  }
  if (outcome.branch === "non-refundable") {
    return detailRow("Refund amount", money(outcome.refundAmount) + " (cleaning/pet fees only - rent is non-refundable)");
  }
  return detailRow("Liable through", escapeHtml(outcome.liabilityEndDate) + ` (${escapeHtml(outcome.liableNights)} nights)`);
}

function cancellationGuestEmail({ guestName, unitCode, confirmationCode, outcome }) {
  const unitName = unitDisplayName(unitCode);
  const body = `
    ${kicker("Cancellation confirmed")}
    ${heading("Your cancellation is confirmed")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(guestName || "there")}, this confirms your stay at <strong style="color:${BRAND.ink};">${escapeHtml(unitName)}</strong> has been cancelled.
    </p>
    ${detailTable(detailRow("Confirmation #", escapeHtml(confirmationCode)) + outcomeSummaryRow(outcome))}
    ${calloutBox(escapeHtml(outcome.message))}
    ${outcome.branch === "full-refund" ? `<p style="font-size:13px; color:${BRAND.inkSoft};">Your refund has been issued to the original payment method. Please allow 5-10 business days for it to appear on your statement.</p>` : ""}
    ${outcome.branch === "midstay" ? `<p style="font-size:13px; color:${BRAND.inkSoft};">No further automatic charges will be made beyond the date above.</p>` : ""}
  `;
  return layout({
    preheader: `Your cancellation for ${unitName} is confirmed`,
    bodyHtml: body,
  });
}

// Dedicated template for the "30 days or fewer before check-in" branch
// specifically -- the generic cancellationGuestEmail above covers all three
// outcomes with the same shape, which left this branch under-explained
// (no specific guidance on WHY rent isn't refunded, just the bare amount).
// This version walks through what was refunded, what wasn't, and why,
// using the exact dates that applied to this booking.
function lateCancellationGuestEmail({ guestName, unitCode, checkIn, confirmationCode, outcome }) {
  const unitName = unitDisplayName(unitCode);
  const first = (guestName || "").trim().split(" ")[0];
  const policyParagraph = checkIn ? cancellationPolicyParagraph(checkIn) : "";

  const body = `
    ${kicker("Cancellation confirmed")}
    ${heading("Your cancellation is confirmed")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, this confirms your stay at <strong style="color:${BRAND.ink};">${escapeHtml(unitName)}</strong> has been cancelled. Since this was cancelled 30 days or fewer before check-in, here's exactly what was refunded and what wasn't.
    </p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(confirmationCode)) +
      detailRow("First month's rent", "Non-refundable") +
      detailRow("Cleaning fee + pet fee(s)", money(outcome.feeRefund || outcome.refundAmount) + " (refunded)")
    )}
    ${calloutBox("The first month's rent is non-refundable for cancellations made 30 days or fewer before check-in, per the policy you agreed to at booking. The cleaning fee and any pet fees are refunded in full, since the unit wasn't cleaned or occupied by your pet.", { tone: "warn" })}
    ${policyParagraph ? `
      <p style="margin:20px 0 6px; font-weight:bold; font-size:14px; color:${BRAND.ink};">For reference, the full policy for your original dates was:</p>
      <p style="margin:0; font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">${policyParagraph}</p>
    ` : ""}
    <p style="margin:20px 0 0; font-size:13px; color:${BRAND.inkSoft};">The refunded amount has been issued to your original payment method -- please allow 5-10 business days for it to appear on your statement.</p>
  `;
  return layout({
    preheader: `Your cancellation for ${unitName} is confirmed`,
    bodyHtml: body,
  });
}

function liabilityInvoiceGuestEmail({ guestName, unitCode, confirmationCode, amount, liableNights, liabilityEndDate, hostedInvoiceUrl }) {
  const unitName = unitDisplayName(unitCode);
  const body = `
    ${kicker("Invoice for remaining stay")}
    ${heading("An invoice is ready for your review")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(guestName || "there")}, per our cancellation policy, you remain liable for rent through ${escapeHtml(liabilityEndDate)} (${escapeHtml(liableNights)} nights) following your notice to end your stay at ${escapeHtml(unitName)} early.
    </p>
    ${detailTable(detailRow("Confirmation #", escapeHtml(confirmationCode)) + detailRow("Amount due", money(amount)) + detailRow("Liable through", escapeHtml(liabilityEndDate)))}
    ${hostedInvoiceUrl ? ctaButton("View & pay invoice", hostedInvoiceUrl) : ""}
    <p style="margin:18px 0 0; font-size:13px; color:${BRAND.inkSoft};">Your card on file has not been charged automatically - please pay via the secure link above.</p>
  `;
  return layout({ preheader: `An invoice for your stay at ${unitName} is ready`, bodyHtml: body });
}

// =========================================================================
// OWNER-FACING TEMPLATES (lighter weight, no hero photo, data-dense)
// =========================================================================

function ownerLayout(titleText, bodyHtml) {
  const body = `${heading(titleText)}${bodyHtml}`;
  return layout({ bodyHtml: body });
}

function contactFormEmail({ name, email, phone, message }) {
  const body = `
    ${detailTable(detailRow("Name", escapeHtml(name)) + detailRow("Email", escapeHtml(email)) + detailRow("Phone", escapeHtml(phone || "Not provided")))}
    <p style="font-weight:bold; margin:20px 0 6px; font-size:14px; color:${BRAND.ink};">Message</p>
    <p style="background:${BRAND.paper}; padding:14px; border-radius:8px; white-space:pre-wrap; font-size:14px; color:${BRAND.ink};">${escapeHtml(message)}</p>
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">Submitted via the Contact form on risefurnishedstays.com</p>
  `;
  return ownerLayout("New Contact Form Submission", body);
}

function ownerNotificationEmail({ guestName, guestEmail, guestPhone, guestCountry, guestComments, unitCode, unitName, checkIn, checkOut, nights, dueToday, fullTotal, schedule, confirmationCode }) {
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const policyParagraph = checkIn ? cancellationPolicyParagraph(checkIn) : "";
  const body = `
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(confirmationCode)) +
      detailRow("Guest", escapeHtml(guestName)) +
      detailRow("Guest email", escapeHtml(guestEmail)) +
      detailRow("Guest phone", escapeHtml(guestPhone || "Not provided")) +
      detailRow("Country", escapeHtml(guestCountry || "Not provided")) +
      detailRow("Unit", escapeHtml(displayUnitName)) +
      detailRow("Check-in", escapeHtml(checkIn)) +
      detailRow("Check-out", escapeHtml(checkOut)) +
      detailRow("Nights", escapeHtml(nights)) +
      detailRow("Paid today", money(dueToday)) +
      detailRow("Full total", money(fullTotal))
    )}
    ${guestComments ? `<p style="font-weight:bold; margin:20px 0 6px; font-size:14px;">Guest comments</p><p style="background:${BRAND.paper}; padding:14px; border-radius:8px; white-space:pre-wrap; font-size:14px;">${escapeHtml(guestComments)}</p>` : ""}
    ${schedule && schedule.length ? `<p style="margin:20px 0 6px; font-weight:bold; font-size:14px;">Scheduled installments</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${scheduleRows(schedule)}</table>` : `<p style="margin-top:14px; font-size:14px; color:${BRAND.inkSoft};">Paid in full at booking.</p>`}
    ${policyParagraph ? `<p style="margin:20px 0 6px; font-weight:bold; font-size:14px;">Cancellation policy for this booking</p><p style="font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">${policyParagraph}</p>` : ""}
  `;
  return ownerLayout("New Booking Received", body);
}

function paymentFailedOwnerEmail({ confirmationCode, unitCode, installmentDate, amount, guestEmail }) {
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">An automatic installment charge did not go through. Stripe will retry per your dunning settings, but you may want to follow up.</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(confirmationCode)) +
      detailRow("Unit", escapeHtml(unitCode)) +
      detailRow("Installment date", escapeHtml(installmentDate)) +
      detailRow("Amount", money(amount)) +
      detailRow("Guest email", escapeHtml(guestEmail))
    )}
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">Manage this in your Stripe dashboard under Invoices.</p>
  `;
  return ownerLayout("Installment Payment Failed", body);
}

function cancellationOwnerEmail({ booking, outcome, refund, voidedInvoiceIds }) {
  const unitName = unitDisplayName(booking.unitCode);
  const body = `
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow("Unit", escapeHtml(unitName)) +
      detailRow("Original check-in", escapeHtml(booking.checkIn)) +
      detailRow("Original check-out", escapeHtml(booking.checkOut)) +
      detailRow("Policy branch", escapeHtml(outcome.branch)) +
      outcomeSummaryRow(outcome) +
      detailRow("Stripe refund", refund ? escapeHtml(refund.id) : "None issued") +
      detailRow("Invoices voided", voidedInvoiceIds && voidedInvoiceIds.length ? escapeHtml(voidedInvoiceIds.join(", ")) : "None")
    )}
    ${calloutBox(escapeHtml(outcome.message))}
    ${outcome.branch === "midstay" ? `<p style="color:#b3261e; font-size:13px;">Mid-stay cancellation - use the "Charge for liability period" action on the admin page to invoice the guest for nights owed beyond what's already been charged.</p>` : ""}
  `;
  return ownerLayout("Booking Cancelled", body);
}

function liabilityInvoiceOwnerEmail({ booking, amount, invoice }) {
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">A Stripe invoice was created and emailed to the guest. They have not been auto-charged - they need to pay via the hosted invoice link.</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow("Liable nights", escapeHtml(booking.liableNights) + " (through " + escapeHtml(booking.liabilityEndDate) + ")") +
      detailRow("Amount invoiced", money(amount)) +
      detailRow("Stripe invoice", escapeHtml(invoice.id)) +
      detailRow("Due date", "7 days from today")
    )}
    <p style="margin-top:16px; font-size:14px;"><a href="${escapeHtml(invoice.hosted_invoice_url)}" style="color:${BRAND.orange}; font-weight:bold;">View/share the hosted invoice link</a></p>
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">If the guest doesn't pay within the due window, you may want to follow up directly or pursue this per your Terms of Service.</p>
  `;
  return ownerLayout("Liability Invoice Sent", body);
}

function leaseReminderEmail({ guestName, unitCode, unitName, confirmationCode, leaseUrl, signByDate }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  const deadlineText = signByDate ? fmtLong(parseKey(signByDate)) : null;

  const body = `
    ${kicker("Action needed")}
    ${heading("Please sign your lease before the deadline")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, your lease for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}) hasn't been signed yet.
    </p>
    ${calloutBox(
      deadlineText
        ? `Please sign by <strong>${deadlineText}</strong>, or your booking will be cancelled.`
        : `Please sign as soon as possible, or your booking will be cancelled.`,
      { tone: "warn" }
    )}
    ${leaseUrl ? ctaButton("Review & sign your lease", leaseUrl) : ""}
    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">
      If you've already signed, this may also be because we're still waiting on your photo ID -- please send it to <a href="mailto:risefurnishedstays@gmail.com" style="color:${BRAND.orange};">risefurnishedstays@gmail.com</a> if you haven't yet.
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Reminder: please sign your lease for ${displayUnitName}`,
    bodyHtml: body,
  });
}

function paymentFailedGuestEmail({ guestName, unitCode, unitName, confirmationCode, installmentDate, amount, updatePaymentUrl }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);

  const body = `
    ${kicker("Action needed")}
    ${heading("We couldn't process your payment")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, an automatic installment payment for your stay at <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}) didn't go through.
    </p>
    ${detailTable(detailRow("Amount due", money(amount)) + detailRow("Original due date", escapeHtml(installmentDate)))}
    ${calloutBox("Please update your payment method as soon as possible to avoid any disruption to your stay.", { tone: "warn" })}
    ${updatePaymentUrl ? ctaButton("Update payment method", updatePaymentUrl) : ""}
  `;

  return layout({
    preheader: `Action needed: payment failed for your stay at ${displayUnitName}`,
    bodyHtml: body,
  });
}

function checkoutInstructionsEmail({ guestName, unitCode, unitName, checkOut, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);

  const body = `
    ${kicker("Checkout reminder")}
    ${heading("Checkout details for your stay")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Thanks for staying with us! Just a friendly reminder that the checkout time is 11:00 AM.
    </p>
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Upon checkout, please make sure to either run the dishwasher with dirty dishes or wash and place clean dishes in the dishwasher to dry before you leave. If you used the AC or heater, please set the AC temperature to 80&deg;F or heater temperature to 65&deg;F. Finally, please make sure to lock the door by pressing the lock icon before you leave.
    </p>
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Please let us know if you have any questions and we would be happy to hear any feedback you have!
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Checkout details for your stay at ${displayUnitName}`,
    bodyHtml: body,
  });
}

module.exports = {
  contactFormEmail,
  guestConfirmationEmail,
  ownerNotificationEmail,
  paymentFailedOwnerEmail,
  paymentFailedGuestEmail,
  cancellationGuestEmail,
  lateCancellationGuestEmail,
  cancellationOwnerEmail,
  liabilityInvoiceOwnerEmail,
  liabilityInvoiceGuestEmail,
  leaseAgreementEmail,
  leaseReminderEmail,
  checkinInstructionsEmail,
  checkoutInstructionsEmail,
  unitDisplayName,
  unitCoverPhoto,
  unitPageUrl,
  unitAddress,
  unitCheckinPdfAttachment,
};
