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

// Cancellation policy:
//   > 30 days before check-in   -> full refund of first month's rent
//                                  PLUS cleaning fee and pet fee(s), since
//                                  the guest never arrived to use the
//                                  cleaned unit or bring their pet(s)
//   <= 30 days before check-in  -> first month's rent non-refundable
//                                  (cleaning/pet fees are also kept --
//                                  $0 refund means nothing is refunded)
//   stay already in progress    -> guest liable for next 30 nights from
//                                  notice date (cleaning/pet fees already
//                                  consumed by the stay -- not refunded)
//
// pets defaults to 0 if not provided (older bookings may not have it stored).
// today/noticeDate default to "now" but accept an override for testing.
function cancellationOutcome(checkInStr, checkOutStr, noticeDate, pets) {
  pets = pets || 0;
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);
  const notice = noticeDate ? new Date(noticeDate) : new Date();
  notice.setHours(0, 0, 0, 0);

  const checkInMidnight = new Date(checkIn);
  checkInMidnight.setHours(0, 0, 0, 0);

  const stayInProgress = notice >= checkInMidnight;

  if (stayInProgress) {
    // Liable for the next 30 nights from the date notice is given,
    // capped at the original checkout date (can't be liable past
    // a stay that was already ending sooner than +30 nights).
    const uncappedLiabilityEnd = addDays(notice, CONFIG.MIN_NIGHTS);
    const liabilityEnd = uncappedLiabilityEnd < checkOut ? uncappedLiabilityEnd : checkOut;
    const liableNights = Math.max(0, nightsBetween(notice, liabilityEnd));

    return {
      branch: "midstay",
      refundAmount: 0,
      refundable: false,
      liabilityEndDate: key(liabilityEnd),
      liableNights,
      cancelFutureInstallments: true, // cancel anything scheduled past liabilityEnd
      message: "Stay already in progress: guest remains liable for the next " +
        CONFIG.MIN_NIGHTS + " nights (or through original checkout, if sooner) from the notice date.",
    };
  }

  const daysUntilCheckIn = nightsBetween(notice, checkInMidnight);
  const moreThan30DaysOut = daysUntilCheckIn > 30;

  // Rent is only refunded outside the 30-day window. Cleaning + pet fees are
  // refunded in BOTH pre-arrival branches -- the guest never arrived to use
  // the cleaning or bring their pet(s), regardless of how close to check-in
  // they cancelled. Only an after-check-in (midstay) cancellation forfeits
  // the fees, since by then they've actually been consumed by the stay.
  const rentRefund = moreThan30DaysOut ? CONFIG.MIN_NIGHTS * CONFIG.NIGHTLY : 0;
  const feeRefund = CONFIG.CLEANING + pets * CONFIG.PET_FEE;

  return {
    // "non-refundable" is a legacy branch name from when this branch refunded
    // $0 -- now it refunds fees but withholds rent, so it's kept only as a
    // stable identifier for code that already switches on outcome.branch.
    branch: moreThan30DaysOut ? "full-refund" : "non-refundable",
    refundAmount: rentRefund + feeRefund,
    rentRefund,
    feeRefund,
    refundable: rentRefund + feeRefund > 0,
    liabilityEndDate: null,
    liableNights: 0,
    cancelFutureInstallments: true, // always cancel everything not yet charged
    daysUntilCheckIn,
    message: moreThan30DaysOut
      ? "Cancelled more than 30 days before check-in: first month's rent, cleaning fee, and pet fee(s) refunded in full."
      : "Cancelled 30 days or fewer before check-in: first month's rent is non-refundable, but the cleaning fee and pet fee(s) are refunded.",
  };
}

module.exports = { CONFIG, priceParts, validateBooking, cancellationOutcome, key, parseKey, addDays, nightsBetween };
