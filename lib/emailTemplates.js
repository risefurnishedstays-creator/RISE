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

// Check-in/check-out times are fixed for every stay (3:00 PM / 11:00 AM --
// the same times stated in the lease itself, see lib/leaseTemplate.js),
// not configurable per booking, so they're safe to hardcode here rather
// than thread through as parameters on every template that needs them.
// Accepts a "YYYY-MM-DD" string; returns "" if not provided so callers can
// use this directly without an extra null-check at each call site.
function checkInDisplay(checkInStr) {
  return checkInStr ? `${fmtLong(parseKey(checkInStr))} at 3pm` : "";
}
function checkOutDisplay(checkOutStr) {
  return checkOutStr ? `${fmtLong(parseKey(checkOutStr))} at 11am` : "";
}
// Builds the exact-dates cancellation policy paragraph, given a check-in
// date string ("YYYY-MM-DD"). Shared across every template that needs to
// state the policy with real dates instead of relative "30 days" language.
function cancellationPolicyParagraph(checkInStr) {
  if (!checkInStr) return "";
  const { fullRefundCutoff, partialRefundCutoff } = cancellationCutoffDates(checkInStr);
  const earlyTermFee = 2550;
  return `Cancel within 5 days of booking and your first month's rent, cleaning fee, and any pet fees are refunded in full -- if your card hasn't been charged yet (it's held, not charged, until that 5-day window closes), the hold is simply released instead. ` +
    `Cancel more than 5 days after booking but by <strong>${fmtLong(fullRefundCutoff)}</strong> and the cleaning fee and any pet fees are refunded in full, with 90% of your first month's rent refunded (10% is kept). ` +
    `Cancel between ${fmtLong(addDaysSafe(fullRefundCutoff, 1))} and <strong>${fmtLong(partialRefundCutoff)}</strong> and the first month's rent is non-refundable, but the cleaning fee and any pet fees are still refunded. ` +
    `After check-in, the cleaning fee and any pet fees become non-refundable, and one of the following applies: if you cancel more than 30 days before your original check-out date, a $${earlyTermFee.toLocaleString("en-US")} early termination fee applies, reduced by a credit for any nights remaining in your current payment period that you've already paid for. If you cancel 30 days or fewer before your original check-out date and your last payment has already been made, no termination fee applies and that last payment is simply kept, not refunded. If you cancel 30 days or fewer before your original check-out date and your last payment has not yet been made, that last payment becomes due in full, with no additional termination fee.`;
}
function addDaysSafe(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Plain-text version of cancellationPolicyParagraph(), for contexts that
// can't render HTML -- specifically, BoldSign PDF form fields, which only
// accept plain text. Derived from the same function rather than duplicated,
// so the two can never drift apart in wording.
function cancellationPolicyPlainText(checkInStr) {
  return cancellationPolicyParagraph(checkInStr).replace(/<\/?strong>/g, "");
}

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

// Mirrors rise-unit-data.js's HOUSE_RULES + per-unit `rules` (pet-specific
// additions) exactly, so the check-in email and the unit page's "House
// Rules" section never say different things. rise-unit-data.js is a
// browser-side file (not requirable from Node), so this is a deliberate
// duplicate -- kept as plain text matching that file's `t` strings (minus
// the <strong> markup used there, which doesn't carry meaning in plain text).
const HOUSE_RULES_GENERAL = [
  "Do not flush anything down the toilet except toilet paper -- no flushable wipes. Guests are responsible for plumbing costs from clogs.",
  "No smoking, vaping, or drugs anywhere on the property.",
  "No parties or loud music.",
  "No unregistered pets or guests.",
  "Quiet hours are 11:00 PM - 7:00 AM.",
  "Treat the unit like your own home -- take care of the furniture, keep it clean, and don't move furniture around.",
  "After a wash cycle, leave the washing machine door open to prevent mold.",
  "Keep all doors closed to keep insects out. When entering at night, keep inside lights off and the outside light on to deter insects.",
  "Please turn off the lights when not in use.",
  "Place garbage in the brown bins, recycling in the blue bins, in front of the house. Make sure to place the garbage inside the bins. Otherwise, an \"extra trash sticker\" from the convenience store is required.",
];

// Per-unit pet-specific rules, keyed by unit code -- only Unit B is
// pet-friendly today (rise-unit-data.js: petsOk: true), but this is keyed
// generically rather than hardcoded to "B" in case that ever changes.
const HOUSE_RULES_PETS = {
  B: [
    "Do not leave your pet unattended at any time -- pets should not be left alone in the unit.",
    "Pick up after your pet and clean up any messes they make.",
  ],
};

// Returns the full house rules list for a given booking -- general rules
// always included, plus that unit's pet-specific rules ONLY when this
// particular booking actually has a pet (not just because the unit
// happens to allow pets -- a guest at the pet-friendly unit who didn't
// bring one doesn't need the pet rules cluttering their check-in email).
function houseRulesForBooking(unitCode, pets) {
  const rules = HOUSE_RULES_GENERAL.slice();
  if (pets > 0 && HOUSE_RULES_PETS[unitCode]) {
    rules.push(...HOUSE_RULES_PETS[unitCode]);
  }
  return rules;
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:22px auto;"><tr><td style="border-radius:8px; background:${BRAND.orange};">
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

// Sent the moment checkout succeeds (the card is AUTHORIZED, not yet
// charged -- see api/stripe-webhook.js's handleCheckoutCompleted). Distinct
// from guestConfirmationEmail, which is sent later once the card is
// actually captured (day 5) and correctly says "payment successful" --
// saying that here would be inaccurate, since no charge has happened yet.
function bookingReservedEmail({ guestName, unitCode, unitName, checkIn, checkOut, nights, first30, cleaning, pets, petFee, dueToday, fullTotal, schedule, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const cover = unitCoverPhoto(unitCode);
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const specsLine = unitSpecsLine(unitCode);

  // Check-in/check-out times are fixed for every stay (3:00 PM / 11:00 AM
  // -- the same times stated in the lease itself, see lib/leaseTemplate.js),
  // not configurable per booking, so they're safe to hardcode here rather
  // than thread through as parameters.
  const firstPaymentRows =
    detailRow("Check-in", checkInDisplay(checkIn)) +
    detailRow("Check-out", checkOutDisplay(checkOut)) +
    detailRow("Total nights", escapeHtml(nights)) +
    detailRow("First 30 nights", money(first30)) +
    detailRow("Cleaning fee", money(cleaning)) +
    (pets > 0 ? detailRow("Pet fee", money(petFee)) : "") +
    detailRowEmphasized("Amount held on card (not yet charged)", money(dueToday));

  // Payment Schedule restates the first payment as "due at lease signing"
  // (the same dueToday amount above, just framed in terms of the full
  // schedule rather than what's held right now), followed by every future
  // installment -- each labeled by its own real due date rather than an
  // ordinal ("2nd installment," "3rd installment") so this still reads
  // correctly no matter how many installments a long stay ends up having.
  const scheduleRowsHtml =
    detailRow("Amount due at lease signing", money(dueToday)) +
    (schedule || []).map((inst) => detailRow(fmtLong(parseKey(inst.date)), money(inst.amount))).join("") +
    detailRowEmphasized("Total amount", money(fullTotal));

  const body = `
    ${kicker("Reservation held")}
    ${heading("Your dates are reserved" + (first ? ", " + first : ""))}
    <p style="margin:0 0 6px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Thanks for booking directly with RISE Furnished Stays. Your dates for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> are reserved, and your card has been authorized for ${money(dueToday)} -- it has <strong>not been charged yet</strong>.
    </p>
    ${specsLine ? `<p style="margin:0 0 18px; font-size:13.5px; color:${BRAND.inkSoft};">${escapeHtml(specsLine)}</p>` : ""}
    ${calloutBox(`<strong>You have 5 days to cancel for free.</strong> Sign your lease within <strong>3 days</strong>, then you'll have <strong>2 more days</strong> to decide if you'd like to cancel -- your card won't be charged until that 5-day window closes. Please also upload a photo of your government-issued ID.`, { tone: "warn" })}
    <p style="margin:0 0 18px; font-size:14px; color:${BRAND.ink};"><strong>Confirmation code:</strong> ${escapeHtml(confirmationCode)}</p>
    ${detailTable(firstPaymentRows)}
    <p style="margin:22px 0 8px; font-weight:bold; font-size:14px; color:${BRAND.ink};">Payment Schedule</p>
    ${detailTable(scheduleRowsHtml)}
    <p style="color:${BRAND.inkSoft}; font-size:12.5px; margin-top:10px;">Each installment after the first is charged automatically to your card on its due date, once the first payment itself has been charged. Stripe will email you a receipt each time.</p>
    ${ctaButton("Sign your lease", `${BRAND.siteUrl}/lease.html?confirmation_code=${encodeURIComponent(confirmationCode)}`)}
    <p style="margin:24px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Once your 5-day window closes and your card is charged, we'll send you a payment confirmation. After your lease is signed and your ID is uploaded, a final confirmation follows -- no further action needed after that until your check-in details arrive about a week before arrival.
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Your dates at ${displayUnitName} are reserved - ${checkIn} to ${checkOut}`,
    bodyHtml: body,
  });
}

function guestConfirmationEmail({ guestName, unitCode, unitName, checkIn, checkOut, nights, dueToday, fullTotal, schedule, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const cover = unitCoverPhoto(unitCode);
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const pageUrl = unitPageUrl(unitCode);
  const specsLine = unitSpecsLine(unitCode);

  const body = `
    ${kicker("Payment successful")}
    ${heading("Your payment is confirmed" + (first ? ", " + first : ""))}
    <p style="margin:0 0 6px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Thanks for booking directly with RISE Furnished Stays. Your payment for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> has been charged.
    </p>
    ${specsLine ? `<p style="margin:0 0 18px; font-size:13.5px; color:${BRAND.inkSoft};">${escapeHtml(specsLine)}</p>` : ""}
    <p style="margin:0 0 18px; font-size:14px; color:${BRAND.ink};"><strong>Confirmation code:</strong> ${escapeHtml(confirmationCode)}</p>
    ${detailTable(
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut)) +
      detailRow("Total nights", escapeHtml(nights)) +
      detailRow("Paid today", money(dueToday)) +
      (schedule || []).map((inst) => detailRow(fmtLong(parseKey(inst.date)), money(inst.amount))).join("") +
      detailRowEmphasized("Total amount", money(fullTotal))
    )}
    ${schedule && schedule.length ? `<p style="color:${BRAND.inkSoft}; font-size:12.5px; margin-top:10px;">Each installment above is charged automatically to your card on file on its due date. Stripe will email you a receipt each time.</p>` : ""}
    ${ctaButton("View " + displayUnitName, pageUrl)}
    <p style="margin:24px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      We'll send your check-in details about a week before arrival.
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
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Right after signing, you'll be asked to upload a photo of your government-issued ID to finish booking.
    </p>
    ${policyParagraph ? `
      <p style="margin:24px 0 6px; font-weight:bold; font-size:14px; color:${BRAND.ink};">Cancellation policy for your stay</p>
      <p style="margin:0; font-size:13.5px; line-height:1.6; color:${BRAND.inkSoft};">${policyParagraph}</p>
    ` : ""}
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
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

function leaseSignedGuestEmail({ guestName, unitCode, unitName, checkIn, checkOut, confirmationCode, idUploadUrl, govIdUploadedAt }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  const idAlreadyUploaded = Boolean(govIdUploadedAt);

  const body = `
    ${kicker("Lease signed")}
    ${heading("Your lease is signed - here's your copy")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, thanks for signing your lease for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}). We've attached a signed PDF copy for your records.
    </p>
    ${detailTable(
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut))
    )}
    ${idAlreadyUploaded
      ? calloutBox(`<strong>You're all set here.</strong> We already have your government-issued ID on file -- no further action needed for that.`)
      : calloutBox(`<strong>One more thing to finish up, if you haven't already:</strong> please upload a photo of the front of your government-issued ID, or email it to <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.orange}; font-weight:bold;">${BRAND.supportEmail}</a>. This is required to complete your booking, and must be done before your check-in date.`, { tone: "warn" })}
    ${!idAlreadyUploaded && idUploadUrl ? ctaButton("Upload your ID", idUploadUrl) : ""}
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      ${idAlreadyUploaded
        ? "Your booking is fully confirmed - no further action needed until your check-in details arrive about a week before arrival."
        : "Once your ID is in, we'll send you a final confirmation - no further action needed after that until your check-in details arrive about a week before arrival."}
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Your signed lease for ${displayUnitName} is attached`,
    bodyHtml: body,
  });
}

// Sent exactly once, the moment all three required steps are complete
// (payment, signed lease, uploaded ID) -- whichever of those three finishes
// last is what triggers this. Tells the guest no further action is needed
// until check-in details arrive about a week out. bookingCompleteEmailSent
// on the booking record guards against sending this twice (e.g. a retried
// upload-id call after the guest already completed everything).
function bookingCompleteEmail({ guestName, unitCode, unitName, checkIn, checkOut, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);

  const body = `
    ${kicker("Booking complete")}
    ${heading("You're all set" + (first ? ", " + first : "") + "!")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Your reservation for <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}) is fully confirmed.
    </p>
    ${detailTable(
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut))
    )}
    ${calloutBox(`<strong>No further action is needed from you right now.</strong> We'll email the exact address, check-in details, wifi info, and house rules about a week before your arrival.`)}
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      We're looking forward to hosting you!
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Your stay at ${displayUnitName} is fully confirmed`,
    bodyHtml: body,
  });
}

function checkinInstructionsEmail({ guestName, unitCode, unitName, checkIn, checkOut, guests, pets, doorCode, guidebookUrl, confirmationCode }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  const address = unitAddress(unitCode);
  // doorCode is a PLACEHOLDER until the Schlage Home API integration is
  // built (see project notes) -- it generates a real per-guest temporary
  // code scoped to the stay dates. Until then this falls back to a clear
  // note rather than silently showing nothing or a fake-looking blank.
  const doorCodeDisplay = doorCode || "(will be sent separately before your arrival)";

  // House rules are derived from the booking itself (unit + whether THIS
  // guest brought a pet), not passed in manually -- see
  // houseRulesForBooking()'s comment for why pet rules only show when the
  // booking actually has pets > 0, not just because the unit allows them.
  const houseRules = houseRulesForBooking(unitCode, pets || 0);
  const rulesHtml = houseRules.length
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
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut)) +
      (address ? detailRow("Address", escapeHtml(address)) : "") +
      (guests ? detailRow("Guests", escapeHtml(guests)) : "") +
      detailRow("Pets", pets > 0 ? escapeHtml(pets) : "None") +
      detailRow("Door code", escapeHtml(doorCodeDisplay))
    )}
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      We've attached step-by-step check-in instructions with photos to help you find the right door.
    </p>
    ${rulesHtml ? `<p style="margin:22px 0 4px; font-weight:bold; font-size:14px; color:${BRAND.ink};">House rules</p>${rulesHtml}` : ""}
    ${guidebookUrl ? ctaButton("Open the Austin guidebook", guidebookUrl) : ""}
    <p style="margin:22px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
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
  if (outcome.branch === "grace-period") {
    return detailRow("Refund/release amount", money(outcome.refundAmount) + ` (rent: ${money(outcome.rentRefund)} + fees: ${money(outcome.feeRefund)})`);
  }
  if (outcome.branch === "full-refund") {
    const pct = outcome.rentRefundPercent && outcome.rentRefundPercent !== 100 ? ` (${outcome.rentRefundPercent}%)` : "";
    return detailRow("Refund amount", money(outcome.refundAmount) + ` (rent${pct}: ${money(outcome.rentRefund)} + fees: ${money(outcome.feeRefund)})`);
  }
  if (outcome.branch === "non-refundable") {
    return detailRow("Refund amount", money(outcome.refundAmount) + " (cleaning/pet fees only - rent is non-refundable)");
  }
  // midstay
  if (outcome.midstayRule === 1) {
    return detailRow("Early termination fee", money(outcome.terminationFee) + (outcome.unusedNightsCredit ? ` (after a ${money(outcome.unusedNightsCredit)} credit)` : "")) +
      (outcome.unpaidUsedNightsDue ? detailRow("Also due (unpaid period, nights used)", money(outcome.unpaidUsedNightsDue)) : "");
  }
  if (outcome.midstayRule === 2) {
    return detailRow("Early termination fee", "None - last payment kept, not refunded") +
      (outcome.unpaidUsedNightsDue ? detailRow("Also due (earlier unpaid period, nights used)", money(outcome.unpaidUsedNightsDue)) : "");
  }
  return detailRow("Final payment due", money(outcome.finalPaymentDue)) +
    (outcome.unpaidUsedNightsDue ? detailRow("Also due (earlier unpaid period, nights used)", money(outcome.unpaidUsedNightsDue)) : "");
}

function cancellationGuestEmail({ guestName, unitCode, confirmationCode, outcome }) {
  const unitName = unitDisplayName(unitCode);
  const body = `
    ${kicker("Cancellation confirmed")}
    ${heading("We are sorry to see you go!")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(guestName || "there")}, this confirms your stay at <strong style="color:${BRAND.ink};">${escapeHtml(unitName)}</strong> has been cancelled.
    </p>
    ${detailTable(detailRow("Confirmation #", escapeHtml(confirmationCode)) + outcomeSummaryRow(outcome))}
    ${calloutBox(escapeHtml(outcome.message))}
    ${outcome.branch === "grace-period" ? `<p style="font-size:13px; color:${BRAND.inkSoft};">If your card had already been charged, the refund has been issued to the original payment method (allow 5-10 business days to appear). If it hadn't been charged yet, the hold on your card has simply been released -- you won't see any charge at all.</p>` : ""}
    ${outcome.branch === "full-refund" ? `<p style="font-size:13px; color:${BRAND.inkSoft};">Your refund has been issued to the original payment method. Please allow 5-10 business days for it to appear on your statement.</p>` : ""}
    ${outcome.branch === "midstay" && outcome.midstayRule === 1 ? `<p style="font-size:13px; color:${BRAND.inkSoft};">This${outcome.unpaidUsedNightsDue ? ", along with " + money(outcome.unpaidUsedNightsDue) + " for nights already stayed in your current payment period," : ""} has been charged to your card on file.</p>` : ""}
    ${outcome.branch === "midstay" && outcome.midstayRule === 2 && outcome.unpaidUsedNightsDue ? `<p style="font-size:13px; color:${BRAND.inkSoft};">${money(outcome.unpaidUsedNightsDue)} for nights already stayed in an earlier, unpaid period has been charged to your card on file.</p>` : ""}
    ${outcome.branch === "midstay" && outcome.midstayRule === 3 ? `<p style="font-size:13px; color:${BRAND.inkSoft};">Since the final payment for your stay had not yet been collected, it has now been charged to your card on file in full${outcome.unpaidUsedNightsDue ? ", along with " + money(outcome.unpaidUsedNightsDue) + " for nights already stayed in an earlier, unpaid period" : ""}.</p>` : ""}
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
    ${heading("We are sorry to see you go!")}
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

function liabilityInvoiceGuestEmail({ guestName, unitCode, confirmationCode, amount, hostedInvoiceUrl, isTerminationFee }) {
  const unitName = unitDisplayName(unitCode);
  const body = `
    ${kicker("Invoice ready")}
    ${heading("An invoice is ready for your review")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(guestName || "there")}, per our cancellation policy, ${isTerminationFee ? "an early termination fee applies" : "your final payment is due in full"} following your notice to end your stay at ${escapeHtml(unitName)} early.
    </p>
    ${detailTable(detailRow("Confirmation #", escapeHtml(confirmationCode)) + detailRow("Amount due", money(amount)))}
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

// Sent once per booking, the first time the daily cron notices a booking is
// more than 3 days old with no signed lease -- flags it for manual review
// rather than auto-cancelling (auto-refunding is judged too risky to do
// without a human looking at it first). leaseDeadlineFlaggedAt on the
// booking record guards against re-sending this every single day after
// the deadline has already passed once.
function ownerLeaseOverdueAlertEmail({ booking, daysOverdue }) {
  const unitName = unitDisplayName(booking.unitCode);
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">This booking's 3-day lease-signing deadline has passed with no signed lease. Per policy, an unsigned lease past the deadline should be cancelled with a full refund -- this requires your manual review and action (no automatic cancellation has been taken).</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow("Unit", escapeHtml(unitName)) +
      detailRow("Check-in", checkInDisplay(booking.checkIn)) +
      detailRow("Booked on", booking.createdAt ? escapeHtml(new Date(booking.createdAt).toLocaleDateString("en-US")) : "Unknown") +
      detailRow("Days overdue", escapeHtml(daysOverdue))
    )}
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">Use the admin cancellation tool to process a full refund if you'd like to cancel this booking.</p>
  `;
  return ownerLayout("Lease Signing Deadline Passed", body);
}

// Sent alongside the guest's check-in instructions email, since the door
// code isn't generated automatically -- there's no integration with the
// front door lock app yet (see project notes re: a future Schlage Home
// API integration). Without this, only the guest would know a code is
// needed for this stay; you'd have no record of which bookings still
// need a code set before their arrival.
function ownerDoorCodeNeededEmail({ booking }) {
  const unitName = unitDisplayName(booking.unitCode);
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">The check-in instructions email just went out to this guest, but the door code is a placeholder until the lock app is integrated -- please set a real code for their stay and send it to them before they arrive.</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow("Unit", escapeHtml(unitName)) +
      detailRow("Check-in", checkInDisplay(booking.checkIn)) +
      detailRow("Check-out", checkOutDisplay(booking.checkOut))
    )}
  `;
  return ownerLayout("Door Code Needed", body);
}

// Renders the unit dropdown's raw value as the same friendly label the
// guest actually saw in the form, rather than the bare value
// ("Any" -> "Any / not sure yet") -- keeps the email consistent with
// what was on screen rather than showing internal option values.
function contactUnitLabel(unit) {
  const labels = { Any: "Any / not sure yet", "Unit A": "Unit A — Cozy Home in South Austin", "Unit B": "Unit B — Entire Home (pet-friendly)", "Unit D": "Unit D — Private Home in South Austin" };
  return labels[unit] || unit;
}

function contactPetsLabel(pets) {
  const n = parseInt(pets, 10);
  if (!n) return "No pets";
  return n + (n === 1 ? " pet" : " pets");
}

function contactGuestsLabel(guests) {
  const n = parseInt(guests, 10);
  if (!n) return guests;
  return n + (n === 1 ? " guest" : " guests");
}

// Optional inquiry-context rows (unit/guests/pets) -- only the booking
// inquiry contact form sends these; other callers of api/contact.js can
// omit them entirely, in which case this renders nothing rather than a
// row full of blanks.
function contactInquiryRows({ unit, guests, pets }) {
  if (!unit && !guests && !pets) return "";
  return (
    (unit ? detailRow("Unit inquiring about", escapeHtml(contactUnitLabel(unit))) : "") +
    (guests ? detailRow("Guests", escapeHtml(contactGuestsLabel(guests))) : "") +
    (pets !== undefined && pets !== null && pets !== "" ? detailRow("Pets", escapeHtml(contactPetsLabel(pets))) : "")
  );
}

function contactFormEmail({ name, email, phone, message, unit, guests, pets }) {
  const body = `
    ${detailTable(
      detailRow("Name", escapeHtml(name)) +
      detailRow("Email", escapeHtml(email)) +
      detailRow("Phone", escapeHtml(phone || "Not provided")) +
      contactInquiryRows({ unit, guests, pets })
    )}
    <p style="font-weight:bold; margin:20px 0 6px; font-size:14px; color:${BRAND.ink};">Message</p>
    <p style="background:${BRAND.paper}; padding:14px; border-radius:8px; white-space:pre-wrap; font-size:14px; color:${BRAND.ink};">${escapeHtml(message)}</p>
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">Submitted via the Contact form on risefurnishedstays.com</p>
  `;
  return ownerLayout("New Contact Form Submission", body);
}

// Sent to the GUEST right after they submit the Contact form, as a copy of
// what they sent -- confirms it actually went through and gives them a
// record of exactly what they wrote, formatted cleanly rather than as a
// plain-text echo. Distinct from contactFormEmail above, which is the
// owner-facing notification of the same submission.
function contactConfirmationGuestEmail({ name, email, phone, message, unit, guests, pets }) {
  const first = (name || "").trim().split(" ")[0];
  const body = `
    ${kicker("Message received")}
    ${heading("Thanks for reaching out" + (first ? ", " + first : "") + "!")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      We've received your message and will get back to you as soon as we can. Here's a copy of what you sent, for your records.
    </p>
    ${detailTable(
      detailRow("Name", escapeHtml(name)) +
      detailRow("Email", escapeHtml(email)) +
      detailRow("Phone", escapeHtml(phone || "Not provided")) +
      contactInquiryRows({ unit, guests, pets })
    )}
    <p style="font-weight:bold; margin:20px 0 6px; font-size:14px; color:${BRAND.ink};">Your message</p>
    <p style="background:${BRAND.paper}; padding:14px; border-radius:8px; white-space:pre-wrap; font-size:14px; line-height:1.5; color:${BRAND.ink}; border:2px solid ${BRAND.paperLine};">${escapeHtml(message)}</p>
    <p style="margin:22px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      If you need to add anything or didn't mean to send this, just reply directly to this email.
    </p>
  `;
  return layout({
    preheader: "We received your message and will be in touch soon",
    bodyHtml: body,
  });
}

// Sent at checkout completion (authorization, not yet captured) -- a
// lighter-weight heads-up that a reservation came in, distinct from
// ownerNotificationEmail (sent later, once the card is actually charged
// at day 5, with the full booking details).
function ownerReservationPendingEmail({ guestName, guestEmail, guestPhone, guestCountry, unitCode, unitName, checkIn, checkOut, nights, dueToday, confirmationCode, captureScheduledFor }) {
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">A new reservation came in. The guest's card is authorized (held) but has <strong>not been charged yet</strong> -- it will be captured automatically on ${escapeHtml(captureScheduledFor)}, once the 5-day free-cancellation window closes. You'll get a separate email once that charge actually goes through.</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(confirmationCode)) +
      detailRow("Guest", escapeHtml(guestName)) +
      detailRow("Guest email", escapeHtml(guestEmail)) +
      detailRow("Guest phone", escapeHtml(guestPhone || "Not provided")) +
      detailRow("Country", escapeHtml(guestCountry || "Not provided")) +
      detailRow("Unit", escapeHtml(displayUnitName)) +
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut)) +
      detailRow("Nights", escapeHtml(nights)) +
      detailRow("Held (not yet charged)", money(dueToday)) +
      detailRow("Capture scheduled for", escapeHtml(captureScheduledFor))
    )}
  `;
  return ownerLayout("New Reservation (Payment Held, Not Yet Charged)", body);
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
      detailRow("Check-in", checkInDisplay(checkIn)) +
      detailRow("Check-out", checkOutDisplay(checkOut)) +
      detailRow("Nights", escapeHtml(nights)) +
      detailRow("First payment charged", money(dueToday)) +
      detailRow("Full total", money(fullTotal))
    )}
    ${guestComments ? `<p style="font-weight:bold; margin:20px 0 6px; font-size:14px;">Guest comments</p><p style="background:${BRAND.paper}; padding:14px; border-radius:8px; white-space:pre-wrap; font-size:14px;">${escapeHtml(guestComments)}</p>` : ""}
    ${schedule && schedule.length ? `<p style="margin:20px 0 6px; font-weight:bold; font-size:14px;">Scheduled installments</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${scheduleRows(schedule)}</table>` : `<p style="margin-top:14px; font-size:14px; color:${BRAND.inkSoft};">Paid in full at booking.</p>`}
    ${policyParagraph ? `<p style="margin:20px 0 6px; font-weight:bold; font-size:14px;">Cancellation policy for this booking</p><p style="font-size:13px; line-height:1.6; color:${BRAND.inkSoft};">${policyParagraph}</p>` : ""}
  `;
  return ownerLayout("New Booking Confirmed (Payment Captured)", body);
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

function cancellationOwnerEmail({ booking, outcome, refund, voidedInvoiceIds, billedInvoice, billingError }) {
  const unitName = unitDisplayName(booking.unitCode);
  const body = `
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow("Unit", escapeHtml(unitName)) +
      detailRow("Original check-in", escapeHtml(booking.checkIn)) +
      detailRow("Original check-out", escapeHtml(booking.checkOut)) +
      detailRow("Policy branch", escapeHtml(outcome.branch) + (outcome.midstayRule ? ` (rule ${escapeHtml(outcome.midstayRule)})` : "")) +
      outcomeSummaryRow(outcome) +
      detailRow("Stripe refund", refund ? escapeHtml(refund.id) : "None issued") +
      (billedInvoice ? detailRow("Charge created", escapeHtml(billedInvoice.id)) : "") +
      detailRow("Invoices voided", voidedInvoiceIds && voidedInvoiceIds.length ? escapeHtml(voidedInvoiceIds.join(", ")) : "None")
    )}
    ${calloutBox(escapeHtml(outcome.message))}
    ${billingError ? `<p style="color:#b3261e; font-weight:bold; font-size:13px;">AUTOMATIC BILLING FAILED: ${escapeHtml(billingError)} -- use the "charge-liability" admin action to bill this manually.</p>` : ""}
    ${outcome.branch === "midstay" && !billingError && (outcome.terminationFee || outcome.finalPaymentDue) ? `<p style="color:${BRAND.inkSoft}; font-size:13px;">This amount was billed automatically to the guest's card on file.</p>` : ""}
  `;
  return ownerLayout("Booking Cancelled", body);
}

function liabilityInvoiceOwnerEmail({ booking, amount, invoice }) {
  const feeLabel = booking.midstayRule === 1 ? "Early termination fee"
    : booking.midstayRule === 3 ? "Final payment due"
    : "Rent for unpaid period";
  const body = `
    <p style="font-size:14px; color:${BRAND.inkSoft}; margin:0 0 16px;">A Stripe invoice was created and emailed to the guest. They have not been auto-charged - they need to pay via the hosted invoice link.</p>
    ${detailTable(
      detailRow("Confirmation #", escapeHtml(booking.confirmationCode)) +
      detailRow("Guest", escapeHtml(booking.guestName) + " (" + escapeHtml(booking.guestEmail) + ")") +
      detailRow(feeLabel, money(amount)) +
      detailRow("Stripe invoice", escapeHtml(invoice.id)) +
      detailRow("Due date", "7 days from today")
    )}
    <p style="margin-top:16px; font-size:14px;"><a href="${escapeHtml(invoice.hosted_invoice_url)}" style="color:${BRAND.orange}; font-weight:bold;">View/share the hosted invoice link</a></p>
    <p style="color:${BRAND.inkSoft}; font-size:12px; margin-top:20px;">If the guest doesn't pay within the due window, you may want to follow up directly or pursue this per your Terms of Service.</p>
  `;
  return ownerLayout("Invoice Sent", body);
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
    <p style="margin:18px 0 0; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      If you've already signed, this may also be because we're still waiting on your ID upload -- please upload it on the page that followed signing if you haven't yet.
    </p>
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: `Reminder: please sign your lease for ${displayUnitName}`,
    bodyHtml: body,
  });
}

// Used for three distinct triggers, all sharing the same content since the
// ask is identical each time -- only the urgency framing changes:
//   1. Immediately, when the guest clicks "Upload ID later" on id-upload.html
//   2. Weekly, via the cron job, for as long as govIdUploadedAt is null
//   3. Once, urgently, the day before check-in if it's still not uploaded
// urgent=true swaps the kicker/heading/callout to convey the tighter
// deadline without needing a whole separate template.
function idUploadReminderEmail({ guestName, unitCode, unitName, confirmationCode, idUploadUrl, checkIn, urgent }) {
  const first = (guestName || "").trim().split(" ")[0];
  const displayUnitName = unitName || unitDisplayName(unitCode);
  const cover = unitCoverPhoto(unitCode);
  const checkInText = checkIn ? fmtLong(parseKey(checkIn)) : null;

  const body = `
    ${kicker(urgent ? "Urgent - check-in is tomorrow" : "Action needed")}
    ${heading(urgent ? "Your ID is still needed before check-in" : "Please upload your ID")}
    <p style="margin:0 0 18px; font-size:15px; line-height:1.6; color:${BRAND.inkSoft};">
      Hi ${escapeHtml(first || "there")}, we still don't have a photo of your government-issued ID for your stay at <strong style="color:${BRAND.ink};">${escapeHtml(displayUnitName)}</strong> (confirmation ${escapeHtml(confirmationCode)}).
    </p>
    ${calloutBox(
      urgent
        ? `<strong>Your check-in date is tomorrow${checkInText ? " (" + checkInText + ")" : ""}.</strong> Please upload your ID right away, or email it to <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.orange}; font-weight:bold;">${BRAND.supportEmail}</a>, so we can confirm your booking before you arrive.`
        : `This is required to complete your booking. Please upload it on our site, or email it to <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.orange}; font-weight:bold;">${BRAND.supportEmail}</a>, before your check-in date${checkInText ? " (" + checkInText + ")" : ""}.`,
      { tone: urgent ? "danger" : "warn" }
    )}
    ${idUploadUrl ? ctaButton("Upload your ID", idUploadUrl) : ""}
  `;

  return layout({
    heroImageUrl: cover,
    heroAlt: displayUnitName,
    preheader: urgent ? `Urgent: your ID is still needed before tomorrow's check-in` : `Reminder: please upload your ID for ${displayUnitName}`,
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
  contactConfirmationGuestEmail,
  ownerLeaseOverdueAlertEmail,
  ownerDoorCodeNeededEmail,
  guestConfirmationEmail,
  bookingReservedEmail,
  ownerNotificationEmail,
  ownerReservationPendingEmail,
  paymentFailedOwnerEmail,
  paymentFailedGuestEmail,
  cancellationGuestEmail,
  lateCancellationGuestEmail,
  cancellationOwnerEmail,
  liabilityInvoiceOwnerEmail,
  liabilityInvoiceGuestEmail,
  leaseAgreementEmail,
  leaseSignedGuestEmail,
  bookingCompleteEmail,
  leaseReminderEmail,
  idUploadReminderEmail,
  checkinInstructionsEmail,
  checkoutInstructionsEmail,
  unitDisplayName,
  unitCoverPhoto,
  unitPageUrl,
  unitAddress,
  unitCheckinPdfAttachment,
  cancellationPolicyPlainText,
};
