// lib/ical.js
// Two jobs:
//   1. generateICal(bookings) -> a .ics text feed of YOUR direct bookings,
//      which Airbnb (and other channels) can IMPORT to block those dates.
//   2. parseICalBusyRanges(icsText) -> extract booked date ranges from an
//      Airbnb (or other) .ics feed so we can block them on your site.
//
// We hand-build the .ics text for generation (it's a simple, well-defined
// format) and use ical.js only for parsing inbound feeds, which can vary.

const ICAL = require("ical.js");

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// iCal all-day dates use YYYYMMDD (no time). DTEND is exclusive.
function toICalDate(dateStr) {
  // dateStr is "YYYY-MM-DD"
  return dateStr.replace(/-/g, "");
}

function nowStamp() {
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Build an iCal feed from confirmed bookings.
 * Each booking becomes a VEVENT spanning check-in (inclusive) to
 * check-out (exclusive), which is the hotel/Airbnb convention.
 */
function generateICal(bookings, calName) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RISE Furnished Stays//Direct Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calName || "RISE Furnished Stays"}`,
  ];

  bookings.forEach((b) => {
    if (!b.checkIn || !b.checkOut) return;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${b.confirmationCode}@risefurnishedstays.com`);
    lines.push(`DTSTAMP:${nowStamp()}`);
    lines.push(`DTSTART;VALUE=DATE:${toICalDate(b.checkIn)}`);
    lines.push(`DTEND;VALUE=DATE:${toICalDate(b.checkOut)}`);
    lines.push("SUMMARY:Booked (RISE direct)");
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  // iCal spec wants CRLF line endings
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parse an inbound .ics feed and return an array of busy ranges:
 *   [{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" }, ...]
 * 'to' is the exclusive check-out date, matching how Airbnb exports.
 */
function parseICalBusyRanges(icsText) {
  const ranges = [];
  try {
    const jcal = ICAL.parse(icsText);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");
    vevents.forEach((ve) => {
      const event = new ICAL.Event(ve);
      if (!event.startDate || !event.endDate) return;
      const from = icalTimeToDateStr(event.startDate);
      const to = icalTimeToDateStr(event.endDate);
      if (from && to) ranges.push({ from, to });
    });
  } catch (e) {
    console.error("Failed to parse iCal feed:", e.message);
  }
  return ranges;
}

function icalTimeToDateStr(t) {
  // t is an ICAL.Time
  try {
    return t.year + "-" + pad(t.month) + "-" + pad(t.day);
  } catch (_) {
    return null;
  }
}

module.exports = { generateICal, parseICalBusyRanges };
