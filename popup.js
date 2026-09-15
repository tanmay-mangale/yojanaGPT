/** Must be ≥ background Ollama fetch timeout so the popup does not give up first. */
const SUMMARY_TIMEOUT_MS = 250000;

/** @type {{ title: string, url: string, text: string } | null} */
let pageSnapshot = null;

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let chatHistory = [];

/** English summary from Ollama (markdown); used for हिंदी / मराठी translation. */
let lastSummaryEnglish = "";

function hideTranslateError() {
  const el = document.getElementById("translateError");
  if (!el) return;
  el.textContent = "";
  el.setAttribute("hidden", "");
}

function showTranslateError(msg) {
  const el = document.getElementById("translateError");
  if (!el) return;
  el.textContent = msg;
  el.removeAttribute("hidden");
}

function setTranslateActive(locale) {
  const btnEn = document.getElementById("btnLangEn");
  const btnHi = document.getElementById("btnLangHi");
  const btnMr = document.getElementById("btnLangMr");
  btnEn?.classList.toggle("active", locale === "en");
  btnHi?.classList.toggle("active", locale === "hi");
  btnMr?.classList.toggle("active", locale === "mr");
}

function setTranslateButtonsDisabled(disabled) {
  for (const id of ["btnLangEn", "btnLangHi", "btnLangMr"]) {
    const b = document.getElementById(id);
    if (b) b.disabled = disabled;
  }
}

function wireTranslateButtons() {
  const summaryBlock = document.getElementById("summaryBlock");
  document.getElementById("btnLangEn")?.addEventListener("click", () => {
    if (!lastSummaryEnglish) return;
    hideTranslateError();
    setFormattedHtml(summaryBlock, lastSummaryEnglish);
    setTranslateActive("en");
  });
  document.getElementById("btnLangHi")?.addEventListener("click", () => {
    void translateSummaryTo("hi");
  });
  document.getElementById("btnLangMr")?.addEventListener("click", () => {
    void translateSummaryTo("mr");
  });
}

async function translateSummaryTo(locale) {
  const summaryBlock = document.getElementById("summaryBlock");
  if (!lastSummaryEnglish || (locale !== "hi" && locale !== "mr")) return;

  hideTranslateError();
  setTranslateButtonsDisabled(true);
  setPlainMessage(
    summaryBlock,
    locale === "hi"
      ? "⏳ Translating summary to Hindi…"
      : "⏳ Translating summary to Marathi…"
  );

  try {
    const result = await withTimeout(
      sendMessageAsync({
        action: "translateSummary",
        payload: { text: lastSummaryEnglish, locale }
      }),
      SUMMARY_TIMEOUT_MS,
      "Translation timed out"
    );

    if (!result || typeof result !== "object") {
      showTranslateError("No response from extension.");
      setFormattedHtml(summaryBlock, lastSummaryEnglish);
      setTranslateActive("en");
      return;
    }

    if (!result.ok) {
      showTranslateError(result.error || "Translation failed.");
      setFormattedHtml(summaryBlock, lastSummaryEnglish);
      setTranslateActive("en");
      return;
    }

    const translated = (result.translated || "").trim();
    if (!translated) {
      showTranslateError("Model returned empty translation.");
      setFormattedHtml(summaryBlock, lastSummaryEnglish);
      setTranslateActive("en");
      return;
    }

    setFormattedHtml(summaryBlock, translated);
    setTranslateActive(locale);
  } catch (e) {
    showTranslateError(e?.message || String(e));
    setFormattedHtml(summaryBlock, lastSummaryEnglish);
    setTranslateActive("en");
  } finally {
    setTranslateButtonsDisabled(false);
  }
}

function sendMessageAsync(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label} (${ms / 1000}s). Reload the extension, open the page, then try the popup again.`
            )
          ),
        ms
      )
    )
  ]);
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

/**
 * Turn model text (with **bold**, bullets, ##) into safe HTML.
 */
function aiTextToSafeHtml(raw) {
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    let h = escapeHtml(line);
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    if (/^#{2,3}\s+/.test(trimmed)) {
      const titleText = trimmed.replace(/^#{2,3}\s+/, "");
      const inner = escapeHtml(titleText).replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>"
      );
      out.push(`<p class="ai-md-h">${inner}</p>`);
      continue;
    }
    if (/^[-•◦]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      out.push(`<p class="ai-md-li">${h}</p>`);
      continue;
    }
    if (!trimmed) {
      out.push("<br>");
      continue;
    }
    out.push(`<p class="ai-md-p">${h}</p>`);
  }
  return out.join("");
}

function setFormattedHtml(el, raw) {
  el.classList.add("ai-formatted");
  el.innerHTML = aiTextToSafeHtml(raw);
}

function setPlainMessage(el, text) {
  el.classList.remove("ai-formatted");
  el.textContent = text;
}

function enableChat() {
  const input = document.getElementById("chatInput");
  const btn = document.getElementById("sendBtn");
  const wrap = document.getElementById("inputWrapper");
  input.disabled = false;
  btn.disabled = false;
  input.placeholder = "Ask anything about this page / scheme…";
  input.style.opacity = "1";
  input.style.cursor = "text";
  wrap.classList.add("input-ready");
  btn.style.cursor = "pointer";
  document.getElementById("followupLabel")?.removeAttribute("hidden");
}

function appendMessage(role, text) {
  const container = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = role === "user" ? "message user-msg" : "message ai-msg";
  if (role === "user") {
    div.textContent = text;
  } else {
    setFormattedHtml(div, text);
  }
  container.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text || !pageSnapshot) return;

  input.value = "";
  appendMessage("user", text);

  const loading = document.createElement("div");
  loading.className = "message ai-msg chat-pending";
  loading.textContent = "⏳ Thinking…";
  document.getElementById("chatMessages").appendChild(loading);
  loading.scrollIntoView({ behavior: "smooth", block: "end" });

  const historyForApi = chatHistory.map((m) => ({
    role: m.role,
    content: m.content
  }));

  try {
    const result = await withTimeout(
      sendMessageAsync({
        action: "chatAboutScheme",
        payload: {
          title: pageSnapshot.title,
          url: pageSnapshot.url,
          text: pageSnapshot.text,
          history: historyForApi,
          userMessage: text
        }
      }),
      SUMMARY_TIMEOUT_MS,
      "Chat request timed out"
    );

    loading.remove();

    if (!result || typeof result !== "object") {
      appendMessage("assistant", "❌ No response from extension.");
      return;
    }

    if (!result.ok) {
      const errDiv = document.createElement("div");
      errDiv.className = "message ai-msg";
      errDiv.textContent = `❌ ${result.error || "Chat failed."}`;
      document.getElementById("chatMessages").appendChild(errDiv);
      errDiv.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    const reply = result.reply || "(No reply.)";
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: reply });
    appendMessage("assistant", reply);
  } catch (e) {
    loading.remove();
    appendMessage("assistant", `❌ ${e?.message || String(e)}`);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const sendBtn = document.getElementById("sendBtn");
  const chatInput = document.getElementById("chatInput");

  sendBtn.addEventListener("click", () => sendChat());
  wireTranslateButtons();
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  chrome.tabs.sendMessage(tab.id, { action: "getPageData" }, async (response) => {
    const summaryBlock = document.getElementById("summaryBlock");

    if (!response) {
      document.getElementById("pageTitle").textContent = "Could not read page.";
      document.getElementById("highlightStatus").textContent =
        "❌ Please refresh the tab and try again.";
      setPlainMessage(summaryBlock, "❌ Could not read page text.");
      return;
    }

    pageSnapshot = {
      title: response.title,
      url: response.url,
      text: response.text || ""
    };

    document.getElementById("pageTitle").textContent = response.title;
    document.getElementById("pageURL").textContent = response.url;

    document.getElementById("highlightStatus").textContent =
      "✅ Action links highlighted on the page!";

    setPlainMessage(
      summaryBlock,
      "⏳ Summarising with Ollama… (first load of a model can take 1–3 min on CPU — keep this popup open.)"
    );

    try {
      const result = await withTimeout(
        sendMessageAsync({
          action: "summarizePage",
          payload: {
            title: pageSnapshot.title,
            url: pageSnapshot.url,
            text: pageSnapshot.text
          }
        }),
        SUMMARY_TIMEOUT_MS,
        "No reply from background (timed out)"
      );

      if (!result || typeof result !== "object") {
        setPlainMessage(
          summaryBlock,
          "❌ Empty response from extension. Reload YojanaGPT on chrome://extensions and try again."
        );
        return;
      }

      if (!result.ok) {
        setPlainMessage(
          summaryBlock,
          `❌ ${result.error || "Failed to summarise."}`
        );
        return;
      }

      const summaryText = result.summary || "(No summary returned.)";
      lastSummaryEnglish = summaryText;
      setFormattedHtml(summaryBlock, summaryText);
      document.getElementById("translateToolbar")?.removeAttribute("hidden");
      hideTranslateError();
      setTranslateActive("en");
      enableChat();
    } catch (e) {
      setPlainMessage(summaryBlock, `❌ ${e?.message || String(e)}`);
    }
  });
});
