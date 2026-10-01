// Coworker Web — scroll highlights and media motion. No dependencies.
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ── 1b) STEPS RAIL: progress classes driven by scroll ──
  const rail = document.querySelector(".steps-rail");
  if (rail) {
    const steps = Array.from(rail.querySelectorAll(".step"));
    const paintSteps = () => {
      const vh = innerHeight;
      steps.forEach((step, i) => {
        const r = step.getBoundingClientRect();
        const center = r.top + r.height / 2;
        const passed = center < vh * 0.62;
        step.classList.toggle("passed", passed);
        step.classList.toggle("active", passed && center > vh * 0.28 && center < vh * 0.55);
      });
    };
    addEventListener("scroll", () => requestAnimationFrame(paintSteps), { passive: true });
    paintSteps();
  }

  // ── 1c) FEATURE MEDIA parallax on scroll ───────────────
  const mediaCards = Array.from(document.querySelectorAll(".fs-media"));
  if (mediaCards.length && !reduced) {
    let queued = false;
    const paintParallax = () => {
      queued = false;
      const vh = innerHeight;
      mediaCards.forEach(card => {
        const r = card.getBoundingClientRect();
        if (r.bottom < -80 || r.top > vh + 80) return;
        const mid = (r.top + r.height / 2 - vh / 2) / vh; // -0.5..0.5
        card.style.translate = "0 " + (mid * -26).toFixed(1) + "px";
      });
    };
    addEventListener("scroll", () => {
      if (!queued) { queued = true; requestAnimationFrame(paintParallax); }
    }, { passive: true });
    paintParallax();
  }

  // ── 3) SCRUB HIGHLIGHT: words light up with scroll ─────
  const scrubEls = document.querySelectorAll("[data-scrub]");
  function buildScrub(p) {
    const words = p.textContent.trim().split(/\s+/);
    const frag = document.createDocumentFragment();
    words.forEach(w => {
      const s = document.createElement("span");
      s.className = "sw";
      s.textContent = w;
      frag.appendChild(s);
      frag.appendChild(document.createTextNode(" "));
    });
    p.textContent = "";
    p.appendChild(frag);
    const spans = Array.from(p.querySelectorAll(".sw"));
    let running = false;
    const paint = () => {
      const r = p.getBoundingClientRect();
      const vh = innerHeight;
      const prog = clamp01((vh * 0.85 - r.top) / (r.height + vh * 0.35));
      const n = Math.floor(prog * spans.length);
      spans.forEach((s, i) => s.classList.toggle("lit", i < n));
      if (prog < 1 || r.bottom > vh) requestAnimationFrame(paint);
      else {
        spans.forEach(s => s.classList.add("lit"));
        running = false;
      }
    };
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !running) {
          running = true;
          requestAnimationFrame(paint);
        }
      });
    }, { threshold: 0.1 });
    io.observe(p);
  }
  scrubEls.forEach(buildScrub);
  // expose so site.js can re-arm after language switch (i18n overwrites innerHTML)
  window.CW_rescrub = () => document.querySelectorAll("[data-scrub]").forEach(buildScrub);

  // ── 4) FEATURE MEDIA tilt ──────────────────────────────
  if (!reduced && fine) {
    document.querySelectorAll(".fs-media").forEach(card => {
      let raf = null;
      card.addEventListener("pointermove", e => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          card.style.transform =
            "perspective(620px) rotateX(" + ((0.5 - py) * 5).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * 7).toFixed(2) + "deg)";
          raf = null;
        });
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    });
  }
})();
