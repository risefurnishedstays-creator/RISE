// api/boldsign-webhook.js
//
// Receives BoldSign's "Completed" event (all parties have signed) and
// triggers the same lease-signed logic that mark-lease-signed previously
// required you to call by hand: decide whether to send check-in
// instructions now or schedule them for 7 days before check-in.
//
// SETUP REQUIRED (in BoldSign's web app):
//   Settings -> Webhooks -> Add Webhook
//   Level: Account
//   URL: https://rise-eta-three.vercel.app/api/boldsign-webhook
//   Events: Completed (this is the only one this endpoint needs)
//   After verifying, BoldSign shows a signing secret -- copy it into
//   Vercel as BOLDSIGN_WEBHOOK_SECRET.
//
// Signature verification: BoldSign signs every webhook payload with
// HMAC-SHA256 in the X-BoldSign-Signature header, formatted as
// "t=<timestamp>, s0=<signature>[, s1=<signature-from-old-secret>]".
// The signed message is "<timestamp>.<raw body>". We verify this
// ourselves rather than trusting any unsigned payload, since this
// endpoint is public and could otherwise be called by anyone.

const crypto = require("crypto");
const { getBooking, updateBookingStatus } = require("../lib/bookings");
const { checkinEmailTiming } = require("../lib/pricing");
const { sendEmail } = require("../lib/sendEmail");
const { checkinInstructionsEmail, unitCheckinPdfAttachment } = require("../lib/emailTemplates");

module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  // Header format: "t=1668693823, s0=abc123..." (and optionally s1=... during secret rotation)
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.trim().split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  if (!timestamp) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  // Check against s0 (current secret) and s1 (old secret, valid briefly
  // during a secret rotation) -- accept if either matches.
  const candidates = Object.keys(parts).filter((k) => k.startsWith("s")).map((k) => parts[k]);
  return candidates.some((sig) => {
    // Timing-safe comparison; lengths must match or timingSafeEqual throws.
    if (!sig || sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const rawBody = await getRawBody(req);

  // BoldSign's initial webhook setup sends a Verification event before
  // you can save the webhook -- this has no signature to check yet and
  // must simply be acknowledged with 200.
  if (req.headers["x-boldsign-event"] === "Verification" || req.headers["X-BoldSign-Event"] === "Verification") {
    return res.status(200).json({ received: true });
  }

  const signatureHeader = req.headers["x-boldsign-signature"];
  const secret = process.env.BOLDSIGN_WEBHOOK_SECRET;
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    console.error("BoldSign webhook signature verification failed.");
    return res.status(401).send("Invalid signature.");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error("BoldSign webhook: could not parse body as JSON.");
    return res.status(400).send("Invalid JSON.");
  }

  const eventType = payload.event && payload.event.eventType;

  // Only the Completed event matters here -- all other subscribed events
  // (if any get added later) are acknowledged but ignored.
  if (eventType !== "Completed") {
    return res.status(200).json({ received: true, ignored: eventType });
  }

  try {
    await handleLeaseCompleted(payload);
  } catch (e) {
    // Log but still return 200 -- BoldSign retries on non-2xx, and we
    // don't want duplicate processing attempts piling up for an error
    // that a retry won't fix (e.g. a missing booking record).
    console.error("Error handling BoldSign Completed event:", e.message);
  }

  return res.status(200).json({ received: true });
};

async function handleLeaseCompleted(payload) {
  // metadata.confirmationCode was set when we originally sent the
  // document via sendLeaseForSignature() in lib/boldsign.js.
  const confirmationCode =
    payload.data && payload.data.metadata && payload.data.metadata.confirmationCode;

  if (!confirmationCode) {
    console.error("BoldSign Completed webhook had no confirmationCode in metadata -- cannot match to a booking.");
    return;
  }

  const booking = await getBooking(confirmationCode);
  if (!booking) {
    console.error("BoldSign Completed webhook: no booking found for", confirmationCode);
    return;
  }

  if (booking.leaseSignedAt) {
    // Already processed (BoldSign can resend events) -- idempotency guard.
    return;
  }

  const now = new Date().toISOString();
  const timing = checkinEmailTiming(booking.checkIn, now);
  const updates = { leaseSignedAt: now };

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
    } catch (e) {
      console.error("Check-in email failed after lease completed for", confirmationCode, e.message);
    }
  } else {
    updates.checkinEmailScheduledFor = timing.scheduledFor;
  }

  await updateBookingStatus(confirmationCode, updates);
}
