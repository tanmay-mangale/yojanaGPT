// Ollama runs locally — no cloud API key. Install from https://ollama.com then:
//   ollama pull llama3.2
// Or set OLLAMA_MODEL below to a model you already have (e.g. qwen2.5:7b, mistral).
//
// If the popup shows "Ollama HTTP 403": Ollama blocks unknown browser Origins. Add a
// Windows user env var OLLAMA_ORIGINS = * (or chrome-extension://*) then fully quit
// and restart Ollama (tray icon → Quit). See Ollama docs for OLLAMA_ORIGINS.

/** Base URL without trailing slash */
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";

/** If empty, the first installed model matching MODEL_PREFERENCE_ORDER is used. */
const OLLAMA_MODEL = "";

/** Prefer larger / newer models for clearer summaries (first match wins). */
const MODEL_PREFERENCE_ORDER = [
  "llama3.3",
  "llama3.2",
  "llama3.1",
  "llama3",
  "qwen2.5",
  "qwen2",
  "mistral-nemo",
  "mistral",
  "mixtral",
  "gemma2",
  "phi3",
  "phi4",
  "deepseek-v2",
  "deepseek-coder",
  "deepseek-r1"
];

function getOllamaBaseUrl() {
  return String(OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

function buildSummarizePrompt({ title, url, text }) {
  return [
    "You are YojanaGPT, an expert on Indian government scheme pages.",
    "Write a SHORT, scannable summary (not an essay). Use ONLY the page text below. No web search. No invented facts.",
    "Ignore menus, footers, language lists, and huge state/stat tables unless essential.",
    "",
    "Formatting rules (required):",
    "- Start with 1–2 opening lines with a fitting emoji (e.g. 📋,🌾,💰,🎓,👨‍🎓,🏀,💼,🍛,🌏,👪).",
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

const TRANSLATE_LOCALES = { hi: "Hindi", mr: "Marathi" };

function buildTranslatePrompt({ summaryText, locale }) {
  const lang = TRANSLATE_LOCALES[locale] || "Hindi";
  const scriptNote =
    locale === "mr"
      ? "Use Devanagari script as standard for Marathi."
      : "Use Devanagari script as standard for Hindi.";
  return [
    "You are an expert translator for Indian government scheme summaries.",
    `Translate the ENTIRE text below into ${lang}. ${scriptNote}`,
    "",
    "Rules (required):",
    "- Preserve structure: same line breaks, bullet characters (• or -), section flow, and emojis.",
    "- Keep **double asterisks** around translated important terms (same phrase boundaries as the source).",
    "- Formal, clear tone suitable for citizens reading about schemes.",
    "- Do not add preambles, notes, or \"Here is the translation\" — output ONLY the translated summary.",
    "",
    "TEXT:",
    summaryText || ""
  ].join("\n");
}

let cachedModelName = "";

/** Long enough for cold model load + CPU inference; popup should match. */
const FETCH_TIMEOUT_MS = 240000;
const LIST_MODELS_TIMEOUT_MS = 15000;

/** Huge pages + num_ctx 32k are very slow on CPU; cap input and context for reliable replies. */
const MAX_SUMMARY_PAGE_CHARS = 22000;
const MAX_CHAT_PAGE_CHARS = 20000;

/**
 * Ollama allocates KV cache from num_ctx — keep it tight to speed up summaries on laptops.
 * Rough token guess: ~4 chars per token; leave room for the answer.
 */
function numCtxForPrompt(promptLength) {
  const estTokens = Math.ceil(promptLength / 4);
  const want = Math.min(16384, Math.max(4096, estTokens + 2800));
  const step = 1024;
  return Math.ceil(want / step) * step;
}

function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(t)
  );
}

async function listOllamaModels(baseUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_MODELS_TIMEOUT_MS);
  const res = await fetch(`${baseUrl}/api/tags`, {
    signal: ctrl.signal
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Ollama list models HTTP ${res.status}: ${errText || res.statusText}`
    );
  }
  const data = await res.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.map((m) => m?.name).filter((n) => typeof n === "string" && n);
}

async function pickWorkingModelName(baseUrl) {
  if (cachedModelName) return cachedModelName;

  const configured = String(OLLAMA_MODEL || "").trim();
  const names = await listOllamaModels(baseUrl);
  if (!names.length) {
    throw new Error(
      "No Ollama models found. Run: ollama pull llama3.2 (or another model), then retry."
    );
  }

  if (configured) {
    const exact = names.find((n) => n === configured);
    if (exact) {
      cachedModelName = exact;
      return cachedModelName;
    }
    const tagNoVer = configured.split(":")[0].toLowerCase();
    const fuzzy = names.find(
      (n) =>
        n.toLowerCase() === configured.toLowerCase() ||
        n.toLowerCase().startsWith(tagNoVer + ":")
    );
    if (fuzzy) {
      cachedModelName = fuzzy;
      return cachedModelName;
    }
    /* configured name not installed — fall back to best available */
  }

  const lower = names.map((n) => ({ n, l: n.toLowerCase() }));
  for (const pref of MODEL_PREFERENCE_ORDER) {
    const p = pref.toLowerCase();
    const hit = lower.find(({ l }) => l.includes(p));
    if (hit) {
      cachedModelName = hit.n;
      return cachedModelName;
    }
  }

  cachedModelName = names[0];
  return cachedModelName;
}

/**
 * Long scheme pages need a large context window; num_ctx is capped by the model in Ollama.
 */
async function ollamaGenerate({
  baseUrl,
  prompt,
  maxOutputTokens = 2048,
  numCtx: numCtxArg
}) {
  const model = await pickWorkingModelName(baseUrl);
  const url = `${baseUrl}/api/generate`;
  const numCtx =
    typeof numCtxArg === "number" && numCtxArg > 0
      ? numCtxArg
      : numCtxForPrompt(prompt.length);

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.25,
          top_p: 0.92,
          num_predict: maxOutputTokens,
          num_ctx: numCtx,
          repeat_penalty: 1.08
        }
      })
    });
  } catch (e) {
    const name = e && e.name;
    if (name === "AbortError") {
      throw new Error(
        `Ollama request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Is Ollama running? Try a smaller page or a faster model.`
      );
    }
    const msg = e?.message || String(e);
    if (/fetch|network|failed|load/i.test(msg) || name === "TypeError") {
      throw new Error(
        `Cannot reach Ollama at ${baseUrl}. Start the Ollama app, then retry. (${msg})`
      );
    }
    throw e;
  }

  if (res.status === 404) {
    const base = model.split(":")[0] || model;
    throw new Error(
      `Ollama: model "${model}" not found. Run: ollama pull ${base}`
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${errText || res.statusText}`);
  }

  const data = await res.json();
  const text = typeof data?.response === "string" ? data.response : "";
  const trimmed = text.trim();
  if (trimmed) return trimmed;

  const detail = data?.error || "empty response";
  throw new Error(
    `Ollama returned no text (model: ${model}). ${detail}. Try another model or shorten the page.`
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const baseUrl = getOllamaBaseUrl();

    if (message?.action === "summarizePage") {
      const title = message?.payload?.title || "";
      const url = message?.payload?.url || "";
      const rawText = message?.payload?.text || "";
      const text = rawText.slice(0, MAX_SUMMARY_PAGE_CHARS);

      const prompt = buildSummarizePrompt({ title, url, text });
      const summary = await ollamaGenerate({
        baseUrl,
        prompt,
        maxOutputTokens: 1536
      });

      sendResponse({ ok: true, summary });
      return;
    }

    if (message?.action === "chatAboutScheme") {
      const title = message?.payload?.title || "";
      const url = message?.payload?.url || "";
      const pageText = (message?.payload?.text || "").slice(0, MAX_CHAT_PAGE_CHARS);
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
      const reply = await ollamaGenerate({
        baseUrl,
        prompt,
        maxOutputTokens: 2048
      });

      sendResponse({ ok: true, reply });
      return;
    }

    if (message?.action === "translateSummary") {
      const summaryText = String(message?.payload?.text || "").trim();
      const locale = message?.payload?.locale;
      if (!summaryText) {
        sendResponse({ ok: false, error: "Nothing to translate." });
        return;
      }
      if (locale !== "hi" && locale !== "mr") {
        sendResponse({ ok: false, error: "Invalid locale (use hi or mr)." });
        return;
      }
      const clipped = summaryText.slice(0, 14000);
      const prompt = buildTranslatePrompt({ summaryText: clipped, locale });
      const translated = await ollamaGenerate({
        baseUrl,
        prompt,
        maxOutputTokens: 2048
      });
      sendResponse({ ok: true, translated });
      return;
    }

    sendResponse({
      ok: false,
      error: `Unknown action: ${String(message?.action || "")}`
    });
  })().catch((err) => {
    let msg = err?.message || String(err);
    if (err?.name === "AbortError") {
      msg =
        "Ollama list-models / request timed out. Ensure Ollama is running and not overloaded.";
    }
    sendResponse({ ok: false, error: msg });
  });

  return true;
});
