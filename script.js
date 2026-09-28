/* ==========================================================================
   Syfice — interaction layer
   No dependencies. Everything degrades gracefully.
   ========================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------------
     CONFIG — edit these
     -------------------------------------------------------------------- */
  var CONFIG = {
    // IANA timezone for the footer clock. e.g. 'Asia/Shanghai', 'Europe/Berlin'
    timezone: 'Asia/Shanghai',
    timezoneLabel: 'CST',
    // Subtle tilt/lean of the hero headline with the pointer. Set false to disable.
    heroParallax: true
  };

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ====================================================================
     1. Reveal on scroll
     ==================================================================== */
  function initReveal() {
    var items = $$('[data-reveal],[data-mask]');
    if (!items.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    // Hero content animates on load, not on scroll — and it MUST bypass the
    // observer: a masked line starts translated fully below its own
    // overflow:hidden clip box, which the observer reads as "never visible".
    // Observing it would deadlock and the hero would stay blank.
    var deferred = items.filter(function (el) { return el.closest('.hero'); });
    var observed = items.filter(function (el) { return deferred.indexOf(el) === -1; });

    var raf = window.requestAnimationFrame || function (f) { return window.setTimeout(f, 16); };
    raf(function () {
      raf(function () {
        deferred.forEach(function (el) { el.classList.add('is-in'); });
      });
    });

    if (!observed.length) return;

    var io = new IntersectionObserver(function (entries) {
      var batch = [];

      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        batch.push(e.target);
      });
      if (!batch.length) return;

      // Rank the batch in document order so a group arriving together ripples
      // instead of snapping in as one slab. Author-set --d always wins.
      batch.sort(function (a, b) {
        return a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1;
      });

      batch.forEach(function (el, i) {
        if (!el.style.getPropertyValue('--d')) {
          el.style.setProperty('--d', Math.min(i, 5));
        }
        el.classList.add('is-in');
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    observed.forEach(function (el) { io.observe(el); });
  }

  /* ====================================================================
     2. Nav — condense on scroll, hide when scrolling down
     ==================================================================== */
  function initNav() {
    var nav = $('#nav');
    if (!nav) return;

    var bar = $('#progress');
    var last = window.pageYOffset;
    var ticking = false;
    var range = 0;

    // Cached so the scroll handler never forces a layout while it is writing
    // classes — reading scrollHeight every frame is how you get jank.
    function measure() {
      range = document.documentElement.scrollHeight - window.innerHeight;
    }

    function update() {
      var y = window.pageYOffset;

      nav.classList.toggle('is-stuck', y > 24);

      // hide on scroll-down past the fold, reveal on scroll-up
      var goingDown = y > last;
      if (y > 400 && goingDown) {
        nav.classList.add('is-hidden');
      } else {
        nav.classList.remove('is-hidden');
      }

      if (bar) {
        var p = range > 0 ? Math.min(1, Math.max(0, y / range)) : 0;
        bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      }

      last = y;
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });

    window.addEventListener('resize', function () {
      measure();
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });

    measure();
    update();
  }

  /* ====================================================================
     3. Mobile menu
     ==================================================================== */
  function initMenu() {
    var burger = $('#burger');
    var menu   = $('#menu');
    if (!burger || !menu) return;

    var open = false;

    function setOpen(next) {
      open = next;
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.hidden = false;
      // let the browser register `hidden=false` before transitioning
      window.requestAnimationFrame(function () {
        menu.classList.toggle('is-open', open);
      });
      document.body.classList.toggle('is-locked', open);
      if (!open) {
        window.setTimeout(function () {
          if (!open) menu.hidden = true;
        }, 450);
      }
    }

    burger.addEventListener('click', function () { setOpen(!open); });

    $$('a', menu).forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    // close if the viewport grows past the mobile breakpoint
    var mq = window.matchMedia('(min-width: 761px)');
    var onChange = function (e) { if (e.matches && open) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);   // Safari < 14
  }

  /* ====================================================================
     4. Magnetic buttons — a few pixels of pull toward the cursor
     ==================================================================== */
  function initMagnetic() {
    if (reduced || window.matchMedia('(hover: none)').matches) return;

    $$('[data-magnetic]').forEach(function (el) {
      var raf = null, tx = 0, ty = 0;

      function apply() {
        el.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
        raf = null;
      }

      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var mx = e.clientX - (r.left + r.width  / 2);
        var my = e.clientY - (r.top  + r.height / 2);
        tx = Math.max(-9, Math.min(9, mx * 0.18));
        ty = Math.max(-6, Math.min(6, my * 0.24));
        if (!raf) raf = window.requestAnimationFrame(apply);
      });

      el.addEventListener('mouseleave', function () {
        tx = ty = 0;
        el.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
        if (!raf) raf = window.requestAnimationFrame(apply);
        window.setTimeout(function () { el.style.transition = ''; }, 520);
      });
    });
  }

  /* ====================================================================
     5. Hero — faint lean toward the pointer
     ==================================================================== */
  function initHeroParallax() {
    if (reduced || !CONFIG.heroParallax) return;
    if (window.matchMedia('(hover: none)').matches) return;

    var title = $('.hero__title');
    if (!title) return;

    var raf = null, cx = 0, cy = 0;

    function apply() {
      title.style.transform = 'translate3d(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px,0)';
      raf = null;
    }

    window.addEventListener('mousemove', function (e) {
      var nx = (e.clientX / window.innerWidth  - 0.5);
      var ny = (e.clientY / window.innerHeight - 0.5);
      cx = nx * 16;
      cy = ny * 8;
      if (!raf) raf = window.requestAnimationFrame(apply);
    }, { passive: true });

    title.style.transition = 'transform .9s cubic-bezier(.16,1,.3,1)';
  }

  /* ====================================================================
     6. Anchor scrolling that respects the fixed nav
     ==================================================================== */
  function initAnchors() {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id === '#' || id.length < 2) return;
        var target = document.querySelector(id);
        if (!target) return;

        e.preventDefault();
        var top = target.getBoundingClientRect().top + window.pageYOffset;
        var offset = parseInt(getComputedStyle(document.documentElement)
                      .getPropertyValue('--nav-h'), 10) || 76;

        window.scrollTo({
          top: Math.max(0, top - offset + 1),
          behavior: reduced ? 'auto' : 'smooth'
        });
        history.replaceState(null, '', id);
      });
    });
  }

  /* ====================================================================
     7. Footer — year + studio clock
     ==================================================================== */
  function initClock() {
    var y = $('#year');
    if (y) y.textContent = String(new Date().getFullYear());

    var clock = $('#clock');
    if (!clock) return;

    var zone = $('#clock-zone');
    if (zone) zone.textContent = CONFIG.timezoneLabel;

    var fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: CONFIG.timezone
      });
    } catch (err) {
      fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function tick() {
      clock.textContent = fmt.format(new Date());
    }

    tick();
    window.setInterval(tick, 15000);
  }

  /* ====================================================================
     8. Grain — barely-there drift so the flat white isn't dead flat
     ==================================================================== */
  function initGrain() {
    if (reduced) return;
    var g = $('.grain');
    if (!g) return;

    var n = 0;
    window.setInterval(function () {
      n = (n + 1) % 6;
      g.style.transform = 'translate(' + (n * 7 % 23) + 'px,' + (n * 11 % 19) + 'px)';
    }, 900);
  }

  /* ====================================================================
     boot
     ==================================================================== */
  function boot() {
    initReveal();
    initNav();
    initMenu();
    initMagnetic();
    initHeroParallax();
    initAnchors();
    initClock();
    initGrain();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
