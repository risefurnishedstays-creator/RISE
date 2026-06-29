// api/create-checkout-session.js
// Creates a Stripe Checkout Session that:
//   1. Charges the "due today" amount (first 30 nights + cleaning + pet fee)
//   2. Saves the guest's card for future off-session installment charges
//      (via setup_future_usage: 'off_session')
//
// The server re-computes all prices from the booking inputs -- it never
// trusts dollar amounts sent by the browser.
//
// Frontend (checkout.html) POSTs JSON:
//   { unitCode, checkIn, checkOut, guests, pets, guestName, guestEmail, guestPhone,
//     guestCountry, guestComments }

const Stripe = require("stripe");
const { priceParts, validateBooking } = require("../lib/pricing");

const UNIT_NAMES = {
  A: "Cozy Home in South Austin",
  B: "Entire Home in South Austin",
  D: "Private Home in South Austin",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { unitCode, checkIn, checkOut, guests, pets, guestName, guestEmail, guestPhone, guestCountry, guestComments } = req.body || {};

    if (!unitCode || !checkIn || !checkOut || !guestEmail || !guestName) {
      return res.status(400).json({ error: "Missing required booking details." });
    }

    // Server-side validation -- never trust the client
    const validationErrors = validateBooking(checkIn, checkOut, guests, pets, unitCode);
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
        // Hold (authorize) the first payment instead of charging it
        // immediately. The card is captured 5 days later by the daily cron
        // (api/cron/scheduled-emails.js), once the free-cancellation grace
        // window has passed -- if the guest cancels before then, the
        // authorization is simply cancelled/released and Stripe's
        // processing fee is never charged at all, since no real charge
        // ever happened. Standard card-network authorization holds are
        // valid for about 7 days for a customer-present transaction like
        // this one, comfortably covering the 5-day window with a 2-day
        // buffer for capture retries. setup_future_usage above is
        // independent of this and still saves the card normally for the
        // LATER installments, which remain on their existing
        // immediate-charge (non-held) schedule -- this hold applies ONLY
        // to this first payment.
        capture_method: "manual",
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
        guestPhone: guestPhone || "",
        guestCountry: guestCountry || "",
        guestComments: (guestComments || "").slice(0, 480),
        nights: String(price.nights),
        dueToday: String(price.dueToday),
        fullTotal: String(price.fullTotal),
        paymentSchedule: JSON.stringify(
          price.paymentDates.map((p) => ({ date: p.dateStr, amount: p.amount, nights: p.nights }))
        ),
      },
      success_url: `${siteUrl}/lease.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/unit-${unitCode.toLowerCase()}.html?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Checkout session error:", error);
    return res.status(500).json({ error: "Unable to start checkout. Please try again." });
  }
};
