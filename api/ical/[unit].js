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

    const bookings = await listBookings(unit, true);
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
