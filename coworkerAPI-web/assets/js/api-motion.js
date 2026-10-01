/* Landing choreography: replay after a section fully leaves the viewport. */
(() => {
  "use strict";
  const preference=matchMedia("(prefers-reduced-motion: reduce)");
  if (typeof IntersectionObserver!=="function" || typeof Element.prototype.animate!=="function") return;
  const tokens=getComputedStyle(document.documentElement);
  const duration=parseFloat(tokens.getPropertyValue("--dur-reveal")) || 720;
  const easing=tokens.getPropertyValue("--ease-out").trim();
  const active=new Set(),seen=new WeakSet(),recipes=new Map(),sections=new Map();
  function register(selector,kind="rise",step=85) {
    document.querySelectorAll(selector).forEach((element,index) => {
      recipes.set(element,{kind,delay:Math.min(index*step,340)});
    });
  }
  register(".hero-meta", "rise", 0);
  register(".hero h1>span", "headline", 120);
  register(".hero-bottom", "rise", 0);
  register(".intro>h2,.intro>div", "rise", 130);
  register(".flow-section .section-head>*", "rise");
  register(".flow>*", "flow", 90);
  register(".flow-note", "rise", 0);
  register(".integration-copy>*", "rise");
  register(".protocol-demo", "panel", 0);
  register(".management>div>*", "rise");
  register(".specs>div", "row", 90);
  register(".limits>h2,.limits-body>*", "rise");
  register(".final-cta>*", "rise", 120);
  register(".footer>*", "rise", 70);
  function reveal(element) {
    if (seen.has(element)) return;
    seen.add(element);
    if (preference.matches) return;
    const {kind,delay}=recipes.get(element);
    const mobile=innerWidth<640;
    const start={
      headline:"translateY(44px) rotateX(12deg)",
      rise:"translateY(28px)", panel:"translateY(32px) scale(.975)",
      row:mobile ? "translateY(20px)" : "translateX(28px)",
      flow:element.classList.contains("connector")
        ? (mobile ? "rotate(90deg) scale(.65)" : "scale(.65)")
        : "translateY(22px) scale(.96)"
    }[kind];
    // Preserve the mobile connector rotation rather than replacing its CSS.
    const end=element.classList.contains("connector") && mobile ? "rotate(90deg)" : "none";
    const animation=element.animate([{opacity:0,transform:start},{opacity:1,transform:end}],{
      duration,delay,easing,fill:"backwards"
    });
    active.add(animation); animation.revealElement=element;
    animation.finished.catch(() => {}).finally(() => active.delete(animation));
  }
  const observer=new IntersectionObserver(entries => {
    // Observe stable section boxes for reset, never animated transforms.
    entries.filter(entry => sections.has(entry.target)).forEach(entry => {
      if (!entry.isIntersecting) {
        sections.get(entry.target).forEach(element => seen.delete(element));
        active.forEach(animation => {
          if (entry.target.contains(animation.revealElement)) animation.cancel();
        });
      }
    });
    entries.forEach(entry => {
      if (entry.isIntersecting && recipes.has(entry.target) && !entry.target.contains(document.activeElement)) reveal(entry.target);
    });
  },{threshold:.08});
  document.querySelectorAll("main>section,.footer").forEach(section => {
    sections.set(section,[...recipes.keys()].filter(element => section.contains(element)));
    observer.observe(section);
  });
  recipes.forEach((_,element) => observer.observe(element));
  document.addEventListener("focusin",event => {
    recipes.forEach((_,element) => {
      if (element.contains(event.target)) seen.add(element);
    });
    // A keyboard user never has to wait for an entry animation.
    active.forEach(animation => animation.cancel());
  });
  preference.addEventListener("change",() => {
    if (preference.matches) active.forEach(animation => animation.cancel());
  });
})();
