chrome.action.onClicked.addListener(async (tab) => {
  await chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html'), windowId: tab.windowId});
});
