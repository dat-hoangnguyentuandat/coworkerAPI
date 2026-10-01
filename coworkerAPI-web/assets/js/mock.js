// Coworker Web — living hero mock: chat types itself, approval flows, loops.
// Only runs while the hero is on screen; pauses when scrolled away.
(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hero = document.querySelector(".hero-mock");
  if (!hero || reduced) return;

  const chatBox = hero.querySelector(".mm-chat div");
  const typingEl = hero.querySelector(".typing");
  const approval = hero.querySelector(".approval");
  const okBtn = hero.querySelector(".approval .a-btn.ok");
  const chip = hero.querySelector(".mm-chip");
  if (!chatBox || !typingEl || !approval) return;

  // Scene text follows the active language
  const SCENES = {
    vi: [
      "<b>Đã đọc cấu trúc dự án — 3 module chính.</b><br>Bắt đầu từ auth như bạn nói.",
      "<b>Đã sửa <code>src/api/auth.ts</code> và chạy thử test.</b><br>2 file thay đổi · 3 test pass — chờ phê duyệt commit.",
    ],
    en: [
      "<b>Read the project structure — 3 main modules.</b><br>Starting with auth as you asked.",
      "<b>Edited <code>src/api/auth.ts</code> and ran the tests.</b><br>2 files changed · 3 tests pass — waiting for commit approval.",
    ],
  };
  const plain = html => html.replace(/<[^>]+>/g, "");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let visible = true;
  let stopped = false;

  new IntersectionObserver(es => es.forEach(e => (visible = e.isIntersecting)), { threshold: 0.15 }).observe(hero);

  async function run() {
    while (!stopped) {
      while (!visible) await sleep(400);
      const lang = (localStorage.getItem("cw.lang") || "vi") === "en" ? "en" : "vi";
      const scenes = SCENES[lang];
      for (const scene of scenes) {
        // 1) thinking dots
        chatBox.innerHTML = "";
        typingEl.style.visibility = "visible";
        await sleep(900);
        typingEl.style.visibility = "hidden";
        // 2) type the reply character by character (plain text into <b>-less span)
        const span = document.createElement("span");
        chatBox.appendChild(span);
        const text = plain(scene);
        for (let i = 0; i <= text.length; i++) {
          if (!visible) await sleep(300);
          span.textContent = text.slice(0, i);
          await sleep(14);
        }
        await sleep(350);
      }
      // 3) approval bar slides in
      approval.classList.add("shown");
      await sleep(1100);
      // 4) user "clicks" Duyệt
      if (okBtn) {
        okBtn.classList.add("approved-flash");
        await sleep(650);
        okBtn.classList.remove("approved-flash");
      }
      approval.classList.add("approved");
      if (chip) {
        chip.classList.add("tick");
        setTimeout(() => chip.classList.remove("tick"), 550);
      }
      await sleep(1900);
      // 5) reset for the loop
      approval.classList.remove("shown", "approved");
      await sleep(400);
    }
  }
  run();
})();
