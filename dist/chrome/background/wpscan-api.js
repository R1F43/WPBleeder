const browser = globalThis.browser || globalThis.chrome;

const WPSCAN_BASE = 'https://wpscan.com/api/v3';

export async function getApiKey() {
  const result = await browser.storage.local.get({ 'settings:wpscanApiKey': '' });
  return result['settings:wpscanApiKey'];
}

async function getCached(slug, version) {
  const key = `vulncache:${slug}:${version}`;
  const result = await browser.storage.local.get(key);
  const cached = result[key];
  if (!cached) return null;
  // 24-hour TTL
  if (Date.now() - cached.cachedAt > 24 * 3600000) {
    await browser.storage.local.remove(key);
    return null;
  }
  return cached.data;
}

async function setCache(slug, version, data) {
  const key = `vulncache:${slug}:${version}`;
  await browser.storage.local.set({ [key]: { data, cachedAt: Date.now() } });
}

function compareVersions(a, b) {
  if (!a || !b) return 0;
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

export async function lookupVulnerabilities(type, slug, installedVersion, signal = null) {
  if (signal?.aborted) return { skipped: true, reason: 'aborted' };
  // type: 'plugins' | 'themes' | 'wordpresses'
  const apiKey = await getApiKey();
  if (!apiKey) return { skipped: true, reason: 'no-api-key' };
  
  // Check cache
  const cached = await getCached(slug, installedVersion || 'unknown');
  if (cached !== null) return cached;
  
  // Format slug for WordPress core: strip dots (e.g. 6.4.2 -> 642)
  let querySlug = slug;
  if (type === 'wordpresses') {
    querySlug = String(slug).replace(/\./g, '');
  }
  
  try {
    const response = await fetch(`${WPSCAN_BASE}/${type}/${querySlug}`, {
      method: 'GET',
      headers: {
        'Authorization': `Token token=${apiKey}`,
        'Accept': 'application/json'
      },
      signal
    });
    
    if (response.status === 429) {
      return { skipped: true, reason: 'rate-limited', error: 'WPScan API daily rate limit exceeded' };
    }
    
    if (response.status === 404) {
      const result = { vulnerabilities: [], notFound: true, totalKnownVulns: 0 };
      await setCache(slug, installedVersion || 'unknown', result);
      return result;
    }
    
    if (!response.ok) {
      return { skipped: true, reason: `http-${response.status}`, error: `WPScan API returned HTTP ${response.status}` };
    }
    
    const data = await response.json();
    const componentData = data[slug] || data[querySlug] || Object.values(data)[0];
    if (!componentData) {
      const result = { vulnerabilities: [], notFound: true, totalKnownVulns: 0 };
      await setCache(slug, installedVersion || 'unknown', result);
      return result;
    }
    
    const allVulns = componentData.vulnerabilities || [];
    
    // Filter to vulnerabilities affecting the installed version
    const affecting = [];
    for (const vuln of allVulns) {
      if (!installedVersion) {
        // No version info — report all known vulns as potentially affecting
        affecting.push({ ...vuln, unversioned: true });
        continue;
      }
      
      if (vuln.fixed_in) {
        // Vulnerable if installed version < fixed_in
        if (compareVersions(installedVersion, vuln.fixed_in) < 0) {
          affecting.push(vuln);
        }
      } else {
        // No fix available — unpatched / zero-day
        affecting.push(vuln);
      }
    }
    
    const result = {
      vulnerabilities: affecting,
      latestVersion: componentData.latest_version || null,
      totalKnownVulns: allVulns.length
    };
    
    await setCache(slug, installedVersion || 'unknown', result);
    return result;
    
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') return { skipped: true, reason: 'aborted' };
    return { skipped: true, reason: err.message, error: err.message };
  }
}

export async function lookupPluginVulns(plugins, signal = null) {
  const results = [];
  for (const plugin of plugins) {
    if (signal?.aborted) return results;
    if (!plugin.slug) continue;
    const vulnData = await lookupVulnerabilities('plugins', plugin.slug, plugin.version, signal);
    if (vulnData.skipped) {
      if (vulnData.reason === 'rate-limited') {
        results.push({ slug: plugin.slug, version: plugin.version, error: 'WPScan API rate limit exceeded' });
        break; // Stop burning quota
      }
      continue;
    }
    results.push({ slug: plugin.slug, version: plugin.version, source: plugin.source, ...vulnData });
  }
  return results;
}

export async function lookupThemeVulns(theme, signal = null) {
  if (!theme?.slug || signal?.aborted) return null;
  return lookupVulnerabilities('themes', theme.slug, theme.version, signal);
}

export async function lookupCoreVulns(version, signal = null) {
  if (!version || signal?.aborted) return null;
  return lookupVulnerabilities('wordpresses', version, version, signal);
}
