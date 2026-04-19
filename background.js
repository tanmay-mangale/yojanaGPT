// Paste your Gemini API key (Google AI Studio). Do not publish the extension with a real key.
const GEMINI_API_KEY = "";

async function getGeminiApiKey() {
  return GEMINI_API_KEY.trim();
}

function buildSummarizePrompt({ title, url, text }) {
  return [
    "You are YojanaGPT, a government scheme assistant.",
    "Summarize the government scheme/page in short, simple language.",
    "Use ONLY the provided page text. Do NOT browse the web or assume facts not present.",
    "Ignore navigation menus, language lists, state lists, charts, big number tables, and footer links.",
    "",
    "Output format:",
    "- Title line: scheme or page name (from text or page title).",
    "- 1 short paragraph (2-4 lines).",
    "- Then 5-10 bullets: benefits, who it is for, how to apply if mentioned, key dates/notes, exclusions if present.",
    "",
    `Page title: ${title || "-"}`,
    `Page url: ${url || "-"}`,
    "",
    "Page text:",
    text || ""
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

async function geminiGenerate({ apiKey, prompt }) {
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
              temperature: 0.2,
              maxOutputTokens: 900
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
    if (message?.action !== "summarizePage") return;

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      sendResponse({
        ok: false,
        error:
          "Missing Gemini API key. Set GEMINI_API_KEY at the top of background.js."
      });
      return;
    }

    const title = message?.payload?.title || "";
    const url = message?.payload?.url || "";
    const rawText = message?.payload?.text || "";

    const text = rawText.slice(0, 24000);

    const prompt = buildSummarizePrompt({ title, url, text });
    const summary = await geminiGenerate({ apiKey, prompt });

    sendResponse({ ok: true, summary });
  })().catch((err) => {
    let msg = err?.message || String(err);
    if (err?.name === "AbortError") {
      msg = "List models / network timed out. Check connection and API key.";
    }
    sendResponse({ ok: false, error: msg });
  });

  return true;
});
