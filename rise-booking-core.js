/* ============================================================
   RISE Furnished Stays — shared booking core
   Config, date helpers, and price math shared by the unit
   availability calendar, the Checkout page, and Confirmation.
   Exposes window.RISE_CORE.
   ============================================================ */
(function () {
  var C = {
    MIN_NIGHTS: 30,
    NIGHTLY: Math.round(2550 / 30), // $85
    CLEANING: 150,
    MAX_GUESTS: 4,
    PET_FEE: 50,
    MAX_PETS: 2,
  };

  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW = ['S','M','T','W','T','F','S'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtLong(d) { return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function nightsBetween(a, b) { return Math.round((b - a) / 86400000); }
  function money(n) { return '$' + n.toLocaleString('en-US'); }

  function priceParts(checkIn, checkOut, pets) {
    pets = pets || 0;
    var n = (checkIn && checkOut) ? nightsBetween(checkIn, checkOut) : 0;
    var first30 = C.MIN_NIGHTS * C.NIGHTLY;
    var petFee = pets * C.PET_FEE;
    var dueToday = first30 + C.CLEANING + petFee;
    var monthlyRate = C.MIN_NIGHTS * C.NIGHTLY;
    var fullTotal = n * C.NIGHTLY + C.CLEANING + petFee;
    var paymentDates = [];
    if (checkIn && n > C.MIN_NIGHTS) {
      var rem = n - C.MIN_NIGHTS;
      for (var i = 1; rem > 0; i++) {
        var nights = Math.min(rem, C.MIN_NIGHTS);
        paymentDates.push({ date: addDays(checkIn, i * C.MIN_NIGHTS), amount: nights * C.NIGHTLY });
        rem -= nights;
      }
    }
    return {
      n: n, first30: first30, cleaning: C.CLEANING,
      pets: pets, petFee: petFee, dueToday: dueToday, monthlyRate: monthlyRate,
      fullTotal: fullTotal, paymentDates: paymentDates,
    };
  }

  window.RISE_CORE = {
    MIN_NIGHTS: C.MIN_NIGHTS, NIGHTLY: C.NIGHTLY, CLEANING: C.CLEANING,
    MAX_GUESTS: C.MAX_GUESTS, PET_FEE: C.PET_FEE, MAX_PETS: C.MAX_PETS,
    MONTHS: MONTHS, DOW: DOW,
    pad: pad, key: key, parseKey: parseKey, fmtLong: fmtLong,
    addDays: addDays, nightsBetween: nightsBetween, money: money,
    priceParts: priceParts,
  };
})();
