// lib/sendEmail.js
// Shared helper for sending transactional emails via Resend.
// Used by: api/contact.js, api/stripe-webhook.js

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Sends an email via Resend's HTTP API.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email address (or array of addresses)
 * @param {string} params.subject - Email subject line
 * @param {string} params.html - HTML body of the email
 * @param {string} [params.from] - Sender address. Defaults to env FROM_EMAIL.
 * @param {string} [params.replyTo] - Optional reply-to address.
 * @param {Array}  [params.attachments] - Optional Resend attachments: [{ filename, content(base64) }].
 */
async function sendEmail({ to, subject, html, from, replyTo, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY environment variable");
  }

  const senderAddress = from || process.env.FROM_EMAIL || "RISE Furnished Stays <bookings@risefurnishedstays.com>";

  const payload = {
    from: senderAddress,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  if (attachments && attachments.length) {
    payload.attachments = attachments;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

module.exports = { sendEmail };
