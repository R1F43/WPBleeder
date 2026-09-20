const browser = globalThis.browser || globalThis.chrome;

// Current panel state
const state = {
  domain: null,
  url: null,
  status: 'idle', // idle | passive_loaded | scanning | done | aborted | disabled
  enabled: true,
  selectedCategories: new Set(['paths', 'admin', 'plugins', 'themes', 'users', 'media', 'xmlrpc', 'findings']),
  passiveData: null,
  activeResults: null,
  scanProgress: { completed: 0, total: 0, percent: 0 },
  wafDetected: false,
  wafVendor: null,
  completedCategories: new Set(), // categories that completed in last scan
  wpscanResults: null,
  wpscanStatus: 'idle', // idle | running | done | error
  wpscanLogs: [],
  wpscanApiKey: '',
  wpscanSelectedTargets: { core: true, themes: new Set(), plugins: new Set() },
  wpscanKnownSlugs: { themes: new Set(), plugins: new Set(), core: false },
  wpscanTargetsInitialized: false
};

// Listeners for state changes
const listeners = new Map(); // key -> Set<callback>

export function getState() { return state; }

export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key).delete(callback);
}

function notify(key) {
  const cbs = listeners.get(key);
  if (cbs) cbs.forEach(cb => cb(state[key], state));
  // Also notify wildcard listeners
  const wildcards = listeners.get('*');
  if (wildcards) wildcards.forEach(cb => cb(key, state));
}

export function updateState(updates) {
  for (const [key, value] of Object.entries(updates)) {
    state[key] = value;
    notify(key);
  }
}

// Toggle a scan category on/off
export function toggleCategory(cat) {
  if (state.selectedCategories.has(cat)) state.selectedCategories.delete(cat);
  else state.selectedCategories.add(cat);
  notify('selectedCategories');
}

// Update active tab domain and load associated data
export async function updateActiveTabDomain() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const oldDomain = state.domain;
    if (tabs[0]?.url) {
      try {
        const url = new URL(tabs[0].url);
        if (url.protocol.startsWith('http')) {
          state.domain = url.hostname;
          state.url = url.origin;
        } else {
          state.domain = null;
          state.url = null;
        }
      } catch(e) {
        state.domain = null;
        state.url = null;
      }
    } else {
      state.domain = null;
      state.url = null;
    }
    
    if (oldDomain !== state.domain) {
      state.wpscanTargetsInitialized = false;
      state.wpscanKnownSlugs = { themes: new Set(), plugins: new Set(), core: false };
      state.wpscanSelectedTargets = { core: true, themes: new Set(), plugins: new Set() };
    }
    
    if (state.domain) {
      const passiveKey = `scan:${state.domain}:passive`;
      const latestKey = `scan:${state.domain}:active:latest`;
      const wpscanKey = `wpscan:${state.domain}:latest`;
      const sessionKey = `session:${state.domain}:inProgress`;

      // Batch all storage lookups in a single parallel step (0ms stall)
      const [storageResult, sessionResult] = await Promise.all([
        browser.storage.local.get([passiveKey, latestKey, wpscanKey]),
        browser.storage.session ? browser.storage.session.get(sessionKey).catch(() => ({})) : Promise.resolve({})
      ]);

      // 1. Passive Data
      if (storageResult[passiveKey]) {
        state.passiveData = storageResult[passiveKey];
        state.status = 'passive_loaded';
      } else {
        state.passiveData = null;
        state.status = 'idle';
      }

      // Request live content script to refresh/send latest passive signals
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_PASSIVE_SCAN' }).catch(() => {});
      }

      // 2. Active Scan Data
      let activeData = storageResult[latestKey];
      if (!activeData) {
        // One-time fallback migration for older timestamped scans
        const all = await browser.storage.local.get(null);
        const prefix = `scan:${state.domain}:active:`;
        let foundKey = null, latestTs = 0;
        for (const k of Object.keys(all)) {
          if (k !== latestKey && k.startsWith(prefix)) {
            const ts = parseInt(k.slice(prefix.length), 10);
            if (ts > latestTs) { latestTs = ts; foundKey = k; }
          }
        }
        if (foundKey && all[foundKey]) {
          activeData = all[foundKey];
          // Cache to :latest so get(null) is never needed again
          browser.storage.local.set({ [latestKey]: activeData }).catch(() => {});
        }
      }

      if (activeData) {
        state.activeResults = activeData;
        state.completedCategories = new Set(activeData.categoriesRun || []);
        state.status = 'done';
        state.wafDetected = !!activeData.wafDetected;
        state.wafVendor = activeData.wafVendor || null;
      } else {
        state.activeResults = null;
        state.completedCategories = new Set();
        state.wafDetected = false;
        state.wafVendor = null;
      }

      // 3. WPScan Results
      if (storageResult[wpscanKey]) {
        state.wpscanResults = storageResult[wpscanKey];
        state.wpscanStatus = 'done';
      } else {
        state.wpscanResults = null;
        state.wpscanStatus = 'idle';
      }
      state.wpscanLogs = [];

      // 4. In-progress Session
      if (sessionResult && sessionResult[sessionKey]) {
        const session = sessionResult[sessionKey];
        state.status = 'scanning';
        state.scanProgress = session.progress || { completed: 0, total: 0, percent: 0 };
      }
    } else {
      state.passiveData = null;
      state.activeResults = null;
      state.completedCategories = new Set();
      state.wafDetected = false;
      state.wafVendor = null;
      state.wpscanResults = null;
      state.wpscanStatus = 'idle';
      state.wpscanLogs = [];
      state.status = 'idle';
    }
    
    if (!state.enabled) {
      state.status = 'disabled';
    }

    notify('domain');
    notify('passiveData');
    notify('activeResults');
    notify('completedCategories');
    notify('wafDetected');
    notify('wpscanResults');
    notify('wpscanStatus');
    notify('wpscanLogs');
    notify('status');
    notify('scanProgress');
    notify('wpscanSelectedTargets');
  } catch(e) {
    console.error('updateActiveTabDomain error:', e);
  }
}

// Initialize — load settings and current domain data from storage
export async function initState() {
  try {
    // Parallelize settings fetch with initial domain detection
    const [settings] = await Promise.all([
      browser.storage.local.get({
        'settings:enabled': true,
        'settings:wpscanApiKey': '',
        'settings:concurrency': 5,
        'settings:delayMs': 200
      }),
      updateActiveTabDomain()
    ]);
    
    state.enabled = settings['settings:enabled'];
    state.wpscanApiKey = settings['settings:wpscanApiKey'] || '';
    notify('enabled');
    notify('wpscanApiKey');
    
    // Listen for tab switches and URL changes
    browser.tabs.onActivated?.addListener(() => {
      updateActiveTabDomain();
    });
    
    browser.tabs.onUpdated?.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        updateActiveTabDomain();
      }
    });
  } catch(e) {
    console.error('initState error:', e);
  }
}

// Listen for messages from background
browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'PASSIVE_UPDATE':
      state.passiveData = message.data;
      state.domain = message.data?.domain || state.domain;
      if (state.enabled && state.status === 'idle') state.status = 'passive_loaded';
      notify('passiveData');
      notify('domain');
      if (state.enabled) notify('status');
      break;
      
    case 'SCAN_PROGRESS':
      if (state.status === 'aborted') return;
      if (message.progress) {
        state.scanProgress = message.progress;
        notify('scanProgress');
      }
      // If there's a result for a specific category, merge it in real-time
      if (message.category && message.result) {
        if (!state.activeResults) {
          state.activeResults = { paths: [], admin: null, plugins: [], themes: [], users: [], media: [], xmlrpc: null, findings: [] };
        }
        if (message.category === 'paths') {
          if (!state.activeResults.paths) state.activeResults.paths = [];
          const existingIdx = state.activeResults.paths.findIndex(p => p.path === message.result.path);
          if (existingIdx >= 0) {
            state.activeResults.paths[existingIdx] = message.result;
          } else {
            state.activeResults.paths.push(message.result);
          }
          notify('activeResults');
        } else if (message.category === 'plugins') {
          if (!state.activeResults.plugins) state.activeResults.plugins = [];
          const existing = state.activeResults.plugins.find(p => p.slug === message.result.slug);
          if (existing) {
            if (message.result.version) existing.version = message.result.version;
            if (message.result.url) existing.url = message.result.url;
            if (message.result.found != null) existing.found = message.result.found;
          } else {
            state.activeResults.plugins.push(message.result);
          }
          notify('activeResults');
        } else if (message.category === 'themes') {
          if (!state.activeResults.themes) state.activeResults.themes = [];
          const existing = state.activeResults.themes.find(t => t.slug === message.result.slug);
          if (existing) {
            if (message.result.name) existing.name = message.result.name;
            if (message.result.version) existing.version = message.result.version;
            if (message.result.status) existing.status = message.result.status;
            if (message.result.isActive != null) existing.isActive = message.result.isActive;
            if (message.result.found != null) existing.found = message.result.found;
          } else {
            state.activeResults.themes.push(message.result);
          }
          notify('activeResults');
        } else if (message.category === 'themes_all') {
          state.activeResults.themes = message.result;
          notify('activeResults');
        } else if (message.category === 'users') {
          if (!state.activeResults.users) state.activeResults.users = [];
          const existing = state.activeResults.users.find(u => u.slug === message.result.slug);
          if (existing) {
            if (message.result.name) existing.name = message.result.name;
            if (message.result.url) existing.url = message.result.url;
            if (message.result.id != null) existing.id = message.result.id;
            if (message.result.source) existing.source = message.result.source;
          } else {
            state.activeResults.users.push(message.result);
          }
          notify('activeResults');
        } else if (message.category === 'users_all') {
          state.activeResults.users = message.result;
          notify('activeResults');
        } else if (message.category === 'media') {
          if (!state.activeResults) state.activeResults = { paths: [], admin: null, plugins: [], themes: [], users: [], media: [], xmlrpc: null, findings: [] };
          if (!state.activeResults.media) state.activeResults.media = [];
          const existing = state.activeResults.media.find(m => m.url === message.result.url);
          if (!existing) {
            state.activeResults.media.push(message.result);
          }
          notify('activeResults');
        } else if (message.category === 'media_all') {
          if (!state.activeResults) state.activeResults = { paths: [], admin: null, plugins: [], themes: [], users: [], media: [], xmlrpc: null, findings: [] };
          state.activeResults.media = message.result;
          notify('activeResults');
        } else if (message.category === 'admin') {
          state.activeResults.admin = message.result;
          notify('activeResults');
        } else if (message.category === 'xmlrpc') {
          state.activeResults.xmlrpc = message.result;
          notify('activeResults');
        } else if (message.category === 'findings') {
          state.activeResults.findings = message.result;
          notify('activeResults');
        }
      }
      break;
      
    case 'SCAN_COMPLETE':
      if (state.status === 'aborted') return;
      state.status = 'done';
      state.activeResults = message.results;
      if (message.categoriesRun) {
        message.categoriesRun.forEach(cat => state.completedCategories.add(cat));
      }
      state.scanProgress = { completed: 0, total: 0, percent: 0 };
      notify('status');
      notify('activeResults');
      notify('completedCategories');
      notify('scanProgress');
      break;
      
    case 'SCAN_ABORTED':
      state.status = 'aborted';
      state.abortReason = message.reason || 'Manual abort';
      state.scanProgress = { completed: 0, total: 0, percent: 0 };
      notify('status');
      notify('scanProgress');
      notify('abortReason');
      break;
      
    case 'WAF_DETECTED':
      if (state.status === 'aborted') return;
      state.wafDetected = true;
      state.wafVendor = message.vendor;
      state.status = 'done';
      notify('wafDetected');
      notify('status');
      break;
      
    case 'STATUS_UPDATE':
      if (state.status === 'aborted' && message.status === 'scanning') return;
      state.status = message.status;
      notify('status');
      break;

    case 'WPSCAN_PROGRESS':
      state.wpscanStatus = 'running';
      if (message.message) {
        state.wpscanLogs = [...state.wpscanLogs, message.message];
      }
      notify('wpscanStatus');
      notify('wpscanLogs');
      break;

    case 'WPSCAN_COMPLETE':
      state.wpscanStatus = 'done';
      state.wpscanResults = message.results;
      state.wpscanLogs = [...state.wpscanLogs, '[+] WPScan Vulnerability Check Complete!'];
      notify('wpscanStatus');
      notify('wpscanResults');
      notify('wpscanLogs');
      break;
  }
});

// Listen for storage changes (settings updates from options page)
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes['settings:enabled']) {
      state.enabled = changes['settings:enabled'].newValue;
      if (!state.enabled) state.status = 'disabled';
      else if (state.passiveData) state.status = 'passive_loaded';
      else state.status = 'idle';
      notify('enabled');
      notify('status');
    }
    if (changes['settings:wpscanApiKey']) {
      state.wpscanApiKey = changes['settings:wpscanApiKey'].newValue || '';
      notify('wpscanApiKey');
    }
  }
});

// Send scan request to background
export async function startScan() {
  if (!state.domain || state.selectedCategories.size === 0) return;
  
  state.status = 'scanning';
  state.selectedCategories.forEach(cat => state.completedCategories.add(cat));
  
  if (!state.activeResults) {
    state.activeResults = {
      paths: [],
      admin: null,
      plugins: [],
      themes: [],
      users: [],
      media: [],
      xmlrpc: null,
      findings: [],
      categoriesRun: Array.from(state.completedCategories)
    };
  } else {
    if (!state.activeResults.themes) state.activeResults.themes = [];
    if (!state.activeResults.media) state.activeResults.media = [];
    state.activeResults.categoriesRun = Array.from(state.completedCategories);
  }
  
  state.scanProgress = { completed: 0, total: 0, percent: 0 };
  notify('status');
  notify('completedCategories');
  notify('activeResults');
  notify('scanProgress');
  
  await browser.runtime.sendMessage({
    type: 'START_SCAN',
    data: {
      domain: state.domain,
      url: state.passiveData?.url || state.url || `https://${state.domain}`,
      categories: Array.from(state.selectedCategories),
      passiveData: state.passiveData
    }
  });
}

export async function abortScan() {
  state.status = 'aborted';
  state.scanProgress = { completed: 0, total: 0, percent: 0 };
  notify('status');
  notify('scanProgress');
  await browser.runtime.sendMessage({ type: 'ABORT_SCAN', data: { domain: state.domain } });
}

export async function resetScan() {
  if (!state.domain) return;
  
  if (state.status === 'scanning') {
    await abortScan();
  }
  
  // Clear domain active scan data via background
  try {
    await browser.runtime.sendMessage({
      type: 'CLEAR_DOMAIN_DATA',
      data: { domain: state.domain }
    });
  } catch (e) {}

  // Clear domain active storage keys locally
  try {
    const all = await browser.storage.local.get(null);
    const prefix = `scan:${state.domain}:active:`;
    const toRemove = [];
    for (const k of Object.keys(all)) {
      if (k.startsWith(prefix) || k === `wpscan:${state.domain}:latest`) {
        toRemove.push(k);
      }
    }
    if (toRemove.length > 0) {
      await browser.storage.local.remove(toRemove);
    }
  } catch (e) {}

  // Reset in-memory state
  state.activeResults = null;
  state.completedCategories = new Set();
  state.wpscanResults = null;
  state.wpscanStatus = 'idle';
  state.wpscanLogs = [];
  state.scanProgress = { completed: 0, total: 0, percent: 0 };
  state.status = state.passiveData ? 'passive_loaded' : 'idle';
  
  notify('activeResults');
  notify('completedCategories');
  notify('wpscanResults');
  notify('wpscanStatus');
  notify('wpscanLogs');
  notify('scanProgress');
  notify('status');

  // Trigger passive scan re-detection on active tab
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      try {
        await browser.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_PASSIVE_SCAN' });
      } catch (err) {
        if (browser.scripting?.executeScript) {
          await browser.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content/passive-detect.js']
          });
        }
      }
    }
  } catch (e) {}
}

export async function toggleEnabled() {
  state.enabled = !state.enabled;
  await browser.storage.local.set({ 'settings:enabled': state.enabled });
  if (!state.enabled) {
    if (state.status === 'scanning') {
      await abortScan();
    }
    state.status = 'disabled';
  } else if (state.passiveData) {
    state.status = 'passive_loaded';
  } else {
    state.status = 'idle';
  }
  notify('enabled');
  notify('status');
}

// WPScan Target Selection Helpers
export function getAvailableWpscanTargets() {
  let coreVer = state.passiveData?.wpVersion?.meta || state.passiveData?.wpVersion?.assets || null;
  if (!coreVer && state.activeResults?.paths) {
    const readme = state.activeResults.paths.find(p => p.path === '/readme.html' && p.extractedVersion);
    if (readme?.extractedVersion) coreVer = readme.extractedVersion;
  }

  // Themes
  const themesMap = new Map();
  if (state.passiveData?.theme?.slug) {
    themesMap.set(state.passiveData.theme.slug, {
      slug: state.passiveData.theme.slug,
      name: state.passiveData.theme.name || state.passiveData.theme.slug,
      version: state.passiveData.theme.version || null,
      isActive: true
    });
  }
  if (state.activeResults?.themes?.length > 0) {
    for (const t of state.activeResults.themes) {
      if (t.slug && (t.found || t.isActive)) {
        if (!themesMap.has(t.slug)) {
          themesMap.set(t.slug, {
            slug: t.slug,
            name: t.name || t.slug,
            version: t.version || null,
            isActive: Boolean(t.isActive)
          });
        }
      }
    }
  }

  // Plugins
  const pluginsMap = new Map();
  if (state.activeResults?.plugins) {
    for (const p of state.activeResults.plugins) {
      const slug = typeof p === 'string' ? p : p.slug;
      if (slug && (p.found || p.source?.includes('passive') || typeof p === 'string')) {
        pluginsMap.set(slug, { slug, version: p.version || null, source: p.source || 'active' });
      }
    }
  }
  if (state.passiveData?.plugins) {
    for (const item of state.passiveData.plugins) {
      const slug = typeof item === 'string' ? item : item.slug;
      if (slug && !pluginsMap.has(slug)) {
        pluginsMap.set(slug, { slug, version: item.version || null, source: 'passive' });
      }
    }
  }

  return {
    coreVer,
    themes: Array.from(themesMap.values()),
    plugins: Array.from(pluginsMap.values())
  };
}

export function syncWpscanTargets() {
  const avail = getAvailableWpscanTargets();
  if (!state.wpscanSelectedTargets) {
    state.wpscanSelectedTargets = { core: true, themes: new Set(), plugins: new Set() };
  }
  if (!state.wpscanKnownSlugs) {
    state.wpscanKnownSlugs = { themes: new Set(), plugins: new Set(), core: false };
  }

  // Core discovery: select when first detected
  if (avail.coreVer && !state.wpscanKnownSlugs.core) {
    state.wpscanKnownSlugs.core = true;
    state.wpscanSelectedTargets.core = true;
  }

  // Themes discovery: select newly detected themes when discovered for the first time
  avail.themes.forEach(t => {
    if (!state.wpscanKnownSlugs.themes.has(t.slug)) {
      state.wpscanKnownSlugs.themes.add(t.slug);
      state.wpscanSelectedTargets.themes.add(t.slug);
    }
  });

  // Plugins discovery: select newly detected plugins when discovered for the first time
  avail.plugins.forEach(p => {
    if (!state.wpscanKnownSlugs.plugins.has(p.slug)) {
      state.wpscanKnownSlugs.plugins.add(p.slug);
      state.wpscanSelectedTargets.plugins.add(p.slug);
    }
  });

  state.wpscanTargetsInitialized = true;
}

export function toggleWpscanTarget(type, slug = null) {
  syncWpscanTargets();
  if (type === 'core') {
    state.wpscanSelectedTargets.core = !state.wpscanSelectedTargets.core;
  } else if (type === 'theme' && slug) {
    if (state.wpscanSelectedTargets.themes.has(slug)) {
      state.wpscanSelectedTargets.themes.delete(slug);
    } else {
      state.wpscanSelectedTargets.themes.add(slug);
    }
  } else if (type === 'plugin' && slug) {
    if (state.wpscanSelectedTargets.plugins.has(slug)) {
      state.wpscanSelectedTargets.plugins.delete(slug);
    } else {
      state.wpscanSelectedTargets.plugins.add(slug);
    }
  }
  notify('wpscanSelectedTargets');
}

export function toggleWpscanGroup(group, selectAll = null) {
  syncWpscanTargets();
  const avail = getAvailableWpscanTargets();
  if (group === 'core') {
    state.wpscanSelectedTargets.core = selectAll !== null ? selectAll : !state.wpscanSelectedTargets.core;
  } else if (group === 'themes') {
    const shouldSelect = selectAll !== null ? selectAll : (state.wpscanSelectedTargets.themes.size < avail.themes.length);
    if (shouldSelect) {
      state.wpscanSelectedTargets.themes = new Set(avail.themes.map(t => t.slug));
    } else {
      state.wpscanSelectedTargets.themes.clear();
    }
  } else if (group === 'plugins') {
    const shouldSelect = selectAll !== null ? selectAll : (state.wpscanSelectedTargets.plugins.size < avail.plugins.length);
    if (shouldSelect) {
      state.wpscanSelectedTargets.plugins = new Set(avail.plugins.map(p => p.slug));
    } else {
      state.wpscanSelectedTargets.plugins.clear();
    }
  }
  notify('wpscanSelectedTargets');
}

export function selectAllWpscanTargets(selectAll = true) {
  const avail = getAvailableWpscanTargets();
  state.wpscanTargetsInitialized = true;
  if (!state.wpscanKnownSlugs) {
    state.wpscanKnownSlugs = { themes: new Set(), plugins: new Set(), core: false };
  }
  if (avail.coreVer) state.wpscanKnownSlugs.core = true;
  avail.themes.forEach(t => state.wpscanKnownSlugs.themes.add(t.slug));
  avail.plugins.forEach(p => state.wpscanKnownSlugs.plugins.add(p.slug));

  state.wpscanSelectedTargets.core = selectAll && Boolean(avail.coreVer);
  if (selectAll) {
    state.wpscanSelectedTargets.themes = new Set(avail.themes.map(t => t.slug));
    state.wpscanSelectedTargets.plugins = new Set(avail.plugins.map(p => p.slug));
  } else {
    state.wpscanSelectedTargets.themes.clear();
    state.wpscanSelectedTargets.plugins.clear();
  }
  notify('wpscanSelectedTargets');
}

// WPScan API on-demand check
export async function runWpscanCheck() {
  if (!state.domain) return;
  syncWpscanTargets();
  state.wpscanStatus = 'running';
  state.wpscanLogs = [
    `[*] Target domain: ${state.domain}`,
    `[*] Connecting to WPScan Vulnerability Database API...`
  ];
  notify('wpscanStatus');
  notify('wpscanLogs');

  try {
    const response = await browser.runtime.sendMessage({
      type: 'RUN_WPSCAN_CHECK',
      data: {
        domain: state.domain,
        passiveData: state.passiveData,
        activeResults: state.activeResults,
        selectedTargets: {
          core: state.wpscanSelectedTargets.core,
          themes: Array.from(state.wpscanSelectedTargets.themes),
          plugins: Array.from(state.wpscanSelectedTargets.plugins)
        }
      }
    });

    if (response && response.error === 'no-api-key') {
      state.wpscanStatus = 'error';
      state.wpscanLogs = [
        ...state.wpscanLogs,
        '[-] Error: No WPScan API token found. Please enter your API token below to enable vulnerability scanning.'
      ];
      notify('wpscanStatus');
      notify('wpscanLogs');
    } else if (response && response.error) {
      state.wpscanStatus = 'error';
      state.wpscanLogs = [
        ...state.wpscanLogs,
        `[-] Error: ${response.error}`
      ];
      notify('wpscanStatus');
      notify('wpscanLogs');
    }
  } catch (e) {
    state.wpscanStatus = 'error';
    state.wpscanLogs = [
      ...state.wpscanLogs,
      `[-] Error communicating with background worker: ${e.message}`
    ];
    notify('wpscanStatus');
    notify('wpscanLogs');
  }
}

export async function saveWpscanApiKey(apiKey) {
  const cleanKey = (apiKey || '').trim();
  await browser.storage.local.set({ 'settings:wpscanApiKey': cleanKey });
  state.wpscanApiKey = cleanKey;
  notify('wpscanApiKey');
}
