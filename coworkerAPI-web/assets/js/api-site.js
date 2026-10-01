(() => {
  "use strict";
  const en = {
    skip:"Skip to content", docs:"Documentation", category:"Local gateway / MCP bridge",
    headline:"Through your endpoint.", protocols:"OpenAI-compatible & Anthropic-compatible",
    explore:"Explore the connection ↓", introTitle:"Familiar tools.\nA different connection.",
    intro:"CoworkerAPI routes requests from AI tools into ChatGPT through a plugin/MCP widget, then returns the response in the client’s protocol. Run the gateway locally and configure your endpoint and API key.",
    start:"Start setup", source:"View source ↗",
    preview:"The widget bridge is experimental. Keep the ChatGPT conversation open while using it.",
    flowTitle:"From request to response.", flowDescription:"Your tool calls the gateway. ChatGPT processes the request. The result returns to your tool.",
    client:"Client", gatewayDetail:"Endpoint · API key\nQueue · Protocol adapter",
    chatDetail:"Plugin / MCP widget\nworkbench_api_submit",
    flowNote:"Tool calls return to the client for execution. The gateway does not run local commands on your behalf.",
    integrationTitle:"Choose your protocol.\nKeep your tools.",
    integrationCopy:"Use the CoworkerAPI base URL and API key in your custom provider settings. Your client must support the corresponding protocol.",
    clientDocs:"Configure your client", copy:"Copy", example:"Configuration example · localhost:3211",
    manageTitle:"Configure and observe.\nIn one dashboard.",
    manageCopy:"Manage your tunnel, API keys, bridge status, and request logs. The built-in setup guide walks through each step in the administration dashboard.",
    manageDocs:"Read the documentation", connection:"Connection", connectionDesc:"Tunnel form, plugin setup, bridge activation",
    keysDesc:"Create keys, revoke keys, control gateway access", observability:"Observability",
    observabilityDesc:"Live requests, usage, and connection status", preferences:"Preferences", preferencesDesc:"English / Vietnamese · light / dark",
    limitsTitle:"Know the limits before you start.",
    limitsCopy:"CoworkerAPI is not an official ChatGPT API and does not guarantee the latency of a direct model API. The widget handles requests serially; SSE is delivered after a complete callback arrives.",
    limitsAccount:"Connection availability and usage limits depend on your ChatGPT account. Windows is the primary platform; tunnel installation and DPAPI-protected secret storage currently require Windows.",
    securityDocs:"Security and limitations", finalTitle:"Set up your first connection.",
    install:"Install from source",
    contact:"Contact:"
  };
  const vi = Object.fromEntries([...document.querySelectorAll("[data-copy]")].map(el => {
    const clone=el.cloneNode(true);
    clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    return [el.dataset.copy,clone.textContent];
  }));
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key,value) => { try { localStorage.setItem(key,value); } catch {} };
  const root = document.documentElement;
  const requestedLanguage = new URLSearchParams(location.search).get("lang");
  let language = (["vi","en"].includes(requestedLanguage) ? requestedLanguage : null) || root.dataset.docDefaultLanguage || read("coworkerapi-web-language") || "vi";
  if (!["vi","en"].includes(language)) language="vi";
  if (requestedLanguage || root.dataset.docDefaultLanguage) save("coworkerapi-web-language",language);
  let theme = read("coworkerapi-web-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const examples = {
    anthropic: JSON.stringify({env:{ANTHROPIC_BASE_URL:"http://127.0.0.1:3211",ANTHROPIC_AUTH_TOKEN:"<API_KEY>",ANTHROPIC_MODEL:"chatgpt-web"}},null,2),
    openai: 'Base URL: http://127.0.0.1:3211/v1\nAPI key: <API_KEY>\nModel: chatgpt-web\n\nPOST /responses\nPOST /chat/completions'
  };
  function applyTheme() {
    root.dataset.theme=theme;
    document.querySelectorAll("[data-theme-toggle]").forEach(el => {
      el.setAttribute("aria-label",language==="en" ? "Switch color theme" : "Đổi giao diện sáng / tối");
      el.setAttribute("aria-pressed",String(theme==="dark"));
    });
  }
  function applyLanguage() {
    root.lang=language;
    document.querySelectorAll("[data-copy]").forEach(el => {
      const value=(language==="en" ? en : vi)[el.dataset.copy];
      if (value!==undefined) { el.textContent=value; el.style.whiteSpace=value.includes("\n") ? "pre-line" : ""; }
    });
    document.querySelectorAll("[data-language]").forEach(el => el.value=language);
    if (!root.dataset.docPage) {
      document.title=language==="en" ? "CoworkerAPI — ChatGPT through your endpoint" : "CoworkerAPI — ChatGPT qua endpoint của bạn";
      document.querySelector('meta[name="description"]').content=language==="en" ? "Connect AI tools to ChatGPT through a local OpenAI-compatible and Anthropic-compatible MCP gateway." : "Kết nối công cụ AI với ChatGPT qua gateway OpenAI-compatible và Anthropic-compatible. Chạy cục bộ, kết nối qua MCP, quản lý từ dashboard.";
    }
    applyTheme();
    window.dispatchEvent(new CustomEvent("api-language",{detail:{language}}));
  }
  document.querySelectorAll("[data-language]").forEach(el => el.addEventListener("change",() => {
    language=el.value; save("coworkerapi-web-language",language); applyLanguage();
  }));
  let themeBusy=false;
  async function toggleTheme(event) {
    if (themeBusy) return;
    themeBusy=true;
    const buttons=[...document.querySelectorAll("[data-theme-toggle]")];
    buttons.forEach(button => { button.disabled=true; });
    const next=theme==="dark" ? "light" : "dark";
    const update=() => { theme=next; save("coworkerapi-web-theme",theme); applyTheme(); };
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof document.startViewTransition!=="function" || typeof root.animate!=="function") { update(); return; }
      const rect=event.currentTarget.getBoundingClientRect();
      const pointer=event.detail!==0 && Number.isFinite(event.clientX) && Number.isFinite(event.clientY);
      const x=pointer ? event.clientX : rect.left+rect.width/2;
      const y=pointer ? event.clientY : rect.top+rect.height/2;
      const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
      const tokens=getComputedStyle(root);
      const transition=document.startViewTransition(update);
      await transition.ready;
      await root.animate({clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]}, {
        duration:parseFloat(tokens.getPropertyValue("--dur-theme")) || 520,
        easing:tokens.getPropertyValue("--ease-theme").trim(),pseudoElement:"::view-transition-new(root)"
      }).finished;
      await transition.finished;
    } catch { update(); }
    finally { themeBusy=false; buttons.forEach(button => { button.disabled=false; }); }
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(el => el.addEventListener("click",toggleTheme));
  document.querySelectorAll("[data-protocol]").forEach(el => el.addEventListener("click",() => {
    const code=document.getElementById("protocol-code");
    document.querySelectorAll("[data-protocol]").forEach(button => button.setAttribute("aria-pressed",String(button===el)));
    code.textContent=examples[el.dataset.protocol];
    document.getElementById("copy-status").textContent="";
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) code.animate([{opacity:.35},{opacity:1}],{duration:150});
  }));
  document.querySelector("[data-copy-code]")?.addEventListener("click",async event => {
    const button=event.currentTarget,status=document.getElementById("copy-status");
    button.disabled=true; button.setAttribute("aria-busy","true"); button.dataset.state="loading";
    try {
      await navigator.clipboard.writeText(document.getElementById("protocol-code").textContent);
      button.dataset.state="success"; status.textContent=language==="en" ? "Configuration copied." : "Đã sao chép cấu hình.";
    } catch {
      button.dataset.state="error"; status.textContent=language==="en" ? "Clipboard unavailable. Select and copy the example manually." : "Không truy cập được clipboard. Chọn nội dung ví dụ để sao chép thủ công.";
    } finally { button.disabled=false;button.removeAttribute("aria-busy"); }
  });
  applyLanguage();
})();
