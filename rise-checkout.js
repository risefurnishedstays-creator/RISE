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

  /* ---------- recap markup ---------- */
  function recapHtml() {
    var sched = '<div class="bk-sched-head">Payment schedule</div>' +
      '<div class="rr due-today"><span class="rk">Due today (nights 1–30 + fees)</span><span>' + money(p.dueToday) + '</span></div>';
    p.paymentDates.forEach(function (pd) {
      sched += '<div class="rr muted"><span class="rk">Due ' + fmtLong(pd.date) + '</span><span>' + money(pd.amount) + '</span></div>';
    });
    return '<div class="bk-recap box">' +
      '<div class="bk-recap-title">' + U.code + ' · ' + unitLabel + '</div>' +
      '<div class="bk-recap-sub">' + fmtLong(checkIn) + ' → ' + fmtLong(checkOut) + ' · ' + p.n + ' nights</div>' +
      '<div class="rr"><span class="rk">Guests</span><span>' + guests + (guests === 1 ? ' guest' : ' guests') + '</span></div>' +
      (U.petsOk ? '<div class="rr"><span class="rk">Pets</span><span>' + pets + (pets === 1 ? ' pet' : ' pets') + '</span></div>' : '') +
      '<div class="rr sep"><span class="rk">' + p.n + ' nights × ' + money(NIGHTLY) + '/night</span><span>' + money(p.n * NIGHTLY) + '</span></div>' +
      '<div class="rr"><span class="rk">Cleaning fee</span><span>' + money(p.cleaning) + '</span></div>' +
      (p.petFee > 0 ? '<div class="rr"><span class="rk">Pet fee · ' + pets + ' × ' + money(PET_FEE) + '</span><span>' + money(p.petFee) + '</span></div>' : '') +
      '<div class="rr"><span class="rk">Security deposit (refundable)</span><span>' + money(p.deposit) + '</span></div>' +
      '<div class="rr total"><span>Full stay total</span><span>' + money(p.fullTotal) + '</span></div>' +
      sched +
      '<a class="co-change" href="' + U.code.toLowerCase().replace(/ /g, '-') + '.html#book-stay">← Change dates or home</a>' +
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
      '<div class="co-recap-wrap">' + recapHtml() + '</div>' +
    '</div>';

  /* ---------- refs + behaviour ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var bkPurpose = $('bkPurpose');
  var bkPurposeOtherWrap = $('bkPurposeOtherWrap');
  var bkPurposeOther = $('bkPurposeOther');
  var bkAgree = $('bkAgree');
  var payInputs = ['bkName','bkEmail','bkPhone','bkCard','bkExp','bkCvc','bkZip'].map($);

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
