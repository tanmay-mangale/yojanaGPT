// Paste your Gemini API key (Google AI Studio). Do not publish the extension with a real key.
const GEMINI_API_KEY = "";

async function getGeminiApiKey() {
  return GEMINI_API_KEY.trim();
}

function buildSummarizePrompt({ title, url, text }) {
  return [
    "You are YojanaGPT, an expert on Indian government scheme pages.",
    "Write a SHORT, scannable summary (not an essay). Use ONLY the page text below. No web search. No invented facts.",
    "Ignore menus, footers, language lists, and huge state/stat tables unless essential.",
    "",
    "Formatting rules (required):",
    "- Start with 1–2 opening lines with a fitting emoji (e.g. 📋 🌾 💰).",
    "- Use a clear emoji at the start of each section line below.",
    "- Use **double asterisks** around the most important terms (amounts, scheme name, dates, mandatory steps).",
    "- Use short bullet lines starting with • or - ; keep bullets tight (one line each where possible).",
    "- Total length: roughly 120–220 words unless the page is tiny.",
    "",
    "Sections (keep each brief):",
    "📌 **What it is** — 1–2 sentences.",
    "💡 **Key benefits** — 2–4 bullets with numbers from the page.",
    "👥 **Who can benefit** — 1–3 bullets.",
    "📝 **How to apply / what to do** — 2–4 bullets (portal, eKYC, registration, status).",
    "⚠️ **Important** — exclusions, deadlines, or warnings if present; else skip.",
    "",
    `Page title: ${title || "-"}`,
    `Page url: ${url || "-"}`,
    "",
    "Page text:",
    text || ""
  ].join("\n");
}

function buildChatPrompt({ title, url, pageText, history, userMessage }) {
  const excerpt = pageText.slice(0, 20000);
  let historyBlock = "";
  for (const m of history) {
    const label = m.role === "user" ? "User" : "Assistant";
    historyBlock += `${label}: ${m.content}\n\n`;
  }
  return [
    "You are YojanaGPT. Answer using ONLY the page content below and the conversation so far.",
    "If the answer is not in the page text, say clearly: 'This is not mentioned on the page you shared.' Do not invent rules, amounts, or dates.",
    "Be concise. Use **bold** for key terms, a few emojis (📌 ✅ ⚠️) where natural, and short bullets when listing steps.",
    "",
    `PAGE TITLE: ${title || "-"}`,
    `URL: ${url || "-"}`,
    "",
    "PAGE CONTENT (context):",
    excerpt || "(empty)",
    "",
    historyBlock ? `CONVERSATION SO FAR:\n${historyBlock}` : "",
    `LATEST USER QUESTION:\n${userMessage}`
  ].join("\n");
}

let cachedModelName = "";

const FETCH_TIMEOUT_MS = 90000;
const LIST_MODELS_TIMEOUT_MS = 25000;

function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(t)
  );
}

async function listGeminiModels({ apiKey, apiVersion }) {
  const base = `https://generativelanguage.googleapis.com/${apiVersion}/models`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_MODELS_TIMEOUT_MS);
  const res = await fetch(`${base}?key=${encodeURIComponent(apiKey)}`, {
    signal: ctrl.signal
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `ListModels HTTP ${res.status}: ${errText || res.statusText}`
    );
  }
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

async function pickWorkingModelName({ apiKey }) {
  if (cachedModelName) return cachedModelName;

  const versionsToTry = ["v1beta", "v1"];
  const preferredContains = [
    "gemini-2.5-flash",
    "gemini-flash",
    "gemini-3-flash",
    "flash"
  ];

  for (const apiVersion of versionsToTry) {
    const models = await listGeminiModels({ apiKey, apiVersion });
    const names = models
      .map((m) => m?.name)
      .filter((n) => typeof n === "string" && n.startsWith("models/"));

    for (const pref of preferredContains) {
      const match = names.find((n) => n.toLowerCase().includes(pref));
      if (match) {
        cachedModelName = match;
        return cachedModelName;
      }
    }

    if (names[0]) {
      cachedModelName = names[0];
      return cachedModelName;
    }
  }

  throw new Error("No models available for this API key.");
}

function parseRetrySecondsFrom429Body(errText) {
  try {
    const j = JSON.parse(errText);
    const details = j?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (d?.["@type"]?.includes("RetryInfo") && d?.retryDelay) {
          const s = String(d.retryDelay);
          const m = s.match(/^(\d+)s$/);
          if (m) return parseInt(m[1], 10);
        }
      }
    }
    const msg = j?.error?.message || "";
    const m2 = msg.match(/retry in ([\d.]+)s/i);
    if (m2) return Math.ceil(parseFloat(m2[1], 10));
  } catch {
    /* ignore */
  }
  return 12;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geminiGenerate({ apiKey, prompt, maxOutputTokens = 2048 }) {
  const modelName = await pickWorkingModelName({ apiKey });
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent`;

  const maxAttempts = 2;
  let lastErrText = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        `${endpoint}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens
            }
          })
        }
      );
    } catch (e) {
      const name = e && e.name;
      if (name === "AbortError") {
        throw new Error(
          `Gemini request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Check network or try again.`
        );
      }
      throw e;
    }

    if (res.status === 429) {
      lastErrText = await res.text().catch(() => "");
      if (attempt < maxAttempts) {
        const waitSec = parseRetrySecondsFrom429Body(lastErrText);
        await sleep(waitSec * 1000 + 500);
        continue;
      }
      throw new Error(
        `Gemini HTTP 429 (quota/rate limit). Free tier is limited (often ~20 requests/day per model). ` +
          `Enable billing in Google AI Studio for higher limits, or wait and retry. Raw: ${lastErrText}`
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (data?.promptFeedback?.blockReason) {
      throw new Error(
        `Prompt blocked: ${data.promptFeedback.blockReason}`
      );
    }
    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    const text =
      cand?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join("") || "";

    const trimmed = text.trim();
    if (trimmed) return trimmed;

    const block = cand?.safetyRatings
      ? JSON.stringify(cand.safetyRatings)
      : "";
    throw new Error(
      `Gemini returned no text (finishReason: ${finish || "unknown"}). ${block ? "Safety: " + block : "Try shorter page text or check API key."}`
    );
  }

  throw new Error(lastErrText || "Gemini request failed after retries.");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      sendResponse({
        ok: false,
        error:
          "Missing Gemini API key. Set GEMINI_API_KEY at the top of background.js."
      });
      return;
    }

    if (message?.action === "summarizePage") {
      const title = message?.payload?.title || "";
      const url = message?.payload?.url || "";
      const rawText = message?.payload?.text || "";
      const text = rawText.slice(0, 56000);

      const prompt = buildSummarizePrompt({ title, url, text });
      const summary = await geminiGenerate({
        apiKey,
        prompt,
        maxOutputTokens: 1536
      });

      sendResponse({ ok: true, summary });
      return;
    }

    if (message?.action === "chatAboutScheme") {
      const title = message?.payload?.title || "";
      const url = message?.payload?.url || "";
      const pageText = message?.payload?.text || "";
      const history = Array.isArray(message?.payload?.history)
        ? message.payload.history
        : [];
      const userMessage = String(message?.payload?.userMessage || "").trim();

      if (!userMessage) {
        sendResponse({ ok: false, error: "Empty message." });
        return;
      }

      const prompt = buildChatPrompt({
        title,
        url,
        pageText,
        history,
        userMessage
      });
      const reply = await geminiGenerate({
        apiKey,
        prompt,
        maxOutputTokens: 2048
      });

      sendResponse({ ok: true, reply });
      return;
    }
  })().catch((err) => {
    let msg = err?.message || String(err);
    if (err?.name === "AbortError") {
      msg = "List models / network timed out. Check connection and API key.";
    }
    sendResponse({ ok: false, error: msg });
  });

  return true;
});
