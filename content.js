chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageData") {
    sendResponse({
      text: document.body.innerText,
      title: document.title,
      url: window.location.href
    });
  }
});