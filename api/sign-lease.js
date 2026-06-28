// api/sign-lease.js
//
// Three related guest-facing actions, kept in one file to avoid spending a
// second slot of Vercel's Hobby-plan 12-function limit (see api/ for the
// current count -- there's exactly one free slot, and this avoids using it):
//
//   action=sign (default, for backward compatibility with lease.html's
//   existing un-parameterized POST) -- receives the guest's drawn
//   signature, generates the final signed lease PDF (lease text + pet
//   addendum if applicable + signature + audit trail + Landlord
//   signature), uploads it to Google Drive, marks the booking as signed,
//   and triggers check-in-email-timing.
//
//   action=upload-id -- receives a photo of the guest's government-issued
//   ID (front side), uploads it to the same Google Drive "Signed Leases"
//   folder, and marks the booking's ID as received. Requires the lease to
//   already be signed. If this completes the booking (lease signed + ID
//   uploaded), sends the one-time consolidated bookingCompleteEmail.
//
//   action=defer-id -- the guest clicked "Upload ID later" on
//   id-upload.html. Records idUploadDeferredAt and immediately sends an
//   idUploadReminderEmail with a link back to the same upload page, so the
//   guest has it on hand even before the weekly cron reminder kicks in.
//
// POST /api/sign-lease                       body: { confirmationCode, signatureImageBase64, sessionId }
// POST /api/sign-lease?action=upload-id       body: { confirmationCode, idImageBase64 }
// POST /api/sign-lease?action=defer-id        body: { confirmationCode, sessionId }

const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { priceParts, checkinEmailTiming } = require("../lib/pricing");
const { buildLeaseText, buildPetAddendumText } = require("../lib/leaseTemplate");
const { generateSignedLeasePdf } = require("../lib/leasePdf");
const { uploadSignedLease, isConfigured: driveConfigured } = require("../lib/googleDrive");
const { sendEmail } = require("../lib/sendEmail");
const { checkinInstructionsEmail, unitCheckinPdfAttachment, unitDisplayName, leaseSignedGuestEmail, bookingCompleteEmail, idUploadReminderEmail } = require("../lib/emailTemplates");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.risefurnishedstays.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const action = (req.query && req.query.action || "sign").toString();
  if (action === "upload-id") return handleUploadId(req, res);
  if (action === "defer-id") return handleDeferId(req, res);
  return handleSign(req, res);
};

// =========================================================================
// action=sign (default) -- original sign-lease behavior, unchanged
// =========================================================================
async function handleSign(req, res) {
  const { confirmationCode, signatureImageBase64, sessionId } = req.body || {};
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
      //
      // googleapis errors often bury the actually-useful detail (wrong
      // folder ID, service account not shared on the folder, expired key,
      // etc.) inside error.response.data or error.errors rather than in
      // e.message, which just says something generic like "Forbidden" or
      // "Not Found" -- log the richer detail when it's there so a Drive
      // failure is actually diagnosable from Vercel logs instead of just
      // "something went wrong."
      const apiDetail = e.response && e.response.data ? JSON.stringify(e.response.data) : (e.errors ? JSON.stringify(e.errors) : null);
      console.error(
        "CRITICAL: Google Drive upload failed for", confirmationCode, ":", e.message,
        apiDetail ? "| API detail: " + apiDetail : "| (no further API detail on this error)"
      );
    }
  } else {
    console.error("Google Drive is not configured -- signed lease for", confirmationCode, "was generated but NOT archived. Set GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_DRIVE_LEASES_FOLDER_ID.");
  }

  // ---- Email the signed lease to the guest, as a PDF attachment ----
  // This does not depend on the Drive upload succeeding -- the PDF buffer
  // is already in memory either way, so the guest gets their copy even if
  // Drive archiving failed for some reason.
  const leasePdfAttachment = {
    filename: `Lease - ${confirmationCode}.pdf`,
    content: pdfBuffer.toString("base64"),
  };
  let leaseEmailSent = false;
  const siteUrl = process.env.SITE_URL || "https://www.risefurnishedstays.com";
  // Prefer session_id (works even if the guest re-lands via the original
  // checkout link), but confirmation_code always works too -- see
  // api/booking-by-session.js's header comment for why both exist.
  const idUploadUrl = sessionId
    ? `${siteUrl}/id-upload.html?session_id=${encodeURIComponent(sessionId)}`
    : `${siteUrl}/id-upload.html?confirmation_code=${encodeURIComponent(confirmationCode)}`;
  try {
    await sendEmail({
      to: booking.guestEmail,
      subject: `Your signed lease - ${unitDisplayName(booking.unitCode)} (${confirmationCode})`,
      replyTo: "risefurnishedstays@gmail.com",
      attachments: [leasePdfAttachment],
      html: leaseSignedGuestEmail({
        guestName: booking.guestName,
        unitCode: booking.unitCode,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        confirmationCode: booking.confirmationCode,
        idUploadUrl,
      }),
    });
    leaseEmailSent = true;
  } catch (e) {
    // Non-fatal: the signature itself is still valid and recorded. Log
    // loudly so a missing guest email doesn't go unnoticed the way a
    // missing Drive upload used to.
    console.error("CRITICAL: lease-signed email to guest failed for", confirmationCode, ":", e.message);
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
    const driveStatusHtml = driveResult.fileUrl
      ? `<p><a href="${driveResult.fileUrl}">View signed lease in Drive</a></p>`
      : `<p style="color:#b3261e; font-weight:bold;">GOOGLE DRIVE UPLOAD FAILED for this lease -- it is NOT archived in the Signed Leases folder. The PDF is attached to this email instead; please save it manually. Check server logs for the underlying error.</p>`;
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: driveResult.fileUrl
        ? `Lease signed: ${confirmationCode} (${unitDisplayName(booking.unitCode)})`
        : `ACTION NEEDED - Drive upload failed for signed lease ${confirmationCode}`,
      attachments: [leasePdfAttachment],
      html: `<p>${(booking.guestName || "Guest")} signed the lease for confirmation ${confirmationCode}.</p>` + driveStatusHtml,
    });
  } catch (e) {
    console.error("Owner lease-signed notification failed (non-fatal) for", confirmationCode, e.message);
  }

  return res.status(200).json({
    confirmationCode,
    leaseSignedAt: signedAt,
    driveFileUrl: driveResult.fileUrl,
    checkinEmail: checkinEmailSentNow ? "sent" : "scheduled",
    leaseEmailSent,
  });
}

// =========================================================================
// action=upload-id (POST) -- guest uploads the front of their
// government-issued ID, after the lease is signed
// =========================================================================
async function handleUploadId(req, res) {
  const { confirmationCode, idImageBase64 } = req.body || {};
  if (!confirmationCode || !idImageBase64) {
    return res.status(400).json({ error: "confirmationCode and idImageBase64 are required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("upload-id lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (!booking.leaseSignedAt) {
    return res.status(409).json({ error: "Please sign your lease before uploading your ID." });
  }

  // Idempotency: a double-submit shouldn't create two Drive uploads.
  if (booking.govIdUploadedAt) {
    return res.status(200).json({
      confirmationCode,
      govIdUploadedAt: booking.govIdUploadedAt,
      driveFileUrl: booking.govIdDriveFileUrl,
      alreadyUploaded: true,
    });
  }

  // ---- Decode the ID image ----
  // Accepts whatever image/* data URL the browser produced (JPEG from a
  // phone camera, PNG from a file picker, etc.) -- captures both the
  // mimeType and the raw bytes so the Drive upload and the file extension
  // match what the guest actually sent.
  let idImageBytes, mimeType, extension;
  try {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(idImageBase64);
    if (!match) throw new Error("expected a data:image/...;base64, URL");
    mimeType = match[1];
    idImageBytes = Buffer.from(match[2], "base64");
    if (idImageBytes.length === 0) throw new Error("empty image data");
    extension = mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1];
  } catch (e) {
    return res.status(400).json({ error: "Invalid idImageBase64 -- expected a base64-encoded image. " + e.message });
  }

  // ---- Upload to Google Drive (same folder as signed leases) ----
  let driveResult = { fileId: null, fileUrl: null };
  let driveError = null;
  if (driveConfigured()) {
    try {
      const filename = `Gov ID - ${confirmationCode} - ${booking.guestName || "Guest"}.${extension}`;
      driveResult = await uploadSignedLease(idImageBytes, filename, mimeType);
    } catch (e) {
      const apiDetail = e.response && e.response.data ? JSON.stringify(e.response.data) : (e.errors ? JSON.stringify(e.errors) : null);
      driveError = e.message;
      console.error(
        "CRITICAL: Google Drive upload failed for government ID,", confirmationCode, ":", e.message,
        apiDetail ? "| API detail: " + apiDetail : "| (no further API detail on this error)"
      );
    }
  } else {
    driveError = "Google Drive is not configured.";
    console.error("Google Drive is not configured -- government ID for", confirmationCode, "was received but NOT archived.");
  }

  const uploadedAt = new Date().toISOString();

  try {
    await updateBookingStatus(confirmationCode, {
      govIdUploadedAt: uploadedAt,
      govIdDriveFileId: driveResult.fileId,
      govIdDriveFileUrl: driveResult.fileUrl,
    });
  } catch (e) {
    console.error("CRITICAL: government ID processed but booking record not updated:", confirmationCode, e.message);
    return res.status(500).json({
      error: "Your ID was received, but we had trouble saving it. Please contact risefurnishedstays@gmail.com to confirm.",
    });
  }

  // ---- Booking is now fully complete (paid + lease signed + ID uploaded)
  // -- send the one-time consolidated confirmation, guarded by
  // bookingCompleteEmailSent so a retried call never double-sends it. ----
  let bookingCompleteEmailSentNow = false;
  if (!booking.bookingCompleteEmailSent) {
    try {
      await sendEmail({
        to: booking.guestEmail,
        subject: `You're all set - RISE Furnished Stays (${confirmationCode})`,
        replyTo: "risefurnishedstays@gmail.com",
        html: bookingCompleteEmail({
          guestName: booking.guestName,
          unitCode: booking.unitCode,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          confirmationCode: booking.confirmationCode,
        }),
      });
      bookingCompleteEmailSentNow = true;
      await updateBookingStatus(confirmationCode, { bookingCompleteEmailSent: true });
    } catch (e) {
      console.error("Booking-complete email failed (non-fatal) for", confirmationCode, e.message);
    }
  }

  // ---- Notify the owner ----
  try {
    const driveStatusHtml = driveResult.fileUrl
      ? `<p><a href="${driveResult.fileUrl}">View ID in Drive</a></p>`
      : `<p style="color:#b3261e; font-weight:bold;">GOOGLE DRIVE UPLOAD FAILED for this ID -- it is NOT archived in the Signed Leases folder. Check server logs for the underlying error.</p>`;
    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: driveResult.fileUrl
        ? `Government ID received: ${confirmationCode} (${unitDisplayName(booking.unitCode)})`
        : `ACTION NEEDED - Drive upload failed for government ID ${confirmationCode}`,
      html: `<p>${(booking.guestName || "Guest")} uploaded their government ID for confirmation ${confirmationCode}.</p>` + driveStatusHtml,
    });
  } catch (e) {
    console.error("Owner ID-uploaded notification failed (non-fatal) for", confirmationCode, e.message);
  }

  return res.status(200).json({
    confirmationCode,
    govIdUploadedAt: uploadedAt,
    driveFileUrl: driveResult.fileUrl,
    driveError,
    bookingCompleteEmailSent: bookingCompleteEmailSentNow,
  });
}

// =========================================================================
// action=defer-id (POST) -- guest clicked "Upload ID later" on
// id-upload.html. No file is uploaded here -- just records the deferral
// and sends an immediate reminder email with a link back to the same page.
// =========================================================================
async function handleDeferId(req, res) {
  const { confirmationCode, sessionId, confirmationCodeParam } = req.body || {};
  if (!confirmationCode) {
    return res.status(400).json({ error: "confirmationCode is required." });
  }

  let booking;
  try {
    booking = await getBooking(confirmationCode);
  } catch (e) {
    console.error("defer-id lookup failed for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not look up booking." });
  }
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (!booking.leaseSignedAt) {
    return res.status(409).json({ error: "Please sign your lease before deferring your ID upload." });
  }
  if (booking.govIdUploadedAt) {
    return res.status(409).json({ error: "Your ID has already been uploaded." });
  }

  try {
    await updateBookingStatus(confirmationCode, { idUploadDeferredAt: new Date().toISOString() });
  } catch (e) {
    console.error("CRITICAL: could not record ID-upload deferral for", confirmationCode, e.message);
    return res.status(500).json({ error: "Could not save your request. Please try again." });
  }

  const siteUrl = process.env.SITE_URL || "https://www.risefurnishedstays.com";
  const idUploadUrl = sessionId
    ? `${siteUrl}/id-upload.html?session_id=${encodeURIComponent(sessionId)}`
    : `${siteUrl}/id-upload.html?confirmation_code=${encodeURIComponent(confirmationCodeParam || confirmationCode)}`;

  try {
    await sendEmail({
      to: booking.guestEmail,
      subject: `Upload your ID anytime before check-in - RISE Furnished Stays`,
      replyTo: "risefurnishedstays@gmail.com",
      html: idUploadReminderEmail({
        guestName: booking.guestName,
        unitCode: booking.unitCode,
        confirmationCode: booking.confirmationCode,
        idUploadUrl,
        checkIn: booking.checkIn,
        urgent: false,
      }),
    });
  } catch (e) {
    console.error("Defer-ID reminder email failed for", confirmationCode, e.message);
    return res.status(502).json({ error: "Could not send the reminder email. Please try again, or email your ID directly to risefurnishedstays@gmail.com." });
  }

  return res.status(200).json({ confirmationCode, deferred: true });
}
