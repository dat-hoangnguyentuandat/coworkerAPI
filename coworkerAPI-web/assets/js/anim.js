// Coworker Web — advanced behaviors v3:
// word reveal, header hide, parallax, marquee, counters, magnetic, tilt.
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const ease = "cubic-bezier(0.2, 0.65, 0.2, 1)";

  // ── Header hide on scroll down, show on up ────────────
  const header = document.querySelector(".site-header");
  let lastY = 0;
  addEventListener("scroll", () => {
    if (!header) return;
    const y = scrollY;
    if (y > 120 && y > lastY) header.classList.add("hid");
    else header.classList.remove("hid");
    lastY = y;
  }, { passive: true });

  // ── Hero parallax (rAF-throttled) ─────────────────────
  const mock = document.querySelector(".hero-mock");
  const heroGrid = document.querySelector(".hero");
  if (!reduced && mock && heroGrid) {
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return;
      requestAnimationFrame(() => {
        const y = Math.min(scrollY, 700);
        mock.style.translate = `0 ${y * 0.08}px`;
        const grid = heroGrid.querySelector(".hero::before") || null;
        ticking = false;
      });
      ticking = true;
    }, { passive: true });
  }

  // ── Counters ──────────────────────────────────────────
  const counters = document.querySelectorAll("[data-count]");
  if (counters.length) {
    const run = el => {
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const dur = 1400;
      const t0 = performance.now();
      const step = now => {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }
      }
    }, { threshold: 0.4 });
    counters.forEach(el => io.observe(el));
  }

  // ── Magnetic buttons (desktop pointer only) ───────────
  if (!reduced && fine) {
    document.querySelectorAll(".btn-magnetic").forEach(btn => {
      const strength = 10;
      btn.addEventListener("pointermove", e => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
        const award = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        btn.style.translate = `${dx * strength}px ${award * strength}px`;
      });
      btn.addEventListener("pointerleave", () => { btn.style.translate = "0 0"; });
    });
  }

  // ── 3D tilt on feature media cards ────────────────────
  if (!reduced && fine) {
    document.querySelectorAll(".fs-media").forEach(card => {
      let raf = null;
      card.addEventListener("pointermove", e => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 7}deg) rotateY(${(px - 0.5) * 9}deg)`;
          card.style.setProperty("--mx", `${e.clientX - r.left}px`);
          card.style.setProperty("--my", `${e.querySelectorAll ? e.clientY - r.top : 0}px`);
          raf = null;
        });
      });
      card.addEventListener("pointerleave", () => {
        card.style.transform = "";
      });
    });
  }
})();
