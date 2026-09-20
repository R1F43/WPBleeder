/**
 * WPBleeder — Storage Utility Module
 *
 * Typed wrappers around browser.storage.local and browser.storage.session.
 * Single source of truth for all storage key patterns.
 */

const browser = globalThis.browser || globalThis.chrome;

// --- Session storage availability detection ---
let _sessionAvailable = null;

async function isSessionAvailable() {
  if (_sessionAvailable !== null) return _sessionAvailable;
  try {
    await browser.storage.session.get('__test__');
    _sessionAvailable = true;
  } catch (e) {
    _sessionAvailable = false;
  }
  return _sessionAvailable;
}

async function sessionGet(key) {
  if (await isSessionAvailable()) {
    const result = await browser.storage.session.get(key);
    return result[key] ?? null;
  }
  // Fallback: use storage.local with session: prefix
  const fallbackKey = `session:fallback:${key}`;
  const result = await browser.storage.local.get(fallbackKey);
  return result[fallbackKey] ?? null;
}

async function sessionSet(key, value) {
  if (await isSessionAvailable()) {
    return browser.storage.session.set({ [key]: value });
  }
  const fallbackKey = `session:fallback:${key}`;
  return browser.storage.local.set({ [fallbackKey]: value });
}

async function sessionRemove(key) {
  if (await isSessionAvailable()) {
    return browser.storage.session.remove(key);
  }
  const fallbackKey = `session:fallback:${key}`;
  return browser.storage.local.remove(fallbackKey);
}

// --- Default settings ---
const DEFAULT_SETTINGS = {
  wpscanApiKey: '',
  concurrency: 5,
  delayMs: 200,
  enabled: true
};

// --- Exported storage interface ---
export const storage = {

  // ========== Settings ==========

  async getSettings() {
    const keys = {
      'settings:wpscanApiKey': DEFAULT_SETTINGS.wpscanApiKey,
      'settings:concurrency': DEFAULT_SETTINGS.concurrency,
      'settings:delayMs': DEFAULT_SETTINGS.delayMs,
      'settings:enabled': DEFAULT_SETTINGS.enabled
    };
    const result = await browser.storage.local.get(keys);
    return {
      wpscanApiKey: result['settings:wpscanApiKey'],
      concurrency: result['settings:concurrency'],
      delayMs: result['settings:delayMs'],
      enabled: result['settings:enabled']
    };
  },

  async saveSettings(partial) {
    const toSet = {};
    if (partial.wpscanApiKey !== undefined) toSet['settings:wpscanApiKey'] = partial.wpscanApiKey;
    if (partial.concurrency !== undefined) toSet['settings:concurrency'] = parseInt(partial.concurrency, 10) || DEFAULT_SETTINGS.concurrency;
    if (partial.delayMs !== undefined) toSet['settings:delayMs'] = parseInt(partial.delayMs, 10) || DEFAULT_SETTINGS.delayMs;
    if (partial.enabled !== undefined) toSet['settings:enabled'] = !!partial.enabled;
    if (Object.keys(toSet).length > 0) {
      await browser.storage.local.set(toSet);
    }
  },

  // ========== Passive Data ==========

  async getPassiveData(domain) {
    const key = `scan:${domain}:passive`;
    const result = await browser.storage.local.get(key);
    return result[key] || null;
  },

  async savePassiveData(domain, data) {
    const key = `scan:${domain}:passive`;
    await browser.storage.local.set({ [key]: data });
  },

  // ========== Active Scan Results ==========

  async getLatestActiveScan(domain) {
    const latestKey = `scan:${domain}:active:latest`;
    const res = await browser.storage.local.get(latestKey);
    if (res[latestKey]) return res[latestKey];

    // Fallback for older timestamped scans
    const all = await browser.storage.local.get(null);
    const prefix = `scan:${domain}:active:`;
    let latestTimestamp = 0;
    let foundKey = null;

    for (const key of Object.keys(all)) {
      if (key !== latestKey && key.startsWith(prefix)) {
        const timestamp = parseInt(key.slice(prefix.length), 10);
        if (timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
          foundKey = key;
        }
      }
    }

    if (!foundKey) return null;
    const data = all[foundKey];
    browser.storage.local.set({ [latestKey]: data }).catch(() => {});
    return data;
  },

  async saveActiveScan(domain, data) {
    const timestamp = data.timestamp || Date.now();
    const key = `scan:${domain}:active:${timestamp}`;
    const latestKey = `scan:${domain}:active:latest`;
    await browser.storage.local.set({
      [key]: { ...data, timestamp },
      [latestKey]: { ...data, timestamp }
    });
  },

  // ========== Session State (in-progress scans) ==========

  async getScanSession(domain) {
    const key = `session:${domain}:inProgress`;
    return sessionGet(key);
  },

  async saveScanSession(domain, state) {
    const key = `session:${domain}:inProgress`;
    await sessionSet(key, { ...state, lastUpdated: Date.now() });
  },

  async clearScanSession(domain) {
    const key = `session:${domain}:inProgress`;
    await sessionRemove(key);
  },

  // ========== Vulnerability Cache ==========

  async getVulnCache(slug, version) {
    const key = `vulncache:${slug}:${version}`;
    const result = await browser.storage.local.get(key);
    const cached = result[key];
    if (!cached) return null;

    // Check TTL (default 24 hours)
    const ttlMs = (cached.ttlHours || 24) * 3600000;
    if (Date.now() - cached.cachedAt > ttlMs) {
      // Expired — clean up
      await browser.storage.local.remove(key);
      return null;
    }

    return cached.data;
  },

  async setVulnCache(slug, version, data, ttlHours = 24) {
    const key = `vulncache:${slug}:${version}`;
    await browser.storage.local.set({
      [key]: {
        data,
        cachedAt: Date.now(),
        ttlHours
      }
    });
  },

  async isVulnCacheValid(slug, version) {
    const cached = await this.getVulnCache(slug, version);
    return cached !== null;
  },

  // ========== Utility ==========

  async clearDomainData(domain) {
    const all = await browser.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter(k =>
      k.startsWith(`scan:${domain}:`) ||
      k.startsWith(`session:fallback:session:${domain}:`)
    );
    if (keysToRemove.length > 0) {
      await browser.storage.local.remove(keysToRemove);
    }
    // Also clear session storage
    await sessionRemove(`session:${domain}:inProgress`);
  }
};
