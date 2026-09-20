/**
 * WPBleeder — Background Service Worker / Event Page
 *
 * Message router + scan orchestration. All event listeners registered
 * synchronously at top-level (required for Chrome service worker wakeup).
 *
 * NEVER touches DOM. All network requests originate from here.
 */

import { ScanQueue } from './queue.js';
import { detectWAF } from './waf-detect.js';
import { getPathTasks, createExtraPathTask } from './scan-paths.js';
import { scanXmlrpc } from './scan-xmlrpc.js';
import { scanUsers } from './scan-users.js';
import { scanAdmin } from './scan-admin.js';
import { getPluginTasks } from './scan-plugins.js';
import { getThemeTasks } from './scan-themes.js';
import { scanMedia } from './scan-media.js';
import { aggregateFindings } from './findings.js';
import { lookupPluginVulns, lookupThemeVulns, lookupCoreVulns, lookupVulnerabilities } from './wpscan-api.js';

const browser = globalThis.browser || globalThis.chrome;

let scanState = {
  isScanning: false,
  aborted: false,
  abortController: null,
  currentDomain: null,
  queue: null
};

function isScanAborted() {
  return scanState.aborted || !scanState.isScanning || Boolean(scanState.abortController?.signal?.aborted);
}

// ============================================================
// TOP-LEVEL EVENT LISTENERS (must be synchronous registration)
// ============================================================

// Message router
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return true to indicate we'll respond asynchronously
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // keep message channel open for async response
});

// Action click → open side panel
// In Chrome, configure the side panel to open on action click.
// In Firefox, the sidebar_action manifest key handles this automatically.
try {
  if (browser.sidePanel && typeof browser.sidePanel.setPanelBehavior === 'function') {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error('Error setting panel behavior:', error));
  }
} catch (e) {
  console.error('setPanelBehavior error:', e);
}

// In Firefox, set sidebar icon explicitly
try {
  if (browser.sidebarAction && typeof browser.sidebarAction.setIcon === 'function') {
    browser.sidebarAction.setIcon({
      path: {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png"
      }
    }).catch(() => {});
  }
} catch (e) {}

// In Firefox, toggle the sidebar on action icon click
try {
  if (browser.sidebarAction && browser.action && typeof browser.action.onClicked?.addListener === 'function') {
    browser.action.onClicked.addListener(() => {
      try {
        // Must be called synchronously to maintain user input context in Firefox
        if (typeof browser.sidebarAction.toggle === 'function') {
          browser.sidebarAction.toggle();
        } else if (typeof browser.sidebarAction.open === 'function') {
          browser.sidebarAction.open();
        }
      } catch (err) {
        console.error('sidebarAction toggle error:', err);
      }
    });
  }
} catch (e) {
  console.error('sidebarAction listener error:', e);
}

// Clean up temporary scan data when the browser launches to prevent disk bloat.
// All settings:* (including settings:wpscanApiKey and user preferences) are preserved.
if (browser.runtime?.onStartup) {
  browser.runtime.onStartup.addListener(async () => {
    try {
      const all = await browser.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter(k =>
        k.startsWith('scan:') ||
        k.startsWith('wpscan:') ||
        k.startsWith('session:')
      );
      if (keysToRemove.length > 0) {
        await browser.storage.local.remove(keysToRemove);
      }
    } catch (e) {
      console.error('Startup storage cleanup error:', e);
    }
  });
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

async function handleMessage(message, sender) {
  switch (message.type) {

    case 'PASSIVE_RESULTS':
      return handlePassiveResults(message.data, sender);

    case 'NOT_WORDPRESS':
      // Content script reports page is not WordPress — nothing to do
      return { ok: true };

    case 'START_SCAN':
      return handleStartScan(message.data);

    case 'ABORT_SCAN':
      return handleAbortScan(message.data);

    case 'GET_STATE':
      return handleGetState(message.data);

    case 'GET_PASSIVE_DATA':
      return handleGetPassiveData(message.data);

    case 'GET_SCAN_RESULTS':
      return handleGetScanResults(message.data);

    case 'CLEAR_DOMAIN_DATA':
      return handleClearDomainData(message.data);

    case 'RUN_WPSCAN_CHECK':
      return handleRunWpscanCheck(message.data);

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ============================================================
// CLEAR DOMAIN DATA / RESET
// ============================================================

async function handleClearDomainData(data) {
  if (!data?.domain) return { ok: false };
  const domain = data.domain;

  if (scanState.isScanning && scanState.currentDomain === domain) {
    if (scanState.queue) scanState.queue.abort();
    scanState.isScanning = false;
  }

  const allStorage = await browser.storage.local.get(null);
  const activePrefix = `scan:${domain}:active:`;
  const keysToRemove = [];
  for (const k of Object.keys(allStorage)) {
    if (k.startsWith(activePrefix) || k === `wpscan:${domain}:latest`) {
      keysToRemove.push(k);
    }
  }
  if (keysToRemove.length > 0) {
    await browser.storage.local.remove(keysToRemove);
  }
  await clearSession(domain);
  return { ok: true };
}

// ============================================================
// PASSIVE RESULTS
// ============================================================

async function handlePassiveResults(data, sender) {
  if (!data || !data.domain) return { ok: false };

  // Check if extension is enabled
  const settings = await browser.storage.local.get({ 'settings:enabled': true });
  if (!settings['settings:enabled']) {
    return { ok: false, error: 'Extension is disabled' };
  }

  // 1. Immediately store initial passive data so the UI updates instantly (<10ms)
  const key = `scan:${data.domain}:passive`;
  await browser.storage.local.set({ [key]: data });

  // Notify panel immediately
  try {
    await browser.runtime.sendMessage({
      type: 'PASSIVE_UPDATE',
      data: data
    });
  } catch (e) {
    // Panel might not be open — that's fine
  }

  // 2. Non-blocking background WAF probe to enrich security data
  (async () => {
    try {
      const targetUrl = data.url || `https://${data.domain}`;
      const wafCheck = await detectWAF(targetUrl);
      if (wafCheck && wafCheck.detected && wafCheck.vendor) {
        if (!data.security) data.security = [];
        const vendorLower = wafCheck.vendor.toLowerCase();
        const alreadyHas = data.security.some(s => s.name.toLowerCase().includes(vendorLower) || vendorLower.includes(s.name.toLowerCase()));
        if (!alreadyHas) {
          data.security.push({
            name: wafCheck.vendor,
            vendor: wafCheck.vendor,
            type: wafCheck.type || 'proxy',
            source: 'response-header'
          });
          await browser.storage.local.set({ [key]: data });
          try {
            await browser.runtime.sendMessage({
              type: 'PASSIVE_UPDATE',
              data: data
            });
          } catch (e) {}
        }
      }
    } catch (e) {
      // Header probe failed or blocked
    }
  })();

  // 3. Non-blocking background Core Version enrichment via /feed/ (catches core version when meta generator is removed)
  (async () => {
    try {
      if (data.wpVersion?.meta) return; // already have explicit meta generator version

      const origin = data.url ? new URL(data.url).origin : `https://${data.domain}`;
      const feedUrl = data.wpVersion?.feedUrl || `${origin}/feed/`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);

      const resp = await fetch(feedUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (resp.ok) {
        const text = await resp.text();
        const match = text.match(/wordpress\.org\/\?v=([\d.]+)/i) || text.match(/<generator>WordPress\s+([\d.]+)<\/generator>/i);
        if (match && match[1]) {
          if (!data.wpVersion) data.wpVersion = { meta: null, assets: null, mismatch: false };
          data.wpVersion.feed = match[1];
          if (!data.wpVersion.meta) {
            data.wpVersion.meta = match[1];
          }
          if (data.wpVersion.assets && data.wpVersion.meta !== data.wpVersion.assets) {
            data.wpVersion.mismatch = true;
          }
          await browser.storage.local.set({ [key]: data });
          try {
            await browser.runtime.sendMessage({
              type: 'PASSIVE_UPDATE',
              data: data
            });
          } catch (e) {}
        }
      }
    } catch (e) {
      // Feed fetch failed or timed out — ignore
    }
  })();

  return { ok: true };
}

// ============================================================
// ACTIVE SCAN
// ============================================================

async function handleStartScan(data) {
  // Check if extension is enabled
  const settings = await browser.storage.local.get({ 'settings:enabled': true });
  if (!settings['settings:enabled']) {
    return { ok: false, error: 'Extension is disabled' };
  }

  if (scanState.isScanning) {
    return { ok: false, error: 'Scan already in progress' };
  }

  const { domain, url, categories, passiveData } = data;
  if (!domain || !categories || categories.length === 0) {
    return { ok: false, error: 'Missing domain or categories' };
  }

  const origin = new URL(url || `https://${domain}`).origin;

  scanState.isScanning = true;
  scanState.aborted = false;
  scanState.abortController = new AbortController();
  scanState.currentDomain = domain;

  // Run scan in the background (don't await — respond immediately)
  runActiveScan(origin, domain, categories, passiveData).catch(err => {
    if (scanState.aborted || err.name === 'AbortError') {
      return;
    }
    console.error('Scan error:', err);
    notifyPanel({ type: 'SCAN_ABORTED', reason: err.message, domain });
  }).finally(() => {
    scanState.isScanning = false;
    scanState.queue = null;
    scanState.abortController = null;
  });

  return { ok: true, status: 'started' };
}

async function runActiveScan(origin, domain, categories, passiveData) {
  // Load settings
  const settings = await browser.storage.local.get({
    'settings:concurrency': 5,
    'settings:delayMs': 200
  });

  // Load existing latest active scan for this domain to merge incrementally
  const allStorage = await browser.storage.local.get(null);
  const prefix = `scan:${domain}:active:`;
  let existingResults = null;
  let latestTs = 0;
  for (const k of Object.keys(allStorage)) {
    if (k.startsWith(prefix)) {
      const ts = parseInt(k.slice(prefix.length), 10);
      if (ts > latestTs) {
        latestTs = ts;
        existingResults = allStorage[k];
      }
    }
  }

  const mergedCategories = Array.from(new Set([...(existingResults?.categoriesRun || []), ...categories]));

  const results = {
    paths: existingResults?.paths ? [...existingResults.paths] : [],
    plugins: existingResults?.plugins ? [...existingResults.plugins] : [],
    users: existingResults?.users ? [...existingResults.users] : [],
    themes: existingResults?.themes ? [...existingResults.themes] : [],
    media: existingResults?.media ? [...existingResults.media] : [],
    xmlrpc: existingResults?.xmlrpc || null,
    admin: existingResults?.admin || null,
    findings: existingResults?.findings ? [...existingResults.findings] : [],
    vulnerabilities: existingResults?.vulnerabilities ? [...existingResults.vulnerabilities] : [],
    categoriesRun: mergedCategories
  };

  const signal = scanState.abortController?.signal;

  // --- WAF Gate ---
  notifyPanel({ type: 'STATUS_UPDATE', status: 'scanning' });

  if (isScanAborted()) { await onAborted(domain); return; }

  const wafResult = await detectWAF(origin, signal);
  if (isScanAborted()) { await onAborted(domain); return; }

  if (wafResult.detected) {
    notifyPanel({
      type: 'WAF_DETECTED',
      vendor: wafResult.vendor
    });

    results.wafDetected = true;
    results.wafVendor = wafResult.vendor;

    // Only halt scan if actively blocked or presented with a challenge page (HTTP 403 / 503)
    if (wafResult.challenge) {
      const timestamp = Date.now();
      const activeKey = `scan:${domain}:active:${timestamp}`;
      const latestKey = `scan:${domain}:active:latest`;
      await browser.storage.local.set({
        [activeKey]: { ...results, timestamp },
        [latestKey]: { ...results, timestamp }
      });
      await clearSession(domain);
      return;
    }
  }

  // --- Run selected categories ---

  // Track total tasks for overall progress
  let totalTasks = 0;
  let completedTasks = 0;

  function onTaskProgress(progress) {
    if (isScanAborted()) return;
    notifyPanel({
      type: 'SCAN_PROGRESS',
      progress: {
        completed: completedTasks + progress.completed,
        total: totalTasks,
        percent: totalTasks > 0 ? Math.round(((completedTasks + progress.completed) / totalTasks) * 100) : 0
      }
    });
  }

  // Paths
  if (categories.includes('paths')) {
    if (isScanAborted()) { await onAborted(domain); return; }
    const pathTasks = getPathTasks(origin, signal);
    totalTasks += pathTasks.length;

    const queue = new ScanQueue({
      concurrency: settings['settings:concurrency'],
      delayMs: settings['settings:delayMs'],
      domain,
      signal,
      onProgress: (progress, itemResult) => {
        if (isScanAborted()) return;
        onTaskProgress(progress);
        if (itemResult && !itemResult.error) {
          notifyPanel({
            type: 'SCAN_PROGRESS',
            category: 'paths',
            result: itemResult,
            progress: {
              completed: completedTasks + progress.completed,
              total: totalTasks,
              percent: totalTasks > 0 ? Math.round(((completedTasks + progress.completed) / totalTasks) * 100) : 0
            }
          });
        }
      }
    });
    scanState.queue = queue;

    pathTasks.forEach(t => queue.enqueue(t));
    const probedPaths = await queue.run();
    if (isScanAborted()) { await onAborted(domain); return; }
    completedTasks += probedPaths.length;

    // Merge into results.paths deduplicating by path
    const pathMap = new Map(results.paths.map(p => [p.path, p]));
    for (const p of probedPaths) {
      pathMap.set(p.path, p);
    }

    // Check if robots.txt discovered extra disallow paths
    const robotsResult = probedPaths.find(p => p.path === '/robots.txt' && p.robotsData);
    if (robotsResult?.robotsData?.customPaths?.length > 0) {
      const existingPathKeys = new Set(pathMap.keys());
      const extraPaths = robotsResult.robotsData.customPaths.filter(p => !existingPathKeys.has(p));
      
      if (extraPaths.length > 0) {
        totalTasks += extraPaths.length;
        const extraQueue = new ScanQueue({
          concurrency: settings['settings:concurrency'],
          delayMs: settings['settings:delayMs'],
          domain,
          signal,
          onProgress: (progress, itemResult) => {
            if (isScanAborted()) return;
            onTaskProgress(progress);
            if (itemResult && !itemResult.error) {
              notifyPanel({
                type: 'SCAN_PROGRESS',
                category: 'paths',
                result: itemResult,
                progress: {
                  completed: completedTasks + progress.completed,
                  total: totalTasks,
                  percent: totalTasks > 0 ? Math.round(((completedTasks + progress.completed) / totalTasks) * 100) : 0
                }
              });
            }
          }
        });
        scanState.queue = extraQueue;
        extraPaths.forEach(p => extraQueue.enqueue(createExtraPathTask(origin, p, 'robots.txt', signal)));
        const extraResults = await extraQueue.run();
        if (isScanAborted()) { await onAborted(domain); return; }
        for (const ep of extraResults) {
          pathMap.set(ep.path, ep);
        }
        completedTasks += extraResults.length;
      }
    }
    results.paths = Array.from(pathMap.values());
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Admin Portal
  if (categories.includes('admin')) {
    totalTasks += 1;
    results.admin = await scanAdmin(origin, passiveData, (endpointResult, currentAdminState) => {
      if (isScanAborted()) return;
      notifyPanel({
        type: 'SCAN_PROGRESS',
        category: 'admin',
        result: currentAdminState,
        endpoint: endpointResult,
        progress: {
          completed: completedTasks,
          total: totalTasks,
          percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      });
    }, signal);
    if (isScanAborted()) { await onAborted(domain); return; }
    completedTasks += 1;
    onTaskProgress({ completed: 0 });
    notifyPanel({ type: 'SCAN_PROGRESS', category: 'admin', result: results.admin, progress: { completed: completedTasks, total: totalTasks, percent: Math.round((completedTasks / totalTasks) * 100) } });
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // xmlrpc
  if (categories.includes('xmlrpc')) {
    totalTasks += 1;
    results.xmlrpc = await scanXmlrpc(origin, signal);
    if (isScanAborted()) { await onAborted(domain); return; }
    completedTasks += 1;
    onTaskProgress({ completed: 0 });
    notifyPanel({ type: 'SCAN_PROGRESS', category: 'xmlrpc', result: results.xmlrpc, progress: { completed: completedTasks, total: totalTasks, percent: Math.round((completedTasks / totalTasks) * 100) } });
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Users
  if (categories.includes('users')) {
    // If passive authors are already known, seed them immediately!
    if (passiveData?.authors?.length > 0) {
      for (const author of passiveData.authors) {
        const userObj = {
          slug: author.slug,
          id: null,
          name: author.name || null,
          source: author.source || 'passive',
          url: author.url || `${origin}/author/${author.slug}/`
        };
        const exists = results.users.some(u => u.slug === userObj.slug);
        if (!exists) {
          results.users.push(userObj);
          notifyPanel({
            type: 'SCAN_PROGRESS',
            category: 'users',
            result: userObj
          });
        }
      }
    }

    totalTasks += 1;
    const foundUsers = await scanUsers(origin, (user) => {
      if (isScanAborted()) return;
      notifyPanel({
        type: 'SCAN_PROGRESS',
        category: 'users',
        result: user,
        progress: {
          completed: completedTasks,
          total: totalTasks,
          percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      });
    }, signal);
    if (isScanAborted()) { await onAborted(domain); return; }
    completedTasks += 1;
    onTaskProgress({ completed: 0 });

    const userMap = new Map(results.users.map(u => [u.slug, u]));
    for (const u of foundUsers) {
      userMap.set(u.slug, u);
    }
    results.users = Array.from(userMap.values());
    notifyPanel({ type: 'SCAN_PROGRESS', category: 'users_all', result: results.users, progress: { completed: completedTasks, total: totalTasks, percent: Math.round((completedTasks / totalTasks) * 100) } });
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Plugins
  if (categories.includes('plugins')) {
    // If passive plugins are already known, send them immediately!
    if (passiveData?.plugins?.length > 0) {
      for (const item of passiveData.plugins) {
        const slug = typeof item === 'string' ? item : item.slug;
        const version = typeof item === 'object' ? item.version : null;
        const url = (typeof item === 'object' && item.url) ? item.url : `${origin}/wp-content/plugins/${slug}/readme.txt`;
        notifyPanel({
          type: 'SCAN_PROGRESS',
          category: 'plugins',
          result: { slug, version, url, source: 'passive', found: true }
        });
      }
    }

    const loadTasks = getPluginTasks(origin, passiveData?.plugins, signal);
    const pluginTasks = await loadTasks();
    if (isScanAborted()) { await onAborted(domain); return; }
    totalTasks += pluginTasks.length;

    const queue = new ScanQueue({
      concurrency: settings['settings:concurrency'],
      delayMs: settings['settings:delayMs'],
      domain,
      signal,
      onProgress: (progress, itemResult) => {
        if (isScanAborted()) return;
        onTaskProgress(progress);
        if (itemResult && itemResult.found) {
          notifyPanel({
            type: 'SCAN_PROGRESS',
            category: 'plugins',
            result: itemResult,
            progress: {
              completed: completedTasks + progress.completed,
              total: totalTasks,
              percent: totalTasks > 0 ? Math.round(((completedTasks + progress.completed) / totalTasks) * 100) : 0
            }
          });
        }
      }
    });
    scanState.queue = queue;

    pluginTasks.forEach(t => queue.enqueue(t));
    const pluginResults = await queue.run();
    if (isScanAborted()) { await onAborted(domain); return; }
    const activePlugins = pluginResults.filter(p => p && (p.found || p.source?.includes('passive')));
    completedTasks += pluginResults.length;

    // Merge into results.plugins deduplicating by slug
    const pluginMap = new Map(results.plugins.map(p => [p.slug, p]));
    for (const p of activePlugins) {
      const existing = pluginMap.get(p.slug);
      if (existing) {
        if (p.version) existing.version = p.version;
        if (p.url) existing.url = p.url;
        if (p.found) existing.found = true;
        if (p.source && !existing.source.includes(p.source)) existing.source += `+${p.source}`;
      } else {
        pluginMap.set(p.slug, p);
      }
    }

    // Add passive-only plugins that weren't found via bruteforce
    if (passiveData?.plugins) {
      for (const item of passiveData.plugins) {
        const slug = typeof item === 'string' ? item : item.slug;
        const pUrl = (typeof item === 'object' && item.url) ? item.url : `${origin}/wp-content/plugins/${slug}/readme.txt`;
        const pVer = typeof item === 'object' ? item.version : null;
        if (!pluginMap.has(slug)) {
          pluginMap.set(slug, { slug, version: pVer, url: pUrl, source: 'passive', found: false });
        } else {
          const ex = pluginMap.get(slug);
          if (!ex.url && pUrl) ex.url = pUrl;
        }
      }
    }
    results.plugins = Array.from(pluginMap.values());
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Themes
  if (categories.includes('themes')) {
    // If passive theme is known, seed it immediately
    if (passiveData?.theme?.slug) {
      const initialTheme = {
        slug: passiveData.theme.slug,
        name: passiveData.theme.name || passiveData.theme.slug,
        version: passiveData.theme.version || null,
        author: null,
        status: 'active',
        isActive: true,
        url: `${origin}/wp-content/themes/${passiveData.theme.slug}/style.css`,
        found: true
      };
      const exists = results.themes.some(t => t.slug === initialTheme.slug);
      if (!exists) {
        results.themes.push(initialTheme);
        notifyPanel({
          type: 'SCAN_PROGRESS',
          category: 'themes',
          result: initialTheme
        });
      }
    }

    const loadThemeTasks = getThemeTasks(origin, passiveData?.theme, signal);
    const themeTasks = await loadThemeTasks();
    if (isScanAborted()) { await onAborted(domain); return; }
    totalTasks += themeTasks.length;

    const themeQueue = new ScanQueue({
      concurrency: settings['settings:concurrency'],
      delayMs: settings['settings:delayMs'],
      domain,
      signal,
      onProgress: (progress, itemResult) => {
        if (isScanAborted()) return;
        onTaskProgress(progress);
        if (itemResult && itemResult.found) {
          notifyPanel({
            type: 'SCAN_PROGRESS',
            category: 'themes',
            result: itemResult,
            progress: {
              completed: completedTasks + progress.completed,
              total: totalTasks,
              percent: totalTasks > 0 ? Math.round(((completedTasks + progress.completed) / totalTasks) * 100) : 0
            }
          });
        }
      }
    });
    scanState.queue = themeQueue;

    themeTasks.forEach(t => themeQueue.enqueue(t));
    const themeResults = await themeQueue.run();
    if (isScanAborted()) { await onAborted(domain); return; }
    const foundThemes = themeResults.filter(t => t && (t.found || t.isActive));
    completedTasks += themeResults.length;

    const themeMap = new Map(results.themes.map(t => [t.slug, t]));
    for (const t of foundThemes) {
      const existing = themeMap.get(t.slug);
      if (existing) {
        if (t.version) existing.version = t.version;
        if (t.name) existing.name = t.name;
        if (t.author) existing.author = t.author;
        if (t.isActive != null) existing.isActive = t.isActive;
        if (t.status) existing.status = t.status;
        existing.found = true;
      } else {
        themeMap.set(t.slug, t);
      }
    }
    results.themes = Array.from(themeMap.values());
    notifyPanel({ type: 'SCAN_PROGRESS', category: 'themes_all', result: results.themes, progress: { completed: completedTasks, total: totalTasks, percent: Math.round((completedTasks / totalTasks) * 100) } });
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Media
  if (categories.includes('media')) {
    if (passiveData?.media?.length > 0) {
      for (const item of passiveData.media) {
        const exists = results.media.some(m => m.url === item.url);
        if (!exists) {
          results.media.push(item);
          notifyPanel({
            type: 'SCAN_PROGRESS',
            category: 'media',
            result: item
          });
        }
      }
    }

    totalTasks += 1;
    const foundMedia = await scanMedia(origin, (item) => {
      if (isScanAborted()) return;
      notifyPanel({
        type: 'SCAN_PROGRESS',
        category: 'media',
        result: item,
        progress: {
          completed: completedTasks,
          total: totalTasks,
          percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      });
    }, passiveData, signal);
    if (isScanAborted()) { await onAborted(domain); return; }
    completedTasks += 1;
    onTaskProgress({ completed: 0 });

    const mediaMap = new Map(results.media.map(m => [m.url, m]));
    for (const m of foundMedia) {
      mediaMap.set(m.url, m);
    }
    results.media = Array.from(mediaMap.values());
    notifyPanel({ type: 'SCAN_PROGRESS', category: 'media_all', result: results.media, progress: { completed: completedTasks, total: totalTasks, percent: Math.round((completedTasks / totalTasks) * 100) } });
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // Findings
  if (categories.includes('findings') || mergedCategories.includes('findings')) {
    results.findings = aggregateFindings(results, passiveData);
    if (!isScanAborted()) {
      notifyPanel({ type: 'SCAN_PROGRESS', category: 'findings', result: results.findings });
    }
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // WPScan vulnerability lookup (runs after plugins/theme/version are known)
  try {
    const confirmedPlugins = results.plugins.filter(p => p.slug && (p.found || p.source?.includes('passive')));
    if (confirmedPlugins.length > 0 && !isScanAborted()) {
      const pluginVulns = await lookupPluginVulns(confirmedPlugins, signal);
      if (isScanAborted()) { await onAborted(domain); return; }
      // Merge vuln data back into plugin results
      for (const pv of pluginVulns) {
        const plugin = results.plugins.find(p => p.slug === pv.slug);
        if (plugin) {
          plugin.vulnerabilities = pv.vulnerabilities;
          plugin.latestVersion = pv.latestVersion;
        }
      }
      results.vulnerabilities.push(...pluginVulns);
    }

    if (isScanAborted()) { await onAborted(domain); return; }

    // Theme vulns: ONLY check confirmed found or active themes.
    // Prioritize active theme first, cap at max 2 themes to conserve WPScan free quota (25 req/day).
    const allThemesToCheck = new Map();
    if (passiveData?.theme?.slug) {
      allThemesToCheck.set(passiveData.theme.slug, {
        slug: passiveData.theme.slug,
        version: passiveData.theme.version || null,
        name: passiveData.theme.name || passiveData.theme.slug,
        isActive: true,
        found: true
      });
    }
    if (results.themes?.length > 0) {
      for (const t of results.themes) {
        if (t.slug && (t.found || t.isActive)) {
          if (allThemesToCheck.has(t.slug)) {
            const existing = allThemesToCheck.get(t.slug);
            if (t.version && !existing.version) existing.version = t.version;
            if (t.name && !existing.name) existing.name = t.name;
          } else {
            allThemesToCheck.set(t.slug, t);
          }
        }
      }
    }

    const sortedThemes = Array.from(allThemesToCheck.values()).sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    const themesToScan = sortedThemes.slice(0, 2);

    for (const themeItem of themesToScan) {
      if (isScanAborted()) { await onAborted(domain); return; }
      const themeVulns = await lookupThemeVulns(themeItem, signal);
      if (themeVulns?.reason === 'rate-limited') {
        break; // Stop immediately to preserve quota
      }
      if (themeVulns && !themeVulns.skipped) {
        const foundThemeInResults = results.themes.find(t => t.slug === themeItem.slug);
        if (foundThemeInResults) {
          foundThemeInResults.vulnerabilities = themeVulns.vulnerabilities;
          foundThemeInResults.latestVersion = themeVulns.latestVersion;
        }
        results.vulnerabilities.push({ slug: themeItem.slug, type: 'theme', ...themeVulns });
      }
    }

    if (isScanAborted()) { await onAborted(domain); return; }

    // Core vulns
    const coreVersion = passiveData?.wpVersion?.meta || passiveData?.wpVersion?.assets;
    if (coreVersion && !isScanAborted()) {
      const coreVulns = await lookupCoreVulns(coreVersion, signal);
      if (isScanAborted()) { await onAborted(domain); return; }
      if (coreVulns && !coreVulns.skipped) {
        results.vulnerabilities.push({ slug: coreVersion, type: 'core', ...coreVulns });
      }
    }
  } catch (e) {
    if (isScanAborted()) { await onAborted(domain); return; }
    console.error('WPScan lookup error:', e);
  }

  if (isScanAborted()) { await onAborted(domain); return; }

  // --- Save results and notify panel ---
  const timestamp = Date.now();
  const activeKey = `scan:${domain}:active:${timestamp}`;
  const latestKey = `scan:${domain}:active:latest`;
  await browser.storage.local.set({
    [activeKey]: { ...results, timestamp },
    [latestKey]: { ...results, timestamp }
  });
  await clearSession(domain);

  notifyPanel({
    type: 'SCAN_COMPLETE',
    results,
    categoriesRun: mergedCategories
  });
}

async function onAborted(domain) {
  scanState.isScanning = false;
  scanState.aborted = true;
  scanState.queue = null;
  if (scanState.abortController) {
    try { scanState.abortController.abort(); } catch (e) {}
  }
  const targetDomain = domain || scanState.currentDomain;
  if (targetDomain) {
    await clearSession(targetDomain);
  }
  notifyPanel({ type: 'SCAN_ABORTED', domain: targetDomain });
}

// ============================================================
// ABORT
// ============================================================

async function handleAbortScan(data) {
  scanState.aborted = true;
  scanState.isScanning = false;

  if (scanState.abortController) {
    try { scanState.abortController.abort(); } catch (e) {}
  }

  if (scanState.queue) {
    try { scanState.queue.abort(); } catch (e) {}
  }

  const domain = data?.domain || scanState.currentDomain;
  if (domain) {
    await clearSession(domain);
  }

  notifyPanel({ type: 'SCAN_ABORTED', domain });

  return { ok: true, status: 'aborted' };
}

// ============================================================
// STATE QUERIES
// ============================================================

async function handleGetState(data) {
  return {
    isScanning: scanState.isScanning,
    currentDomain: scanState.currentDomain,
    progress: scanState.queue?.getProgress() || null
  };
}

async function handleGetPassiveData(data) {
  if (!data?.domain) return { passiveData: null };
  const key = `scan:${data.domain}:passive`;
  const result = await browser.storage.local.get(key);
  return { passiveData: result[key] || null };
}

async function handleGetScanResults(data) {
  if (!data?.domain) return { results: null };

  // Find latest active scan
  const all = await browser.storage.local.get(null);
  const prefix = `scan:${data.domain}:active:`;
  let latestKey = null;
  let latestTimestamp = 0;
  for (const key of Object.keys(all)) {
    if (key.startsWith(prefix)) {
      const ts = parseInt(key.slice(prefix.length), 10);
      if (ts > latestTimestamp) {
        latestTimestamp = ts;
        latestKey = key;
      }
    }
  }

  return { results: latestKey ? all[latestKey] : null };
}

// ============================================================
// WPSCAN API ON-DEMAND CHECK
// ============================================================

async function handleRunWpscanCheck(data) {
  const { domain, passiveData, activeResults, selectedTargets } = data || {};
  if (!domain) return { ok: false, error: 'No target domain specified.' };

  const settings = await browser.storage.local.get({
    'settings:enabled': true,
    'settings:wpscanApiKey': ''
  });
  if (!settings['settings:enabled']) {
    return { ok: false, error: 'Extension is disabled' };
  }
  const apiKey = settings['settings:wpscanApiKey'];
  if (!apiKey) {
    return { ok: false, error: 'no-api-key' };
  }

  // Load previous results to preserve previously scanned targets if running a partial subset
  const prevStored = await browser.storage.local.get(`wpscan:${domain}:latest`);
  const prevResults = prevStored[`wpscan:${domain}:latest`] || null;

  const shouldCheckCore = selectedTargets ? Boolean(selectedTargets.core) : true;
  const allowedThemes = selectedTargets?.themes ? new Set(selectedTargets.themes) : null;
  const allowedPlugins = selectedTargets?.plugins ? new Set(selectedTargets.plugins) : null;

  notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: '[*] Connecting to WPScan vulnerability database (wpscan.com)...' });

  const wpscanResults = {
    domain,
    timestamp: Date.now(),
    core: (!shouldCheckCore && prevResults?.core) ? prevResults.core : null,
    theme: (!allowedThemes && prevResults?.theme) ? prevResults.theme : null,
    themes: [],
    plugins: [],
    errors: [],
    totalVulnerabilities: 0
  };

  // 1. Determine targets to scan
  const coreVer = passiveData?.wpVersion?.meta || passiveData?.wpVersion?.assets;
  const willScanCore = Boolean(shouldCheckCore && coreVer);

  // Themes
  const themesMap = new Map();
  if (passiveData?.theme?.slug) {
    themesMap.set(passiveData.theme.slug, {
      slug: passiveData.theme.slug,
      version: passiveData.theme.version || null,
      name: passiveData.theme.name || passiveData.theme.slug,
      isActive: true,
      found: true
    });
  }
  if (activeResults?.themes?.length > 0) {
    for (const t of activeResults.themes) {
      if (t.slug && (t.found || t.isActive)) {
        if (!themesMap.has(t.slug)) {
          themesMap.set(t.slug, {
            slug: t.slug,
            version: t.version || null,
            name: t.name || t.slug,
            isActive: Boolean(t.isActive),
            found: true
          });
        }
      }
    }
  }

  let themesToScan = Array.from(themesMap.values());
  if (allowedThemes) {
    themesToScan = themesToScan.filter(t => allowedThemes.has(t.slug));
  } else {
    themesToScan.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    themesToScan = themesToScan.slice(0, 2);
  }

  // Plugins
  const pluginsMap = new Map();
  if (activeResults?.plugins) {
    for (const p of activeResults.plugins) {
      const slug = typeof p === 'string' ? p : p.slug;
      if (slug && (p.found || p.source?.includes('passive') || typeof p === 'string')) {
        pluginsMap.set(slug, { slug, version: p.version || null, source: p.source || 'active' });
      }
    }
  }
  if (passiveData?.plugins) {
    for (const item of passiveData.plugins) {
      const slug = typeof item === 'string' ? item : item.slug;
      if (slug && !pluginsMap.has(slug)) {
        pluginsMap.set(slug, { slug, version: item.version || null, source: 'passive' });
      }
    }
  }

  let pluginsToScan = Array.from(pluginsMap.values());
  if (allowedPlugins) {
    pluginsToScan = pluginsToScan.filter(p => allowedPlugins.has(p.slug));
  }

  // Carry over previously scanned items that are NOT being re-scanned
  if (prevResults) {
    if (!shouldCheckCore && prevResults.core) {
      wpscanResults.core = prevResults.core;
      if (prevResults.core.vulnerabilities?.length > 0) {
        wpscanResults.totalVulnerabilities += prevResults.core.vulnerabilities.length;
      }
    }
    if (prevResults.themes?.length > 0) {
      for (const prevT of prevResults.themes) {
        if (!themesToScan.some(t => t.slug === prevT.slug)) {
          wpscanResults.themes.push(prevT);
          if (prevT.vulnerabilities?.length > 0) {
            wpscanResults.totalVulnerabilities += prevT.vulnerabilities.length;
          }
          if (prevT.isActive && !wpscanResults.theme) {
            wpscanResults.theme = prevT;
          }
        }
      }
    }
    if (prevResults.plugins?.length > 0) {
      for (const prevP of prevResults.plugins) {
        if (!pluginsToScan.some(p => p.slug === prevP.slug)) {
          wpscanResults.plugins.push(prevP);
          if (prevP.vulnerabilities?.length > 0) {
            wpscanResults.totalVulnerabilities += prevP.vulnerabilities.length;
          }
        }
      }
    }
  }

  const totalItemsToScan = (willScanCore ? 1 : 0) + themesToScan.length + pluginsToScan.length;
  if (totalItemsToScan === 0) {
    notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'done', message: '[!] No targets selected for scanning.' });
    notifyPanel({ type: 'WPSCAN_COMPLETE', results: wpscanResults });
    return { ok: true, results: wpscanResults };
  }

  let currentTargetIndex = 0;

  // 1. Core version check
  if (willScanCore) {
    currentTargetIndex++;
    const coreSlug = String(coreVer).replace(/\./g, '');
    notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP GET] [${currentTargetIndex}/${totalItemsToScan}] https://wpscan.com/api/v3/wordpresses/${coreSlug}` });
    try {
      const coreData = await lookupCoreVulns(coreVer);
      if (coreData?.reason === 'rate-limited') {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: '[HTTP 429] Daily rate limit reached (25 req/day on free plan).' });
        wpscanResults.errors.push(`Core lookup: ${coreData.error || 'Rate limit exceeded'}`);
        await browser.storage.local.set({ [`wpscan:${domain}:latest`]: wpscanResults });
        notifyPanel({ type: 'WPSCAN_COMPLETE', results: wpscanResults });
        return { ok: true, results: wpscanResults };
      }
      if (coreData && !coreData.skipped) {
        wpscanResults.core = { version: coreVer, ...coreData };
        const count = coreData.vulnerabilities?.length || 0;
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP 200] WordPress Core ${coreVer} -> ${count} vulnerabilities found` });
        if (count > 0) {
          wpscanResults.totalVulnerabilities += count;
        }
      } else if (coreData?.notFound) {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP 404] WordPress Core ${coreVer} (no known vulnerabilities in database)` });
      } else if (coreData?.error) {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP ERR] WordPress Core ${coreVer}: ${coreData.error}` });
        wpscanResults.errors.push(`Core lookup: ${coreData.error}`);
      }
    } catch (e) {
      notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP ERR] Core lookup failed: ${e.message}` });
      wpscanResults.errors.push(`Core lookup: ${e.message}`);
    }
  }

  // 2. Themes check
  for (const themeItem of themesToScan) {
    currentTargetIndex++;
    const themeSlug = themeItem.slug;
    const themeVer = themeItem.version || null;
    notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP GET] [${currentTargetIndex}/${totalItemsToScan}] https://wpscan.com/api/v3/themes/${themeSlug}` });
    try {
      const themeData = await lookupThemeVulns(themeItem);
      if (themeData?.reason === 'rate-limited') {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: '[HTTP 429] Daily rate limit reached (25 req/day on free plan).' });
        wpscanResults.errors.push(`Theme "${themeSlug}": ${themeData.error || 'Rate limit exceeded'}`);
        await browser.storage.local.set({ [`wpscan:${domain}:latest`]: wpscanResults });
        notifyPanel({ type: 'WPSCAN_COMPLETE', results: wpscanResults });
        return { ok: true, results: wpscanResults };
      }
      if (themeData && !themeData.skipped) {
        const themeEntry = { slug: themeSlug, version: themeVer, name: themeItem.name, isActive: themeItem.isActive, ...themeData };
        wpscanResults.themes.push(themeEntry);
        if (themeItem.isActive || themeSlug === passiveData?.theme?.slug) {
          wpscanResults.theme = themeEntry;
        }
        const count = themeData.vulnerabilities?.length || 0;
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP 200] Theme "${themeSlug}" -> ${count} vulnerabilities found` });
        if (count > 0) {
          wpscanResults.totalVulnerabilities += count;
        }
      } else if (themeData?.notFound) {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP 404] Theme "${themeSlug}" (no known vulnerabilities in database)` });
      } else if (themeData?.error) {
        notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP ERR] Theme "${themeSlug}": ${themeData.error}` });
        wpscanResults.errors.push(`Theme "${themeSlug}": ${themeData.error}`);
      }
    } catch (e) {
      notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: `[HTTP ERR] Theme "${themeSlug}": ${e.message}` });
      wpscanResults.errors.push(`Theme "${themeSlug}": ${e.message}`);
    }
  }

  // 3. Plugins check
  for (const plugin of pluginsToScan) {
    currentTargetIndex++;
    notifyPanel({
      type: 'WPSCAN_PROGRESS',
      status: 'running',
      message: `[HTTP GET] [${currentTargetIndex}/${totalItemsToScan}] https://wpscan.com/api/v3/plugins/${plugin.slug}`
    });

    try {
      const pData = await lookupVulnerabilities('plugins', plugin.slug, plugin.version);
      if (pData && !pData.skipped) {
        const entry = { slug: plugin.slug, version: plugin.version, source: plugin.source, ...pData };
        wpscanResults.plugins.push(entry);
        const vCount = pData.vulnerabilities?.length || 0;
        notifyPanel({
          type: 'WPSCAN_PROGRESS',
          status: 'running',
          message: `[HTTP 200] Plugin "${plugin.slug}"${plugin.version ? ` v${plugin.version}` : ''} -> ${vCount} vulnerabilities`
        });
        if (vCount > 0) {
          wpscanResults.totalVulnerabilities += vCount;
        }
      } else if (pData?.notFound) {
        notifyPanel({
          type: 'WPSCAN_PROGRESS',
          status: 'running',
          message: `[HTTP 404] Plugin "${plugin.slug}" (no known vulnerabilities in database)`
        });
      } else if (pData?.error) {
        notifyPanel({
          type: 'WPSCAN_PROGRESS',
          status: 'running',
          message: `[HTTP ERR] Plugin "${plugin.slug}": ${pData.error}`
        });
        wpscanResults.errors.push(`Plugin "${plugin.slug}": ${pData.error}`);
        if (pData.reason === 'rate-limited') {
          notifyPanel({ type: 'WPSCAN_PROGRESS', status: 'running', message: '[HTTP 429] Daily rate limit reached (25 req/day on free plan).' });
          break;
        }
      }
    } catch (e) {
      notifyPanel({
        type: 'WPSCAN_PROGRESS',
        status: 'running',
        message: `[HTTP ERR] Plugin "${plugin.slug}": ${e.message}`
      });
      wpscanResults.errors.push(`Plugin "${plugin.slug}": ${e.message}`);
    }
  }

  // Save latest wpscan results for domain
  await browser.storage.local.set({
    [`wpscan:${domain}:latest`]: wpscanResults
  });

  notifyPanel({
    type: 'WPSCAN_COMPLETE',
    results: wpscanResults
  });

  return { ok: true, results: wpscanResults };
}

// ============================================================
// HELPERS
// ============================================================

async function notifyPanel(message) {
  try {
    await browser.runtime.sendMessage(message);
  } catch (e) {
    // Panel not open — fine
  }
}

async function clearSession(domain) {
  const key = `session:${domain}:inProgress`;
  try {
    await browser.storage.session.remove(key);
  } catch (e) {
    try {
      await browser.storage.local.remove(`session:fallback:${key}`);
    } catch (e2) { /* ignore */ }
  }
}
