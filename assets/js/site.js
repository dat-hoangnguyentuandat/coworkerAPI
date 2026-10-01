// Coworker Web — behaviors: theme, i18n, reveal engine, spotlight, nav.
(() => {
  "use strict";

  // ── Theme ─────────────────────────────────────────────
  const root = document.documentElement;
  const storedTheme = localStorage.getItem("cw.theme");
  root.dataset.theme = storedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
    if (!localStorage.getItem("cw.theme")) root.dataset.theme = e.matches ? "dark" : "light";
  });
  const dict = window.CW_I18N || { vi: {}, en: {} };
  const englishDocs = document.body.classList.contains("docs-body") && location.pathname.endsWith("/en.html");
  let lang = new URLSearchParams(location.search).get("lang") || (englishDocs ? "en" : (localStorage.getItem("cw.lang") || "vi"));
  document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
    btn.addEventListener("click", event => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      const update = () => { root.dataset.theme = next; localStorage.setItem("cw.theme", next); };
      if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
      const transition = document.startViewTransition(update);
      transition.ready.then(() => {
        const x = event.clientX || innerWidth / 2;
        const y = event.clientY || innerHeight / 2;
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        root.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" });
      }).catch(() => {});
    });
  });

  // Compact navigation shared by the landing page and documentation.
  const header = document.querySelector(".site-header-inner");
  const nav = header?.querySelector(".site-nav");
  if (nav) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-menu-toggle hdr-control";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "mobile-site-menu");
    button.setAttribute("aria-label", lang === "en" ? "Open menu" : "Mở menu");
    button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path class="menu-line menu-line-top" d="M4 7h16"/><path class="menu-line menu-line-middle" d="M4 12h16"/><path class="menu-line menu-line-bottom" d="M4 17h16"/></svg>';
    const menu = document.createElement("nav");
    menu.id = "mobile-site-menu";
    menu.className = "mobile-site-menu";
    menu.setAttribute("aria-label", lang === "en" ? "Mobile navigation" : "Điều hướng trên điện thoại");
    const links = document.body.classList.contains("docs-body") ? document.querySelectorAll(".docs-sidebar a") : nav.querySelectorAll("a");
    links.forEach(link => menu.appendChild(link.cloneNode(true)));
    const close = () => { button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", lang === "en" ? "Open menu" : "Mở menu"); menu.classList.remove("open"); };
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", lang === "en" ? (open ? "Close menu" : "Open menu") : (open ? "Đóng menu" : "Mở menu"));
      menu.classList.toggle("open", open);
    });
    menu.addEventListener("click", event => { if (event.target.closest("a")) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    document.addEventListener("click", event => { if (!header.parentElement.contains(event.target)) close(); });
    header.appendChild(button);
    header.parentElement.appendChild(menu);
  }

  // ── i18n ──────────────────────────────────────────────
  if (document.body.classList.contains("docs-body") && new URLSearchParams(location.search).has("lang")) {
    localStorage.setItem("cw.lang", lang);
  }
  const englishAnchors = {
    "installation.html": "install",
    "quickstart.html": "quickstart",
    "multi-account.html": "profiles",
    "multi-tunnel.html": "tunnels",
    "security.html": "security",
    "changelog.html": "changelog",
  };
  const englishTarget = () => {
    const page = englishAnchors[location.pathname.split("/").pop()];
    return `en.html${page ? `?page=${page}` : ""}`;
  };
  if (document.body.classList.contains("docs-body") && !englishDocs && lang === "en") {
    location.replace(englishTarget());
    return;
  }
  const t = key => (dict[lang] && dict[lang][key]) ?? (dict.vi[key] ?? key);

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      if (typeof val === "string") el.innerHTML = val;
    });
    // re-arm scroll-scrub word spans after innerHTML overwrite
    if (window.CW_rescrub) window.CW_rescrub();
    document.querySelectorAll("[data-i18n-html]").forEach(el => {
      const key = el.getAttribute("data-i18n-html");
      const val = t(key);
      if (typeof val === "string") {
        el.innerHTML = val;
      }
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.title = t(el.getAttribute("data-i18n-title"));
    });
    document.querySelectorAll(".lang-toggle span").forEach(span => {
      span.classList.toggle("on", span.dataset.lang === lang);
    });
    const backToTop = document.querySelector(".back-to-top");
    if (backToTop) backToTop.setAttribute("aria-label", lang === "en" ? "Back to top" : "Lên đầu trang");
  }
  document.querySelectorAll(".lang-toggle span").forEach(span => {
    span.addEventListener("click", () => {
      if (document.body.classList.contains("docs-body") && span.dataset.lang === "en" && !location.pathname.endsWith("/en.html")) {
        localStorage.setItem("cw.lang", "en");
        location.href = englishTarget();
        return;
      }
      if (document.body.classList.contains("docs-body") && span.dataset.lang === "vi" && location.pathname.endsWith("/en.html")) {
        localStorage.setItem("cw.lang", "vi");
        const vietnameseTargets = { install: "installation.html", quickstart: "quickstart.html", profiles: "multi-account.html", tunnels: "multi-tunnel.html", security: "security.html", changelog: "changelog.html" };
        const page = new URLSearchParams(location.search).get("page") || location.hash.slice(1);
        location.href = vietnameseTargets[page] || "index.html";
        return;
      }
      lang = span.dataset.lang;
      localStorage.setItem("cw.lang", lang);
      applyLang();
    });
  });
  applyLang();

  // Shared quick navigation on landing and every documentation page.
  const topButton = document.createElement("button");
  topButton.type = "button";
  topButton.className = "back-to-top";
  topButton.setAttribute("aria-label", lang === "en" ? "Back to top" : "Lên đầu trang");
  topButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7M12 19V5"/></svg>';
  document.body.appendChild(topButton);
  const updateTopButton = () => topButton.classList.toggle("show", scrollY > Math.min(420, innerHeight * 0.2));
  addEventListener("scroll", updateTopButton, { passive: true });
  addEventListener("resize", updateTopButton, { passive: true });
  topButton.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
  updateTopButton();

  // ── Reveal engine ───────────────────────────────────────
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const replayMotion = !document.body.classList.contains("docs-body");
  const revealables = document.querySelectorAll(".rv:not(.feature-split .rv), .steps-rail .step, .final-cta .btn");
  const featureTargets = document.querySelectorAll(".feature-split, .hz-panel");
  if (reduced || !("IntersectionObserver" in window)) {
    revealables.forEach(el => el.classList.add("in"));
    featureTargets.forEach(el => { el.classList.add("in"); el.querySelectorAll(".rv").forEach(child => child.classList.add("in")); });
  } else {
    root.classList.add("motion-ready");
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          if (!replayMotion) io.unobserve(entry.target);
        } else if (replayMotion) {
          entry.target.classList.remove("in");
        }
      }
    }, { threshold: replayMotion ? 0 : 0.01, rootMargin: replayMotion ? "0px" : "0px 0px 140px 0px" });
    revealables.forEach(el => io.observe(el));
    const featureObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        entry.target.classList.toggle("in", entry.isIntersecting);
        entry.target.querySelectorAll(".rv").forEach(child => child.classList.toggle("in", entry.isIntersecting));
      }
    }, { threshold: 0 });
    featureTargets.forEach(el => featureObserver.observe(el));
  }

  // Stagger groups: auto-assign delays to children
  document.querySelectorAll("[data-stagger]").forEach(group => {
    const step = parseInt(group.dataset.stagger, 10) || 90;
    [...group.children].forEach((child, i) => {
      if (i < 6) child.style.setProperty("--d", `${i * step}ms`);
    });
  });

  // ── Scroll progress bar ───────────────────────────────
  const bar = document.querySelector(".progress-bar");
  if (bar) {
    let ticking = false;
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
      ticking = false;
    };
    addEventListener("scroll", () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  // ── Spotlight: mouse-tracking glow on media cards ─────
  document.querySelectorAll(".fs-media").forEach(card => {
    card.addEventListener("pointermove", e => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      card.style.setProperty("--my", `${e.clientY - rect.top}px`);
    });
  });

  // ── Active sidebar link (docs) ────────────────────────
  const currentPath = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".docs-sidebar a").forEach(link => {
    if (englishDocs) return;
    const href = link.getAttribute("href") || "";
    if (href === currentPath || (currentPath === "index.html" && href === "./")) link.classList.add("active");
  });

  // ── TOC scroll-spy (docs) ─────────────────────────────
  const tocLinks = [...document.querySelectorAll(".docs-toc a[href^='#']")];
  if (tocLinks.length) {
    const targets = tocLinks.map(l => document.querySelector(l.getAttribute("href"))).filter(Boolean);
    const setActive = id => tocLinks.forEach(l => l.classList.toggle("active", l.getAttribute("href") === `#${id}`));
    const spy = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
    }, { rootMargin: "-20% 0px -70% 0px" });
    targets.forEach(t => spy.observe(t));
  }
})();
