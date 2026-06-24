/* ============================================================
   RISE Furnished Stays — Checkout page
   Reads the booking selection from the URL (u, in, out, g, p),
   renders the recap + guest/payment form, validates, then
   hands off to the Confirmation page via sessionStorage.
   Depends on rise-booking-core.js + rise-unit-data.js.
   ============================================================ */
(function () {
  var CORE = window.RISE_CORE;
  var UNITS = window.RISE_UNITS;
  var mount = document.getElementById('coMount');
  if (!CORE || !UNITS || !mount) return;

  var money = CORE.money, fmtLong = CORE.fmtLong, parseKey = CORE.parseKey;
  var nightsBetween = CORE.nightsBetween, MIN_NIGHTS = CORE.MIN_NIGHTS, PET_FEE = CORE.PET_FEE, NIGHTLY = CORE.NIGHTLY;
  var addDays = CORE.addDays, key = CORE.key, MONTHS = CORE.MONTHS, DOW = CORE.DOW;

  /* ---------- styles ---------- */
  var css = `
  .co-grid { display: grid; grid-template-columns: 1fr 372px; gap: 40px; align-items: start; }
  .co-form { min-width: 0; }
  .co-recap-wrap { position: sticky; top: 92px; }

  .bk-sec { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); }
  .co-block { margin-bottom: 34px; }
  .bk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .bk-inp { display: flex; flex-direction: column; }
  .bk-inp[hidden] { display: none; }
  .bk-inp.full { grid-column: 1 / -1; }
  .bk-inp label { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 7px; }
  .bk-inp input { font-family: var(--font-body); font-size: 15px; color: var(--ink); border: 2.5px solid var(--line); border-radius: 8px; background: var(--paper); padding: 0 12px; height: 46px; width: 100%; }
  .bk-inp input:focus { outline: none; border-color: var(--accent); box-shadow: 2px 2px 0 var(--accent-soft); }
  .bk-inp input.bad { border-color: var(--red); }
  .bk-inp select { font-family: var(--font-body); font-size: 15px; color: var(--ink); border: 2.5px solid var(--line); border-radius: 8px; background: var(--paper); padding: 0 12px; height: 46px; width: 100%; cursor: pointer; }
  .bk-inp select:focus { outline: none; border-color: var(--accent); box-shadow: 2px 2px 0 var(--accent-soft); }
  .bk-inp select.bad { border-color: var(--red); }
  .bk-pet-err { font-size: 12px; color: var(--red); font-weight: 600; line-height: 1.4; margin: 6px 0 0; }
  .bk-pay-note { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-soft); display: flex; align-items: center; gap: 7px; margin: 4px 0 18px; }
  .bk-pay-note::before { content: "🔒"; }
  .bk-agree { display: flex; gap: 11px; align-items: flex-start; margin: 0 0 20px; cursor: pointer; }
  .bk-agree input { appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 24px; height: 24px; margin: 0; border: 2.5px solid var(--line); border-radius: 6px; background: var(--paper); cursor: pointer; position: relative; transition: background .1s; }
  .bk-agree input:checked { background: var(--accent); }
  .bk-agree input:checked::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 15px; font-weight: 700; }
  .bk-agree input.bad { border-color: var(--red); box-shadow: 0 0 0 3px color-mix(in oklab, var(--red) 22%, transparent); }
  .bk-agree span { font-size: 14px; line-height: 1.5; color: var(--ink); }
  .bk-agree a { color: var(--accent); text-decoration: none; border-bottom: 1.5px solid color-mix(in oklab, var(--accent) 45%, transparent); }
  .bk-agree a:hover { border-bottom-color: var(--accent); }

  /* recap card */
  .bk-recap { padding: 22px 22px 8px; box-shadow: 5px 6px 0 var(--ink); }
  .bk-recap-title { font-family: var(--font-head); font-size: 20px; margin-bottom: 4px; }
  .bk-recap-sub { font-size: 13px; color: var(--ink-soft); margin-bottom: 16px; }
  .bk-recap .rr { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 14px; padding: 5px 0; }
  .bk-recap .rr .rk { color: var(--ink-soft); }
  .bk-recap .rr.total { font-weight: 700; font-size: 16px; margin-top: 8px; padding-top: 11px; border-top: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); }
  .bk-recap .rr.sep { margin-top: 8px; padding-top: 11px; border-top: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); }
  .bk-sched-head { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin: 16px 0 10px; padding-bottom: 7px; border-bottom: 2px dashed color-mix(in oklab, var(--ink) 22%, transparent); }
  .bk-recap .rr.due-today { font-weight: 700; font-size: 15px; color: var(--ink); background: var(--accent-soft); border: 2px solid color-mix(in oklab, var(--accent) 45%, transparent); border-radius: 9px; padding: 10px 12px; margin: 2px 0 10px; }
  .bk-recap .rr.due-today .rk { color: var(--ink); }
  .bk-recap .rr.muted { font-size: 12.5px; color: var(--ink-soft); }
  .co-change { display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; margin-bottom: 16px; font-family: ui-monospace, monospace; font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--accent); text-decoration: none; }
  .co-change:hover { text-decoration: underline; }

  /* empty / error state */
  .co-empty { max-width: 520px; margin: 20px auto 40px; text-align: center; padding: 40px 32px; box-shadow: 5px 6px 0 var(--ink); }
  .co-empty .ce-badge { width: 60px; height: 60px; margin: 0 auto 18px; border: 2.5px solid var(--line); border-radius: 50%; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; font-size: 28px; box-shadow: 3px 3px 0 var(--ink); }
  .co-empty h2 { font-size: 26px; margin-bottom: 12px; }
  .co-empty p { color: var(--ink-soft); font-size: 15.5px; line-height: 1.55; margin: 0 auto 22px; max-width: 40ch; }

  @media (max-width: 900px) {
    .co-grid { grid-template-columns: 1fr; gap: 30px; }
    .co-recap-wrap { position: static; order: -1; }
  }
  @media (max-width: 560px) { .bk-grid { grid-template-columns: 1fr; } }

  /* editable date picker (recap) */
  .co-dates { position: relative; display: grid; grid-template-columns: 1fr 1fr; border: 2.5px solid var(--line); border-radius: 11px; margin: 4px 0 8px; }
  .co-datefield { text-align: left; background: var(--paper); border: none; padding: 9px 13px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-body); border-radius: 9px; }
  .co-datefield + .co-datefield { border-left: 2.5px solid var(--line); }
  .co-datefield.active { box-shadow: inset 0 0 0 2.5px var(--accent); }
  .co-dl { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .co-dv { font-size: 14px; font-weight: 600; }
  .co-pop { position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 90; background: var(--paper); border: 2.5px solid var(--line); border-radius: 13px; box-shadow: 5px 6px 0 var(--ink); padding: 14px; }
  .co-pop[hidden] { display: none; }
  .co-pop-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; }
  .co-pop-month { font-family: var(--font-head); font-size: 16px; }
  .co-pop-nav { display: flex; gap: 6px; }
  .co-pop-nav button { width: 30px; height: 30px; border: 2px solid var(--line); border-radius: 8px; background: var(--paper); cursor: pointer; font-size: 15px; line-height: 1; box-shadow: 1.5px 1.5px 0 var(--ink); }
  .co-pop-nav button:hover { background: var(--accent); color: #fff; }
  .co-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 3px; }
  .co-dow { font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: .02em; text-transform: uppercase; color: var(--ink-soft); text-align: center; padding-bottom: 4px; }
  .co-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 12px; border: 1.5px solid transparent; border-radius: 8px; }
  .co-day.in { border-color: color-mix(in oklab, var(--ink) 14%, transparent); }
  .co-day.past { color: color-mix(in oklab, var(--ink) 30%, transparent); }
  .co-day.booked { background: repeating-linear-gradient(45deg, var(--red-soft), var(--red-soft) 3px, transparent 3px, transparent 6px); border-color: var(--red); color: color-mix(in oklab,var(--ink) 50%, transparent); text-decoration: line-through; }
  .co-day.sel { cursor: pointer; }
  .co-day.sel:hover { border-color: var(--accent); background: var(--accent-soft); }
  .co-day.in-range, .co-day.preview-range { background: var(--accent-soft); border-color: color-mix(in oklab,var(--accent) 30%, transparent); border-radius: 0; }
  .co-day.sel-start, .co-day.sel-end, .co-day.preview-end { background: var(--accent); color:#fff; border-color: var(--line); font-weight: 700; border-radius: 8px; }
  .co-day.turnover { background: linear-gradient(135deg, var(--paper) 0 46%, var(--line) 46% 54%, var(--red-soft) 54% 100%); border-color: color-mix(in oklab,var(--red) 55%, transparent); color: var(--ink); text-decoration: none; cursor: pointer; }
  .co-day.turnover.sel-end { background: var(--accent); color:#fff; }
  .co-pop-note { font-size: 12px; color: var(--red); font-weight: 600; margin: 10px 0 0; line-height: 1.4; }
  .co-legend { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 11px; font-size: 10.5px; color: var(--ink-soft); }
  .co-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .co-legend i { width: 12px; height: 12px; border: 1.5px solid var(--line); border-radius: 4px; flex: none; }
  .co-legend i.open { background: var(--paper); }
  .co-legend i.bk { background: repeating-linear-gradient(45deg, var(--red-soft), var(--red-soft) 2px, transparent 2px, transparent 4px); border-color: var(--red); }
  .co-legend i.turn { background: linear-gradient(135deg, var(--paper) 0 45%, var(--line) 45% 55%, var(--red-soft) 55% 100%); border-color: color-mix(in oklab,var(--red) 55%, transparent); }
  .co-pop-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 11px; padding-top: 10px; border-top: 2px dashed color-mix(in oklab,var(--ink) 16%, transparent); }
  .co-pop-foot button { background: none; border: none; cursor: pointer; font-family: var(--font-body); font-size: 13px; color: var(--ink); text-decoration: underline; padding: 4px 2px; }
  .co-pop-foot .co-done { text-decoration: none; font-weight: 700; border: 2px solid var(--line); border-radius: 8px; padding: 6px 15px; box-shadow: 2px 2px 0 var(--ink); }
  .co-pop-foot .co-done:hover { background: var(--accent); color: #fff; }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- parse + validate the selection ---------- */
  var q = new URLSearchParams(location.search);
  var unitKey = (q.get('u') || '').toUpperCase().replace(/^UNIT\s*/, '');
  var U = UNITS[unitKey];
  var checkIn = q.get('in') ? parseKey(q.get('in')) : null;
  var checkOut = q.get('out') ? parseKey(q.get('out')) : null;
  var guests = Math.max(1, Math.min(CORE.MAX_GUESTS, parseInt(q.get('g'), 10) || 1));
  var pets = U && U.petsOk ? Math.max(0, Math.min(CORE.MAX_PETS, parseInt(q.get('p'), 10) || 0)) : 0;

  var validDates = checkIn && checkOut && !isNaN(checkIn) && !isNaN(checkOut) && nightsBetween(checkIn, checkOut) >= MIN_NIGHTS;

  function renderEmpty(msg) {
    mount.innerHTML =
      '<div class="co-empty box">' +
        '<div class="ce-badge">🗓️</div>' +
        '<h2>Let’s pick your dates first</h2>' +
        '<p>' + msg + '</p>' +
        '<a class="btn accent" href="index.html#book-stay">Browse homes &amp; dates</a>' +
      '</div>';
  }

  if (!U || !validDates) {
    renderEmpty(!U
      ? 'We couldn’t find that home. Choose one of our South Austin homes and select your stay dates to continue.'
      : 'Your stay needs a valid check-in and check-out date with a ' + MIN_NIGHTS + '-night minimum. Head back to pick your dates.');
    return;
  }

  // update breadcrumb link to the right unit page
  var crumb = document.getElementById('coUnitCrumb');
  if (crumb) { crumb.textContent = U.code; crumb.href = U.code.toLowerCase().replace(/ /g, '-') + '.html'; }

  var p = CORE.priceParts(checkIn, checkOut, pets);
  var unitLabel = U.petsOk ? 'Entire Home' : (U.kicker || '').replace(' · Pet-friendly', '');

  /* ---------- editable calendar (availability-aware) ---------- */
  var bookedRanges = [];
  function rebuildRanges() {
    bookedRanges = (U.booked || []).map(function (b) {
      var from = new Date(b.from + 'T00:00:00');
      var to = new Date(b.to + 'T00:00:00');
      if (b.exclusiveEnd === true) { to = addDays(to, -1); }
      return { from: from, to: to };
    });
  }
  rebuildRanges();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function isBooked(d) { return bookedRanges.some(function (b) { return d >= b.from && d <= b.to; }); }
  function isPast(d) { return d < today; }
  function isAvail(d) { return !isBooked(d) && !isPast(d); }
  function isTurnover(d) { return isBooked(d) && !isPast(d) && !isBooked(addDays(d, -1)); }
  function rangeClear(a, b) { for (var d = new Date(a); d < b; d = addDays(d, 1)) { if (isBooked(d)) return false; } return true; }
  var firstOpen = new Date(today);
  for (var gg = 0; gg < 800 && !isAvail(firstOpen); gg++) firstOpen = addDays(firstOpen, 1);

  var calOpen = false, calRef = null, pickMode = 'in', hoverDay = null, tmpIn = null, tmpOut = null, calMsg = '';

  function gid(id) { return document.getElementById(id); }
  function setActive() {
    var fi = gid('coFldIn'), fo = gid('coFldOut');
    if (fi) fi.classList.toggle('active', calOpen && pickMode === 'in');
    if (fo) fo.classList.toggle('active', calOpen && pickMode === 'out');
  }
  function dayCls(date) {
    var cls = 'co-day in';
    var turn = isTurnover(date);
    if (isBooked(date) && !turn) cls += ' booked';
    else if (isPast(date)) cls += ' past';
    else if (turn) cls += ' booked turnover sel';
    else cls += ' sel';
    if (tmpIn && key(date) === key(tmpIn)) cls += ' sel-start';
    else if (tmpOut && key(date) === key(tmpOut)) cls += ' sel-end';
    else if (tmpIn && tmpOut && date > tmpIn && date < tmpOut) cls += ' in-range';
    return cls;
  }
  function renderCalPop() {
    var pop = gid('coPop'); if (!pop) return;
    var y = calRef.getFullYear(), m = calRef.getMonth();
    var first = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var grid = DOW.map(function (d) { return '<div class="co-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < first; i++) grid += '<div class="co-day"></div>';
    for (var dd = 1; dd <= days; dd++) { var date = new Date(y, m, dd); grid += '<div class="' + dayCls(date) + '" data-date="' + key(date) + '">' + dd + '</div>'; }
    pop.innerHTML =
      '<div class="co-pop-top"><div class="co-pop-month">' + MONTHS[m] + ' ' + y + '</div>' +
        '<div class="co-pop-nav"><button type="button" data-nav="prev" aria-label="previous month">\u2039</button><button type="button" data-nav="next" aria-label="next month">\u203a</button></div></div>' +
      '<div class="co-cal-grid">' + grid + '</div>' +
      (calMsg ? '<div class="co-pop-note">' + calMsg + '</div>' : '') +
      '<div class="co-legend"><span><i class="open"></i> Available</span><span><i class="bk"></i> Booked</span><span><i class="turn"></i> Checkout only</span></div>' +
      '<div class="co-pop-foot"><button type="button" data-act="clear">Clear</button><button type="button" class="co-done" data-act="done">Done</button></div>';
    applyHover();
  }
  function applyHover() {
    var pop = gid('coPop'); if (!pop) return;
    var active = tmpIn && !tmpOut && hoverDay && hoverDay > tmpIn && rangeClear(tmpIn, hoverDay);
    pop.querySelectorAll('.co-day[data-date]').forEach(function (cell) {
      cell.classList.remove('preview-range', 'preview-end');
      if (!active) return;
      var date = parseKey(cell.dataset.date);
      if (date > tmpIn && date < hoverDay) cell.classList.add('preview-range');
      else if (key(date) === key(hoverDay)) cell.classList.add('preview-end');
    });
  }
  function pickDay(s) {
    var d = parseKey(s);
    if (isTurnover(d)) {
      if (tmpIn && !tmpOut && d > tmpIn && rangeClear(tmpIn, d)) { tmpOut = d; }
      else { return; }
    } else {
      if (!isAvail(d)) return;
      if (!tmpIn || tmpOut) { tmpIn = d; tmpOut = null; pickMode = 'out'; calMsg = ''; }
      else if (d <= tmpIn) { tmpIn = d; tmpOut = null; pickMode = 'out'; calMsg = ''; }
      else if (!rangeClear(tmpIn, d)) { tmpIn = d; tmpOut = null; pickMode = 'out'; calMsg = ''; }
      else { tmpOut = d; }
    }
    hoverDay = null;
    if (tmpIn && tmpOut) {
      var nn = nightsBetween(tmpIn, tmpOut);
      if (nn >= MIN_NIGHTS) { commit(); return; }
      calMsg = 'Minimum stay is ' + MIN_NIGHTS + ' nights \u2014 you have ' + nn + '. Pick a later checkout.';
      renderCalPop(); return;
    }
    renderCalPop(); setActive();
  }
  function commit() {
    checkIn = tmpIn; checkOut = tmpOut;
    p = CORE.priceParts(checkIn, checkOut, pets);
    calOpen = false; calMsg = '';
    paintRecap(); updatePayBtn();
  }
  function handlePopClick(e) {
    var nav = e.target.closest('[data-nav]');
    if (nav) { calRef.setMonth(calRef.getMonth() + (nav.dataset.nav === 'prev' ? -1 : 1)); renderCalPop(); return; }
    var act = e.target.closest('[data-act]');
    if (act) { if (act.dataset.act === 'clear') { tmpIn = null; tmpOut = null; calMsg = ''; pickMode = 'in'; renderCalPop(); setActive(); } else { closeCal(); } return; }
    var cell = e.target.closest('.co-day.sel');
    if (cell && cell.dataset.date) pickDay(cell.dataset.date);
  }
  function openCal(mode) {
    tmpIn = checkIn; tmpOut = checkOut; calMsg = '';
    pickMode = (mode === 'out' && tmpIn) ? 'out' : 'in';
    var base = (pickMode === 'out' && tmpIn) ? tmpIn : (tmpIn || firstOpen);
    calRef = new Date(base.getFullYear(), base.getMonth(), 1);
    calOpen = true;
    var pop = gid('coPop'); if (!pop) return;
    pop.hidden = false;
    pop.onclick = function (e) { e.stopPropagation(); handlePopClick(e); };
    pop.onmouseover = function (e) { var c = e.target.closest('.co-day.sel'); if (c && c.dataset.date && tmpIn && !tmpOut) { var d = parseKey(c.dataset.date); if (!hoverDay || key(d) !== key(hoverDay)) { hoverDay = d; applyHover(); } } };
    pop.onmouseleave = function () { if (hoverDay) { hoverDay = null; applyHover(); } };
    renderCalPop(); setActive();
  }
  function closeCal() { calOpen = false; var pop = gid('coPop'); if (pop) pop.hidden = true; setActive(); }
  function toggleCal(mode) { if (calOpen && pickMode === mode) closeCal(); else openCal(mode); }
  function wireDates() {
    var fi = gid('coFldIn'), fo = gid('coFldOut');
    if (!fi || !fo) return;
    fi.onclick = function (e) { e.stopPropagation(); toggleCal('in'); };
    fo.onclick = function (e) { e.stopPropagation(); toggleCal('out'); };
  }
  function paintRecap() { var w = gid('coRecapWrap'); if (w) { w.innerHTML = recapHtml(); wireDates(); } }
  function updatePayBtn() { var b = gid('bkPay'); if (b) b.innerHTML = 'Pay ' + money(p.dueToday) + ' &amp; confirm'; }

  /* ---------- recap markup ---------- */
  function recapHtml() {
    var sched = '<div class="bk-sched-head">Payment schedule</div>' +
      '<div class="rr due-today"><span class="rk">Due today (nights 1–30 + fees)</span><span>' + money(p.dueToday) + '</span></div>';
    p.paymentDates.forEach(function (pd) {
      sched += '<div class="rr muted"><span class="rk">Due ' + fmtLong(pd.date) + '</span><span>' + money(pd.amount) + '</span></div>';
    });
    return '<div class="bk-recap box">' +
      '<div class="bk-recap-title">' + U.code + ' · ' + unitLabel + '</div>' +
      '<div class="co-dates">' +
        '<button type="button" class="co-datefield" id="coFldIn"><span class="co-dl">Check-in</span><span class="co-dv" id="coIn">' + fmtLong(checkIn) + '</span></button>' +
        '<button type="button" class="co-datefield" id="coFldOut"><span class="co-dl">Checkout</span><span class="co-dv" id="coOut">' + fmtLong(checkOut) + '</span></button>' +
        '<div class="co-pop" id="coPop" hidden></div>' +
      '</div>' +
      '<div class="bk-recap-sub">' + p.n + ' nights · tap a date to edit</div>' +
      '<div class="rr"><span class="rk">Guests</span><span>' + guests + (guests === 1 ? ' guest' : ' guests') + '</span></div>' +
      (U.petsOk ? '<div class="rr"><span class="rk">Pets</span><span>' + pets + (pets === 1 ? ' pet' : ' pets') + '</span></div>' : '') +
      '<div class="rr sep"><span class="rk">' + p.n + ' nights × ' + money(NIGHTLY) + '/night</span><span>' + money(p.n * NIGHTLY) + '</span></div>' +
      '<div class="rr"><span class="rk">Cleaning fee</span><span>' + money(p.cleaning) + '</span></div>' +
      (p.petFee > 0 ? '<div class="rr"><span class="rk">Pet fee · ' + pets + ' × ' + money(PET_FEE) + '</span><span>' + money(p.petFee) + '</span></div>' : '') +
      '<div class="rr total"><span>Full stay total</span><span>' + money(p.fullTotal) + '</span></div>' +
      sched +
      '<a class="co-change" href="index.html#book-stay">← Switch to a different home</a>' +
    '</div>';
  }

  /* ---------- pet detail fields ---------- */
  function petFieldsHtml() {
    if (!(U.petsOk && pets > 0)) return '';
    var h = '<div class="co-block"><div class="bk-sec">Pet details</div><div class="bk-grid">';
    for (var i = 1; i <= pets; i++) {
      h += '<div class="bk-inp"><label>Pet ' + i + ' breed</label><input id="bkPetBreed' + i + '" type="text" placeholder="e.g. Labrador" /></div>' +
        '<div class="bk-inp"><label>Pet ' + i + ' weight (lbs)</label><input id="bkPetWeight' + i + '" type="text" inputmode="numeric" placeholder="e.g. 35" /><p class="bk-pet-err" id="bkPetErr' + i + '" hidden>! Pet ' + i + '’s weight exceeds 50 lbs and is not allowed.</p></div>';
    }
    h += '</div></div>';
    return h;
  }

  /* ---------- render ---------- */
  mount.innerHTML =
    '<div class="co-grid">' +
      '<div class="co-form">' +
        '<div class="co-block">' +
          '<div class="bk-sec">Your stay</div>' +
          '<div class="bk-grid">' +
            '<div class="bk-inp full"><label>Purpose of your stay</label><select id="bkPurpose"><option value="" selected disabled>Select a purpose…</option><option>Relocation / moving</option><option>Work or business trip</option><option>Travel nursing / medical</option><option>Home remodel / temporary housing</option><option>Vacation / leisure</option><option>Family visit</option><option>Other</option></select></div>' +
            '<div class="bk-inp full" id="bkPurposeOtherWrap" hidden><label>Tell us a bit more</label><input id="bkPurposeOther" type="text" placeholder="Briefly describe the purpose of your stay" /></div>' +
          '</div>' +
        '</div>' +
        petFieldsHtml() +
        '<div class="co-block">' +
          '<div class="bk-sec">Guest details</div>' +
          '<div class="bk-grid">' +
            '<div class="bk-inp full"><label>Full name</label><input id="bkName" type="text" placeholder="Jane Guest" autocomplete="name" /></div>' +
            '<div class="bk-inp"><label>Email</label><input id="bkEmail" type="email" placeholder="you@email.com" autocomplete="email" /></div>' +
            '<div class="bk-inp"><label>Phone</label><input id="bkPhone" type="tel" placeholder="(512) 555-0148" autocomplete="tel" /></div>' +
          '</div>' +
        '</div>' +
        '<div class="co-block">' +
          '<div class="bk-sec">Payment</div>' +
          '<div class="bk-grid">' +
            '<div class="bk-inp full"><label>Card number</label><input id="bkCard" type="text" inputmode="numeric" placeholder="1234 5678 9012 3456" autocomplete="cc-number" /></div>' +
            '<div class="bk-inp"><label>Expiry</label><input id="bkExp" type="text" placeholder="MM / YY" autocomplete="cc-exp" /></div>' +
            '<div class="bk-inp"><label>CVC</label><input id="bkCvc" type="text" inputmode="numeric" placeholder="123" autocomplete="cc-csc" /></div>' +
            '<div class="bk-inp"><label>Billing ZIP</label><input id="bkZip" type="text" inputmode="numeric" placeholder="78745" autocomplete="postal-code" /></div>' +
          '</div>' +
        '</div>' +
        '<div class="bk-pay-note">Prototype — no real card is charged.</div>' +
        '<label class="bk-agree" for="bkAgree"><input type="checkbox" id="bkAgree" /><span>By making this reservation, I confirm I have read and agree to the <a href="terms.html" target="_blank">Booking Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</span></label>' +
        '<button class="btn accent block" id="bkPay">Pay ' + money(p.dueToday) + ' &amp; confirm</button>' +
      '</div>' +
      '<div class="co-recap-wrap" id="coRecapWrap">' + recapHtml() + '</div>' +
    '</div>';

  /* ---------- refs + behaviour ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var bkPurpose = $('bkPurpose');
  var bkPurposeOtherWrap = $('bkPurposeOtherWrap');
  var bkPurposeOther = $('bkPurposeOther');
  var bkAgree = $('bkAgree');
  var payInputs = ['bkName','bkEmail','bkPhone','bkCard','bkExp','bkCvc','bkZip'].map($);

  // wire the editable date picker + dismiss-on-outside-click + live sync
  wireDates();
  document.addEventListener('click', function (e) { var w = gid('coRecapWrap'); if (calOpen && w && !w.contains(e.target)) closeCal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && calOpen) closeCal(); });
  (function () {
    var API_BASE = 'https://rise-eta-three.vercel.app';
    var up = (U.code || '').replace(/^Unit\s*/i, '').toUpperCase();
    if (!up) return;
    fetch(API_BASE + '/api/availability?unit=' + encodeURIComponent(up))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (!data || !data.booked) return; U.booked = data.booked.map(function (b) { return { from: b.from, to: b.to, exclusiveEnd: true }; }); rebuildRanges(); if (calOpen) renderCalPop(); })
      .catch(function () {});
  })();

  bkPurpose.addEventListener('change', function () {
    bkPurposeOtherWrap.hidden = bkPurpose.value !== 'Other';
    bkPurpose.classList.remove('bad');
  });
  bkPurposeOther.addEventListener('input', function () { bkPurposeOther.classList.remove('bad'); });
  bkAgree.addEventListener('change', function () { bkAgree.classList.remove('bad'); });
  payInputs.forEach(function (el) { el.addEventListener('input', function () { el.classList.remove('bad'); }); });

  document.querySelectorAll('[id^="bkPetWeight"], [id^="bkPetBreed"]').forEach(function (el) {
    el.addEventListener('input', function () {
      el.classList.remove('bad');
      if (/Weight/.test(el.id)) {
        var n = el.id.replace('bkPetWeight', '');
        var err = $('bkPetErr' + n);
        var w = parseFloat(el.value);
        var over = !isNaN(w) && w > 50;
        if (err) err.hidden = !over;
        if (over) el.classList.add('bad');
      }
    });
  });

  $('bkPay').addEventListener('click', function () {
    var ok = true, firstBad = null;

    var purposeBad = !bkPurpose.value;
    bkPurpose.classList.toggle('bad', purposeBad);
    if (purposeBad) { ok = false; if (!firstBad) firstBad = bkPurpose; }
    if (!bkPurposeOtherWrap.hidden) {
      var otherBad = !bkPurposeOther.value.trim();
      bkPurposeOther.classList.toggle('bad', otherBad);
      if (otherBad) { ok = false; if (!firstBad) firstBad = bkPurposeOther; }
    }

    var petInfo = [];
    document.querySelectorAll('#coMount [id^="bkPetBreed"], #coMount [id^="bkPetWeight"]').forEach(function (el) {
      var bad = !el.value.trim();
      if (!bad && /Weight/.test(el.id)) {
        var w = parseFloat(el.value);
        bad = isNaN(w) || w <= 0 || w > 50;
        var nn = el.id.replace('bkPetWeight', '');
        var err = $('bkPetErr' + nn);
        if (err) err.hidden = !(!isNaN(w) && w > 50);
      }
      el.classList.toggle('bad', bad);
      if (bad) { ok = false; if (!firstBad) firstBad = el; }
    });

    var email = $('bkEmail');
    payInputs.forEach(function (el) {
      var bad = !el.value.trim();
      if (el === email) bad = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value);
      if (el.id === 'bkCard') bad = el.value.replace(/\D/g, '').length < 12;
      el.classList.toggle('bad', bad);
      if (bad && !firstBad) firstBad = el;
      if (bad) ok = false;
    });

    if (!ok) { firstBad.focus(); return; }

    var agreeBad = !bkAgree.checked;
    bkAgree.classList.toggle('bad', agreeBad);
    if (agreeBad) { bkAgree.focus(); return; }

    // collect pet details
    if (U.petsOk && pets > 0) {
      for (var i = 1; i <= pets; i++) {
        petInfo.push({ breed: ($('bkPetBreed' + i).value || '').trim(), weight: ($('bkPetWeight' + i).value || '').trim() });
      }
    }

    var name = $('bkName').value.trim();
    var record = {
      code: 'RISE-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      unit: U.code,
      unitLabel: unitLabel,
      unitFile: U.code.toLowerCase().replace(/ /g, '-') + '.html',
      checkIn: CORE.key(checkIn),
      checkOut: CORE.key(checkOut),
      nights: p.n,
      guests: guests,
      pets: pets,
      petInfo: petInfo,
      purpose: bkPurpose.value === 'Other' ? bkPurposeOther.value.trim() : bkPurpose.value,
      name: name,
      email: email.value.trim(),
      phone: $('bkPhone').value.trim(),
      dueToday: p.dueToday,
      fullTotal: p.fullTotal,
      paymentDates: p.paymentDates.map(function (pd) { return { date: CORE.key(pd.date), amount: pd.amount }; }),
    };
    try { sessionStorage.setItem('rise_booking', JSON.stringify(record)); } catch (e) {}
    window.location.href = 'confirmation.html';
  });
})();
