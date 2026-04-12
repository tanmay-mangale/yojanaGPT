window.addEventListener("DOMContentLoaded", async () => {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: "getPageData" }, (response) => {

    if (!response) {
      document.getElementById("pageTitle").textContent = "Could not read page.";
      document.getElementById("highlightStatus").textContent = "❌ Please refresh and try again.";
      return;
    }

    // Fill page info
    document.getElementById("pageTitle").textContent = response.title;
    document.getElementById("pageURL").textContent = response.url;

    // Show status
    document.getElementById("highlightStatus").textContent =
      "✅ Action links highlighted on the page!";

    // Show page text
    document.getElementById("textOutput").textContent = response.text;

  });

});