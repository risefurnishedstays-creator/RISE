/* ============================================================
   RISE Furnished Stays — Confirmation page
   Renders the booking confirmation from the record the
   Checkout page stashed in sessionStorage ('rise_booking').
   Depends on rise-booking-core.js.
   ============================================================ */
(function () {
  var CORE = window.RISE_CORE;
  var mount = document.getElementById('cfMount');
  if (!CORE || !mount) return;
  var money = CORE.money, fmtLong = CORE.fmtLong, parseKey = CORE.parseKey;

  var css = `
  .cf-card { max-width: 640px; margin: 0 auto; padding: 40px 40px 36px; box-shadow: 6px 7px 0 var(--ink); text-align: center; }
  .cf-badge { width: 72px; height: 72px; margin: 0 auto 20px; border: 2.5px solid var(--line); border-radius: 50%; background: var(--green-soft); color: var(--green); display: flex; align-items: center; justify-content: center; font-size: 36px; box-shadow: 3px 3px 0 var(--ink); }
  .cf-kick { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .cf-card h1 { font-size: clamp(30px, 4vw, 42px); line-height: 1.04; margin-bottom: 14px; }
  .cf-lede { color: var(--ink-soft); font-size: 16px; line-height: 1.6; margin: 0 auto 24px; max-width: 46ch; }
  .cf-lede b { color: var(--ink); }
  .cf-code { display: inline-flex; flex-direction: column; gap: 4px; align-items: center; font-family: ui-monospace, monospace; border: 2.5px solid var(--line); border-radius: 12px; padding: 12px 24px; margin-bottom: 28px; background: var(--accent-soft); box-shadow: 3px 3px 0 var(--ink); }
  .cf-code .cl { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-soft); }
  .cf-code .cv { font-size: 19px; font-weight: 700; letter-spacing: .14em; }

  .cf-recap { text-align: left; border: 2.5px solid var(--line); border-radius: 14px; padding: 6px 22px 16px; margin-bottom: 28px; }
  .cf-recap .rr { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; font-size: 14.5px; padding: 11px 0; border-bottom: 2px dashed color-mix(in oklab, var(--ink) 16%, transparent); }
  .cf-recap .rr:last-child { border-bottom: none; }
  .cf-recap .rr .rk { color: var(--ink-soft); }
  .cf-recap .rr .rv { font-weight: 600; text-align: right; }
  .cf-recap .rr.total .rv, .cf-recap .rr.total .rk { font-weight: 700; font-size: 16px; }

  .cf-sched { text-align: left; margin-bottom: 28px; }
  .cf-sched-head { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); margin: 0 0 10px; }
  .cf-sched .sr { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13.5px; padding: 6px 0; color: var(--ink-soft); }
  .cf-sched .sr.due { color: var(--ink); font-weight: 700; }

  .cf-next { text-align: left; background: var(--accent-soft); border: 2.5px solid var(--line); border-radius: 14px; box-shadow: 4px 4px 0 var(--ink); padding: 20px 24px; margin-bottom: 28px; }
  .cf-next-head { font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .cf-next ul { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
  .cf-next li { position: relative; padding-left: 26px; font-size: 14.5px; line-height: 1.5; }
  .cf-next li::before { content: "→"; position: absolute; left: 0; top: 0; color: var(--accent); font-weight: 700; }

  .cf-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

  .cf-empty { max-width: 520px; margin: 0 auto; text-align: center; padding: 44px 36px; box-shadow: 6px 7px 0 var(--ink); }
  .cf-empty .ce-badge { width: 64px; height: 64px; margin: 0 auto 18px; border: 2.5px solid var(--line); border-radius: 50%; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 3px 3px 0 var(--ink); }
  .cf-empty h2 { font-size: 27px; margin-bottom: 12px; }
  .cf-empty p { color: var(--ink-soft); font-size: 15.5px; line-height: 1.55; margin: 0 auto 22px; max-width: 40ch; }

  @media (max-width: 560px) { .cf-card { padding: 30px 22px 28px; } }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var rec = null;
  try { rec = JSON.parse(sessionStorage.getItem('rise_booking') || 'null'); } catch (e) { rec = null; }

  if (!rec || !rec.code) {
    mount.innerHTML =
      '<div class="cf-empty box">' +
        '<div class="ce-badge">🔎</div>' +
        '<h2>No booking to show</h2>' +
        '<p>We couldn’t find a recent booking on this device. Start a reservation to see your confirmation here.</p>' +
        '<a class="btn accent" href="index.html#book-stay">Browse homes &amp; dates</a>' +
      '</div>';
    return;
  }

  var checkIn = parseKey(rec.checkIn), checkOut = parseKey(rec.checkOut);
  var first = (rec.name || '').trim().split(' ')[0];

  var sched = '';
  if (rec.paymentDates && rec.paymentDates.length) {
    sched += '<div class="cf-sched"><div class="cf-sched-head">Payment schedule</div>';
    sched += '<div class="sr due"><span>Charged today</span><span>' + money(rec.dueToday) + '</span></div>';
    rec.paymentDates.forEach(function (pd) {
      sched += '<div class="sr"><span>Due ' + fmtLong(parseKey(pd.date)) + '</span><span>' + money(pd.amount) + '</span></div>';
    });
    sched += '</div>';
  }

  mount.innerHTML =
    '<div class="cf-card box">' +
      '<div class="cf-badge">✓</div>' +
      '<div class="cf-kick">Booking confirmed</div>' +
      '<h1>You’re all set' + (first ? ', ' + first : '') + '!</h1>' +
      '<p class="cf-lede">Your stay at <b>' + rec.unit + ' · ' + rec.unitLabel + '</b> is reserved. A confirmation and self check-in details are on the way to <b>' + (rec.email || 'your email') + '</b>.</p>' +
      '<div class="cf-code"><span class="cl">Confirmation code</span><span class="cv">' + rec.code + '</span></div>' +
      '<div class="cf-recap">' +
        '<div class="rr"><span class="rk">Home</span><span class="rv">' + rec.unit + ' · ' + rec.unitLabel + '</span></div>' +
        '<div class="rr"><span class="rk">Dates</span><span class="rv">' + fmtLong(checkIn) + ' → ' + fmtLong(checkOut) + '</span></div>' +
        '<div class="rr"><span class="rk">Length of stay</span><span class="rv">' + rec.nights + ' nights</span></div>' +
        '<div class="rr"><span class="rk">Guests</span><span class="rv">' + rec.guests + (rec.guests === 1 ? ' guest' : ' guests') + (rec.pets ? ' · ' + rec.pets + (rec.pets === 1 ? ' pet' : ' pets') : '') + '</span></div>' +
        '<div class="rr total"><span class="rk">Charged today</span><span class="rv">' + money(rec.dueToday) + '</span></div>' +
      '</div>' +
      sched +
      '<div class="cf-next">' +
        '<div class="cf-next-head">What happens next</div>' +
        '<ul>' +
          '<li>A confirmation email with your receipt is on its way.</li>' +
          '<li>We’ll send the exact address and check-in details closer to your arrival.</li>' +
          '<li>You’ll receive a separate email with the lease agreement to review and sign.</li>' +
          '<li>Questions before then? Reach out via our <a href="contact.html" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">contact page</a> or at <a href="mailto:risefurnishedstays@gmail.com" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">risefurnishedstays@gmail.com</a>.</li>' +
        '</ul>' +
      '</div>' +
      '<div class="cf-actions">' +
        '<a class="btn accent" href="index.html">Back to home</a>' +
        '<a class="btn ghost" href="austin-guidebook.html">Explore the Austin guidebook</a>' +
      '</div>' +
    '</div>';
})();
