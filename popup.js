window.addEventListener("DOMContentLoaded", async () => {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: "getPageData" }, (response) => {

    if (!response) {
      document.getElementById("textOutput").textContent = "Could not read page. Refresh and try.";
      return;
    }

    // Fill title and URL
    console.log(response.title)
    document.getElementById("pageTitle").textContent = response.title;
    document.getElementById("pageURL").textContent = response.url;

    // Show extracted text
    document.getElementById("textOutput").textContent = response.text;
  });

}); 