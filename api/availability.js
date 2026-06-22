// api/availability.js
// INBOUND availability. Returns the blocked date ranges for a unit by merging:
//   1. Your confirmed DIRECT bookings (from Redis)
//   2. Bookings pulled from Airbnb/VRBO iCal feeds for that unit
//
// Your unit pages call this to grey out unavailable dates, instead of relying
// on hardcoded U.booked arrays.
//
// URL: https://<your-vercel>/api/availability?unit=A
// Response: { unit: "A", booked: [{ from: "2026-08-01", to: "2026-08-31" }, ...] }

const { listBookings } = require("../lib/bookings");
const { parseICalBusyRanges } = require("../lib/ical");
const { feedsFor } = require("../lib/airbnbFeeds");

const VALID_UNITS = ["A", "B", "D"];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const unit = (req.query.unit || "").toString().toUpperCase();
    if (!VALID_UNITS.includes(unit)) {
      return res.status(400).json({ error: "Invalid or missing unit." });
    }

    const ranges = [];

    // 1. Direct bookings from Redis
    try {
      const direct = await listBookings(unit, true);
      direct.forEach((b) => {
        if (b.checkIn && b.checkOut) ranges.push({ from: b.checkIn, to: b.checkOut });
      });
    } catch (e) {
      console.error("Error reading direct bookings:", e.message);
      // continue -- we still want to return channel feeds even if Redis hiccups
    }

    // 2. Channel feeds (Airbnb/VRBO). Fetch all in parallel; tolerate failures.
    const feeds = feedsFor(unit);
    if (feeds.length) {
      const results = await Promise.allSettled(
        feeds.map((url) =>
          fetch(url, { headers: { "User-Agent": "RISE-Furnished-Stays/1.0" } }).then((r) => {
            if (!r.ok) throw new Error(`Feed responded ${r.status}`);
            return r.text();
          })
        )
      );
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          parseICalBusyRanges(result.value).forEach((rng) => ranges.push(rng));
        } else {
          console.error("Feed fetch failed:", result.reason && result.reason.message);
        }
      });
    }

    // De-duplicate identical ranges
    const seen = new Set();
    const merged = ranges.filter((r) => {
      const k = r.from + "_" + r.to;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Short cache so the calendar is fresh but we don't hammer Airbnb on every load
    res.setHeader("Cache-Control", "public, max-age=900"); // 15 min
    return res.status(200).json({ unit, booked: merged });
  } catch (error) {
    console.error("Availability error:", error);
    return res.status(500).json({ error: "Could not load availability." });
  }
};
