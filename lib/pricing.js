// lib/pricing.js
// Server-side mirror of the client's RISE_CORE.priceParts() math.
// We re-compute price on the server so we never trust amounts sent
// from the browser (a user could tamper with them). The client sends
// only the booking inputs (unit, dates, guests, pets); the server
// decides the actual dollar amounts.

const CONFIG = {
  MIN_NIGHTS: 30,
  NIGHTLY: Math.round(2550 / 30), // $85
  CLEANING: 150,
  MAX_GUESTS: 4,
  PET_FEE: 50,
  MAX_PETS: 2,
};

function pad(n) { return n < 10 ? "0" + n : "" + n; }
function key(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseKey(s) { const p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function nightsBetween(a, b) { return Math.round((b - a) / 86400000); }

function priceParts(checkInStr, checkOutStr, pets) {
  pets = pets || 0;
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);
  const n = nightsBetween(checkIn, checkOut);

  const first30 = CONFIG.MIN_NIGHTS * CONFIG.NIGHTLY;
  const petFee = pets * CONFIG.PET_FEE;
  const dueToday = first30 + CONFIG.CLEANING + petFee;
  const fullTotal = n * CONFIG.NIGHTLY + CONFIG.CLEANING + petFee;

  const paymentDates = [];
  if (n > CONFIG.MIN_NIGHTS) {
    let rem = n - CONFIG.MIN_NIGHTS;
    for (let i = 1; rem > 0; i++) {
      const nights = Math.min(rem, CONFIG.MIN_NIGHTS);
      paymentDates.push({
        date: addDays(checkIn, i * CONFIG.MIN_NIGHTS),
        dateStr: key(addDays(checkIn, i * CONFIG.MIN_NIGHTS)),
        nights: nights,
        amount: nights * CONFIG.NIGHTLY,
      });
      rem -= nights;
    }
  }

  return {
    nights: n,
    nightly: CONFIG.NIGHTLY,
    first30,
    cleaning: CONFIG.CLEANING,
    pets,
    petFee,
    dueToday,
    fullTotal,
    paymentDates,
  };
}

// Validation: confirms the booking inputs are sane before we charge anything
function validateBooking(checkInStr, checkOutStr, guests, pets) {
  const errors = [];
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);

  if (isNaN(checkIn) || isNaN(checkOut)) errors.push("Invalid dates.");
  const n = nightsBetween(checkIn, checkOut);
  if (n < CONFIG.MIN_NIGHTS) errors.push(`Minimum stay is ${CONFIG.MIN_NIGHTS} nights.`);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (checkIn < today) errors.push("Check-in date is in the past.");

  const g = parseInt(guests, 10);
  if (isNaN(g) || g < 1 || g > CONFIG.MAX_GUESTS) errors.push(`Guests must be 1\u2013${CONFIG.MAX_GUESTS}.`);

  const p = parseInt(pets, 10) || 0;
  if (p < 0 || p > CONFIG.MAX_PETS) errors.push(`Pets must be 0\u2013${CONFIG.MAX_PETS}.`);

  return errors;
}

module.exports = { CONFIG, priceParts, validateBooking, key, parseKey, addDays, nightsBetween };
