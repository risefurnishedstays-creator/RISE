// api/ical/[unit].js
// OUTBOUND feed. Serves a .ics calendar of YOUR confirmed direct bookings for
// one unit, so Airbnb/VRBO can IMPORT it and block those dates on their side.
//
// URL: https://<your-vercel>/api/ical/A   (or /B, /D)
// You paste THIS url into Airbnb's "Import calendar" for the matching listing.

const { listBookings } = require("../../lib/bookings");
const { generateICal } = require("../../lib/ical");

const VALID_UNITS = ["A", "B", "D"];

module.exports = async function handler(req, res) {
  try {
    // Vercel provides the dynamic segment in req.query.unit
    let unit = (req.query.unit || "").toString().toUpperCase().replace(/\.ICS$/i, "");
    if (!VALID_UNITS.includes(unit)) {
      res.status(404).send("Unknown unit");
      return;
    }

    // listBookings(unit, true) should already exclude status: "cancelled"
    // bookings entirely. For "cancelled-midstay" bookings, we still want
    // them on the calendar, but only through liabilityEndDate -- the last
    // night the guest actually paid for and is entitled to occupy -- not
    // the original checkOut, since the guest is no longer occupying (or
    // paying for) any remainder beyond that. We clamp checkOut here so
    // generateICal doesn't need to know about cancellation semantics at
    // all. liabilityEndDate is set by cancellationOutcome() in
    // lib/pricing.js for all three midstay termination-fee rules: it's the
    // end of the guest's last paid period under Rule 1, or the original
    // checkout date under Rules 2/3 (where the final period was always the
    // last one regardless of the early-termination fee outcome).
    const bookings = (await listBookings(unit, true)).map((b) => {
      if (b.status === "cancelled-midstay" && b.liabilityEndDate) {
        return { ...b, checkOut: b.liabilityEndDate };
      }
      return b;
    });
    const ics = generateICal(bookings, `RISE Furnished Stays — Unit ${unit}`);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="rise-unit-${unit}.ics"`);
    // Let channels cache briefly; they typically poll every few hours anyway
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(ics);
  } catch (error) {
    console.error("iCal export error:", error);
    res.status(500).send("Error generating calendar");
  }
};
