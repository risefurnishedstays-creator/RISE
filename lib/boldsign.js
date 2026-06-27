// lib/boldsign.js
//
// Thin wrapper around BoldSign's "send document from template" API. This
// fills in your lease template with this booking's real data and sends it
// to the guest for signature.
//
// SETUP REQUIRED BEFORE THIS WORKS (one-time, in BoldSign's web app, not code):
//   1. Create your lease template in BoldSign's dashboard.
//      See: https://support.boldsign.com/en-US/kb/article/31/create-template
//   2. Add a form field for each value you want pre-filled (guest name,
//      check-in, check-out, rent amount, etc.) and note each field's
//      EXACT field ID -- BoldSign shows this when you click a field in
//      the template editor. These IDs go in TEMPLATE_FIELD_IDS below.
//      Include ONE large multi-line text field for the full cancellation
//      policy clause (it gets filled with a generated paragraph including
//      this booking's real cutoff dates -- not typed in by hand).
//   3. Get your API key from BoldSign -> Settings -> API.
//   4. Set these in Vercel env vars:
//        BOLDSIGN_API_KEY
//        BOLDSIGN_TEMPLATE_ID
//   5. Set up a webhook (BoldSign -> Settings -> Webhooks -> Add Webhook,
//      Account Level, event = "Completed") pointed at:
//        https://rise-eta-three.vercel.app/api/boldsign-webhook
//      Copy its signing secret into Vercel as BOLDSIGN_WEBHOOK_SECRET.
//
// Until all of the above is done, sendLeaseForSignature() will throw a
// clear configuration error rather than silently failing or sending a
// broken request.

const fetch = global.fetch; // Node 18+/Vercel runtime has fetch built in
const { cancellationPolicyPlainText } = require("./emailTemplates");

const BOLDSIGN_API_BASE = "https://api.boldsign.com";

// Map of our internal field names to BoldSign's template field IDs.
// REPLACE THESE PLACEHOLDER VALUES with the real field IDs from your
// template once you've created it -- they're visible in BoldSign's
// template editor when you click each field.
const TEMPLATE_FIELD_IDS = {
  guestName: "GuestName",       // <- replace with real field ID
  unitName: "UnitName",         // <- replace with real field ID
  unitAddress: "UnitAddress",   // <- replace with real field ID
  checkIn: "CheckInDate",       // <- replace with real field ID
  checkOut: "CheckOutDate",     // <- replace with real field ID
  monthlyRent: "MonthlyRent",   // <- replace with real field ID
  cleaningFee: "CleaningFee",   // <- replace with real field ID
  petFee: "PetFee",             // <- replace with real field ID
  confirmationCode: "ConfirmationCode", // <- replace with real field ID
  // A single multi-line text field in the lease template covering the
  // whole cancellation clause, filled in as one block of plain text with
  // this specific booking's real cutoff dates and fee amount -- not a
  // fill-in-the-blank field. Make this field large enough in the template
  // editor to fit several sentences (it runs ~500-600 characters).
  cancellationPolicy: "CancellationPolicy", // <- replace with real field ID
};

function isConfigured() {
  return Boolean(process.env.BOLDSIGN_API_KEY && process.env.BOLDSIGN_TEMPLATE_ID);
}

/**
 * Sends the lease template to a guest for signature, pre-filled with this
 * booking's real data.
 *
 * @param {Object} booking - must include guestName, guestEmail, unitCode,
 *   checkIn, checkOut, confirmationCode, and pricing fields.
 * @param {Object} pricing - { monthlyRent, cleaningFee, petFee } as display strings.
 * @param {string} unitName - the full friendly unit name (e.g. "Cozy Home in South Austin").
 * @param {string} unitAddress - the full street address for this unit.
 * @returns {Promise<{documentId: string}>}
 */
async function sendLeaseForSignature(booking, pricing, unitName, unitAddress) {
  if (!isConfigured()) {
    throw new Error(
      "BoldSign is not configured. Set BOLDSIGN_API_KEY and BOLDSIGN_TEMPLATE_ID " +
      "in Vercel env vars, and replace the placeholder field IDs in lib/boldsign.js " +
      "with the real ones from your template. See comments at the top of this file."
    );
  }

  const existingFormFields = [
    { Id: TEMPLATE_FIELD_IDS.guestName, Value: booking.guestName || "" },
    { Id: TEMPLATE_FIELD_IDS.unitName, Value: unitName || "" },
    { Id: TEMPLATE_FIELD_IDS.unitAddress, Value: unitAddress || "" },
    { Id: TEMPLATE_FIELD_IDS.checkIn, Value: booking.checkIn || "" },
    { Id: TEMPLATE_FIELD_IDS.checkOut, Value: booking.checkOut || "" },
    { Id: TEMPLATE_FIELD_IDS.monthlyRent, Value: pricing.monthlyRent || "" },
    { Id: TEMPLATE_FIELD_IDS.cleaningFee, Value: pricing.cleaningFee || "" },
    { Id: TEMPLATE_FIELD_IDS.petFee, Value: pricing.petFee || "" },
    { Id: TEMPLATE_FIELD_IDS.confirmationCode, Value: booking.confirmationCode || "" },
    // Real cutoff dates for THIS booking's check-in, not relative "30 days"
    // language -- computed fresh per lease so it's always correct even if
    // the policy's day-count or fee amount is ever changed in pricing.js.
    { Id: TEMPLATE_FIELD_IDS.cancellationPolicy, Value: cancellationPolicyPlainText(booking.checkIn) },
  ];

  const body = {
    roles: [
      {
        roleIndex: 1,
        signerName: booking.guestName || "Guest",
        signerEmail: booking.guestEmail,
        existingFormFields: existingFormFields,
      },
    ],
    // Lets us find the booking again from the webhook payload without a
    // separate lookup table -- BoldSign returns this metadata back on
    // every webhook event for this document.
    metadata: { confirmationCode: booking.confirmationCode },
  };

  const res = await fetch(
    `${BOLDSIGN_API_BASE}/v1/template/send?templateId=${encodeURIComponent(process.env.BOLDSIGN_TEMPLATE_ID)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.BOLDSIGN_API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BoldSign send failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return { documentId: data.documentId || data.DocumentId };
}

module.exports = { sendLeaseForSignature, isConfigured, TEMPLATE_FIELD_IDS };
