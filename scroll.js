/* ============================================================
   Nordholm — scroll-driven build sequence

   Two things have to be smooth, and they are separate problems:

   1. The page itself. A mouse wheel delivers scroll in ~100px chunks,
      so the captions and the rail arrive in steps. We intercept the
      wheel, keep a virtual scroll target, and ease the real scroll
      position towards it every frame.

   2. The video. Scroll position maps onto currentTime, eased so a
      flick of the wheel reads as motion rather than a jump. Seeks are
      snapped to frame boundaries and never issued while one is still
      in flight, which is what keeps the decoder from falling behind.

   Both easings are frame-rate independent, so the feel is identical at
   60Hz and 144Hz.
   ============================================================ */

(function () {
  "use strict";

  var section = document.querySelector("[data-build]");
  var video   = document.querySelector("[data-video]");
  var caps    = Array.prototype.slice.call(document.querySelectorAll("[data-cap]"));
  var ticks   = Array.prototype.slice.call(document.querySelectorAll("[data-tick]"));
  var hudNum  = document.querySelector("[data-hud-num]");

  if (!section || !video) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- tuning ---------------------------------------------- */

  var SCROLL_TAU = 0.13;   // seconds; higher = more glide, more lag
  var VIDEO_TAU  = 0.09;
  var SNAP_JUMP  = 1.2;    // seconds of video; larger gaps cut instead of crawl
  var FRAME      = 1 / 24; // source frame duration

  // The first slice of the section holds on the empty clearing so the hero
  // has room to be read, and the tail holds on the finished house for the
  // CTA. Everything between maps linearly onto the clip.
  var HOLD_IN  = 0.10;
  var HOLD_OUT = 0.96;

  /* --- state ----------------------------------------------- */

  var duration = 0;
  var target   = 0;   // where the scroll says the video should be, in seconds
  var current  = 0;   // where the video actually is, eased
  var progress = 0;   // 0..1 through the section
  var active   = -1;  // index of the caption currently shown

  var sectionTop = 0; // cached so the scroll handler never reads layout
  var runway     = 1;
  var pageMax    = 0;

  // Chrome colour is decided by whatever section sits under the masthead,
  // rather than by a blend mode: over bright snow, difference blending
  // lands on a mid grey and the wordmark disappears.
  var masthead = document.querySelector(".masthead");
  var bands    = [];
  var chrome   = "";

  var scrollTarget  = window.scrollY;
  var scrollCurrent = window.scrollY;
  var lastFrame     = 0;

  // Virtual scrolling only for a real pointer. Touch already has momentum
  // of its own and hijacking it makes things worse, not better.
  var smooth = !reduced &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  var stops = caps.map(function (cap) {
    return parseFloat(cap.dataset.at) || 0;
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* --- pick a plate that suits the viewport ---------------- */

  var wide = video.getAttribute("data-src");
  var narrow = video.getAttribute("data-src-sm");

  function wantsWide() {
    return window.innerWidth * Math.min(window.devicePixelRatio || 1, 2) > 1000;
  }

  video.src = (narrow && !wantsWide()) ? narrow : wide;

  // A window that starts narrow and is then widened would otherwise be stuck
  // on the small plate for the rest of the session. Upgrade in place, keeping
  // position. Never downgrade: the wide file is already fetched by then.
  function maybeUpgrade() {
    if (!narrow || video.src.indexOf(wide) !== -1 || !wantsWide()) return;
    var at = video.currentTime;
    video.src = wide;
    video.addEventListener("loadedmetadata", function once() {
      video.removeEventListener("loadedmetadata", once);
      try { video.currentTime = at; } catch (e) { /* not seekable yet */ }
    });
  }

  /* --- geometry -------------------------------------------- */

  function cacheGeometry() {
    sectionTop = section.getBoundingClientRect().top + window.scrollY;
    runway = Math.max(section.offsetHeight - window.innerHeight, 1);
    pageMax = Math.max(
      document.documentElement.scrollHeight - window.innerHeight, 0);
    scrollTarget = clamp(scrollTarget, 0, pageMax);

    bands = Array.prototype.map.call(
      document.querySelectorAll("[data-chrome]"),
      function (el) {
        var box = el.getBoundingClientRect();
        return {
          top: box.top + window.scrollY,
          bottom: box.bottom + window.scrollY,
          tone: el.getAttribute("data-chrome")
        };
      });

    update();
  }

  function paintChrome() {
    if (!masthead || !bands.length) return;
    var probe = window.scrollY + 32;      // roughly the masthead's baseline
    var tone = bands[0].tone;
    for (var i = 0; i < bands.length; i++) {
      if (probe >= bands[i].top && probe < bands[i].bottom) {
        tone = bands[i].tone;
        break;
      }
      if (probe >= bands[i].bottom) tone = bands[i].tone;
    }
    if (tone === chrome) return;
    chrome = tone;
    masthead.classList.toggle("is-light", tone === "light");
    masthead.classList.toggle("is-dark", tone === "dark");
  }

  /* --- video readiness ------------------------------------- */

  function onMeta() {
    duration = video.duration || 0;
    update();
  }

  if (video.readyState >= 1) onMeta();
  video.addEventListener("loadedmetadata", onMeta);

  // Safari and iOS will not decode a frame until the element has been told
  // to play at least once. Play, then immediately pause.
  function primeDecoder() {
    var played = video.play();
    if (played && typeof played.then === "function") {
      played.then(function () { video.pause(); }).catch(function () { /* fine */ });
    } else {
      video.pause();
    }
  }
  video.addEventListener("canplay", primeDecoder, { once: true });
  window.addEventListener("pointerdown", primeDecoder, { once: true });
  window.addEventListener("touchstart", primeDecoder, { once: true, passive: true });

  /* --- scroll -> time -------------------------------------- */

  function update() {
    progress = clamp((window.scrollY - sectionTop) / runway, 0, 1);

    var played = clamp(
      (progress - HOLD_IN) / (HOLD_OUT - HOLD_IN), 0, 1);

    target = played * duration;
    paint();
    paintChrome();
  }

  /* --- captions, rail, hud --------------------------------- */

  function paint() {
    var next = 0;
    for (var i = 0; i < stops.length; i++) {
      if (progress >= stops[i] - 0.02) next = i;
    }
    if (next === active) return;
    active = next;

    for (var c = 0; c < caps.length; c++) {
      caps[c].classList.toggle("is-on", c === active);
    }
    // the rail has one tick per stage; caption 0 is the hero, so tick i
    // belongs to caption i + 1
    for (var t = 0; t < ticks.length; t++) {
      ticks[t].classList.toggle("is-active", t === active - 1);
      ticks[t].classList.toggle("is-done", t < active - 1);
    }
    if (hudNum) {
      hudNum.textContent = active === 0 ? "00" : ("0" + (active - 1)).slice(-2);
    }
  }

  /* --- virtual scroll -------------------------------------- */

  function onWheel(e) {
    if (!smooth || e.ctrlKey || e.metaKey) return;
    e.preventDefault();

    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;                    // lines
    else if (e.deltaMode === 2) d *= window.innerHeight; // pages

    scrollTarget = clamp(scrollTarget + d, 0, pageMax);
  }

  // Anything that moves the page without going through the wheel — a
  // scrollbar drag, PageDown, an anchor link — lands here and takes over.
  function onNativeScroll() {
    if (smooth && Math.abs(window.scrollY - scrollCurrent) > 2) {
      scrollCurrent = scrollTarget = window.scrollY;
    }
    update();
  }

  function onAnchorClick(e) {
    if (!smooth) return;
    var link = e.target.closest && e.target.closest('a[href^="#"]');
    if (!link) return;
    var id = link.getAttribute("href");
    if (id.length < 2) return;
    var dest = document.querySelector(id);
    if (!dest) return;
    e.preventDefault();
    scrollTarget = clamp(
      dest.getBoundingClientRect().top + window.scrollY, 0, pageMax);
  }

  /* --- render loop ----------------------------------------- */

  function frame(now) {
    var dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 60;
    lastFrame = now;

    if (smooth) {
      var gap = scrollTarget - scrollCurrent;
      if (Math.abs(gap) < 0.4) {
        scrollCurrent = scrollTarget;
      } else {
        scrollCurrent += gap * (1 - Math.exp(-dt / SCROLL_TAU));
        window.scrollTo(0, scrollCurrent);
      }
    }

    if (duration) {
      var delta = target - current;

      if (reduced || Math.abs(delta) > SNAP_JUMP) {
        current = target;
      } else {
        current += delta * (1 - Math.exp(-dt / VIDEO_TAU));
        if (Math.abs(delta) < 0.002) current = target;
      }

      // Land on a real frame. Seeking between frames costs a decode and
      // shows the same picture, so it is pure jank.
      var snapped = Math.round(current / FRAME) * FRAME;

      if (!video.seeking && video.readyState >= 1 &&
          Math.abs(video.currentTime - snapped) > FRAME * 0.5) {
        try { video.currentTime = snapped; } catch (e) { /* not seekable yet */ }
      }
    }

    requestAnimationFrame(frame);
  }

  if (smooth) {
    document.documentElement.classList.add("js-smooth");
    window.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("click", onAnchorClick);
    // a hybrid laptop that starts using its touchscreen hands control back
    window.addEventListener("touchstart", function () {
      smooth = false;
      document.documentElement.classList.remove("js-smooth");
    }, { passive: true, once: true });
  }

  window.addEventListener("scroll", onNativeScroll, { passive: true });
  window.addEventListener("resize", function () {
    cacheGeometry();
    maybeUpgrade();
  });
  window.addEventListener("load", function () {
    cacheGeometry();
    maybeUpgrade();
  });

  cacheGeometry();
  requestAnimationFrame(frame);

  /* --- reveals for the sections below ---------------------- */

  var reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -12% 0px" });

    Array.prototype.forEach.call(reveals, function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + "ms";
      io.observe(el);
    });
  } else {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add("is-in"); });
  }
})();
