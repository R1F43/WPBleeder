// The only file allowed to touch panel/sidebar APIs directly.
// Everything else calls openPanel().
const browser = globalThis.browser || globalThis.chrome;

export async function openPanel(tabId) {
  if (browser.sidePanel && typeof browser.sidePanel.open === 'function') {
    // Chrome: chrome.sidePanel.open()
    return browser.sidePanel.open({ tabId });
  } else if (browser.sidebarAction && typeof browser.sidebarAction.open === 'function') {
    // Firefox: browser.sidebarAction.open()
    return browser.sidebarAction.open();
  }
  throw new Error('No side panel API available');
}

export async function closePanel() {
  if (browser.sidePanel && typeof browser.sidePanel.close === 'function') {
    return browser.sidePanel.close();
  } else if (browser.sidebarAction && typeof browser.sidebarAction.close === 'function') {
    return browser.sidebarAction.close();
  }
}
