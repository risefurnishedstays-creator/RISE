/* ============================================================
   RISE Furnished Stays — Airbnb-style booking widget
   Renders into <div id="bookMount"> in each unit page's sidebar.
   - Date fields open a popover calendar (availability-aware,
     30-night minimum, booked + turnover/checkout-only days)
   - Once valid dates are chosen, shows the all-in stay total
   - Clicking the total opens a price-details popover
     (fees + payment schedule)
   Reads window.RISE_UNIT (set inline per page) + window.RISE_CORE.
   ============================================================ */
(function () {
  var U = window.RISE_UNIT;
  var CORE = window.RISE_CORE;
  if (!U || !CORE) return;

  var mount = document.getElementById('bookMount');
  if (!mount) return;

  var MIN_NIGHTS = CORE.MIN_NIGHTS, NIGHTLY = CORE.NIGHTLY, PET_FEE = CORE.PET_FEE;
  var MAX_GUESTS = CORE.MAX_GUESTS, MAX_PETS = CORE.MAX_PETS;
  var MONTHS = CORE.MONTHS, DOW = CORE.DOW;
  var key = CORE.key, parseKey = CORE.parseKey, fmtLong = CORE.fmtLong;
  var addDays = CORE.addDays, nightsBetween = CORE.nightsBetween, money = CORE.money;

  /* ---------- availability ---------- */
  var bookedRanges = [];
  function rebuildBookedRanges() {
    bookedRanges = (U.booked || []).map(function (b) {
      var from = new Date(b.from + 'T00:00:00');
      var to = new Date(b.to + 'T00:00:00');
      if (b.exclusiveEnd === true) { to = addDays(to, -1); }
      return { from: from, to: to };
    });
  }
  rebuildBookedRanges();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function isBooked(d) { return bookedRanges.some(function (b) { return d >= b.from && d <= b.to; }); }
  function isPast(d) { return d < today; }
  function isAvail(d) { return !isBooked(d) && !isPast(d); }
  // A booked day whose previous night is free can still be picked as a CHECK-OUT
  // date: the morning a booking begins is free for a departing guest (turnover).
  function isTurnover(d) { return isBooked(d) && !isPast(d) && !isBooked(addDays(d, -1)); }
  function rangeClear(a, b) { for (var d = new Date(a); d < b; d = addDays(d, 1)) { if (isBooked(d)) return false; } return true; }
  var firstOpen = new Date(today);
  for (var g = 0; g < 800 && !isAvail(firstOpen); g++) firstOpen = addDays(firstOpen, 1);
  function recomputeFirstOpen() {
    firstOpen = new Date(today);
    for (var gg = 0; gg < 800 && !isAvail(firstOpen); gg++) firstOpen = addDays(firstOpen, 1);
  }

  /* ---------- styles ---------- */
  var css = `
  .abnb-card { position: sticky; top: 92px; z-index: 30; padding: 22px 22px 20px; background: var(--paper); border: 2.5px solid var(--line); border-radius: 16px; box-shadow: 5px 6px 0 var(--ink); }
  .abnb-rate { font-size: 13.5px; margin-bottom: 12px; color: var(--ink); }
  .abnb-rate b { color: var(--ink); }
  .abnb-rate .star { color: var(--accent); }
  .abnb-rate span { color: var(--ink-soft); }
  .abnb-price { margin-bottom: 16px; min-height: 50px; }
  .abnb-bigprice { font-family: var(--font-head); font-size: 27px; line-height: 1.1; }
  .abnb-per { font-size: 14px; color: var(--ink-soft); font-family: var(--font-body); font-weight: 400; }
  .abnb-total { font-family: var(--font-head); font-size: 27px; line-height: 1.1; background: none; border: none; padding: 0; cursor: pointer; color: var(--ink); display: flex; width: 100%; align-items: baseline; flex-wrap: nowrap; gap: 8px; text-align: left; }
  .abnb-total .abnb-info { font-family: var(--font-body); font-size: 12.5px; font-weight: 600; color: var(--accent); border-bottom: 1.5px dashed color-mix(in oklab,var(--accent) 50%, transparent); align-self: center; margin-left: auto; white-space: nowrap; }
  .abnb-total:hover .abnb-info { color: var(--ink); border-bottom-color: var(--ink); }
  .abnb-sub { font-size: 13px; color: var(--ink-soft); margin-top: 4px; }

  .abnb-fields { position: relative; display: grid; grid-template-columns: 1fr 1fr; border: 2.5px solid var(--line); border-radius: 11px; margin-bottom: 12px; }
  .abnb-field { text-align: left; background: var(--paper); border: none; padding: 9px 13px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-body); border-radius: 9px; }
  .abnb-field + .abnb-field { border-left: 2.5px solid var(--line); }
  .abnb-field.active { box-shadow: inset 0 0 0 2.5px var(--accent); }
  .abnb-fl { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .abnb-fv { font-size: 14.5px; font-weight: 600; }
  .abnb-fv.ph { color: color-mix(in oklab, var(--ink-soft) 75%, transparent); font-weight: 400; }

  .abnb-guests { display: flex; flex-direction: column; gap: 4px; border: 2.5px solid var(--line); border-radius: 11px; padding: 8px 13px; margin-bottom: 12px; }
  .abnb-guests select { font-family: var(--font-body); font-size: 15px; border: none; background: transparent; padding: 0; cursor: pointer; color: var(--ink); width: 100%; }
  .abnb-guests select:focus { outline: none; }

  .abnb-msg { font-size: 13px; line-height: 1.4; margin: 0 0 12px; }
  .abnb-msg:empty { margin: 0; }
  .abnb-msg.warn { color: var(--red); }
  .abnb-msg.hint { color: var(--ink-soft); }
  .abnb-note { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-soft); text-align: center; margin-top: 12px; }

  /* calendar popover */
  .abnb-pop { position: absolute; top: calc(100% + 10px); left: 0; right: 0; z-index: 80; background: var(--paper); border: 2.5px solid var(--line); border-radius: 13px; box-shadow: 5px 6px 0 var(--ink); padding: 16px 16px 12px; }
  .abnb-pop[hidden] { display: none; }
  .abnb-pop-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .abnb-pop-month { font-family: var(--font-head); font-size: 17px; }
  .abnb-pop-nav { display: flex; gap: 7px; }
  .abnb-pop-nav button { width: 31px; height: 31px; border: 2px solid var(--line); border-radius: 8px; background: var(--paper); cursor: pointer; font-size: 16px; line-height: 1; box-shadow: 1.5px 1.5px 0 var(--ink); }
  .abnb-pop-nav button:hover { background: var(--accent); color: #fff; }
  .abnb-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 3px; }
  .abnb-dow { font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: .02em; text-transform: uppercase; color: var(--ink-soft); text-align: center; padding-bottom: 5px; }
  .abnb-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 12.5px; border: 1.5px solid transparent; border-radius: 8px; }
  .abnb-day.in { border-color: color-mix(in oklab, var(--ink) 14%, transparent); }
  .abnb-day.past { color: color-mix(in oklab, var(--ink) 30%, transparent); }
  .abnb-day.booked { background: repeating-linear-gradient(45deg, var(--red-soft), var(--red-soft) 3px, transparent 3px, transparent 6px); border-color: var(--red); color: color-mix(in oklab,var(--ink) 50%, transparent); text-decoration: line-through; }
  .abnb-day.sel { cursor: pointer; transition: background .1s, border-color .1s; }
  .abnb-day.sel:hover { border-color: var(--accent); background: var(--accent-soft); }
  .abnb-day.in-range, .abnb-day.preview-range { background: var(--accent-soft); border-color: color-mix(in oklab,var(--accent) 30%, transparent); border-radius: 0; }
  .abnb-day.sel-start, .abnb-day.sel-end, .abnb-day.preview-end { background: var(--accent); color:#fff; border-color: var(--line); font-weight: 700; border-radius: 8px; }
  .abnb-day.turnover { background: linear-gradient(135deg, var(--paper) 0 46%, var(--line) 46% 54%, var(--red-soft) 54% 100%); border-color: color-mix(in oklab,var(--red) 55%, transparent); color: var(--ink); text-decoration: none; cursor: pointer; }
  .abnb-day.turnover.sel-end { background: var(--accent); color:#fff; }
  .abnb-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 13px; font-size: 11px; color: var(--ink-soft); }
  .abnb-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .abnb-legend i { width: 13px; height: 13px; border: 1.5px solid var(--line); border-radius: 4px; flex: none; }
  .abnb-legend i.open { background: var(--paper); }
  .abnb-legend i.bk { background: repeating-linear-gradient(45deg, var(--red-soft), var(--red-soft) 2px, transparent 2px, transparent 4px); border-color: var(--red); }
  .abnb-legend i.turn { background: linear-gradient(135deg, var(--paper) 0 45%, var(--line) 45% 55%, var(--red-soft) 55% 100%); border-color: color-mix(in oklab,var(--red) 55%, transparent); }
  .abnb-pop-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 13px; padding-top: 11px; border-top: 2px dashed color-mix(in oklab,var(--ink) 16%, transparent); }
  .abnb-pop-foot button { background: none; border: none; cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--ink); text-decoration: underline; padding: 4px 2px; }
  .abnb-pop-foot .abnb-done { text-decoration: none; font-weight: 700; border: 2px solid var(--line); border-radius: 8px; padding: 6px 16px; box-shadow: 2px 2px 0 var(--ink); }
  .abnb-pop-foot .abnb-done:hover { background: var(--accent); color: #fff; }

  /* price-details popover */
  .abnb-break { position: absolute; top: 58px; left: 16px; right: 16px; z-index: 85; background: var(--paper); border: 2.5px solid var(--line); border-radius: 13px; box-shadow: 5px 6px 0 var(--ink); padding: 16px 18px; }
  .abnb-break[hidden] { display: none; }
  .abnb-break-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .abnb-break-top b { font-family: var(--font-head); font-size: 17px; }
  .abnb-break-close { background: none; border: none; cursor: pointer; font-size: 16px; line-height: 1; color: var(--ink-soft); padding: 2px 4px; }
  .abnb-break-close:hover { color: var(--ink); }
  .abnb-br-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13.5px; padding: 5px 0; }
  .abnb-br-row .bk { color: var(--ink-soft); }
  .abnb-br-row.total { font-weight: 700; font-size: 15px; margin-top: 6px; padding-top: 10px; border-top: 2px dashed color-mix(in oklab,var(--ink) 18%, transparent); }
  .abnb-br-head { font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin: 15px 0 6px; padding-top: 11px; border-top: 2px dashed color-mix(in oklab,var(--ink) 18%, transparent); }
  .abnb-br-row.due { font-weight: 700; }
  .abnb-br-row.muted { color: var(--ink-soft); font-size: 12.5px; }

  @media (max-width: 900px) {
    .abnb-card { position: relative; top: 0; }
  }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- state ---------- */
  var checkIn = null, checkOut = null, hoverDay = null;
  var calRef = new Date(firstOpen.getFullYear(), firstOpen.getMonth(), 1);
  var calOpen = false, breakdownOpen = false, pickMode = 'in';

  /* ---------- card shell ---------- */
  var guestOpts = '';
  for (var gi = 1; gi <= MAX_GUESTS; gi++) guestOpts += '<option value="' + gi + '">' + gi + (gi === 1 ? ' guest' : ' guests') + '</option>';
  var petsBlock = '';
  if (U.petsOk) {
    var po = '';
    for (var pi = 0; pi <= MAX_PETS; pi++) po += '<option value="' + pi + '">' + pi + (pi === 1 ? ' pet' : ' pets') + '</option>';
    petsBlock = '<div class="abnb-guests"><label class="abnb-fl" for="abPets">Pets</label><select id="abPets">' + po + '</select></div>';
  }
  mount.innerHTML =
    '<div class="abnb-card">' +
      '<div class="abnb-rate"><span class="star">\u2605</span> <b>' + (U.rating || '') + '</b> <span>\u00b7 ' + (U.reviews || 0) + ' reviews</span></div>' +
      '<div class="abnb-price" id="abPrice"></div>' +
      '<div class="abnb-fields">' +
        '<button type="button" class="abnb-field" id="fldIn"><span class="abnb-fl">Check-in</span><span class="abnb-fv ph" id="abIn">Add date</span></button>' +
        '<button type="button" class="abnb-field" id="fldOut"><span class="abnb-fl">Checkout</span><span class="abnb-fv ph" id="abOut">Add date</span></button>' +
        '<div class="abnb-pop" id="abPop" hidden></div>' +
      '</div>' +
      '<div class="abnb-guests"><label class="abnb-fl" for="abGuests">Guests</label><select id="abGuests">' + guestOpts + '</select></div>' +
      petsBlock +
      '<div class="abnb-msg hint" id="abMsg"></div>' +
      '<button class="btn accent block" id="abBook" disabled>Check availability</button>' +
      '<a class="btn block" href="contact.html" style="margin-top:10px;">Ask a question</a>' +
      '<div class="abnb-note" id="abNote">No booking fees &middot; book direct &amp; save</div>' +
      '<div class="abnb-break" id="abBreak" hidden></div>' +
    '</div>';

  var abPop = document.getElementById('abPop');
  var abBreak = document.getElementById('abBreak');
  var fldIn = document.getElementById('fldIn');
  var fldOut = document.getElementById('fldOut');
  var abGuests = document.getElementById('abGuests');
  var abPets = document.getElementById('abPets');
  var abBook = document.getElementById('abBook');

  function petsVal() { return abPets ? (parseInt(abPets.value, 10) || 0) : 0; }
  function priceParts() { return CORE.priceParts(checkIn, checkOut, petsVal()); }

  /* ---------- calendar popover ---------- */
  function dayCls(date) {
    var cls = 'abnb-day in';
    var turnover = isTurnover(date);
    if (isBooked(date) && !turnover) cls += ' booked';
    else if (isPast(date)) cls += ' past';
    else if (turnover) cls += ' booked turnover sel';
    else cls += ' sel';
    var inStart = checkIn && key(date) === key(checkIn);
    var inEnd = checkOut && key(date) === key(checkOut);
    var rangeHi = checkIn && checkOut && date > checkIn && date < checkOut;
    if (inStart) cls += ' sel-start';
    else if (inEnd) cls += ' sel-end';
    else if (rangeHi) cls += ' in-range';
    return cls;
  }
  function renderCalPopover() {
    var y = calRef.getFullYear(), m = calRef.getMonth();
    var first = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var grid = DOW.map(function (d) { return '<div class="abnb-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < first; i++) grid += '<div class="abnb-day"></div>';
    for (var dd = 1; dd <= days; dd++) {
      var date = new Date(y, m, dd);
      grid += '<div class="' + dayCls(date) + '" data-date="' + key(date) + '">' + dd + '</div>';
    }
    abPop.innerHTML =
      '<div class="abnb-pop-top"><div class="abnb-pop-month">' + MONTHS[m] + ' ' + y + '</div>' +
        '<div class="abnb-pop-nav"><button type="button" data-nav="prev" aria-label="previous month">\u2039</button><button type="button" data-nav="next" aria-label="next month">\u203a</button></div></div>' +
      '<div class="abnb-grid">' + grid + '</div>' +
      '<div class="abnb-legend"><span><i class="open"></i> Available</span><span><i class="bk"></i> Booked</span><span><i class="turn"></i> Checkout only</span></div>' +
      '<div class="abnb-pop-foot"><button type="button" data-act="clear">Clear dates</button><button type="button" class="abnb-done" data-act="done">' + (checkIn && checkOut ? 'Done' : 'Close') + '</button></div>';
    applyHover();
  }
  function applyHover() {
    var active = checkIn && !checkOut && hoverDay && hoverDay > checkIn && rangeClear(checkIn, hoverDay);
    abPop.querySelectorAll('.abnb-day[data-date]').forEach(function (cell) {
      cell.classList.remove('preview-range', 'preview-end');
      if (!active) return;
      var date = parseKey(cell.dataset.date);
      if (date > checkIn && date < hoverDay) cell.classList.add('preview-range');
      else if (key(date) === key(hoverDay)) cell.classList.add('preview-end');
    });
  }
  function pickDay(s) {
    var d = parseKey(s);
    if (isTurnover(d)) {
      if (checkIn && !checkOut && d > checkIn && rangeClear(checkIn, d)) { checkOut = d; pickMode = 'in'; }
      else { return; }
    } else {
      if (!isAvail(d)) return;
      if (!checkIn || checkOut) { checkIn = d; checkOut = null; pickMode = 'out'; }
      else if (d <= checkIn) { checkIn = d; checkOut = null; pickMode = 'out'; }
      else if (!rangeClear(checkIn, d)) { checkIn = d; checkOut = null; pickMode = 'out'; }
      else { checkOut = d; pickMode = 'in'; }
    }
    hoverDay = null;
    renderCalPopover();
    updateFieldActive();
    updateCard();
    if (checkIn && checkOut) setTimeout(closeCal, 280);
  }

  abPop.addEventListener('click', function (e) {
    e.stopPropagation(); // keep the outside-click handler from closing the popover
                         // when innerHTML re-render detaches the clicked node
    var nav = e.target.closest('[data-nav]');
    if (nav) { calRef.setMonth(calRef.getMonth() + (nav.dataset.nav === 'prev' ? -1 : 1)); renderCalPopover(); return; }
    var act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'clear') { checkIn = null; checkOut = null; hoverDay = null; pickMode = 'in'; renderCalPopover(); updateFieldActive(); updateCard(); }
      else { closeCal(); }
      return;
    }
    var cell = e.target.closest('.abnb-day.sel');
    if (cell && cell.dataset.date) pickDay(cell.dataset.date);
  });
  abPop.addEventListener('mouseover', function (e) {
    var cell = e.target.closest('.abnb-day.sel');
    if (!cell || !cell.dataset.date) return;
    if (checkIn && !checkOut) { var d = parseKey(cell.dataset.date); if (!hoverDay || key(d) !== key(hoverDay)) { hoverDay = d; applyHover(); } }
  });
  abPop.addEventListener('mouseleave', function () { if (hoverDay) { hoverDay = null; applyHover(); } });

  function openCal(mode) {
    // When reopening specifically to change the CHECKOUT date (mode === 'out')
    // on an already-committed stay, clear checkOut to null first. Without
    // this, pickDay()'s "!checkIn || checkOut" branch sees the existing
    // checkOut as a sign that a full range was just selected, and treats
    // the next click as the start of a brand new range -- wiping checkIn
    // instead of just updating checkout. This mirrors the same fix applied
    // to checkout.html's date picker for the identical underlying bug.
    if (mode === 'out' && checkIn && checkOut) {
      checkOut = null;
    }
    pickMode = (mode === 'out' && checkIn) ? 'out' : 'in';
    // Default to the CURRENT month whenever nothing is picked yet for this
    // field -- regardless of whether today (or this month) happens to be
    // booked out. Only fall back to the already-picked date (checkIn, when
    // reopening to adjust checkout) once something has actually been selected.
    var base = (pickMode === 'out' && checkIn) ? checkIn : (checkIn || today);
    calRef = new Date(base.getFullYear(), base.getMonth(), 1);
    closeBreakdown();
    abPop.hidden = false;
    calOpen = true;
    updateFieldActive();
    renderCalPopover();
  }
  function closeCal() { abPop.hidden = true; calOpen = false; updateFieldActive(); }
  function toggleField(mode) { if (calOpen && pickMode === mode) closeCal(); else openCal(mode); }
  fldIn.addEventListener('click', function () { toggleField('in'); });
  fldOut.addEventListener('click', function () { toggleField('out'); });

  function updateFieldActive() {
    fldIn.classList.toggle('active', calOpen && pickMode === 'in');
    fldOut.classList.toggle('active', calOpen && pickMode === 'out');
  }

  /* ---------- price-details popover ---------- */
  function toggleBreakdown() { if (breakdownOpen) closeBreakdown(); else { breakdownOpen = true; closeCal(); renderBreakdown(); } }
  function closeBreakdown() { breakdownOpen = false; abBreak.hidden = true; abBreak.innerHTML = ''; }
  function renderBreakdown() {
    if (!(checkIn && checkOut)) { closeBreakdown(); return; }
    var p = priceParts();
    var rows =
      '<div class="abnb-br-row"><span class="bk">' + p.n + ' nights \u00d7 ' + money(NIGHTLY) + '</span><span>' + money(p.n * NIGHTLY) + '</span></div>' +
      '<div class="abnb-br-row"><span class="bk">Cleaning fee</span><span>' + money(p.cleaning) + '</span></div>' +
      (p.petFee > 0 ? '<div class="abnb-br-row"><span class="bk">Pet fee \u00b7 ' + p.pets + ' \u00d7 ' + money(PET_FEE) + '</span><span>' + money(p.petFee) + '</span></div>' : '') +
      '<div class="abnb-br-row total"><span>Full stay total</span><span>' + money(p.fullTotal) + '</span></div>';
    var sched = '<div class="abnb-br-head">Payment schedule</div>' +
      '<div class="abnb-br-row due"><span>Due today (first 30 nights + fees)</span><span>' + money(p.dueToday) + '</span></div>';
    p.paymentDates.forEach(function (pd) {
      sched += '<div class="abnb-br-row muted"><span>Due ' + fmtLong(pd.date) + '</span><span>' + money(pd.amount) + '</span></div>';
    });
    abBreak.innerHTML =
      '<div class="abnb-break-top"><b>Price details</b><button type="button" class="abnb-break-close" data-close="1" aria-label="close">\u2715</button></div>' +
      rows + sched;
    var priceEl = document.getElementById('abPrice');
    abBreak.style.top = (priceEl.offsetTop + priceEl.offsetHeight + 8) + 'px';
    abBreak.hidden = false;
  }
  abBreak.addEventListener('click', function (e) { e.stopPropagation(); if (e.target.closest('[data-close]')) closeBreakdown(); });

  /* ---------- card state ---------- */
  function updateCard() {
    var abIn = document.getElementById('abIn'), abOut = document.getElementById('abOut');
    if (checkIn) { abIn.textContent = fmtLong(checkIn); abIn.classList.remove('ph'); }
    else { abIn.textContent = 'Add date'; abIn.classList.add('ph'); }
    if (checkOut) { abOut.textContent = fmtLong(checkOut); abOut.classList.remove('ph'); }
    else { abOut.textContent = 'Add date'; abOut.classList.add('ph'); }

    var priceEl = document.getElementById('abPrice');
    var msgEl = document.getElementById('abMsg');
    var noteEl = document.getElementById('abNote');
    var n = (checkIn && checkOut) ? nightsBetween(checkIn, checkOut) : 0;
    var valid = false;

    if (!checkIn || !checkOut) {
      priceEl.innerHTML = '<div class="abnb-bigprice">' + money(NIGHTLY) + ' <span class="abnb-per">/ night</span></div><div class="abnb-sub">Add dates for your total</div>';
      msgEl.textContent = checkIn ? 'Now select your check-out date.' : '';
      msgEl.className = 'abnb-msg hint';
      abBook.textContent = 'Check availability';
      // Button stays ENABLED here (not disabled) so a click is always
      // possible -- the click handler below shows a clear validation
      // message via abMsg if dates are still missing, rather than the
      // button silently doing nothing, which is what disabled caused.
      abBook.disabled = false;
      noteEl.textContent = 'No booking fees \u00b7 book direct & save';
    } else if (n < MIN_NIGHTS) {
      priceEl.innerHTML = '<div class="abnb-bigprice">' + money(NIGHTLY) + ' <span class="abnb-per">/ night</span></div><div class="abnb-sub">' + n + ' nights selected</div>';
      msgEl.textContent = 'Minimum stay is ' + MIN_NIGHTS + ' nights \u2014 you have ' + n + '. Pick a later check-out.';
      msgEl.className = 'abnb-msg warn';
      abBook.textContent = 'Stay too short';
      abBook.disabled = true;
      noteEl.textContent = 'No booking fees \u00b7 book direct & save';
    } else {
      valid = true;
      var p = priceParts();
      priceEl.innerHTML =
        '<button type="button" class="abnb-total" id="abTotalBtn">' + money(p.fullTotal) + ' <span class="abnb-per">total</span> <span class="abnb-info">price details</span></button>' +
        '<div class="abnb-sub">' + n + ' nights \u00b7 ' + money(NIGHTLY) + '/night \u00b7 all fees included</div>';
      msgEl.textContent = '';
      msgEl.className = 'abnb-msg';
      abBook.textContent = 'Book & pay \u2192';
      abBook.disabled = false;
      noteEl.textContent = "You won't be charged yet \u00b7 No booking fees";
      document.getElementById('abTotalBtn').addEventListener('click', toggleBreakdown);
    }
    if (breakdownOpen && valid) renderBreakdown(); else if (!valid) closeBreakdown();
  }

  abGuests.addEventListener('change', updateCard);
  if (abPets) abPets.addEventListener('change', function () { if (breakdownOpen) renderBreakdown(); updateCard(); });

  abBook.addEventListener('click', function () {
    if (!checkIn || !checkOut) {
      var msgEl = document.getElementById('abMsg');
      msgEl.textContent = !checkIn
        ? 'Please select a check-in date to continue.'
        : 'Please select a check-out date to continue.';
      msgEl.className = 'abnb-msg warn';
      // Open the calendar pointed at whichever date is still missing, so
      // the guest doesn't just see an error -- they're taken straight to
      // the fix.
      openCal(!checkIn ? 'in' : 'out');
      return;
    }
    if (abBook.disabled) return; // still blocked for the "stay too short" case
    var params = new URLSearchParams({
      u: (U.code || '').replace(/^Unit\s*/i, ''),
      in: key(checkIn), out: key(checkOut),
      g: abGuests.value, p: petsVal() + '',
    });
    window.location.href = 'checkout.html?' + params.toString();
  });

  /* ---------- dismiss popovers ---------- */
  document.addEventListener('click', function (e) {
    if (!mount.contains(e.target)) { closeCal(); closeBreakdown(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeCal(); closeBreakdown(); }
  });

  /* ---------- init ---------- */
  updateCard();

  // Refresh from live availability (direct bookings + Airbnb/VRBO feeds).
  // The availability API runs on Vercel (same base as the checkout & contact
  // forms). The static site is served from a different origin, so we must
  // call the absolute URL — a relative "/api/..." path 404s here.
  var API_BASE = 'https://rise-eta-three.vercel.app';
  var unitParam = (U.code || '').replace(/^Unit\s*/i, '').toUpperCase();
  if (unitParam) {
    fetch(API_BASE + '/api/availability?unit=' + encodeURIComponent(unitParam))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.booked) return;
        U.booked = data.booked.map(function (b) { return { from: b.from, to: b.to, exclusiveEnd: true }; });
        rebuildBookedRanges();
        if (checkIn && checkOut && !rangeClear(checkIn, checkOut)) { checkIn = null; checkOut = null; pickMode = 'in'; }
        recomputeFirstOpen();
        if (calOpen) renderCalPopover();
        updateCard();
      })
      .catch(function () { /* offline / API down: keep page data */ });
  }
})();
