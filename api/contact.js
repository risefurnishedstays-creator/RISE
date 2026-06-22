// api/contact.js
// Handles submissions from the "Contact Us" form on the website.
// Sends the submission details to risefurnishedstays@gmail.com.
//
// Frontend should POST JSON here as: { name, email, phone, message }

const { sendEmail } = require("../lib/sendEmail");
const { contactFormEmail } = require("../lib/emailTemplates");

module.exports = async function handler(req, res) {
  // CORS: allow requests from your site
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, phone, message } = req.body || {};

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    await sendEmail({
      to: "risefurnishedstays@gmail.com",
      subject: `New Contact Form Submission from ${name}`,
      html: contactFormEmail({ name, email, phone, message }),
      replyTo: email, // lets you hit "reply" and respond straight to the guest
    });

    return res.status(200).json({ success: true, message: "Message sent successfully." });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({ error: "Something went wrong sending your message. Please try again or email us directly." });
  }
};
