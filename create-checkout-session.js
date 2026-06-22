// api/create-checkout-session.js
// Creates a Stripe Checkout Session that:
//   1. Charges the "due today" amount (first 30 nights + cleaning + deposit + pet fee)
//   2. Saves the guest's card for future off-session installment charges
//      (via setup_future_usage: 'off_session')
//
// The server re-computes all prices from the booking inputs -- it never
// trusts dollar amounts sent by the browser.
//
// Frontend (checkout.html) POSTs JSON:
//   { unitCode, checkIn, checkOut, guests, pets, guestName, guestEmail }

const Stripe = require("stripe");
const { priceParts, validateBooking } = require("../lib/pricing");

const UNIT_NAMES = {
  A: "Unit A",
  B: "Unit B",
  D: "Unit D",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { unitCode, checkIn, checkOut, guests, pets, guestName, guestEmail } = req.body || {};

    if (!unitCode || !checkIn || !checkOut || !guestEmail || !guestName) {
      return res.status(400).json({ error: "Missing required booking details." });
    }

    // Server-side validation -- never trust the client
    const validationErrors = validateBooking(checkIn, checkOut, guests, pets);
    if (validationErrors.length) {
      return res.status(400).json({ error: validationErrors.join(" ") });
    }

    const petCount = parseInt(pets, 10) || 0;
    const price = priceParts(checkIn, checkOut, petCount);
    const unitName = UNIT_NAMES[unitCode] || `Unit ${unitCode}`;
    const siteUrl = process.env.SITE_URL || "https://www.risefurnishedstays.com";

    // Build line items for the "due today" charge
    const lineItems = [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `${unitName} — First 30 nights (${checkIn} to ${checkOut})` },
          unit_amount: price.first30 * 100,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Cleaning fee" },
          unit_amount: price.cleaning * 100,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Refundable security deposit" },
          unit_amount: price.deposit * 100,
        },
        quantity: 1,
      },
    ];

    if (price.petFee > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: `Pet fee (${petCount})` },
          unit_amount: price.petFee * 100,
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: guestEmail,
      line_items: lineItems,
      // THIS is the key line: save the card for future off-session charges
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      // Everything the webhook needs to set up future invoices.
      // Stripe metadata values must be strings, so we JSON-encode the schedule.
      metadata: {
        unitCode,
        unitName,
        checkIn,
        checkOut,
        guests: String(guests),
        pets: String(petCount),
        guestName,
        guestEmail,
        nights: String(price.nights),
        dueToday: String(price.dueToday),
        fullTotal: String(price.fullTotal),
        paymentSchedule: JSON.stringify(
          price.paymentDates.map((p) => ({ date: p.dateStr, amount: p.amount, nights: p.nights }))
        ),
      },
      success_url: `${siteUrl}/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/unit-${unitCode.toLowerCase()}.html?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Checkout session error:", error);
    return res.status(500).json({ error: "Unable to start checkout. Please try again." });
  }
};
