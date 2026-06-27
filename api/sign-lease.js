// api/sign-lease.js
//
// Receives the guest's drawn signature from lease.html, generates the
// final signed lease PDF (lease text + pet addendum if applicable +
// signature + audit trail), uploads it to Google Drive, marks the
// booking as signed, and triggers the same check-in-email-timing logic
// that the (now-removed) BoldSign integration used to trigger via webhook.
//
// POST /api/sign-lease
// body: { confirmationCode, signatureImageBase64, ipAddress (optional, we
//         also read the real one from the request itself) }

const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { priceParts, checkinEmailTiming } = require("../lib/pricing");
const { buildLeaseText, buildPetAddendumText } = require("../lib/leaseTemplate");
const { generateSignedLeasePdf } = require("../lib/leasePdf");
const { uploadSignedLease, isConfigured: driveConfigured } = require("../lib/googleDrive");
const { sendEmail } = require("../lib/sendEmail");
const { checkinInstructionsEmail, unitCheckinPdfAttachment, unitDisplayName } = require("../lib/emailTemplates");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { confirmationCode, signatureImageBase64 } = req.body || {};
  if (!confirmationCode || !signatureImageBase64) {
    return res.status(400).json({ error: "confirmationCode and signatureImageBase64 are required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("sign-lease lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  // Idempotency: don't let a double-submit (e.g. a guest double-clicking,
  // or retrying after a network hiccup) generate two signed PDFs.
  if (booking.leaseSignedAt) {
    return res.status(409).json({
      error: "This lease has already been signed.",
      leaseSignedAt: booking.leaseSignedAt,
      driveFileUrl: booking.leaseDriveFileUrl,
    });
  }

  // ---- Decode the signature image ----
  let signatureImageBytes;
  try {
    const base64Data = signatureImageBase64.replace(/^data:image\/png;base64,/, "");
    signatureImageBytes = Buffer.from(base64Data, "base64");
    if (signatureImageBytes.length === 0) throw new Error("empty image data");
  } catch (e) {
    return res.status(400).json({ error: "Invalid signatureImageBase64 -- expected a base64-encoded PNG." });
  }

  // ---- Build the real lease text for this booking ----
  const pets = typeof booking.pets === "number" ? booking.pets : 0;
  const pricing = priceParts(booking.checkIn, booking.checkOut, pets);

  const leaseText = buildLeaseText({
    guestName: booking.guestName,
    unitCode: booking.unitCode,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    fullTotal: pricing.fullTotal,
    dueToday: pricing.dueToday,
    paymentDates: pricing.paymentDates,
  });

  const petAddendumText = buildPetAddendumText({
    pets,
    petFeeTotal: pricing.petFee,
  });

  // ---- IP address for the audit trail ----
  // x-forwarded-for can contain a comma-separated chain (client, proxies);
  // the first entry is the original client.
  const forwardedFor = (req.headers["x-forwarded-for"] || "").toString();
  const ipAddress = forwardedFor.split(",")[0].trim() || req.socket?.remoteAddress || "(not recorded)";

  const signedAt = new Date().toISOString();

  // ---- Generate the signed PDF ----
  let pdfBuffer;
  try {
    pdfBuffer = await generateSignedLeasePdf({
      leaseText,
      petAddendumText,
      signatureImageBytes,
      signingInfo: {
        guestName: booking.guestName,
        confirmationCode: booking.confirmationCode,
        signedAt,
        ipAddress,
      },
    });
  } catch (e) {
    console.error("PDF generation failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not generate the signed lease PDF: " + e.message });
  }

  // ---- Upload to Google Drive ----
  let driveResult = { fileId: null, fileUrl: null };
  if (driveConfigured()) {
    try {
      const filename = `Lease - ${confirmationCode} - ${booking.guestName || "Guest"}.pdf`;
      driveResult = await uploadSignedLease(pdfBuffer, filename);
    } catch (e) {
      // Don't fail the whole signing flow over a Drive hiccup -- the
      // signature itself is still valid and recorded; just log loudly so
      // you know to retrieve/re-upload this one manually.
      console.error("CRITICAL: Google Drive upload failed for", confirmationCode, ":", e.message);
    }
  } else {
    console.error("Google Drive is not configured -- signed lease for", confirmationCode, "was generated but NOT archived. Set GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_DRIVE_LEASES_FOLDER_ID.");
  }

  // ---- Mark the booking signed, and decide check-in email timing ----
  // (Same decision mark-lease-signed / the old BoldSign webhook made --
  // duplicated here rather than calling out to booking-actions.js, since
  // this is a small, self-contained decision and not worth an internal
  // HTTP round-trip.)
  const timing = checkinEmailTiming(booking.checkIn, signedAt);
  const updates = {
    leaseSignedAt: signedAt,
    leaseDriveFileId: driveResult.fileId,
    leaseDriveFileUrl: driveResult.fileUrl,
  };

  let checkinEmailSentNow = false;
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
      checkinEmailSentNow = true;
    } catch (e) {
      console.error("Check-in email failed right after signing for", confirmationCode, e.message);
    }
  } else {
    updates.checkinEmailScheduledFor = timing.scheduledFor;
  }

  try {
    await updateBookingStatus(confirmationCode, updates);
  } catch (e) {
    console.error("CRITICAL: lease signed and PDF generated, but booking record not updated:", confirmationCode, e.message);
    return res.status(500).json({
      error: "Your signature was recorded, but we had trouble saving it. Please contact risefurnishedstays@gmail.com to confirm.",
    });
  }

  // ---- Notify the owner ----
  try {
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `Lease signed: ${confirmationCode} (${unitDisplayName(booking.unitCode)})`,
      html: `<p>${(booking.guestName || "Guest")} signed the lease for confirmation ${confirmationCode}.</p>` +
        (driveResult.fileUrl ? `<p><a href="${driveResult.fileUrl}">View signed lease in Drive</a></p>` : `<p style="color:#b3261e;">Google Drive upload failed -- check server logs and archive this lease manually.</p>`),
    });
  } catch (e) {
    console.error("Owner lease-signed notification failed (non-fatal) for", confirmationCode, e.message);
  }

  return res.status(200).json({
    confirmationCode,
    leaseSignedAt: signedAt,
    driveFileUrl: driveResult.fileUrl,
    checkinEmail: checkinEmailSentNow ? "sent" : "scheduled",
  });
};
