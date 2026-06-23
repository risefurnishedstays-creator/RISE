/* RISE — shared mobile nav drawer + responsive polish.
   Build a working slide-in menu from the existing desktop nav,
   wire the burger button, and inject mobile CSS refinements.
   Drop <script src="rise-nav.js"></script> at the end of any page. */
(function () {
  'use strict';

  /* ---------- responsive CSS (appended after page styles so it wins) ---------- */
  var css = `
  /* logo sizing — single control point for the whole site (desktop + mobile).
     Injected after page styles so these win over per-page rules. */
  .logo-img { height: 88px; }
  header.nav .nav-inner { height: 100px; }

  /* fluid base sizing on phones */
  @media (max-width: 640px) {
    body { font-size: 16px; }
    .wrap { padding-left: 18px; padding-right: 18px; }
    .logo-img { height: 64px; }
    header.nav .nav-inner { height: 78px; }
    .nav-cta { gap: 8px; }
  }
  @media (max-width: 400px) {
    .wrap { padding-left: 14px; padding-right: 14px; }
    .logo-img { height: 56px; }
  }

  /* unit spec strip: replace border separators with real "|" pipes, and wrap on mobile */
  .specs span { border-left: none !important; }
  .specs span:not(:first-child)::before {
    content: "|";
    margin-right: 16px;
    font-weight: 400;
    opacity: .4;
    align-self: center;
  }
  @media (max-width: 720px) {
    .specs { flex-wrap: wrap !important; justify-content: center !important; row-gap: 2px; }
    .specs span { padding: 7px 12px !important; }
    .specs span:not(:first-child)::before { margin-right: 10px; }
  }

  /* hero image shorter on phones */
  @media (max-width: 640px) {
    .hero-photo img { height: 280px !important; }
    .hero { padding-top: 30px !important; }
  }

  /* gallery carousel arrows a touch smaller on phones */
  @media (max-width: 480px) {
    .car-btn { width: 40px; height: 40px; font-size: 19px; }
    .car-btn.prev { left: 8px; } .car-btn.next { right: 8px; }
  }

  /* keep the burger visually clean */
  .burger { font-size: 20px; padding: 8px 14px; line-height: 1; }

  /* unit "About this home": make the first (.lede) paragraph match the rest */
  .d-main #overview .lede { font-size: inherit !important; }

  /* ---- prevent horizontal overflow (the #1 cause of "zoomed out" mobile) ---- */
  html, body { overflow-x: clip; max-width: 100%; }
  img, svg, video { max-width: 100%; }

  /* hero headline: fixed 104px overflowed phones — make it fluid, desktop unchanged */
  .hero h1 { font-size: clamp(44px, 13vw, 104px) !important; overflow-wrap: anywhere; }
  /* hero subtext: track the headline — start shrinking around 800px, like the h1 */
  .hero p.sub { font-size: clamp(14px, 2.4vw, 19px) !important; }
  /* let the subtext run full width once the hero stacks (≤900px), instead of 42ch */
  @media (max-width: 900px) { .hero p.sub { max-width: none !important; } }

  /* Austin Guidebook header: same fluid treatment as the home hero */
  .gb-intro h1 { font-size: clamp(40px, 9vw, 104px) !important; overflow-wrap: anywhere; }
  .gb-intro p { font-size: clamp(14px, 2.4vw, 18px) !important; }
  @media (max-width: 900px) { .gb-intro p { max-width: none !important; } }

  /* two-column booking / calendar / checkout grids must stack on small screens */
  @media (max-width: 900px) {
    .cal-wrap { grid-template-columns: 1fr !important; max-width: 100% !important; }
    .co-grid { grid-template-columns: 1fr !important; }
    .co-recap-wrap { position: static !important; top: auto !important; }
    .cal-side { width: 100% !important; }
  }

  /* ===== mobile drawer ===== */
  .rmnav-root { position: fixed; inset: 0; z-index: 200; display: none; }
  .rmnav-root.open { display: block; }
  .rmnav-backdrop {
    position: absolute; inset: 0;
    background: color-mix(in oklab, var(--ink, #2b2926) 46%, transparent);
    opacity: 0; transition: opacity .22s ease;
  }
  .rmnav-root.open .rmnav-backdrop { opacity: 1; }
  .rmnav-panel {
    position: absolute; top: 0; right: 0; height: 100%;
    width: min(82vw, 340px);
    background: var(--paper, #f4f1ea);
    border-left: 2.5px solid var(--line, #2b2926);
    box-shadow: -6px 0 0 color-mix(in oklab, var(--ink, #2b2926) 12%, transparent);
    padding: 20px 20px 30px;
    display: flex; flex-direction: column; gap: 4px;
    overflow-y: auto;
    transform: translateX(102%);
    transition: transform .26s cubic-bezier(.4,0,.2,1);
  }
  .rmnav-root.open .rmnav-panel { transform: translateX(0); }
  .rmnav-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px; padding-bottom: 14px;
    border-bottom: 2px dashed color-mix(in oklab, var(--ink, #2b2926) 22%, transparent);
  }
  .rmnav-head .rmnav-mark {
    font-family: var(--font-head, Georgia, serif); font-weight: 700; font-size: 19px;
    letter-spacing: .5px; color: var(--ink, #2b2926);
  }
  .rmnav-head .rmnav-mark b { color: var(--accent, #b06a45); }
  .rmnav-close {
    width: 40px; height: 40px; flex: none; cursor: pointer;
    border: 2.5px solid var(--line, #2b2926); border-radius: 10px;
    background: var(--paper, #f4f1ea); color: var(--ink, #2b2926);
    font-size: 20px; line-height: 1; box-shadow: 2px 2px 0 var(--ink, #2b2926);
    display: flex; align-items: center; justify-content: center;
  }
  .rmnav-close:active { transform: translate(2px,2px); box-shadow: none; }
  .rmnav-link {
    font-family: var(--font-body, system-ui, sans-serif);
    font-size: 17px; font-weight: 600; color: var(--ink, #2b2926);
    text-decoration: none; padding: 13px 12px; border-radius: 10px;
    border: 2px solid transparent;
  }
  .rmnav-link.current { border-color: var(--line, #2b2926); background: var(--accent, #b06a45); color: #fff; }
  .rmnav-link:active { background: var(--accent-soft, rgba(176,106,69,.16)); }
  .rmnav-group-label {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--ink-soft, #6f6a63);
    padding: 14px 12px 6px;
  }
  .rmnav-sub {
    font-family: var(--font-body, system-ui, sans-serif);
    font-size: 15.5px; color: var(--ink, #2b2926); text-decoration: none;
    padding: 11px 12px 11px 24px; border-radius: 10px; border: 2px solid transparent;
  }
  .rmnav-sub:active { background: var(--accent-soft, rgba(176,106,69,.16)); }
  .rmnav-cta {
    margin-top: 18px; text-align: center; text-decoration: none;
    font-family: var(--font-body, system-ui, sans-serif); font-weight: 700; font-size: 16px;
    background: var(--accent, #b06a45); color: #fff;
    border: 2.5px solid var(--line, #2b2926); border-radius: 12px;
    padding: 13px 18px; box-shadow: 3px 3px 0 var(--ink, #2b2926);
  }
  .rmnav-cta:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--ink, #2b2926); }
  body.rmnav-locked { overflow: hidden; }
  `;
  var styleEl = document.createElement('style');
  styleEl.id = 'rise-nav-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- build the drawer from the existing desktop nav ---------- */
  var burger = document.querySelector('.burger');
  var navLinks = document.querySelector('header.nav nav.links');
  if (!burger || !navLinks) return;

  var root = document.createElement('div');
  root.className = 'rmnav-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Menu');

  var backdrop = document.createElement('div');
  backdrop.className = 'rmnav-backdrop';

  var panel = document.createElement('nav');
  panel.className = 'rmnav-panel';

  var head = document.createElement('div');
  head.className = 'rmnav-head';
  head.innerHTML = '<span class="rmnav-mark"><b>RISE</b> Furnished Stays</span>';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'rmnav-close';
  closeBtn.setAttribute('aria-label', 'Close menu');
  closeBtn.innerHTML = '&#10005;';
  head.appendChild(closeBtn);
  panel.appendChild(head);

  /* walk the desktop nav children, preserving order + dropdown structure */
  Array.prototype.forEach.call(navLinks.children, function (child) {
    if (child.matches('a')) {
      var a = document.createElement('a');
      a.className = 'rmnav-link' + (child.classList.contains('current') ? ' current' : '');
      a.href = child.getAttribute('href');
      a.textContent = child.textContent.trim();
      panel.appendChild(a);
    } else if (child.classList.contains('nav-dd')) {
      var parentLink = child.querySelector(':scope > a');
      var label = document.createElement('div');
      label.className = 'rmnav-group-label';
      label.textContent = parentLink ? parentLink.textContent.trim().replace(/\s*▾\s*$/, '') : 'More';
      panel.appendChild(label);
      child.querySelectorAll('.nav-dd-menu a').forEach(function (sub) {
        var s = document.createElement('a');
        s.className = 'rmnav-sub';
        s.href = sub.getAttribute('href');
        s.textContent = sub.textContent.trim();
        panel.appendChild(s);
      });
    }
  });

  /* Book Direct CTA from the desktop header */
  var cta = document.querySelector('.nav-cta .btn.accent');
  if (cta) {
    var c = document.createElement('a');
    c.className = 'rmnav-cta';
    c.href = 'index.html#book-stay';
    c.textContent = cta.textContent.trim();
    panel.appendChild(c);
  }

  root.appendChild(backdrop);
  root.appendChild(panel);
  document.body.appendChild(root);

  /* ---------- open / close ---------- */
  function open() {
    root.classList.add('open');
    document.body.classList.add('rmnav-locked');
    burger.setAttribute('aria-expanded', 'true');
  }
  function close() {
    root.classList.remove('open');
    document.body.classList.remove('rmnav-locked');
    burger.setAttribute('aria-expanded', 'false');
  }

  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-controls', 'rise-mobile-nav');
  root.id = 'rise-mobile-nav';

  burger.addEventListener('click', function (e) {
    e.preventDefault();
    root.classList.contains('open') ? close() : open();
  });
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) close();
  });
  /* close after tapping any in-page link */
  panel.addEventListener('click', function (e) {
    if (e.target.closest('a')) close();
  });
  /* if the viewport grows back to desktop, make sure the drawer is closed */
  window.matchMedia('(min-width: 901px)').addEventListener('change', function (m) {
    if (m.matches) close();
  });
})();
