/* ============================================================
   RISE Furnished Stays — Confirmation page
   Renders the booking confirmation by fetching the real record
   from storage via session_id in the URL (set by Stripe's
   redirect after checkout). This reflects the same data the
   webhook saved -- not a local-only client guess -- so it still
   works in a new tab, a different device, or after sessionStorage
   has been cleared.
   Depends on rise-booking-core.js.
   ============================================================ */
(function () {
  var CORE = window.RISE_CORE;
  var mount = document.getElementById('cfMount');
  if (!CORE || !mount) return;
  var money = CORE.money, fmtLong = CORE.fmtLong, parseKey = CORE.parseKey;

  var UNIT_LABELS = {
    A: 'Cozy Home in South Austin',
    B: 'Entire Home in South Austin',
    D: 'Private Home in South Austin',
  };

  var css = `
  .cf-card { max-width: 640px; margin: 0 auto; padding: 40px 40px 36px; box-shadow: 6px 7px 0 var(--ink); text-align: center; }
  .cf-badge { width: 72px; height: 72px; margin: 0 auto 20px; border: 2.5px solid var(--line); border-radius: 50%; background: var(--green-soft); color: var(--green); display: flex; align-items: center; justify-content: center; font-size: 36px; box-shadow: 3px 3px 0 var(--ink); }

  /* One consistent small-label treatment for every eyebrow/header on this
     page (Payment successful, Confirmation code, the Action Needed
     heading) -- same family as the site's other section eyebrows, just
     sized to actually be readable. */
  .cf-eyebrow { font-family: ui-monospace, monospace; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
  .cf-kick { color: var(--accent); margin-bottom: 10px; }
  .cf-card h1 { font-size: clamp(30px, 4vw, 42px); line-height: 1.04; margin-bottom: 14px; }

  /* One consistent body size (15.5px) for every paragraph/row of real
     content on the page -- the lede, the recap rows, and the next-steps
     list all read at the same size now instead of five different ones. */
  .cf-lede { color: var(--ink-soft); font-size: 15.5px; line-height: 1.6; margin: 0 auto 24px; max-width: 46ch; }
  .cf-lede b { color: var(--ink); }
  .cf-code { display: inline-flex; flex-direction: column; gap: 4px; align-items: center; border: 2.5px solid var(--line); border-radius: 12px; padding: 12px 24px; margin-bottom: 28px; background: var(--accent-soft); box-shadow: 3px 3px 0 var(--ink); }
  .cf-code .cl { color: var(--ink-soft); }
  .cf-code .cv { font-family: ui-monospace, monospace; font-size: 17px; font-weight: 700; letter-spacing: .1em; margin-top: 2px; }

  .cf-recap { text-align: left; border: 2.5px solid var(--line); border-radius: 14px; padding: 6px 22px 16px; margin-bottom: 28px; }
  .cf-recap .rr { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; font-size: 15.5px; padding: 11px 0; border-bottom: 2px dashed color-mix(in oklab, var(--ink) 16%, transparent); }
  .cf-recap .rr:last-child { border-bottom: none; }
  .cf-recap .rr .rk { color: var(--ink-soft); }
  .cf-recap .rr .rv { font-weight: 600; text-align: right; }
  .cf-recap .rr.total .rv, .cf-recap .rr.total .rk { font-weight: 700; }

  .cf-sched { text-align: left; margin-bottom: 28px; }
  .cf-sched-head { color: var(--ink-soft); margin: 0 0 10px; }
  .cf-sched .sr { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 15.5px; padding: 6px 0; color: var(--ink-soft); }
  .cf-sched .sr.due { color: var(--ink); font-weight: 700; }

  /* Action Needed box -- left as-is per explicit instruction, not touched
     by the type-scale cleanup above. */
  .cf-next { text-align: left; background: var(--accent-soft); border: 2.5px solid var(--line); border-radius: 14px; box-shadow: 4px 4px 0 var(--ink); padding: 20px 24px; margin-bottom: 28px; }
  .cf-next-head { font-family: ui-monospace, monospace; font-size: 18px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .cf-next ul { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
  .cf-next li { position: relative; padding-left: 26px; font-size: 14.5px; line-height: 1.5; }
  .cf-next li::before { content: "→"; position: absolute; left: 0; top: 0; color: var(--accent); font-weight: 700; }

  .cf-actions { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

  .cf-empty { max-width: 520px; margin: 0 auto; text-align: center; padding: 44px 36px; box-shadow: 6px 7px 0 var(--ink); }
  .cf-empty .ce-badge { width: 64px; height: 64px; margin: 0 auto 18px; border: 2.5px solid var(--line); border-radius: 50%; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 3px 3px 0 var(--ink); }
  .cf-empty h2 { font-size: 27px; margin-bottom: 12px; }
  .cf-empty p { color: var(--ink-soft); font-size: 15.5px; line-height: 1.55; margin: 0 auto 22px; max-width: 40ch; }

  .cf-loading { max-width: 520px; margin: 0 auto; text-align: center; padding: 60px 36px; color: var(--ink-soft); font-size: 15.5px; }

  @media (max-width: 560px) { .cf-card { padding: 30px 22px 28px; } }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function renderEmpty() {
    mount.innerHTML =
      '<div class="cf-empty box">' +
        '<div class="ce-badge">🔎</div>' +
        '<h2>No booking to show</h2>' +
        '<p>We couldn’t find a recent booking to display. If you just completed checkout, check your email for confirmation -- it may take a few seconds to appear here.</p>' +
        '<a class="btn accent" href="index.html#book-stay">Browse homes &amp; dates</a>' +
      '</div>';
  }

  function renderLoading() {
    mount.innerHTML = '<div class="cf-loading box">Loading your confirmation…</div>';
  }

  function renderBooking(rec) {
    var checkIn = parseKey(rec.checkIn), checkOut = parseKey(rec.checkOut);
    var first = (rec.guestName || '').trim().split(' ')[0];
    var unitLabel = UNIT_LABELS[rec.unitCode] || '';

    // dueToday/paymentDates/guests/pets aren't stored on the booking record
    // today (saveBooking() only persists the fields cancel-booking.js and
    // the iCal feed need) -- so this recap shows what's actually verifiable
    // from storage rather than guessing at amounts. The full payment/guest
    // breakdown still arrives via email, which is built from the live
    // Stripe session data at the time of booking.
    var sched = '';

    // Figure out which of the 4 real states this booking is actually in,
    // rather than always showing the same "send your ID" message
    // regardless of status -- that was a real bug (this file predates the
    // hold-then-capture and ID-upload-page work and was never updated to
    // match). Mirrors the same flags lease.html / id-upload.html /
    // sign-lease.js already check (leaseSignedAt, govIdUploadedAt,
    // booking.status), so this page's framing always matches reality
    // instead of drifting out of sync with the rest of the flow again.
    var isComplete = !!rec.govIdUploadedAt;
    var leaseSigned = !!rec.leaseSignedAt;
    var isPendingCapture = rec.status === 'pending-capture';

    var kicker, heading, lede, nextItems;

    if (isComplete) {
      kicker = 'Booking confirmed';
      heading = 'You\u2019re all set' + (first ? ', ' + first : '') + '!';
      lede = 'Your reservation for <b>' + rec.unitCode + (unitLabel ? ' \u00b7 ' + unitLabel : '') + '</b> is fully confirmed -- payment received, lease signed, and ID verified.' +
        (rec.bookingCompleteEmailSent ? ' A confirmation email with your full payment breakdown and receipt has been sent to <b>' + (rec.guestEmail || 'your email') + '</b>.' : ' A confirmation email with your full payment breakdown and receipt is on its way to <b>' + (rec.guestEmail || 'your email') + '</b>.');
      nextItems = [
        '<b>No further action is needed from you right now.</b>',
        'We\u2019ll email the exact address, check-in details, wifi info, and house rules about a week before your arrival.',
        'Questions before then? Reach out via our <a href="contact.html" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">contact page</a> or at risefurnishedstays@gmail.com.',
      ];
    } else if (leaseSigned) {
      kicker = isPendingCapture ? 'Lease signed' : 'Payment successful';
      heading = 'Upload your ID to finish booking' + (first ? ', ' + first : '');
      lede = 'Your lease for <b>' + rec.unitCode + (unitLabel ? ' \u00b7 ' + unitLabel : '') + '</b> is signed' +
        (isPendingCapture ? ', and your card is on hold' : ' and your payment is confirmed') +
        '. Your booking isn\u2019t complete yet -- you\u2019ll need to upload a photo of your government-issued ID before your stay is confirmed.';
      var idUploadUrl = 'id-upload.html?confirmation_code=' + encodeURIComponent(rec.confirmationCode);
      nextItems = [
        '<b>Upload your ID <a href="' + idUploadUrl + '" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">on this page</a>, or email it to risefurnishedstays@gmail.com for verification.</b>',
        'A confirmation email with your full payment breakdown and receipt is on its way.',
        'We\u2019ll send the exact address and check-in details closer to your arrival.',
        'Questions before then? Reach out via our <a href="contact.html" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">contact page</a> or at risefurnishedstays@gmail.com.',
      ];
    } else {
      kicker = isPendingCapture ? 'Reservation held' : 'Payment successful';
      heading = 'Sign your lease to finish booking' + (first ? ', ' + first : '');
      lede = isPendingCapture
        ? 'Your dates for <b>' + rec.unitCode + (unitLabel ? ' \u00b7 ' + unitLabel : '') + '</b> are reserved, and your card is on hold but has not been charged yet. Your booking isn\u2019t complete yet -- you\u2019ll need to sign your lease and upload a photo ID before your stay is confirmed.'
        : 'Your payment for <b>' + rec.unitCode + (unitLabel ? ' \u00b7 ' + unitLabel : '') + '</b> went through. Your booking isn\u2019t complete yet -- you\u2019ll need to sign your lease and upload a photo ID before your stay is confirmed.';
      var leaseUrl = 'lease.html?confirmation_code=' + encodeURIComponent(rec.confirmationCode);
      nextItems = [
        '<b>Sign your lease <a href="' + leaseUrl + '" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">on this page</a>, then upload a photo ID.</b>',
        'A confirmation email with next steps is on its way to <b>' + (rec.guestEmail || 'your email') + '</b>.',
        'We\u2019ll send the exact address and check-in details closer to your arrival.',
        'Questions before then? Reach out via our <a href="contact.html" style="color:var(--accent);text-decoration:none;border-bottom:1.5px solid color-mix(in oklab,var(--accent) 45%,transparent);">contact page</a> or at risefurnishedstays@gmail.com.',
      ];
    }

    mount.innerHTML =
      '<div class="cf-card box">' +
        '<div class="cf-badge">✓</div>' +
        '<div class="cf-eyebrow cf-kick">' + kicker + '</div>' +
        '<h1>' + heading + '</h1>' +
        '<p class="cf-lede">' + lede + '</p>' +
        '<div class="cf-code"><span class="cf-eyebrow cl">Confirmation code</span><span class="cv">' + rec.confirmationCode + '</span></div>' +
        '<div class="cf-recap">' +
          '<div class="rr"><span class="rk">Home</span><span class="rv">' + rec.unitCode + (unitLabel ? ' · ' + unitLabel : '') + '</span></div>' +
          '<div class="rr"><span class="rk">Dates</span><span class="rv">' + fmtLong(checkIn) + ' → ' + fmtLong(checkOut) + '</span></div>' +
          '<div class="rr total"><span class="rk">Length of stay</span><span class="rv">' + rec.nights + ' nights</span></div>' +
        '</div>' +
        sched +
        '<div class="cf-next">' +
          '<div class="cf-next-head">' + (isComplete ? 'You\u2019re all set' : 'Action needed to complete your booking') + '</div>' +
          '<ul>' +
            nextItems.map(function (item) { return '<li>' + item + '</li>'; }).join('') +
          '</ul>' +
        '</div>' +
        '<div class="cf-actions">' +
          '<a class="btn accent" href="index.html">Back to home</a>' +
          '<a class="btn ghost" href="austin-guidebook.html">Explore the Austin guidebook</a>' +
        '</div>' +
      '</div>';
  }

  // ---- Fetch the real booking, with a short retry for the webhook race ----
  // Stripe redirects the browser here the instant payment succeeds, but the
  // webhook that writes the booking to storage fires asynchronously and can
  // lag by a second or two. Retry a few times before giving up.
  //
  // IMPORTANT: this page is served by GitHub Pages (www.risefurnishedstays.com),
  // but /api/* routes live on Vercel, a separate origin. A relative fetch('/api/...')
  // would resolve against GitHub Pages and 404 -- same reason checkout.html
  // hardcodes API_BASE instead of using a relative path.
  var API_BASE = 'https://rise-eta-three.vercel.app'; // CHANGE THIS if your Vercel URL ever changes

  function fetchBooking(linkQuery, attempt) {
    attempt = attempt || 1;
    var MAX_ATTEMPTS = 5;
    var RETRY_DELAY_MS = 1200;

    fetch(API_BASE + '/api/booking-by-session?' + linkQuery)
      .then(function (res) {
        if (res.status === 404 && attempt < MAX_ATTEMPTS) {
          setTimeout(function () { fetchBooking(linkQuery, attempt + 1); }, RETRY_DELAY_MS);
          return null;
        }
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result) return; // mid-retry
        if (!result.ok || !result.data || !result.data.booking) {
          renderEmpty();
          return;
        }
        renderBooking(result.data.booking);
      })
      .catch(function () {
        renderEmpty();
      });
  }

  var params = new URLSearchParams(window.location.search);
  var sessionId = params.get('session_id');
  var confirmationCodeParam = params.get('confirmation_code');

  // Reminder emails sent days after checkout link with ?confirmation_code=
  // instead of ?session_id=, since the original Stripe session id isn't
  // stored anywhere retrievable that long after checkout -- see
  // api/booking-by-session.js's header comment for why. Whichever the
  // guest arrived with is forwarded as-is.
  var linkQuery = sessionId
    ? 'session_id=' + encodeURIComponent(sessionId)
    : confirmationCodeParam
      ? 'confirmation_code=' + encodeURIComponent(confirmationCodeParam)
      : null;

  if (!linkQuery) {
    renderEmpty();
    return;
  }

  renderLoading();
  fetchBooking(linkQuery);
})();
