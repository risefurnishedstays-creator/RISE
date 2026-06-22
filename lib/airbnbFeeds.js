// lib/airbnbFeeds.js
// Maps each unit code to its Airbnb (or other channel) iCal EXPORT URL.
//
// HOW TO FILL THIS IN:
//   In Airbnb: Listing > Pricing & availability > Availability >
//   "Sync calendars" > "Connect to another website" > copy the export URL.
//   It looks like: https://www.airbnb.com/calendar/ical/123456.ics?s=abc...
//
// You can store the real URLs as environment variables in Vercel (recommended,
// since they're secret-ish) OR paste them directly here. Env vars win if set.
//
// A unit can have multiple inbound feeds (e.g. Airbnb + VRBO) -- list them all.

function feedsFor(unitCode) {
  const envKey = `AIRBNB_ICAL_${unitCode}`; // e.g. AIRBNB_ICAL_A
  const fromEnv = process.env[envKey];
  if (fromEnv) {
    // allow comma-separated multiple feeds
    return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  }
  // Fallback: hardcoded (leave empty until you have the URLs)
  const HARDCODED = {
    A: [],
    B: [],
    D: [],
  };
  return HARDCODED[unitCode] || [];
}

module.exports = { feedsFor };
