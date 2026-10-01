/* Native smooth scrolling, with a floating shortcut after the first screen. */
(() => {
  "use strict";
  const sentinel=document.createElement("div");
  sentinel.className="scroll-top-sentinel"; sentinel.setAttribute("aria-hidden","true");
  const button=document.createElement("button");
  button.type="button"; button.className="scroll-top";
  button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v14"/></svg>';
  const label=() => {
    const text=document.documentElement.lang==="en" ? "Back to top" : "Lên đầu trang";
    button.setAttribute("aria-label",text); button.title=text;
  };
  const show=visible => {
    button.setAttribute("aria-hidden",String(!visible)); button.tabIndex=visible ? 0 : -1;
  };
  label(); show(false); document.body.append(sentinel,button);
  window.addEventListener("api-language",label);
  button.addEventListener("click",() => {
    window.scrollTo({top:0,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
    document.querySelector(".brand")?.focus({preventScroll:true});
  });
  if (typeof IntersectionObserver==="function") {
    new IntersectionObserver(entries => show(!entries[0].isIntersecting)).observe(sentinel);
  } else {
    // Functional fallback on older browsers; native scrolling remains available.
    const update=() => show(window.scrollY>480);
    window.addEventListener("scroll",update,{passive:true}); update();
  }
})();
