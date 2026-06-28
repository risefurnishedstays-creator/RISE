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

// Decides when check-in instructions should go out, evaluated at the moment
// the lease is signed (the trigger event). If check-in is less than 7 days
// away at that point, there's no useful "schedule for later" -- it goes out
// immediately. Otherwise, it's scheduled for exactly 7 days before check-in,
// to be picked up by the daily cron job (api/cron/scheduled-emails.js).
function checkinEmailTiming(checkInStr, leaseSignedDate) {
  const checkIn = parseKey(checkInStr);
  const signedAt = leaseSignedDate ? new Date(leaseSignedDate) : new Date();
  signedAt.setHours(0, 0, 0, 0);
  const checkInMidnight = new Date(checkIn);
  checkInMidnight.setHours(0, 0, 0, 0);

  const daysUntilCheckIn = nightsBetween(signedAt, checkInMidnight);

  if (daysUntilCheckIn < 7) {
    return { sendNow: true, scheduledFor: null };
  }
  return { sendNow: false, scheduledFor: key(addDays(checkInMidnight, -7)) };
}

// Returns the two cancellation policy cutoff dates (as Date objects) for a
// given check-in: the last day a FULL refund still applies (31 days before
// check-in, since the policy is "more than 30 days"), and the last day a
// PARTIAL refund (cleaning/pet fees only) still applies (the day before
// check-in itself). Shared by every email template that states the policy
// with exact dates, so the math only lives in one place.
function cancellationCutoffDates(checkInStr) {
  const checkIn = parseKey(checkInStr);
  return {
    fullRefundCutoff: addDays(checkIn, -31),
    partialRefundCutoff: addDays(checkIn, -1),
  };
}

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

// Given a stay's check-in/checkout and an arbitrary date within the stay,
// finds which 30-night payment period that date falls into -- mirrors the
// exact period boundaries priceParts() uses to build paymentDates, so the
// two never disagree about where one installment ends and the next begins.
// Returns null if the date is before check-in or on/after checkout.
function findPaymentPeriod(checkInStr, checkOutStr, onDate) {
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);
  const totalNights = nightsBetween(checkIn, checkOut);
  const date = new Date(onDate);
  date.setHours(0, 0, 0, 0);

  if (date < checkIn || date >= checkOut) return null;

  let cursor = new Date(checkIn);
  let remaining = totalNights;
  let index = 0;
  while (remaining > 0) {
    const periodNights = Math.min(CONFIG.MIN_NIGHTS, remaining);
    const periodStart = new Date(cursor);
    const periodEnd = addDays(cursor, periodNights); // exclusive
    if (date >= periodStart && date < periodEnd) {
      const nightsUsed = nightsBetween(periodStart, date);
      const nightsRemaining = periodNights - nightsUsed;
      return {
        index,
        startDate: key(periodStart),
        endDate: key(periodEnd),
        nights: periodNights,
        amount: periodNights * CONFIG.NIGHTLY,
        nightsUsed,
        nightsRemaining,
        isFinalPeriod: periodEnd.getTime() === checkOut.getTime(),
      };
    }
    cursor = periodEnd;
    remaining -= periodNights;
    index++;
  }
  return null; // unreachable given the bounds check above
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
//   stay already in progress    -> see the three midstay rules below
//
// Midstay rules (guest cancels after check-in, stay already underway):
//
//   Rule 1 (not within 30 days of checkout): Guest owes a $2,550 early
//     termination fee, reduced by a credit for the unused nights already
//     paid for in their current/most-recent payment period ($85/night for
//     each night remaining in that period as of the notice date). This can
//     reduce the fee to as little as one night's rent if cancellation
//     happens right after a fresh payment.
//
//   Rule 2 (within 30 days of checkout, AND the final installment was
//     already collected): No termination fee. The final payment already
//     made is simply kept, not refunded.
//
//   Rule 3 (within 30 days of checkout, AND the final installment has NOT
//     yet been collected): That final installment becomes due in full,
//     with no termination fee added on top.
//
// Because the stay is billed in 30-night cycles, "within 30 days of
// checkout" always falls inside the stay's final payment period -- so
// Rules 2/3 are really just "is the notice date in the final period, and
// has that period's payment posted yet."
//
// pets defaults to 0 if not provided (older bookings may not have it stored).
// today/noticeDate default to "now" but accept an override for testing.
// lastPaymentPaid: caller-supplied (from Stripe invoice status) -- whether
// the installment covering the notice date's payment period has actually
// been charged. pricing.js has no Stripe access, so this can't be
// determined here; api/booking-actions.js looks it up and passes it in.
function cancellationOutcome(checkInStr, checkOutStr, noticeDate, pets, lastPaymentPaid) {
  pets = pets || 0;
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);
  const notice = noticeDate ? new Date(noticeDate) : new Date();
  notice.setHours(0, 0, 0, 0);

  const checkInMidnight = new Date(checkIn);
  checkInMidnight.setHours(0, 0, 0, 0);

  const stayInProgress = notice >= checkInMidnight;

  if (stayInProgress) {
    // Clamp the period lookup to the last valid day of the stay, in case
    // notice is given on or after checkout itself (e.g. backdated entry,
    // or processing a few days late) -- still treat it as the final period.
    const lookupDate = notice < checkOut ? notice : addDays(checkOut, -1);
    const period = findPaymentPeriod(checkInStr, checkOutStr, lookupDate);

    if (period && period.isFinalPeriod) {
      if (lastPaymentPaid) {
        // Rule 2: final payment already collected -- keep it, no fee.
        return {
          branch: "midstay",
          midstayRule: 2,
          refundAmount: 0,
          refundable: false,
          terminationFee: 0,
          finalPaymentDue: 0,
          liabilityEndDate: key(checkOut),
          cancelFutureInstallments: true,
          message: "Stay cancelled within 30 days of checkout, and the final payment has already been made: " +
            "no termination fee applies. The final payment already collected is kept and is not refunded.",
        };
      }
      // Rule 3: final installment not yet collected -- it's now due in full.
      return {
        branch: "midstay",
        midstayRule: 3,
        refundAmount: 0,
        refundable: false,
        terminationFee: 0,
        finalPaymentDue: period.amount,
        liabilityEndDate: key(checkOut),
        cancelFutureInstallments: false, // the final installment is NOT cancelled -- it's charged
        message: "Stay cancelled within 30 days of checkout, and the final payment had not yet been collected: " +
          "no termination fee applies, but the final payment of $" + period.amount.toLocaleString("en-US") + " is now due in full.",
      };
    }

    // Rule 1: general midstay cancellation, not within 30 days of checkout.
    //
    // The unused-nights credit assumes the guest's current payment period
    // was actually charged -- if it wasn't (lastPaymentPaid === false), give
    // no credit, and instead separately bill for the nights they did use in
    // that still-unpaid period (they stayed those nights, so they owe for
    // them, just not bundled into the termination fee's credit math).
    const EARLY_TERM_FEE = 2550;
    const currentPeriodPaid = lastPaymentPaid !== false; // null/undefined (e.g. period 0) treated as paid
    const unusedNightsCredit = (period && currentPeriodPaid) ? period.nightsRemaining * CONFIG.NIGHTLY : 0;
    const terminationFee = Math.max(0, EARLY_TERM_FEE - unusedNightsCredit);
    const unpaidUsedNightsDue = (period && !currentPeriodPaid) ? period.nightsUsed * CONFIG.NIGHTLY : 0;

    return {
      branch: "midstay",
      midstayRule: 1,
      refundAmount: 0,
      refundable: false,
      terminationFee,
      unusedNightsCredit,
      unusedNights: (period && currentPeriodPaid) ? period.nightsRemaining : 0,
      unpaidUsedNightsDue,
      finalPaymentDue: 0,
      liabilityEndDate: period ? period.endDate : key(notice),
      cancelFutureInstallments: true,
      message: "Stay already in progress: a $" + EARLY_TERM_FEE.toLocaleString("en-US") + " early termination fee applies" +
        (unusedNightsCredit > 0
          ? ", reduced by a $" + unusedNightsCredit.toLocaleString("en-US") + " credit for " + (period ? period.nightsRemaining : 0) + " unused night(s) already paid for, for a total of $" + terminationFee.toLocaleString("en-US") + "."
          : ".") +
        (unpaidUsedNightsDue > 0
          ? " The current payment period had not yet been charged, so $" + unpaidUsedNightsDue.toLocaleString("en-US") + " for the " + period.nightsUsed + " night(s) already used in that period is also due, in addition to the termination fee."
          : ""),
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
    cancelFutureInstallments: true, // always cancel everything not yet charged
    daysUntilCheckIn,
    message: moreThan30DaysOut
      ? "Cancelled more than 30 days before check-in: first month's rent, cleaning fee, and pet fee(s) refunded in full."
      : "Cancelled 30 days or fewer before check-in: first month's rent is non-refundable, but the cleaning fee and pet fee(s) are refunded.",
  };
}

module.exports = { CONFIG, priceParts, validateBooking, cancellationOutcome, checkinEmailTiming, cancellationCutoffDates, findPaymentPeriod, key, parseKey, addDays, nightsBetween };
