/* ============================================================
   RISE Furnished Stays — availability + booking start
   Shared by Unit A / B / D detail pages.
   Reads window.RISE_UNIT (set inline on each page) and
   window.RISE_CORE (rise-booking-core.js).
   - Interactive availability calendar (select check-in / out)
   - 30-night minimum, blocks booked & past dates
   - Booking summary card → navigates to the Checkout page
   ============================================================ */
(function () {
  var U = window.RISE_UNIT;
  var CORE = window.RISE_CORE;
  if (!U || !CORE) return;

  /* ---------- config + helpers (from core) ---------- */
  var MIN_NIGHTS = CORE.MIN_NIGHTS, NIGHTLY = CORE.NIGHTLY, PET_FEE = CORE.PET_FEE;
  var MAX_GUESTS = CORE.MAX_GUESTS, MAX_PETS = CORE.MAX_PETS;
  var MONTHS = CORE.MONTHS, DOW = CORE.DOW;
  var key = CORE.key, parseKey = CORE.parseKey, fmtLong = CORE.fmtLong;
  var addDays = CORE.addDays, nightsBetween = CORE.nightsBetween, money = CORE.money;

  var bookedRanges = (U.booked || []).map(function (b) {
    return { from: new Date(b.from + 'T00:00:00'), to: new Date(b.to + 'T00:00:00') };
  });
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function isBooked(d){ return bookedRanges.some(function (b){ return d >= b.from && d <= b.to; }); }
  function isPast(d){ return d < today; }
  function isAvail(d){ return !isBooked(d) && !isPast(d); }
  function rangeClear(a, b){
    for (var d = new Date(a); d < b; d = addDays(d, 1)) { if (isBooked(d)) return false; }
    return true;
  }
  var firstOpen = new Date(today);
  for (var g = 0; g < 800 && !isAvail(firstOpen); g++) firstOpen = addDays(firstOpen, 1);

  /* ---------- styles ---------- */
  var css = `
  .cal-day.sel { cursor: pointer; transition: background .1s, color .1s, border-color .1s; }
  .cal-day.sel:hover { border-color: var(--accent); background: var(--accent-soft); }
  .cal-day.in-range { background: var(--accent-soft); border-color: color-mix(in oklab, var(--accent) 30%, transparent); border-radius: 0; }
  .cal-day.sel-start, .cal-day.sel-end { background: var(--accent); color: #fff; border-color: var(--line); font-weight: 700; }
  .cal-day.preview-range { background: var(--accent-soft); border-color: color-mix(in oklab, var(--accent) 30%, transparent); border-radius: 0; }
  .cal-day.preview-end { background: var(--accent); color: #fff; border-color: var(--line); font-weight: 700; }
  .cal-hint { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-soft); margin-top: 12px; line-height: 1.5; }

  /* compact availability layout */
  .cal-wrap { grid-template-columns: 1fr 312px; gap: 26px; max-width: 800px; margin-inline: auto; }
  .cal { padding: 18px 20px 20px; }
  .cal-top { margin-bottom: 12px; }
  .cal-month { font-size: 20px; }
  .cal-grid { gap: 4px; }
  .cal-day { font-size: 13px; border-radius: 7px; }
  .cal-legend { margin-top: 12px; font-size: 12px; }

  .cal-side { display: flex; flex-direction: column; gap: 22px; }

  .book-stay { padding: 22px 22px 22px; box-shadow: 5px 6px 0 var(--ink); }
  .book-stay .bs-head { font-family: var(--font-head); font-size: 20px; margin-bottom: 16px; }
  .book-stay .bs-rate { font-size: 13px; color: var(--ink-soft); margin-bottom: 16px; }
  .book-stay .bs-rate .stars { color: var(--accent); }
  .bs-dates { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; border: 2.5px solid var(--line); border-radius: 10px; padding: 11px 13px; margin-bottom: 14px; }
  .bs-date { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .bs-date .bsl { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .bs-date .bsv { font-size: 14.5px; font-weight: 600; white-space: nowrap; }
  .bs-date .bsv.ph { color: color-mix(in oklab, var(--ink-soft) 75%, transparent); font-weight: 400; }
  .bs-arrow { color: var(--accent); font-size: 16px; }
  .bs-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
  .bs-field label { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
  .bs-field select { font-family: var(--font-body); font-size: 15px; color: var(--ink); border: 2.5px solid var(--line); border-radius: 8px; background: var(--paper); padding: 7px 10px; cursor: pointer; }
  .bs-field select:focus { outline: none; border-color: var(--accent); }
  .bs-rows { display: none; flex-direction: column; gap: 9px; padding: 14px 0; margin-bottom: 4px; border-top: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); border-bottom: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); }
  .bs-rows.show { display: flex; }
  .bs-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 14.5px; }
  .bs-row .bk { color: var(--ink-soft); }
  .bs-row .bk small { display: block; font-size: 11px; }
  .bs-row.total { font-weight: 700; font-size: 16px; padding-top: 9px; border-top: 2px solid color-mix(in oklab, var(--ink) 14%, transparent); }
  .bs-msg { font-size: 13px; line-height: 1.45; margin: 14px 0 14px; display: none; }
  .bs-msg.show { display: block; }
  .bs-msg.warn { color: var(--red); }
  .bs-msg.hint { color: var(--ink-soft); }
  .book-stay .bnote { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-soft); text-align: center; margin-top: 12px; }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- calendar element refs ---------- */
  var grid = document.getElementById('calGrid');
  var monthLabel = document.getElementById('calMonth');
  var calRef = new Date(firstOpen.getFullYear(), firstOpen.getMonth(), 1);

  var checkIn = null, checkOut = null, hoverDay = null;

  function renderCal() {
    var y = calRef.getFullYear(), m = calRef.getMonth();
    monthLabel.textContent = MONTHS[m] + ' ' + y;
    var first = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var html = DOW.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < first; i++) html += '<div class="cal-day"></div>';
    for (var dd = 1; dd <= days; dd++) {
      var date = new Date(y, m, dd);
      var cls = 'cal-day in';
      if (isBooked(date)) cls += ' booked';
      else if (isPast(date)) cls += ' past';
      else {
        cls += ' sel';
        var inStart = checkIn && key(date) === key(checkIn);
        var inEnd = checkOut && key(date) === key(checkOut);
        var rangeHi = checkIn && checkOut && date > checkIn && date < checkOut;
        if (inStart) cls += ' sel-start';
        else if (inEnd) cls += ' sel-end';
        else if (rangeHi) cls += ' in-range';
      }
      html += '<div class="' + cls + '" data-date="' + key(date) + '">' + dd + '</div>';
    }
    grid.innerHTML = html;
    applyHover();
  }

  function applyHover() {
    var active = checkIn && !checkOut && hoverDay && hoverDay > checkIn && rangeClear(checkIn, hoverDay);
    grid.querySelectorAll('.cal-day[data-date]').forEach(function (cell) {
      cell.classList.remove('preview-range', 'preview-end');
      if (!active) return;
      var date = parseKey(cell.dataset.date);
      if (date > checkIn && date < hoverDay) cell.classList.add('preview-range');
      else if (key(date) === key(hoverDay)) cell.classList.add('preview-end');
    });
  }

  function pickDay(s) {
    var d = parseKey(s);
    if (!isAvail(d)) return;
    if (!checkIn || checkOut) { checkIn = d; checkOut = null; }
    else if (d <= checkIn) { checkIn = d; checkOut = null; }
    else if (!rangeClear(checkIn, d)) { checkIn = d; checkOut = null; }
    else { checkOut = d; }
    hoverDay = null;
    renderCal();
    updateSummary();
  }

  grid.addEventListener('click', function (e) {
    var cell = e.target.closest('.cal-day.sel');
    if (cell && cell.dataset.date) pickDay(cell.dataset.date);
  });
  grid.addEventListener('mouseover', function (e) {
    var cell = e.target.closest('.cal-day.sel');
    if (!cell || !cell.dataset.date) return;
    if (checkIn && !checkOut) {
      var d = parseKey(cell.dataset.date);
      if (!hoverDay || key(d) !== key(hoverDay)) { hoverDay = d; applyHover(); }
    }
  });
  grid.addEventListener('mouseleave', function () { if (hoverDay) { hoverDay = null; applyHover(); } });

  document.getElementById('calPrev').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() - 1); renderCal(); });
  document.getElementById('calNext').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() + 1); renderCal(); });

  /* ---------- booking summary card ---------- */
  var calWrap = document.querySelector('.cal-wrap');
  var side = document.createElement('div');
  side.className = 'cal-side';

  var bookCard = document.createElement('div');
  bookCard.className = 'book-stay box';
  var guestOpts = '';
  for (var gi = 1; gi <= MAX_GUESTS; gi++) guestOpts += '<option value="' + gi + '">' + gi + (gi === 1 ? ' guest' : ' guests') + '</option>';
  var petField = '';
  if (U.petsOk) {
    var petOpts = '';
    for (var pi = 0; pi <= MAX_PETS; pi++) petOpts += '<option value="' + pi + '">' + pi + (pi === 1 ? ' pet' : ' pets') + '</option>';
    petField = '<div class="bs-field"><label for="bsPets">Pets</label><select id="bsPets">' + petOpts + '</select></div>' +
      '<p style="font-size:12px;color:var(--ink-soft);line-height:1.4;margin:-6px 0 14px;">Under 50 lbs, non-restricted breed, well-behaved \u2014 share each pet\'s breed &amp; weight at booking.</p>';
  }
  bookCard.innerHTML =
    '<div class="bs-head">Book your stay</div>' +
    '<div class="bs-dates">' +
      '<div class="bs-date"><span class="bsl">Check-in</span><span class="bsv ph" id="bsIn">Add date</span></div>' +
      '<div class="bs-arrow">→</div>' +
      '<div class="bs-date"><span class="bsl">Check-out</span><span class="bsv ph" id="bsOut">Add date</span></div>' +
    '</div>' +
    '<div class="bs-field"><label for="bsGuests">Guests</label><select id="bsGuests">' + guestOpts + '</select></div>' +
    petField +
    '<div class="bs-rows" id="bsRows"></div>' +
    '<div class="bs-msg hint show" id="bsMsg">Select your check-in date on the calendar to begin.</div>' +
    '<button class="btn accent block" id="bsBook" disabled>Select dates</button>' +
    '<div class="bnote">No booking fees · free cancellation up to 30 days before check-in</div>';

  side.appendChild(bookCard);
  calWrap.appendChild(side);

  var bsIn = document.getElementById('bsIn');
  var bsOut = document.getElementById('bsOut');
  var bsRows = document.getElementById('bsRows');
  var bsMsg = document.getElementById('bsMsg');
  var bsBook = document.getElementById('bsBook');
  var bsGuests = document.getElementById('bsGuests');
  var bsPets = document.getElementById('bsPets');
  if (bsPets) bsPets.addEventListener('change', updateSummary);

  var calBox = document.querySelector('.cal');
  if (calBox) {
    var hint = document.createElement('div');
    hint.className = 'cal-hint';
    hint.textContent = 'Tip: tap an available day to set check-in, then a later day for check-out. ' + MIN_NIGHTS + '-night minimum stay.';
    calBox.appendChild(hint);
  }

  function currentNights() { return (checkIn && checkOut) ? nightsBetween(checkIn, checkOut) : 0; }
  function priceParts() { return CORE.priceParts(checkIn, checkOut, bsPets ? (parseInt(bsPets.value, 10) || 0) : 0); }

  function setMsg(text, kind) {
    bsMsg.textContent = text || '';
    bsMsg.className = 'bs-msg ' + (kind || 'hint') + (text ? ' show' : '');
  }

  function updateSummary() {
    if (checkIn) { bsIn.textContent = fmtLong(checkIn); bsIn.classList.remove('ph'); }
    else { bsIn.textContent = 'Add date'; bsIn.classList.add('ph'); }
    if (checkOut) { bsOut.textContent = fmtLong(checkOut); bsOut.classList.remove('ph'); }
    else { bsOut.textContent = 'Add date'; bsOut.classList.add('ph'); }

    var valid = false;
    if (!checkIn) {
      setMsg('Select your check-in date on the calendar to begin.', 'hint');
      bsBook.textContent = 'Select dates';
    } else if (!checkOut) {
      setMsg('Now pick your check-out date — ' + MIN_NIGHTS + '-night minimum.', 'hint');
      bsBook.textContent = 'Select check-out';
    } else {
      var n = currentNights();
      if (n < MIN_NIGHTS) {
        setMsg('Minimum stay is ' + MIN_NIGHTS + ' nights — you have ' + n + '. Pick a later check-out.', 'warn');
        bsBook.textContent = 'Stay too short';
      } else {
        valid = true;
        setMsg('', 'hint');
        bsBook.textContent = 'Book & pay →';
      }
    }

    if (valid) {
      var p = priceParts();
      var schedRows = '<div class="bs-row" style="font-size:13px;"><span class="bk">Due today (nights 1–30 + fees)</span><span>' + money(p.dueToday) + '</span></div>';
      p.paymentDates.forEach(function(pd) {
        schedRows += '<div class="bs-row" style="font-size:13px;"><span class="bk">Due ' + fmtLong(pd.date) + '</span><span>' + money(pd.amount) + '</span></div>';
      });
      bsRows.innerHTML =
        '<div class="bs-row"><span class="bk">' + p.n + ' nights<small>' + money(NIGHTLY) + ' / night</small></span><span>' + money(p.n * NIGHTLY) + '</span></div>' +
        '<div class="bs-row"><span class="bk">Cleaning fee</span><span>' + money(p.cleaning) + '</span></div>' +
        (p.petFee > 0 ? '<div class="bs-row"><span class="bk">Pet fee · ' + p.pets + ' × ' + money(PET_FEE) + '</span><span>' + money(p.petFee) + '</span></div>' : '') +
        '<div class="bs-row"><span class="bk">Refundable deposit</span><span>' + money(p.deposit) + '</span></div>' +
        '<div class="bs-row total"><span>Full stay total</span><span>' + money(p.fullTotal) + '</span></div>' +
        '<div style="padding-top:10px;margin-top:2px;border-top:1.5px dashed color-mix(in oklab,var(--ink) 14%,transparent);">' + schedRows + '</div>';
      bsRows.classList.add('show');
    } else {
      bsRows.classList.remove('show');
      bsRows.innerHTML = '';
    }
    bsBook.disabled = !valid;
  }

  /* ---------- go to the Checkout page ---------- */
  bsBook.addEventListener('click', function () {
    if (bsBook.disabled || !checkIn || !checkOut) return;
    var params = new URLSearchParams({
      u: (U.code || '').replace(/^Unit\s*/i, ''),
      in: key(checkIn),
      out: key(checkOut),
      g: bsGuests.value,
      p: bsPets ? bsPets.value : '0',
    });
    window.location.href = 'checkout.html?' + params.toString();
  });

  /* ---------- init ---------- */
  renderCal();
  updateSummary();
})();
