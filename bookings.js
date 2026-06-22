// lib/bookings.js
// Booking storage backed by Upstash Redis (provisioned via Vercel Marketplace).
// We keep this deliberately simple: each booking is a JSON value stored under
// a key like  booking:A:CONFIRMATIONCODE  so we can list all bookings for a
// unit with a single prefix scan. An iCal feed only ever needs "list all
// bookings for this unit", which this handles trivially.
//
// Required env vars (auto-injected by the Vercel/Upstash integration):
//   KV_REST_API_URL  (or UPSTASH_REDIS_REST_URL)
//   KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_TOKEN)

const { Redis } = require("@upstash/redis");

// Redis.fromEnv() reads either the KV_* or UPSTASH_* variable names automatically
const redis = Redis.fromEnv();

function bookingKey(unitCode, confirmationCode) {
  return `booking:${unitCode}:${confirmationCode}`;
}

/**
 * Save a confirmed booking.
 * @param {Object} b - { unitCode, confirmationCode, guestName, guestEmail,
 *                        checkIn, checkOut, nights, status }
 */
async function saveBooking(b) {
  if (!b.unitCode || !b.confirmationCode) {
    throw new Error("saveBooking requires unitCode and confirmationCode");
  }
  const record = {
    unitCode: b.unitCode,
    confirmationCode: b.confirmationCode,
    guestName: b.guestName || "",
    guestEmail: b.guestEmail || "",
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    status: b.status || "confirmed",
    createdAt: new Date().toISOString(),
  };
  await redis.set(bookingKey(b.unitCode, b.confirmationCode), JSON.stringify(record));
  return record;
}

/**
 * List all bookings for a unit (optionally only confirmed ones).
 */
async function listBookings(unitCode, confirmedOnly = true) {
  const pattern = `booking:${unitCode}:*`;
  const keys = [];
  let cursor = 0;
  // SCAN avoids blocking on large keyspaces; loop until cursor returns to 0
  do {
    const [next, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(next);
    keys.push(...batch);
  } while (cursor !== 0);

  if (!keys.length) return [];

  const values = await redis.mget(...keys);
  const bookings = values
    .map((v) => {
      if (!v) return null;
      // Upstash may return already-parsed objects or JSON strings
      return typeof v === "string" ? safeParse(v) : v;
    })
    .filter(Boolean);

  return confirmedOnly ? bookings.filter((b) => b.status === "confirmed") : bookings;
}

/**
 * Mark a booking cancelled (so it drops out of availability).
 */
async function cancelBooking(unitCode, confirmationCode) {
  const k = bookingKey(unitCode, confirmationCode);
  const v = await redis.get(k);
  if (!v) return null;
  const rec = typeof v === "string" ? safeParse(v) : v;
  if (!rec) return null;
  rec.status = "cancelled";
  await redis.set(k, JSON.stringify(rec));
  return rec;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = { saveBooking, listBookings, cancelBooking };
