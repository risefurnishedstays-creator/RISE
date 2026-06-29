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
//   Rule 1 (notice given MORE than 30 days before the original checkout
//     date): Guest owes a $2,550 early termination fee, reduced by a
//     credit for the unused nights already paid for in their
//     current/most-recent payment period ($85/night for each night
//     remaining in that period as of the notice date). This can reduce
//     the fee to as little as one night's rent if cancellation happens
//     right after a fresh payment.
//
//   Rule 2 (notice given 30 days or fewer before the original checkout
//     date, AND the TRUE final installment -- the one covering the last
//     night of the stay -- was already collected): No termination fee.
//     The final payment already made is simply kept, not refunded.
//
//   Rule 3 (notice given 30 days or fewer before the original checkout
//     date, AND the true final installment has NOT yet been collected):
//     That final installment becomes due in full, with no termination fee
//     added on top.
//
// IMPORTANT: "within 30 days of checkout" is a real date comparison
// against the ORIGINAL CHECKOUT DATE, not "is notice in the final payment
// period." Those two conditions only coincide when every payment period
// is a full 30 nights. Whenever the stay's last period is SHORTER than 30
// nights (e.g. a 65-night stay = 30 + 30 + 5), the 30-day-before-checkout
// window starts partway through the second-to-last period -- so notice
// can be within 30 days of checkout while still landing in a period that
// isn't technically "final." Rules 2/3 must still apply in that case, and
// the installment they check/bill is always the TRUE final one (whichever
// period's endDate equals checkout), found via finalPeriodLookup below --
// never just whatever period the notice date happens to fall in.
//
// If notice falls in an EARLIER period than the true final one (only
// possible in that same short-final-period scenario) and that earlier
// period hasn't been paid yet, the guest still owes for the nights they
// used in it -- billed the same way Rule 1 bills unpaidUsedNightsDue for
// its own current period, just attached to the Rule 2/3 outcome instead.
//
// pets defaults to 0 if not provided (older bookings may not have it stored).
// today/noticeDate default to "now" but accept an override for testing.
// lastPaymentPaid: whether the installment covering the NOTICE date's own
//   payment period has been charged (used by Rule 1's credit calc, and by
//   the earlier-period gap billing under Rules 2/3).
// finalPeriodPaid: whether the installment covering the TRUE final period
//   (the one ending at checkout) has been charged (used by Rule 2 vs 3).
//   Only consulted when notice is within 30 days of checkout; pass
//   anything for it otherwise. pricing.js has no Stripe access, so both
//   of these are caller-supplied -- api/booking-actions.js looks them up.
// bookingCreatedAt: the booking's createdAt timestamp (ISO string or Date),
//   used ONLY by the pre-arrival branch to determine whether notice falls
//   within the 5-day (120-hour) free-cancellation grace window. Not
//   consulted at all once the stay is in progress (midstay rules don't
//   care when the booking was originally made). If omitted, treated as
//   outside the grace window -- the safer default, since a missing
//   timestamp shouldn't accidentally grant a free cancellation.
function cancellationOutcome(checkInStr, checkOutStr, noticeDate, pets, lastPaymentPaid, finalPeriodPaid, bookingCreatedAt) {
  pets = pets || 0;
  const checkIn = parseKey(checkInStr);
  const checkOut = parseKey(checkOutStr);
  const notice = noticeDate ? new Date(noticeDate) : new Date();
  // Captured BEFORE notice is truncated to midnight below -- the grace
  // window needs precise clock time (exactly 120 hours from booking),
  // while every other comparison in this function is intentionally
  // day-granularity (calendar-date cutoffs, not exact timestamps).
  const preciseNoticeTime = notice.getTime();
  notice.setHours(0, 0, 0, 0);

  const checkInMidnight = new Date(checkIn);
  checkInMidnight.setHours(0, 0, 0, 0);

  const stayInProgress = notice >= checkInMidnight;

  if (stayInProgress) {
    // Clamp the period lookup to the last valid day of the stay, in case
    // notice is given on or after checkout itself (e.g. backdated entry,
    // or processing a few days late).
    const lookupDate = notice < checkOut ? notice : addDays(checkOut, -1);
    const period = findPaymentPeriod(checkInStr, checkOutStr, lookupDate);

    // Real date comparison against checkout -- NOT period membership.
    const daysToCheckout = nightsBetween(notice, checkOut);
    const withinFinalWindow = daysToCheckout <= 30;

    if (withinFinalWindow) {
      // Always evaluate the TRUE final period (the one ending at
      // checkout), which may differ from `period` above when the last
      // period is shorter than 30 nights.
      const finalLookupDate = addDays(checkOut, -1);
      const finalPeriod = findPaymentPeriod(checkInStr, checkOutStr, finalLookupDate) || period;

      // If notice landed in an earlier period than the true final one,
      // bill for any already-used-but-unpaid nights in THAT earlier
      // period -- same mechanic as Rule 1's unpaidUsedNightsDue, just
      // computed here since Rule 1 doesn't run in this branch.
      const noticeInEarlierPeriod = period && finalPeriod && period.index < finalPeriod.index;
      const earlierPeriodUnpaidDue = (noticeInEarlierPeriod && lastPaymentPaid === false)
        ? period.nightsUsed * CONFIG.NIGHTLY
        : 0;

      if (finalPeriodPaid) {
        // Rule 2: final payment already collected -- keep it, no fee.
        return {
          branch: "midstay",
          midstayRule: 2,
          refundAmount: 0,
          refundable: false,
          terminationFee: 0,
          finalPaymentDue: 0,
          unpaidUsedNightsDue: earlierPeriodUnpaidDue,
          liabilityEndDate: key(checkOut),
          cancelFutureInstallments: true,
          message: "Stay cancelled within 30 days of checkout, and the final payment has already been made: " +
            "no termination fee applies. The final payment already collected is kept and is not refunded." +
            (earlierPeriodUnpaidDue > 0
              ? " An earlier payment period had not yet been charged, so $" + earlierPeriodUnpaidDue.toLocaleString("en-US") + " for the " + period.nightsUsed + " night(s) already used in that period is also due."
              : ""),
        };
      }
      // Rule 3: final installment not yet collected -- it's now due in full.
      return {
        branch: "midstay",
        midstayRule: 3,
        refundAmount: 0,
        refundable: false,
        terminationFee: 0,
        finalPaymentDue: finalPeriod.amount,
        unpaidUsedNightsDue: earlierPeriodUnpaidDue,
        liabilityEndDate: key(checkOut),
        cancelFutureInstallments: false, // the final installment is NOT cancelled -- it's charged
        message: "Stay cancelled within 30 days of checkout, and the final payment had not yet been collected: " +
          "no termination fee applies, but the final payment of $" + finalPeriod.amount.toLocaleString("en-US") + " is now due in full." +
          (earlierPeriodUnpaidDue > 0
            ? " An earlier payment period had also not yet been charged, so $" + earlierPeriodUnpaidDue.toLocaleString("en-US") + " for the " + period.nightsUsed + " night(s) already used in that period is due as well."
            : ""),
      };
    }

    // Rule 1: general midstay cancellation, more than 30 days before checkout.
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

  // ---- Pre-arrival cancellation: three tiers, in priority order ----
  //
  // Tier 1 (full refund): cancelled within FREE_CANCEL_WINDOW_HOURS of
  // booking (5 days = 120 hours: a 72-hour lease-signing window plus a
  // further 48-hour decide-to-cancel window, treated as one continuous
  // grace period from the guest's perspective) AND still more than 30
  // days before check-in. In practice the card is held but not captured
  // until day 5 (see api/cron/scheduled-emails.js), so most Tier-1
  // cancellations never generate a real charge to refund at all -- the
  // authorization is simply released. Everything is refunded/released:
  // rent, cleaning fee, and pet fee(s).
  //
  // Tier 2 (90% rent refund): cancelled AFTER the 5-day grace window, but
  // still more than 30 days before check-in. Cleaning and pet fee(s) are
  // refunded in full; 10% of first month's rent is kept, 90% refunded.
  //
  // Tier 3 (unchanged from before this policy existed): 30 days or fewer
  // before check-in. First month's rent is non-refundable; cleaning and
  // pet fee(s) are refunded in full.
  //
  // Tier 3 always takes priority over Tiers 1/2 when they'd overlap (e.g.
  // a last-minute booking made only a few days before check-in) -- the
  // grace period never overrides the inside-30-days rule; see this
  // function's bookingCreatedAt parameter doc above.
  const daysUntilCheckIn = nightsBetween(notice, checkInMidnight);
  const moreThan30DaysOut = daysUntilCheckIn > 30;

  const FREE_CANCEL_WINDOW_HOURS = 120; // 5 days: 72h to sign + 48h to decide
  const bookingCreated = bookingCreatedAt ? new Date(bookingCreatedAt) : null;
  const hoursSinceBooking = bookingCreated ? (preciseNoticeTime - bookingCreated.getTime()) / 3600000 : Infinity;
  // Use the actual clock-time difference (not a midnight-truncated one) --
  // unlike the day-granularity check-in cutoffs elsewhere in this
  // function, the 5-day grace period is a precise 120-hour window from
  // the moment of booking, since capture itself happens at exactly that
  // boundary (see the cron job). bookingCreated may be in the future
  // relative to `notice` if no createdAt was supplied (Infinity hours
  // ago) -- treated as outside the grace window, the safer default.
  const withinGraceWindow = hoursSinceBooking >= 0 && hoursSinceBooking < FREE_CANCEL_WINDOW_HOURS;

  // Rent refund tier, fees are refunded in full across ALL pre-arrival
  // branches -- the guest never arrived to use the cleaning or bring
  // their pet(s), regardless of how close to check-in or how long after
  // booking they cancelled. Only an after-check-in (midstay) cancellation
  // forfeits the fees, since by then they've actually been consumed.
  const feeRefund = CONFIG.CLEANING + pets * CONFIG.PET_FEE;
  const fullRent = CONFIG.MIN_NIGHTS * CONFIG.NIGHTLY;

  let tier, rentRefund, rentRefundPercent;
  if (!moreThan30DaysOut) {
    tier = 3;
    rentRefund = 0;
    rentRefundPercent = 0;
  } else if (withinGraceWindow) {
    tier = 1;
    rentRefund = fullRent;
    rentRefundPercent = 100;
  } else {
    tier = 2;
    rentRefund = Math.round(fullRent * 0.9);
    rentRefundPercent = 90;
  }

  const messages = {
    1: "Cancelled within 5 days of booking: first month's rent, cleaning fee, and pet fee(s) refunded in full.",
    2: "Cancelled more than 5 days after booking but more than 30 days before check-in: the cleaning fee and pet fee(s) are refunded in full, and 90% of the first month's rent is refunded (10% is kept).",
    3: "Cancelled 30 days or fewer before check-in: first month's rent is non-refundable, but the cleaning fee and pet fee(s) are refunded.",
  };

  return {
    // "full-refund" / "non-refundable" are legacy branch names kept as
    // stable identifiers for code that already switches on outcome.branch
    // (e.g. cancellationGuestEmail's template selection). "grace-period"
    // is new, for Tier 1 specifically, since its message and "this might
    // just be a release, not a refund" framing differ enough from
    // "full-refund" (Tier 2, which is always a REAL refund of a captured
    // payment) to need its own branch name downstream.
    branch: tier === 1 ? "grace-period" : tier === 2 ? "full-refund" : "non-refundable",
    cancellationTier: tier,
    refundAmount: rentRefund + feeRefund,
    rentRefund,
    rentRefundPercent,
    feeRefund,
    refundable: rentRefund + feeRefund > 0,
    liabilityEndDate: null,
    cancelFutureInstallments: true, // always cancel everything not yet charged
    daysUntilCheckIn,
    hoursSinceBooking: Number.isFinite(hoursSinceBooking) ? Math.round(hoursSinceBooking) : null,
    message: messages[tier],
  };
}

module.exports = { CONFIG, priceParts, validateBooking, cancellationOutcome, checkinEmailTiming, cancellationCutoffDates, findPaymentPeriod, key, parseKey, addDays, nightsBetween };
