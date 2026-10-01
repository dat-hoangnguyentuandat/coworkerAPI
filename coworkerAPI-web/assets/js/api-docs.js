/* CoworkerAPI documentation: static content with progressive locale switching. */
(() => {
  const page = document.documentElement.dataset.docPage;
  if (!page) return;
  const aliases = { install: "installation", quickstart: "quickstart", profiles: "multi-account", tunnels: "multi-tunnel", security: "security", changelog: "changelog" };
  const legacy = new URLSearchParams(location.search).get("page");
  if (location.pathname.endsWith("/en.html") && aliases[legacy]) {
    location.replace(aliases[legacy] + ".html?lang=en" + location.hash);
    return;
  }
  function setLanguage(language) {
    const lang = language === "en" ? "en" : "vi";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-doc-locale]").forEach(section => {
      section.hidden = section.dataset.docLocale !== lang;
    });
    document.querySelectorAll("[data-doc-vi]").forEach(node => {
      node.textContent = node.dataset[lang === "en" ? "docEn" : "docVi"];
    });
    const heading = document.querySelector('[data-doc-locale="' + lang + '"] h1');
    if (heading) document.title = heading.textContent + " — CoworkerAPI";
    const intro = document.querySelector('[data-doc-locale="' + lang + '"] .lead');
    const description = document.querySelector('meta[name="description"]');
    if (intro && description) description.content = intro.textContent;
    const select = document.querySelector("[data-language]");
    if (select) select.value = lang;
  }
  document.querySelectorAll("[data-doc-link]").forEach(link => {
    if (link.dataset.docLink === page) link.setAttribute("aria-current", "page");
  });
  window.addEventListener("api-language", event => {
    setLanguage(typeof event.detail === "string" ? event.detail : event.detail?.language);
  });
  setLanguage(document.documentElement.lang);
})();
