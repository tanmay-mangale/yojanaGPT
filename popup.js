const SUMMARY_TIMEOUT_MS = 100000;

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

window.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: "getPageData" }, async (response) => {
    if (!response) {
      document.getElementById("pageTitle").textContent = "Could not read page.";
      document.getElementById("highlightStatus").textContent =
        "❌ Please refresh the tab and try again.";
      return;
    }

    document.getElementById("pageTitle").textContent = response.title;
    document.getElementById("pageURL").textContent = response.url;

    document.getElementById("highlightStatus").textContent =
      "✅ Action links highlighted on the page!";

    const textOutput = document.getElementById("textOutput");
    textOutput.textContent = "⏳ Summarising this scheme with Gemini...";

    try {
      const result = await withTimeout(
        sendMessageAsync({
          action: "summarizePage",
          payload: {
            title: response.title,
            url: response.url,
            text: response.text
          }
        }),
        SUMMARY_TIMEOUT_MS,
        "No reply from background (timed out)"
      );

      if (!result || typeof result !== "object") {
        textOutput.textContent =
          "❌ Empty response from extension. Reload YojanaGPT on chrome://extensions and try again.";
        return;
      }

      if (!result.ok) {
        textOutput.textContent = `❌ ${result.error || "Failed to summarise."}`;
        return;
      }

      textOutput.textContent = result.summary || "(No summary returned.)";
    } catch (e) {
      textOutput.textContent = `❌ ${e?.message || String(e)}`;
    }
  });
});
