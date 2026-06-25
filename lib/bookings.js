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
    pets: typeof b.pets === "number" ? b.pets : 0,
    status: b.status || "confirmed",
    paymentIntentId: b.paymentIntentId || null,
    stripeCustomerId: b.stripeCustomerId || null,
    // Lease + scheduled-email tracking. leaseSignedAt is null until set
    // (manually for now, via BoldSign webhook once that's built later).
    // The two "*Sent" flags are what make the daily cron idempotent --
    // without them, a cron run that fires twice in one day (a documented
    // possibility on Vercel) would send duplicate emails to the guest.
    leaseSignedAt: b.leaseSignedAt || null,
    checkinEmailScheduledFor: b.checkinEmailScheduledFor || null,
    checkinEmailSent: b.checkinEmailSent || false,
    arrivalReminderSent: b.arrivalReminderSent || false,
    // Lease-signing reminder: tracks the last date a reminder was sent, so
    // the daily cron can send at most one per day without a separate
    // "already sent today" flag for every single day.
    leaseReminderLastSent: b.leaseReminderLastSent || null,
    checkoutEmailSent: b.checkoutEmailSent || false,
    createdAt: new Date().toISOString(),
  };
  await redis.set(bookingKey(b.unitCode, b.confirmationCode), JSON.stringify(record));
  return record;
}

/**
 * List all bookings for a unit (optionally only confirmed ones).
 */
async function listBookings(unitCode, activeOnly = true) {
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

  // "activeOnly" (the historical name was confirmedOnly) now means: exclude
  // bookings that are FULLY cancelled (status "cancelled"), but keep
  // "confirmed" AND "cancelled-midstay" -- the latter still needs to block
  // dates on the outbound iCal feed, just clamped to liabilityEndDate by the
  // caller (api/ical/[unit].js), not excluded outright.
  return activeOnly ? bookings.filter((b) => b.status !== "cancelled") : bookings;
}

/**
 * Look up a single booking across all units by confirmation code.
 * Bookings are keyed by unitCode too, so if you already know the unit,
 * calling redis.get(bookingKey(unitCode, confirmationCode)) directly is
 * cheaper. This is for callers (like the cancellation endpoint) who only
 * have the confirmation code on hand.
 */
async function getBooking(confirmationCode) {
  const pattern = `booking:*:${confirmationCode}`;
  let cursor = 0;
  let foundKey = null;
  do {
    const [next, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(next);
    if (batch.length) { foundKey = batch[0]; break; }
  } while (cursor !== 0);

  if (!foundKey) return null;
  const v = await redis.get(foundKey);
  if (!v) return null;
  return typeof v === "string" ? safeParse(v) : v;
}

/**
 * Patch arbitrary fields on a booking (status, refund info, liability
 * window, etc.) without clobbering the rest of the record. Used by
 * cancel-booking.js after the Stripe-side work succeeds.
 */
async function updateBookingStatus(confirmationCode, updates) {
  const existing = await getBooking(confirmationCode);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  await redis.set(bookingKey(existing.unitCode, confirmationCode), JSON.stringify(updated));
  return updated;
}

/**
 * Permanently delete a booking record. This is NOT the same as cancellation
 * (which keeps the record with status "cancelled" for history/refund
 * tracking) -- this removes it from Redis entirely. Intended for cleaning
 * up test-mode bookings that were never real, not for processing real
 * guest cancellations (use cancel-booking.js for that).
 */
async function deleteBooking(unitCode, confirmationCode) {
  const k = bookingKey(unitCode, confirmationCode);
  const existing = await redis.get(k);
  if (!existing) return null;
  await redis.del(k);
  return typeof existing === "string" ? safeParse(existing) : existing;
}

/**
 * List all confirmed bookings across ALL units (A, B, D). Used by the daily
 * cron job, which needs to scan every active booking regardless of unit to
 * find ones whose scheduled email date has arrived.
 */
async function listAllConfirmedBookings() {
  const units = ["A", "B", "D"];
  const all = [];
  for (const unit of units) {
    const bookings = await listBookings(unit, true); // true = exclude fully-cancelled
    all.push(...bookings);
  }
  return all;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

module.exports = { saveBooking, listBookings, listAllConfirmedBookings, getBooking, updateBookingStatus, deleteBooking };
