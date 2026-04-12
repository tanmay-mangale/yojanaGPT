chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "getPageData") {

    const text = document.body.innerText;

    const anchors = [...document.querySelectorAll("a")]
      .map(el => ({
        text: el.innerText.trim(),
        href: el.href || "",
        className: el.className || "",
      }))
      .filter(el => el.text.length > 1);

    sendResponse({
      text,
      title: document.title,
      url: window.location.href,
      anchors
    });

    highlightActionLinks();
  }

});


// ── MAIN FUNCTION ──
function highlightActionLinks() {

  // ✅ Inject styles (only once)
  if (!document.getElementById("yojana-style")) {
    const style = document.createElement("style");
    style.id = "yojana-style";

style.innerText = `

/* ───────── MAIN CTA BUTTON ───────── */
.yojana-highlight {
  position: relative !important;
  border-radius: 12px !important;

  background: linear-gradient(135deg, #22c55e, #16a34a) !important;
  color: white !important;

  font-weight: 700 !important;
  padding: 8px 14px !important;

  box-shadow:
    0 0 0 3px rgba(34,197,94,0.6),
    0 10px 30px rgba(34,197,94,0.5) !important;

  transform: scale(1.05) !important;
  animation: pulseGlow 1.6s infinite !important;

  transition: all 0.25s ease !important;
  cursor: pointer !important;
  z-index: 9999 !important;
}

/* Hover = premium feel */
.yojana-highlight:hover {
  transform: scale(1.12) translateY(-3px) !important;
  box-shadow:
    0 0 0 5px rgba(34,197,94,0.8),
    0 15px 40px rgba(34,197,94,0.8) !important;
}

/* ───────── PULSE ANIMATION ───────── */
@keyframes pulseGlow {
  0% { transform: scale(1.05); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1.05); }
}

/* ───────── SMART TAG (LIKE AI SUGGESTION) ───────── */
.yojana-tag {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;

  background: linear-gradient(135deg, #1e293b, #334155) !important;
  color: #facc15 !important;

  font-size: 11px !important;
  font-weight: 800 !important;

  padding: 5px 12px !important;
  border-radius: 999px !important;

  margin-bottom: 6px !important;
  font-family: Arial, sans-serif !important;

  box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;

  animation: tagFloat 1.5s ease-in-out infinite !important;
  pointer-events: none !important;
}

/* Floating effect */
@keyframes tagFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

/* ───────── ARROW POINTER (VERY IMPORTANT) ───────── */
.yojana-tag::after {
  content: "";
  position: absolute;
  bottom: -6px;
  left: 20px;

  width: 10px;
  height: 10px;

  background: #334155;
  transform: rotate(45deg);
}

/* ───────── SCREEN DIM EFFECT (FOCUS USER) ───────── */
.yojana-dim {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  background: rgba(0,0,0,0.5);
  z-index: 9998;

  backdrop-filter: blur(2px);
}

`;

    document.head.appendChild(style);
  }

  // Keywords
  const actionKeywords = [
    "register","login","apply","status","update","edit","check",
    "download","helpdesk","grievance","refund","surrender",
    "beneficiary","kyc","correction","new farmer","search",
    "ekyc","know your"
  ];

  const actionParentClasses = [
    "farmerbox","quickaction","newtitle","action","btn","button"
  ];

  // Clear old highlights
  document.querySelectorAll(".yojana-highlight")
    .forEach(el => el.classList.remove("yojana-highlight"));

  document.querySelectorAll(".yojana-tag")
    .forEach(el => el.remove());


  let firstHighlighted = null;

  // 🔥 LOOP THROUGH LINKS
  document.querySelectorAll("a").forEach(el => {

    const text = el.innerText.trim().toLowerCase();
    const parentClass = el.parentElement ? el.parentElement.className.toLowerCase() : "";
    const ownClass = el.className.toLowerCase();

    const isNavOrFooter =
      parentClass.includes("mainnavi") ||
      parentClass.includes("footerlink") ||
      parentClass.includes("hometopmenu") ||
      parentClass.includes("sub-menu") ||
      parentClass.includes("dropdown-menu");

    if (isNavOrFooter || text.length < 2) return;

    const matchedByText = actionKeywords.some(k => text.includes(k));
    const matchedByClass = actionParentClasses.some(k =>
      parentClass.includes(k) || ownClass.includes(k)
    );

    if (matchedByText || matchedByClass) {

      // Highlight
      el.classList.add("yojana-highlight");

      // Add tag
      const tag = document.createElement("div");
      tag.className = "yojana-tag";
      tag.innerText = "🔗"+el.innerText.trim();

      el.parentNode.insertBefore(tag, el);

      // Save first for scroll
      if (!firstHighlighted) firstHighlighted = el;
    }

  });

  // Auto scroll to first important button
  if (firstHighlighted) {
    firstHighlighted.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }
}