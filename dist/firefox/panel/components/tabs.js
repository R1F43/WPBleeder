import {
  getState, subscribe, runWpscanCheck, saveWpscanApiKey,
  getAvailableWpscanTargets, syncWpscanTargets, toggleWpscanTarget,
  toggleWpscanGroup, selectAllWpscanTargets
} from '../state.js';
import { createRow, createExternalLinkRow, createUserRow, createThemeRow, createMediaRow, createFindingRow, createFirewallRow, createPluginRow } from './row.js';
import { renderReportTab } from './report-export.js';

const TABS = [
  { id: 'overview', label: 'Overview', alwaysUnlocked: true },
  { id: 'paths', label: 'Paths', category: 'paths' },
  { id: 'admin', label: 'Admin Portal', category: 'admin' },
  { id: 'plugins', label: 'Plugins', category: 'plugins' },
  { id: 'themes', label: 'Themes', category: 'themes' },
  { id: 'users', label: 'Users', category: 'users' },
  { id: 'media', label: 'Media', category: 'media' },
  { id: 'xmlrpc', label: 'XML-RPC', category: 'xmlrpc' },
  { id: 'wpscan', label: 'WPScan Vulns', alwaysUnlocked: true },
  { id: 'findings', label: 'Findings', category: 'findings' },
  { id: 'firewall', label: 'Firewall', alwaysUnlocked: true },
  { id: 'report', label: 'Report', alwaysUnlocked: true }
];

const LOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

let activeTab = 'overview';
let isEditingWpscanToken = false;

export function initTabs() {
  const tabBar = document.getElementById('tab-bar');
  const tabContent = document.getElementById('tab-content');
  
  // Create tab buttons
  TABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (tab.id === activeTab ? ' active' : '');
    btn.dataset.tab = tab.id;
    btn.innerHTML = tab.label;
    btn.addEventListener('click', () => switchTab(tab.id));
    tabBar.appendChild(btn);
  });
  
  function isTabLocked(tabDef) {
    if (tabDef.alwaysUnlocked) return false;
    const state = getState();
    // Unlock category tabs immediately while active scanning if selected
    if (state.status === 'scanning' && state.selectedCategories.has(tabDef.category)) return false;
    // Plugins tab unlocks if passive plugins or active plugin results exist
    if (tabDef.id === 'plugins' && ((state.passiveData?.plugins && state.passiveData.plugins.length > 0) || (state.activeResults?.plugins && state.activeResults.plugins.length > 0))) return false;
    // Admin tab can also unlock if passive signals or active admin data exist
    if (tabDef.id === 'admin' && (state.passiveData?.adminSignals || state.activeResults?.admin)) return false;
    // Users tab can also unlock if passive authors or active users exist
    if (tabDef.id === 'users' && ((state.passiveData?.authors && state.passiveData.authors.length > 0) || (state.activeResults?.users && state.activeResults.users.length > 0))) return false;
    // Themes tab can unlock if passive theme or active themes exist
    if (tabDef.id === 'themes' && (state.passiveData?.theme || (state.activeResults?.themes && state.activeResults.themes.length > 0))) return false;
    // Media tab can unlock if passive media or active media exist
    if (tabDef.id === 'media' && ((state.passiveData?.media && state.passiveData.media.length > 0) || (state.activeResults?.media && state.activeResults.media.length > 0))) return false;
    // Paths tab unlocks if active paths exist
    if (tabDef.id === 'paths' && state.activeResults?.paths && state.activeResults.paths.length > 0) return false;
    // XML-RPC tab unlocks if active xmlrpc data exists
    if (tabDef.id === 'xmlrpc' && state.activeResults?.xmlrpc) return false;
    // Findings tab unlocks if findings exist or version mismatch was flagged
    if (tabDef.id === 'findings' && ((state.activeResults?.findings && state.activeResults.findings.length > 0) || state.passiveData?.wpVersion?.mismatch)) return false;
    return !state.completedCategories.has(tabDef.category);
  }
  
  function getLockedMessage(tabDef) {
    const state = getState();
    if (state.activeResults) {
      return `This category was not included in the last scan. Select "${tabDef.label}" in the scan chips and run a new scan.`;
    }
    return `No scan has been run yet. Select categories and press "Start scan" to begin.`;
  }
  
  function switchTab(tabId) {
    activeTab = tabId;
    // Update tab buttons
    tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      const t = TABS.find(t => t.id === btn.dataset.tab);
      const locked = isTabLocked(t);
      btn.classList.toggle('active', btn.dataset.tab === tabId);
      btn.classList.toggle('locked', locked);
      if (locked) {
        btn.innerHTML = `${LOCK_SVG} ${t.label}`;
      } else {
        btn.innerHTML = t.label;
      }
    });
    renderTabContent();
  }
  
  function renderTabContent() {
    tabContent.innerHTML = '';
    const tabDef = TABS.find(t => t.id === activeTab);
    if (!tabDef) return;
    
    if (isTabLocked(tabDef)) {
      renderLockedState(tabDef);
      return;
    }
    
    try {
      switch(activeTab) {
        case 'overview': renderOverview(); break;
        case 'paths': renderPaths(); break;
        case 'admin': renderAdminPortal(); break;
        case 'plugins': renderPlugins(); break;
        case 'themes': renderThemes(); break;
        case 'users': renderUsers(); break;
        case 'media': renderMedia(); break;
        case 'xmlrpc': renderXmlrpc(); break;
        case 'wpscan': renderWpscan(); break;
        case 'findings': renderFindings(); break;
        case 'firewall': renderFirewall(); break;
        case 'report': renderReport(); break;
      }
    } catch (err) {
      console.error(`Error rendering tab ${activeTab}:`, err);
      tabContent.innerHTML = `<div class="locked-state" style="color:var(--danger);"><p>Error rendering ${activeTab}: ${escapeHtml(err.message)}</p></div>`;
    }
  }
  
  function renderLockedState(tabDef) {
    const div = document.createElement('div');
    div.className = 'locked-state';
    div.innerHTML = `
      ${LOCK_SVG}
      <p>${getLockedMessage(tabDef)}</p>
    `;
    tabContent.appendChild(div);
  }
  
  function renderOverview() {
    const state = getState();
    const pd = state.passiveData;
    if (!pd) {
      const div = document.createElement('div');
      div.className = 'locked-state';
      div.innerHTML = '<p>Navigate to a WordPress site to see passive detection results.</p>';
      tabContent.appendChild(div);
      return;
    }
    
    // WP version
    if (pd.wpVersion) {
      const ver = pd.wpVersion.meta || pd.wpVersion.assets || 'Unknown';
      const row = createRow('wordpress', `WordPress ${ver}`);
      if (pd.wpVersion.mismatch) {
        const badge = document.createElement('span');
        badge.className = 'row-badge badge-warning';
        badge.textContent = 'version mismatch';
        row.appendChild(badge);
      }
      tabContent.appendChild(row);
    }
    
    // Theme
    if (pd.theme) {
      const label = `Theme: ${pd.theme.slug}${pd.theme.version ? ` (${pd.theme.version})` : ''}`;
      const row = createRow('palette', label);
      row.classList.add('clickable');
      row.title = 'Click to view in Themes tab';
      row.addEventListener('click', () => switchTab('themes'));
      tabContent.appendChild(row);
    }
    
    // Passive plugins
    if (pd.plugins && pd.plugins.length > 0) {
      const header = document.createElement('div');
      header.className = 'section-label clickable';
      header.title = 'Click to view in Plugins tab';
      header.style.cursor = 'pointer';
      header.textContent = `Detected plugins (${pd.plugins.length}) →`;
      header.addEventListener('click', () => switchTab('plugins'));
      tabContent.appendChild(header);
      pd.plugins.forEach(p => {
        const slug = typeof p === 'string' ? p : p.slug;
        const version = typeof p === 'object' ? p.version : null;
        const label = version ? `${slug} (${version})` : slug;
        const baseUrl = pd.url || state.url || `https://${state.domain}`;
        let origin = `https://${state.domain}`;
        try { origin = new URL(baseUrl).origin; } catch (e) {}
        const verifyUrl = (typeof p === 'object' && p.url) ? p.url : `${origin}/wp-content/plugins/${slug}/readme.txt`;
        const row = createPluginRow(label, verifyUrl, 'passive', 0);
        tabContent.appendChild(row);
      });
    }
    
    // Authors
    if (pd.authors && pd.authors.length > 0) {
      const header = document.createElement('div');
      header.className = 'section-label';
      header.textContent = `Detected authors (${pd.authors.length})`;
      tabContent.appendChild(header);
      pd.authors.forEach(a => {
        const label = a.name ? `${a.slug} (${a.name})` : a.slug;
        const baseUrl = pd.url || state.url || `https://${state.domain}`;
        let origin = `https://${state.domain}`;
        try { origin = new URL(baseUrl).origin; } catch (e) {}
        const verifyUrl = a.url || `${origin}/author/${a.slug}/`;
        const row = createUserRow(label, verifyUrl, a.source);
        tabContent.appendChild(row);
      });
    }

    // Firewalls & Protection
    const secItems = pd.security || [];
    if (secItems.length > 0 || state.wafDetected) {
      const header = document.createElement('div');
      header.className = 'section-label';
      header.textContent = 'Firewall & Protection';
      tabContent.appendChild(header);

      if (state.wafDetected) {
        const row = createRow('shield', `Active WAF Blocking: ${state.wafVendor || 'Detected'}`);
        row.classList.add('clickable');
        row.title = 'Click to view full Firewall & WAF details';
        row.addEventListener('click', () => switchTab('firewall'));
        const badge = document.createElement('span');
        badge.className = 'row-badge badge-warning';
        badge.textContent = 'blocking';
        row.appendChild(badge);
        tabContent.appendChild(row);
      }

      secItems.forEach(item => {
        const typeLabel = item.type === 'proxy' ? 'Proxy Firewall / CDN' : 'WP Security Plugin';
        const row = createRow('shield', item.name);
        row.classList.add('clickable');
        row.title = 'Click to view full Firewall & WAF details';
        row.addEventListener('click', () => switchTab('firewall'));
        const badge = document.createElement('span');
        badge.className = 'row-badge badge-neutral';
        badge.textContent = typeLabel;
        row.appendChild(badge);
        tabContent.appendChild(row);
      });
    }
  }
  
  function renderPaths() {
    const state = getState();
    const paths = state.activeResults?.paths || [];
    const isScanning = state.status === 'scanning';

    if (isScanning) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Probing paths in real-time... (${paths.length} probed)</span>`;
      tabContent.appendChild(liveBar);
    }

    if (paths.length === 0 && !isScanning) {
      tabContent.innerHTML = '<div class="locked-state"><p>No path results available.</p></div>';
      return;
    }

    // Sort paths ascending by HTTP status code (200, 301, 302, 400, 403, 404...)
    const sortedPaths = [...paths].sort((a, b) => {
      const statusA = (a.status != null && a.status > 0) ? a.status : 999;
      const statusB = (b.status != null && b.status > 0) ? b.status : 999;
      if (statusA !== statusB) return statusA - statusB;
      return (a.path || '').localeCompare(b.path || '');
    });

    // Check if robots.txt was parsed
    const robotsPath = sortedPaths.find(p => p.path === '/robots.txt' && p.robotsData);
    if (robotsPath?.robotsData) {
      const rd = robotsPath.robotsData;
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'section-label';
      summaryDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--surface-1);padding:6px 10px;border-radius:4px;margin-bottom:8px;font-size:11px;';
      summaryDiv.innerHTML = `
        <span><strong>robots.txt:</strong> ${rd.disallow.length} disallows (${rd.customPaths.length} probed)</span>
        <span class="row-badge badge-neutral">${rd.sitemaps.length} sitemaps</span>
      `;
      tabContent.appendChild(summaryDiv);
    }

    sortedPaths.forEach(p => {
      const baseUrl = state.passiveData?.url || `https://${state.domain}`;
      const url = `${new URL(baseUrl).origin}${p.path}`;
      const statusClass = p.status >= 200 && p.status < 300 ? 'badge-success' : 
                          p.status >= 300 && p.status < 400 ? 'badge-warning' :
                          p.status === 403 ? 'badge-warning' : 'badge-neutral';
      
      const row = createExternalLinkRow(p.path, url, p.status, statusClass);
      const sourceBadge = document.createElement('span');
      sourceBadge.className = 'row-badge badge-neutral';
      sourceBadge.style.cssText = 'margin-right:4px;font-size:10px;';
      if (p.source === 'robots.txt') {
        sourceBadge.textContent = 'robots.txt';
        sourceBadge.title = 'Discovered via robots.txt directives';
      } else if (p.source === 'passive') {
        sourceBadge.textContent = 'passive';
        sourceBadge.title = 'Discovered via passive in-page detection';
      } else {
        sourceBadge.textContent = 'active probe';
        sourceBadge.title = 'Standard wordlist active probe';
      }
      if (p.extractedVersion) {
        const verBadge = document.createElement('span');
        verBadge.className = 'row-badge badge-warning';
        verBadge.style.cssText = 'margin-right:4px;font-size:10px;font-weight:600;';
        verBadge.textContent = `v${p.extractedVersion}`;
        verBadge.title = `Extracted version from ${p.path}`;
        row.insertBefore(verBadge, row.lastChild);
      }
      row.insertBefore(sourceBadge, row.lastChild);
      tabContent.appendChild(row);
    });
  }

  function renderAdminPortal() {
    const state = getState();
    const admin = state.activeResults?.admin;
    const passiveSignals = state.passiveData?.adminSignals;
    const isScanning = state.status === 'scanning';

    if (isScanning && !admin) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Probing authentication & admin endpoints in real-time...</span>`;
      tabContent.appendChild(liveBar);
    }

    if (!admin && !passiveSignals && !isScanning) {
      tabContent.innerHTML = '<div class="locked-state"><p>No Admin Portal scan data available. Run an active scan with Admin Portal selected.</p></div>';
      return;
    }

    // Active Status Cards / Overview
    if (admin) {
      const loginStatusClass = admin.loginAccessible ? 'badge-warning' : (admin.isHiddenLogin ? 'badge-neutral' : 'badge-neutral');
      const loginStatusText = admin.loginAccessible ? 'EXPOSED' : (admin.isHiddenLogin ? 'HIDDEN / BLOCKED' : (admin.loginStatus ? `HTTP ${admin.loginStatus}` : 'UNKNOWN'));

      const regStatusClass = admin.registrationEnabled ? 'badge-danger' : 'badge-neutral';
      const regStatusText = admin.registrationEnabled ? 'OPEN' : 'CLOSED / DISABLED';

      const statusOverview = document.createElement('div');
      statusOverview.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;';
      statusOverview.innerHTML = `
        <div style="background:var(--surface-1);padding:8px 10px;border-radius:6px;border:1px solid var(--border);">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">Login Portal</div>
          <span class="row-badge ${loginStatusClass}">${loginStatusText}</span>
        </div>
        <div style="background:var(--surface-1);padding:8px 10px;border-radius:6px;border:1px solid var(--border);">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">User Registration</div>
          <span class="row-badge ${regStatusClass}">${regStatusText}</span>
        </div>
      `;
      tabContent.appendChild(statusOverview);

      // Endpoints list sorted ascending by status code
      const epHeader = document.createElement('div');
      epHeader.className = 'section-label';
      epHeader.textContent = 'Authentication & Admin Endpoints (Sorted by Status)';
      tabContent.appendChild(epHeader);

      const sortedEndpoints = [...(admin.endpoints || [])].sort((a, b) => {
        const statusA = (a.status != null && a.status > 0) ? a.status : 999;
        const statusB = (b.status != null && b.status > 0) ? b.status : 999;
        if (statusA !== statusB) return statusA - statusB;
        return (a.name || '').localeCompare(b.name || '');
      });

      sortedEndpoints.forEach(ep => {
        const statusClass = ep.status >= 200 && ep.status < 300 ? 'badge-success' : 
                            ep.status >= 300 && ep.status < 400 ? 'badge-warning' :
                            ep.status === 403 || ep.status === 404 ? 'badge-neutral' : 'badge-danger';
        
        const row = createExternalLinkRow(`${ep.name} (${ep.path})`, ep.url, ep.status || 'N/A', statusClass);
        if (ep.detail) {
          const detailSpan = document.createElement('div');
          detailSpan.className = 'row-detail';
          detailSpan.textContent = ep.detail;
          detailSpan.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-top:2px;';
          row.querySelector('.row-label')?.appendChild(detailSpan);
        }
        tabContent.appendChild(row);
      });
    }

    // Passive Signals Section
    if (passiveSignals) {
      const pHeader = document.createElement('div');
      pHeader.className = 'section-label';
      pHeader.style.cssText = 'margin-top:16px;';
      pHeader.textContent = 'Passive In-Page Detection';
      tabContent.appendChild(pHeader);

      if (passiveSignals.hasLoginForm) {
        tabContent.appendChild(createRow('shield', 'Login form embedded directly on active page'));
      }
      if (passiveSignals.hasRegisterForm) {
        tabContent.appendChild(createRow('shield', 'Registration form embedded directly on active page'));
      }
      if (passiveSignals.ajaxUrl) {
        tabContent.appendChild(createRow('code', `Admin AJAX Script URL: ${passiveSignals.ajaxUrl}`));
      }
      if (passiveSignals.loginLinks?.length > 0) {
        passiveSignals.loginLinks.forEach(l => {
          tabContent.appendChild(createExternalLinkRow(`Login link: "${l.text}"`, l.url, null, 'badge-neutral'));
        });
      }
      if (passiveSignals.registrationLinks?.length > 0) {
        passiveSignals.registrationLinks.forEach(l => {
          tabContent.appendChild(createExternalLinkRow(`Register link: "${l.text}"`, l.url, null, 'badge-neutral'));
        });
      }
    }
  }
  
  function renderPlugins() {
    const state = getState();
    const activePlugins = state.activeResults?.plugins || [];
    const passivePlugins = (state.passiveData?.plugins || []).map(p => {
      const slug = typeof p === 'string' ? p : p.slug;
      return {
        slug,
        version: p.version || null,
        url: p.url || null,
        source: 'passive'
      };
    });

    // Merge by slug
    const pluginMap = new Map();
    activePlugins.forEach(p => {
      const slug = typeof p === 'string' ? p : p.slug;
      pluginMap.set(slug, typeof p === 'string' ? { slug, source: 'active' } : { ...p, source: p.source || 'active' });
    });
    passivePlugins.forEach(p => {
      if (!pluginMap.has(p.slug)) {
        pluginMap.set(p.slug, p);
      } else {
        const existing = pluginMap.get(p.slug);
        if (!existing.version && p.version) existing.version = p.version;
        if (!existing.url && p.url) existing.url = p.url;
      }
    });

    const plugins = Array.from(pluginMap.values());
    const isScanning = state.status === 'scanning';

    if (isScanning) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Probing plugins against wordlist... (${plugins.length} discovered so far)</span>`;
      tabContent.appendChild(liveBar);
    }

    if (plugins.length === 0 && !isScanning) {
      tabContent.innerHTML = '<div class="locked-state"><p>No plugins found.</p></div>';
      return;
    }

    const isPassiveOnly = !state.activeResults?.plugins?.length && state.passiveData?.plugins?.length > 0;
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'section-label';
    summaryDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--surface-1);padding:6px 10px;border-radius:4px;margin-bottom:8px;font-size:11px;';
    summaryDiv.innerHTML = `
      <span><strong>Plugins Identified:</strong> ${plugins.length}</span>
      <span class="row-badge badge-neutral">${isPassiveOnly ? 'Passive In-Page Signals' : (state.activeResults?.plugins?.length ? 'Wordlist + Passive' : 'Detected')}</span>
    `;
    tabContent.appendChild(summaryDiv);

    plugins.forEach(p => {
      const label = p.version ? `${p.slug} (${p.version})` : p.slug;
      const baseUrl = state.passiveData?.url || state.url || `https://${state.domain}`;
      let origin = `https://${state.domain}`;
      try { origin = new URL(baseUrl).origin; } catch (e) {}
      const verifyUrl = p.url || `${origin}/wp-content/plugins/${p.slug}/readme.txt`;
      const cveCount = p.vulnerabilities?.length || 0;
      const row = createPluginRow(label, verifyUrl, p.source, cveCount);
      tabContent.appendChild(row);
    });
  }

  function renderThemes() {
    const state = getState();
    let themes = state.activeResults?.themes || [];
    if (themes.length === 0 && state.passiveData?.theme?.slug) {
      const baseUrl = state.passiveData.url || state.url || `https://${state.domain}`;
      let origin = `https://${state.domain}`;
      try { origin = new URL(baseUrl).origin; } catch (e) {}
      themes = [{
        slug: state.passiveData.theme.slug,
        name: state.passiveData.theme.name || state.passiveData.theme.slug,
        version: state.passiveData.theme.version || null,
        status: 'active',
        isActive: true,
        url: `${origin}/wp-content/themes/${state.passiveData.theme.slug}/style.css`,
        found: true
      }];
    }
    const isScanning = state.status === 'scanning';

    if (isScanning && themes.length === 0) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Probing themes against wordlist...</span>`;
      tabContent.appendChild(liveBar);
      return;
    }

    if (themes.length === 0 && !isScanning) {
      const div = document.createElement('div');
      div.className = 'locked-state';
      div.innerHTML = '<p>No themes detected. Select Themes in the scan chips and run a scan.</p>';
      tabContent.appendChild(div);
      return;
    }

    const sorted = [...themes].sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    const activeCount = sorted.filter(t => t.isActive).length;
    const inactiveCount = sorted.filter(t => !t.isActive).length;

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'section-label';
    summaryDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--surface-1);padding:6px 10px;border-radius:4px;margin-bottom:8px;font-size:11px;';
    summaryDiv.innerHTML = `
      <span><strong>Themes Detected:</strong> ${sorted.length} (${activeCount} active${inactiveCount > 0 ? `, ${inactiveCount} inactive` : ''})</span>
      ${inactiveCount > 0 ? '<span class="row-badge badge-warning">Inactive Themes Found</span>' : '<span class="row-badge badge-success">Clean</span>'}
    `;
    tabContent.appendChild(summaryDiv);

    sorted.forEach(t => {
      const row = createThemeRow(t);
      tabContent.appendChild(row);
    });
  }
  
  function renderUsers() {
    const state = getState();
    let users = state.activeResults?.users || [];
    if (users.length === 0 && state.passiveData?.authors?.length > 0) {
      users = state.passiveData.authors.map(a => ({
        slug: a.slug,
        name: a.name || null,
        source: a.source || 'passive',
        url: a.url || null
      }));
    }
    const isScanning = state.status === 'scanning';

    if (isScanning) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Enumerating users via REST API, author archives, sitemaps, posts, and feeds... (${users.length} found)</span>`;
      tabContent.appendChild(liveBar);
    }

    if (users.length === 0 && !isScanning) {
      const div = document.createElement('div');
      div.className = 'locked-state';
      div.innerHTML = '<p>No enumerable users — target likely hardened.</p>';
      tabContent.appendChild(div);
      return;
    }

    users.forEach(u => {
      const label = u.name ? `${u.slug} (${u.name})` : u.slug;
      const baseUrl = state.passiveData?.url || state.url || `https://${state.domain}`;
      let origin = `https://${state.domain}`;
      try { origin = new URL(baseUrl).origin; } catch (e) {}
      const verifyUrl = u.url || `${origin}/author/${u.slug}/`;
      const row = createUserRow(label, verifyUrl, u.source);
      tabContent.appendChild(row);
    });
  }

  function renderMedia() {
    const state = getState();
    let media = state.activeResults?.media || [];
    if (media.length === 0 && state.passiveData?.media?.length > 0) {
      media = state.passiveData.media;
    }
    const isScanning = state.status === 'scanning';

    if (isScanning && media.length === 0) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Enumerating media attachments in real-time...</span>`;
      tabContent.appendChild(liveBar);
      return;
    }

    if (media.length === 0 && !isScanning) {
      const div = document.createElement('div');
      div.className = 'locked-state';
      div.innerHTML = '<p>No media attachments enumerated. Run an active scan with "Media" selected to probe /wp-json/wp/v2/media and XML sitemaps.</p>';
      tabContent.appendChild(div);
      return;
    }

    const isPassiveOnly = !state.activeResults?.media?.length && state.passiveData?.media?.length > 0;
    const docCount = media.filter(m => m.isDocument).length;
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'section-label';
    summaryDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:var(--surface-1);padding:6px 10px;border-radius:4px;margin-bottom:8px;font-size:11px;';
    summaryDiv.innerHTML = `
      <span><strong>Enumerated Media:</strong> ${media.length} items ${isPassiveOnly ? '(passive DOM)' : ''}</span>
      ${docCount > 0 ? `<span class="row-badge badge-warning">${docCount} Documents / Archives</span>` : '<span class="row-badge badge-neutral">Standard Media</span>'}
    `;
    tabContent.appendChild(summaryDiv);

    media.forEach(item => {
      const row = createMediaRow(item);
      tabContent.appendChild(row);
    });
  }
  
  function renderXmlrpc() {
    const state = getState();
    const xmlrpc = state.activeResults?.xmlrpc;
    const isScanning = state.status === 'scanning';

    if (isScanning && !xmlrpc) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Testing XML-RPC endpoint (/xmlrpc.php)...</span>`;
      tabContent.appendChild(liveBar);
      return;
    }

    if (!xmlrpc && !isScanning) {
      tabContent.innerHTML = '<div class="locked-state"><p>No XML-RPC scan results available. Include XML-RPC in the scan and start a scan.</p></div>';
      return;
    }
    
    // Status row
    const statusClass = xmlrpc.enabled ? 'badge-danger' : (xmlrpc.status === 404 ? 'badge-success' : 'badge-neutral');
    const statusLabel = xmlrpc.enabled ? 'ENABLED' : (xmlrpc.status ? `HTTP ${xmlrpc.status}` : 'DISABLED / BLOCKED');
    
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML = `
      <svg class="row-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span class="row-label"><strong>XML-RPC Endpoint</strong></span>
      <span class="row-badge ${statusClass}">${statusLabel}</span>
    `;
    tabContent.appendChild(row);
    
    if (xmlrpc.enabled && xmlrpc.methods && xmlrpc.methods.length > 0) {
      const header = document.createElement('div');
      header.className = 'section-label';
      header.textContent = `Supported XML-RPC Methods (${xmlrpc.methods.length})`;
      tabContent.appendChild(header);
      
      const dangerous = ['pingback.ping', 'system.multicall', 'wp.getUsersBlogs'];
      
      xmlrpc.methods.forEach(method => {
        const methodRow = document.createElement('div');
        methodRow.className = 'result-row';
        const isDangerous = dangerous.includes(method);
        methodRow.innerHTML = `
          <svg class="row-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          <span class="row-label" style="font-family:monospace;font-size:12px;">${escapeHtml(method)}</span>
          ${isDangerous ? '<span class="row-badge badge-warning">sensitive</span>' : ''}
        `;
        tabContent.appendChild(methodRow);
      });
    } else if (!xmlrpc.enabled) {
      const info = document.createElement('div');
      info.className = 'locked-state';
      info.innerHTML = '<p>XML-RPC is disabled or blocked on this server.</p>';
      tabContent.appendChild(info);
    }
  }

  function renderWpscan() {
    const state = getState();
    if (!state.domain) {
      tabContent.innerHTML = '<div class="locked-state"><p>Navigate to a WordPress website to perform a WPScan vulnerability audit.</p></div>';
      return;
    }

    const container = document.createElement('div');

    // 1. Header Card
    const headerCard = document.createElement('div');
    headerCard.className = 'wpscan-header';

    const headerTitle = document.createElement('div');
    headerTitle.className = 'wpscan-title';
    headerTitle.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      WPScan Vulnerability Scanner
    `;
    headerCard.appendChild(headerTitle);

    const headerDesc = document.createElement('div');
    headerDesc.className = 'wpscan-desc';
    headerDesc.textContent = 'Probes WordPress Core, active theme, and identified plugins against the official WPScan vulnerability database in real-time.';
    headerCard.appendChild(headerDesc);

    // API Key Box or Action Controls
    const hasKey = Boolean(state.wpscanApiKey && state.wpscanApiKey.trim().length > 0);
    if (!hasKey || isEditingWpscanToken) {
      const tokenBox = document.createElement('div');
      tokenBox.className = 'wpscan-token-box';
      tokenBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <label style="font-size:11px;font-weight:600;" for="wpscan-inline-key">WPScan API Token</label>
          <a href="https://wpscan.com/api" target="_blank" class="wpscan-token-link">Get Free Token (25 req/day) ↗</a>
        </div>
        <div style="display:flex;gap:6px;">
          <input type="password" id="wpscan-inline-key" class="settings-input" placeholder="Paste your WPScan API token here..." value="${escapeHtml(state.wpscanApiKey || '')}">
          <button id="btn-save-wpscan-inline" class="scan-btn" style="width:auto;white-space:nowrap;padding:6px 12px;font-size:11px;margin:0;">Save</button>
          ${isEditingWpscanToken && hasKey ? '<button id="btn-cancel-wpscan-inline" class="btn-link" style="font-size:11px;padding:0 6px;">Cancel</button>' : ''}
        </div>
      `;

      tokenBox.querySelector('#btn-save-wpscan-inline')?.addEventListener('click', async () => {
        const input = tokenBox.querySelector('#wpscan-inline-key');
        const key = input ? input.value : '';
        await saveWpscanApiKey(key);
        isEditingWpscanToken = false;
        renderTabContent();
      });

      tokenBox.querySelector('#btn-cancel-wpscan-inline')?.addEventListener('click', () => {
        isEditingWpscanToken = false;
        renderTabContent();
      });

      headerCard.appendChild(tokenBox);
    } else {
      const statusBar = document.createElement('div');
      statusBar.className = 'wpscan-status-bar';
      statusBar.innerHTML = `
        <div class="token-status-active">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          API Token Configured
        </div>
        <button id="btn-edit-wpscan-key" class="btn-link">Change token</button>
      `;

      statusBar.querySelector('#btn-edit-wpscan-key')?.addEventListener('click', () => {
        isEditingWpscanToken = true;
        renderTabContent();
      });

      headerCard.appendChild(statusBar);
    }

    // Target Selection Box (always available)
    syncWpscanTargets();
    const avail = getAvailableWpscanTargets();
    const selected = state.wpscanSelectedTargets || { core: true, themes: new Set(), plugins: new Set() };

    const totalSelected = (selected.core && avail.coreVer ? 1 : 0) +
      (selected.themes?.size || 0) +
      (selected.plugins?.size || 0);

    const selectorBox = document.createElement('div');
    selectorBox.className = 'wpscan-selector-box';

    // Header with Select All / Clear All
    const selHeader = document.createElement('div');
    selHeader.className = 'wpscan-selector-header';
    selHeader.innerHTML = `
      <span class="wpscan-selector-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Select Targets (${totalSelected} selected)
      </span>
      <div class="wpscan-selector-actions">
        <button id="btn-wpscan-select-all" class="btn-link">Select All</button>
        <span style="color:var(--border);">|</span>
        <button id="btn-wpscan-clear-all" class="btn-link">Clear All</button>
      </div>
    `;
    selectorBox.appendChild(selHeader);

    // Group Toggle Row
    const groupRow = document.createElement('div');
    groupRow.className = 'wpscan-group-row';

    // Core Group Chip
    if (avail.coreVer) {
      const coreChip = document.createElement('button');
      coreChip.className = `chip ${selected.core ? 'selected' : ''}`;
      coreChip.textContent = `WordPress Core (${avail.coreVer})`;
      coreChip.title = selected.core ? 'Deselect WordPress Core' : 'Select WordPress Core';
      coreChip.addEventListener('click', () => {
        toggleWpscanTarget('core');
      });
      groupRow.appendChild(coreChip);
    }

    // Themes Group Chip
    if (avail.themes.length > 0) {
      const allThemesSelected = avail.themes.every(t => selected.themes.has(t.slug));
      const themeGroupChip = document.createElement('button');
      themeGroupChip.className = `chip ${allThemesSelected ? 'selected' : (selected.themes.size > 0 ? 'selected' : '')}`;
      themeGroupChip.textContent = `Themes (${selected.themes.size}/${avail.themes.length})`;
      themeGroupChip.title = 'Toggle all themes';
      themeGroupChip.addEventListener('click', () => {
        toggleWpscanGroup('themes');
      });
      groupRow.appendChild(themeGroupChip);
    }

    // Plugins Group Chip
    if (avail.plugins.length > 0) {
      const allPluginsSelected = avail.plugins.every(p => selected.plugins.has(p.slug));
      const pluginGroupChip = document.createElement('button');
      pluginGroupChip.className = `chip ${allPluginsSelected ? 'selected' : (selected.plugins.size > 0 ? 'selected' : '')}`;
      pluginGroupChip.textContent = `Plugins (${selected.plugins.size}/${avail.plugins.length})`;
      pluginGroupChip.title = 'Toggle all plugins';
      pluginGroupChip.addEventListener('click', () => {
        toggleWpscanGroup('plugins');
      });
      groupRow.appendChild(pluginGroupChip);
    }

    selectorBox.appendChild(groupRow);

    // Granular Themes List
    if (avail.themes.length > 0) {
      const themesSection = document.createElement('div');
      const themeSubhead = document.createElement('div');
      themeSubhead.className = 'wpscan-subheading';
      themeSubhead.innerHTML = `<span>Themes</span> <span style="font-weight:400;color:var(--text-muted);">${selected.themes.size} of ${avail.themes.length}</span>`;
      themesSection.appendChild(themeSubhead);

      const themeList = document.createElement('div');
      themeList.className = 'wpscan-item-list';
      avail.themes.forEach(t => {
        const isSel = selected.themes.has(t.slug);
        const chip = document.createElement('div');
        chip.className = `wpscan-item-chip ${isSel ? 'selected' : ''}`;
        chip.innerHTML = `<span>${escapeHtml(t.name || t.slug)}${t.isActive ? ' <em>(active)</em>' : ''}</span>`;
        chip.addEventListener('click', () => {
          toggleWpscanTarget('theme', t.slug);
        });
        themeList.appendChild(chip);
      });
      themesSection.appendChild(themeList);
      selectorBox.appendChild(themesSection);
    }

    // Granular Plugins List
    if (avail.plugins.length > 0) {
      const pluginsSection = document.createElement('div');
      const pluginSubhead = document.createElement('div');
      pluginSubhead.className = 'wpscan-subheading';
      pluginSubhead.innerHTML = `<span>Plugins</span> <span style="font-weight:400;color:var(--text-muted);">${selected.plugins.size} of ${avail.plugins.length}</span>`;
      pluginsSection.appendChild(pluginSubhead);

      const pluginList = document.createElement('div');
      pluginList.className = 'wpscan-item-list';
      avail.plugins.forEach(p => {
        const isSel = selected.plugins.has(p.slug);
        const chip = document.createElement('div');
        chip.className = `wpscan-item-chip ${isSel ? 'selected' : ''}`;
        chip.innerHTML = `<span>${escapeHtml(p.slug)}${p.version ? ` (${escapeHtml(p.version)})` : ''}</span>`;
        chip.addEventListener('click', () => {
          toggleWpscanTarget('plugin', p.slug);
        });
        pluginList.appendChild(chip);
      });
      pluginsSection.appendChild(pluginList);
      selectorBox.appendChild(pluginsSection);
    } else if (avail.themes.length === 0 && !avail.coreVer) {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'font-size:11px;color:var(--text-muted);padding:4px 0;';
      emptyNote.textContent = 'No plugins or themes detected yet. Perform an active scan or browse the site to identify components.';
      selectorBox.appendChild(emptyNote);
    }

    // Quota Notice / Estimate
    const quotaNotice = document.createElement('div');
    quotaNotice.className = 'wpscan-quota-notice';
    quotaNotice.innerHTML = `
      <span>Est. API requests: <strong>${totalSelected}</strong></span>
      <span>Free Plan Quota: 25 req/day</span>
    `;
    selectorBox.appendChild(quotaNotice);

    // Event handlers for Select All / Clear All
    selectorBox.querySelector('#btn-wpscan-select-all')?.addEventListener('click', () => {
      selectAllWpscanTargets(true);
    });
    selectorBox.querySelector('#btn-wpscan-clear-all')?.addEventListener('click', () => {
      selectAllWpscanTargets(false);
    });

    headerCard.appendChild(selectorBox);

    // Run Button
    const runBtn = document.createElement('button');
    runBtn.id = 'btn-run-wpscan';
    runBtn.className = 'scan-btn';
    runBtn.style.cssText = 'width:100%;margin:4px 0 0 0;';
    const isRunning = state.wpscanStatus === 'running';

    if (!hasKey) {
      runBtn.disabled = isRunning;
      runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Enter API Token Above to Run Scan';
      runBtn.addEventListener('click', () => {
        const input = headerCard.querySelector('#wpscan-inline-key');
        if (input) {
          input.focus();
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    } else {
      runBtn.disabled = isRunning || totalSelected === 0;
      runBtn.innerHTML = isRunning 
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Checking WPScan Database...'
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> ${totalSelected > 0 ? `Run WPScan Check (${totalSelected} selected)` : 'Select at least 1 target'}`;

      runBtn.addEventListener('click', async () => {
        await runWpscanCheck();
      });
    }

    headerCard.appendChild(runBtn);

    container.appendChild(headerCard);

    // 2. Live CLI Terminal Window
    if ((state.wpscanLogs && state.wpscanLogs.length > 0) || state.wpscanStatus === 'running') {
      const cliWindow = document.createElement('div');
      cliWindow.className = 'cli-window';

      const cliTop = document.createElement('div');
      cliTop.className = 'cli-topbar';
      cliTop.innerHTML = `
        <div class="cli-dots">
          <span class="cli-dot cli-dot-red"></span>
          <span class="cli-dot cli-dot-yellow"></span>
          <span class="cli-dot cli-dot-green"></span>
        </div>
        <span class="cli-title">HTTP Client — https://wpscan.com/api/v3 (${escapeHtml(state.domain)})</span>
      `;
      cliWindow.appendChild(cliTop);

      const cliBody = document.createElement('div');
      cliBody.id = 'cli-terminal-body';
      cliBody.className = 'cli-body';
      
      const linesHtml = state.wpscanLogs.map(log => {
        let cls = 'cli-line';
        if (log.startsWith('[HTTP 200]') || log.startsWith('[+]')) cls += ' cli-line-success';
        else if (log.startsWith('[HTTP 429]') || log.startsWith('[!]')) cls += ' cli-line-warn';
        else if (log.startsWith('[HTTP ERR]') || log.startsWith('[-]')) cls += ' cli-line-danger';
        else if (log.startsWith('[HTTP GET]') || log.startsWith('[*]')) cls += ' cli-line-cmd';
        return `<div class="${cls}">${escapeHtml(log)}</div>`;
      }).join('');

      cliBody.innerHTML = linesHtml + (state.wpscanStatus === 'running' ? '<div><span class="cli-cursor">_</span></div>' : '');
      cliWindow.appendChild(cliBody);
      container.appendChild(cliWindow);

      // Auto scroll terminal
      setTimeout(() => {
        const bodyEl = document.getElementById('cli-terminal-body');
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
      }, 0);
    }

    // 3. Formatted Vulnerability Results Cards
    if (state.wpscanResults) {
      const res = state.wpscanResults;
      const total = res.totalVulnerabilities || 0;

      // Banner
      const banner = document.createElement('div');
      if (total > 0) {
        banner.className = 'vuln-summary-banner vuln-summary-danger';
        banner.innerHTML = `
          <span><strong>[!] ${total} Vulnerabilities Identified</strong></span>
          <span class="row-badge badge-danger">ACTION REQUIRED</span>
        `;
      } else {
        banner.className = 'vuln-summary-banner vuln-summary-success';
        banner.innerHTML = `
          <span><strong>[✓] 0 Known Vulnerabilities Detected</strong></span>
          <span class="row-badge badge-success">CLEAN</span>
        `;
      }
      container.appendChild(banner);

      // Expand all / Collapse all controls bar
      if (total > 0) {
        const controlsBar = document.createElement('div');
        controlsBar.className = 'vuln-controls-bar';
        controlsBar.innerHTML = `
          <button class="vuln-toggle-btn" id="btn-collapse-all-vulns">Collapse all</button>
          <span style="color:var(--border);">|</span>
          <button class="vuln-toggle-btn" id="btn-expand-all-vulns">Expand all</button>
        `;
        controlsBar.querySelector('#btn-collapse-all-vulns')?.addEventListener('click', () => {
          container.querySelectorAll('.vuln-card').forEach(c => {
            if (c.querySelector('.vuln-card-body')) c.classList.add('collapsed');
          });
        });
        controlsBar.querySelector('#btn-expand-all-vulns')?.addEventListener('click', () => {
          container.querySelectorAll('.vuln-card').forEach(c => {
            c.classList.remove('collapsed');
          });
        });
        container.appendChild(controlsBar);
      }

      // Core Card
      if (res.core) {
        const coreCard = renderVulnComponentCard('WordPress Core', res.core.version, res.core.vulnerabilities || [], res.core.latestVersion);
        container.appendChild(coreCard);
      }

      // Theme Cards (Active + Inactive)
      if (res.themes && res.themes.length > 0) {
        const themeHeader = document.createElement('div');
        themeHeader.className = 'section-label';
        themeHeader.textContent = `Themes (${res.themes.length} tested)`;
        container.appendChild(themeHeader);

        res.themes.forEach(t => {
          const statusTag = t.isActive ? 'Active' : 'Inactive';
          const tCard = renderVulnComponentCard(`${t.name || t.slug} (${statusTag})`, t.version, t.vulnerabilities || [], t.latestVersion);
          container.appendChild(tCard);
        });
      } else if (res.theme) {
        const themeCard = renderVulnComponentCard(`Theme: ${res.theme.slug}`, res.theme.version, res.theme.vulnerabilities || [], res.theme.latestVersion);
        container.appendChild(themeCard);
      }

      // Plugins Cards
      if (res.plugins && res.plugins.length > 0) {
        const pluginHeader = document.createElement('div');
        pluginHeader.className = 'section-label';
        pluginHeader.textContent = `Plugins (${res.plugins.length} tested)`;
        container.appendChild(pluginHeader);

        res.plugins.forEach(p => {
          const pCard = renderVulnComponentCard(p.slug, p.version, p.vulnerabilities || [], p.latestVersion, p.source);
          container.appendChild(pCard);
        });
      }
    }

    tabContent.appendChild(container);
  }

  function renderVulnComponentCard(title, installedVersion, vulns, latestVersion, source) {
    const card = document.createElement('div');
    card.className = 'vuln-card';

    const header = document.createElement('div');
    header.className = 'vuln-card-header';

    const count = vulns.length;
    const badgeClass = count > 0 ? 'badge-danger' : 'badge-success';
    const badgeText = count > 0 ? `${count} CVE${count > 1 ? 's' : ''}` : 'No Known CVEs';

    const chevronSvg = count > 0 ? `
      <svg class="vuln-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>` : '';

    header.innerHTML = `
      <div class="vuln-card-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>${escapeHtml(title)}</span>
        ${installedVersion ? `<span style="font-size:11px;color:var(--text-secondary);font-weight:normal;">v${escapeHtml(installedVersion)}</span>` : '<span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(version unconfirmed)</span>'}
        ${source ? `<span class="row-badge badge-neutral" style="font-size:9px;">${escapeHtml(source)}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span class="row-badge ${badgeClass}">${badgeText}</span>
        ${chevronSvg}
      </div>
    `;

    if (count > 0) {
      header.classList.add('collapsible');
      header.title = 'Click to expand or collapse vulnerabilities';
      header.addEventListener('click', () => {
        card.classList.toggle('collapsed');
      });
    }

    card.appendChild(header);

    if (count === 0) {
      const cleanNote = document.createElement('div');
      cleanNote.style.cssText = 'font-size:11px;color:var(--text-muted);margin-top:2px;';
      cleanNote.textContent = latestVersion ? `Latest upstream version: ${latestVersion}` : 'No known vulnerabilities in database.';
      card.appendChild(cleanNote);
    } else {
      const body = document.createElement('div');
      body.className = 'vuln-card-body';

      vulns.forEach(v => {
        const item = document.createElement('div');
        item.className = 'vuln-item';

        const itemTitle = document.createElement('div');
        itemTitle.className = 'vuln-item-title';
        itemTitle.textContent = v.title || 'WordPress Security Vulnerability';
        item.appendChild(itemTitle);

        const tags = document.createElement('div');
        tags.className = 'vuln-tags';

        // Fixed In badge
        if (v.fixed_in) {
          tags.innerHTML += `<span class="fixed-badge">Fixed in v${escapeHtml(v.fixed_in)}</span>`;
        } else {
          tags.innerHTML += `<span class="cve-badge" style="background:var(--bg-warning);color:var(--warning);">No Fix Available</span>`;
        }

        // CVSS score
        if (v.cvss?.score) {
          tags.innerHTML += `<span class="row-badge badge-warning">CVSS ${escapeHtml(String(v.cvss.score))}</span>`;
        }

        // CVE badges
        if (v.references?.cve && Array.isArray(v.references.cve)) {
          v.references.cve.forEach(cve => {
            tags.innerHTML += `<a href="https://nvd.nist.gov/vuln/detail/CVE-${escapeHtml(cve)}" target="_blank" class="cve-badge">CVE-${escapeHtml(cve)} ↗</a>`;
          });
        }

        item.appendChild(tags);

        // References
        if (v.references?.url && Array.isArray(v.references.url) && v.references.url.length > 0) {
          const refs = document.createElement('div');
          refs.className = 'vuln-refs';
          refs.innerHTML = '<strong>References:</strong> ';
          v.references.url.slice(0, 3).forEach(url => {
            try {
              const host = new URL(url).hostname.replace(/^www\./, '');
              refs.innerHTML += `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(host)} ↗</a>`;
            } catch(e) {
              refs.innerHTML += `<a href="${escapeHtml(url)}" target="_blank">Advisory ↗</a>`;
            }
          });
          item.appendChild(refs);
        }

        body.appendChild(item);
      });

      card.appendChild(body);
    }

    return card;
  }

  function updateOrRenderWpscanLogs() {
    const cliBody = document.getElementById('cli-terminal-body');
    const state = getState();
    if (!cliBody) {
      renderTabContent();
      return;
    }

    const linesHtml = state.wpscanLogs.map(log => {
      let cls = 'cli-line';
      if (log.startsWith('[+]')) cls += ' cli-line-success';
      else if (log.startsWith('[!]')) cls += ' cli-line-warn';
      else if (log.startsWith('[-]')) cls += ' cli-line-danger';
      else if (log.startsWith('[*]')) cls += ' cli-line-cmd';
      return `<div class="${cls}">${escapeHtml(log)}</div>`;
    }).join('');

    cliBody.innerHTML = linesHtml + (state.wpscanStatus === 'running' ? '<div><span class="cli-cursor">_</span></div>' : '');
    cliBody.scrollTop = cliBody.scrollHeight;
  }

  function renderFindings() {
    const state = getState();
    const findings = state.activeResults?.findings || [];
    const isScanning = state.status === 'scanning';

    if (isScanning && findings.length === 0) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Evaluating security findings in real-time...</span>`;
      tabContent.appendChild(liveBar);
      return;
    }

    if (findings.length === 0 && !isScanning) {
      tabContent.innerHTML = '<div class="locked-state"><p>No security findings detected.</p></div>';
      return;
    }

    if (isScanning) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Security findings (${findings.length} detected so far)</span>`;
      tabContent.appendChild(liveBar);
    }

    findings.forEach(f => {
      tabContent.appendChild(createFindingRow(f));
    });
  }

  function renderFirewall() {
    const state = getState();
    const pd = state.passiveData;
    const isScanning = state.status === 'scanning';

    if (!pd && !state.activeResults && !state.domain) {
      tabContent.innerHTML = '<div class="locked-state"><p>No WordPress target detected yet. Navigate to a WordPress site to analyze firewalls and security plugins.</p></div>';
      return;
    }

    if (isScanning) {
      const liveBar = document.createElement('div');
      liveBar.className = 'live-scan-bar';
      liveBar.innerHTML = `<span class="status-dot status-scanning"></span> <span>Probing and verifying security controls...</span>`;
      tabContent.appendChild(liveBar);
    }

    // 1. Gather all detected firewalls and security components
    const secItems = pd?.security ? [...pd.security] : [];
    const activePlugins = (state.activeResults?.plugins || []).map(p => typeof p === 'string' ? p : p.slug);
    const passivePlugins = pd?.plugins || [];
    const allPlugins = new Set([...activePlugins, ...passivePlugins]);

    // Plugin detection definitions to cross-reference
    const pluginDefs = [
      { slug: 'wordfence', name: 'Wordfence Security', vendor: 'Defiant Inc.', detail: 'Endpoint firewall, malware scanner & live traffic blocking' },
      { slug: 'better-wp-security', name: 'Solid Security (iThemes)', vendor: 'SolidWP', detail: 'Two-factor auth, brute-force shield & site hardening' },
      { slug: 'solid-security', name: 'Solid Security', vendor: 'SolidWP', detail: 'Two-factor auth, brute-force shield & site hardening' },
      { slug: 'sucuri-scanner', name: 'Sucuri Security', vendor: 'Sucuri', detail: 'Auditing, malware scanner, integrity monitoring & firewall agent' },
      { slug: 'ninjafirewall', name: 'NinjaFirewall', vendor: 'NinjaTechnologies', detail: 'True web application firewall (WAF) hooked prior to WordPress core' },
      { slug: 'all-in-one-wp-security-and-firewall', name: 'All-in-One WP Security', vendor: 'AIOWPS', detail: 'Security audit, firewall rules & login lockdown' },
      { slug: 'aiowpsec', name: 'All-in-One WP Security', vendor: 'AIOWPS', detail: 'Security audit, firewall rules & login lockdown' },
      { slug: 'wp-simple-firewall', name: 'Shield Security', vendor: 'Shield', detail: 'Automated IP management, telemetry & defense against bots' },
      { slug: 'shield-security', name: 'Shield Security', vendor: 'Shield', detail: 'Automated IP management, telemetry & defense against bots' },
      { slug: 'bbq-firewall', name: 'BBQ: Block Bad Queries', vendor: 'BBQ', detail: 'Lightweight request URI & query parameter filter' },
      { slug: 'wp-cerber', name: 'WP Cerber Security', vendor: 'Cerber', detail: 'Anti-spam, anti-bot, brute-force shield & integrity inspector' },
      { slug: 'secupress', name: 'SecuPress Security', vendor: 'SecuPress', detail: 'WordPress security scanner, anti-brute force & firewall' },
      { slug: 'cleantalk-spam-protect', name: 'CleanTalk Security', vendor: 'CleanTalk', detail: 'Cloud-based anti-spam, brute-force protection & firewall' },
      { slug: 'malcare-security', name: 'MalCare Security', vendor: 'MalCare', detail: 'Cloud malware scanner, bot protection & smart firewall' }
    ];

    // Merge plugins detected through enumeration into security list if not already present
    pluginDefs.forEach(def => {
      if (allPlugins.has(def.slug)) {
        if (!secItems.some(i => i.name.toLowerCase().includes(def.slug) || i.name === def.name)) {
          secItems.push({
            name: def.name,
            vendor: def.vendor,
            type: 'plugin',
            detail: def.detail,
            evidence: `/wp-content/plugins/${def.slug}/`,
            source: 'plugin-enumeration'
          });
        }
      }
    });

    // Cloud proxy detection definitions
    const cloudFirewalls = secItems.filter(i => i.type === 'proxy');
    const securityPlugins = secItems.filter(i => i.type === 'plugin');

    // If active WAF detected a vendor, mark or add
    if (state.wafDetected && state.wafVendor) {
      const vendorLower = state.wafVendor.toLowerCase();
      const existingCloud = cloudFirewalls.find(c => c.name.toLowerCase().includes(vendorLower) || c.vendor?.toLowerCase().includes(vendorLower));
      if (existingCloud) {
        existingCloud.isBlocking = true;
      } else {
        const isPluginWaf = vendorLower.includes('wordfence') || vendorLower.includes('ninja');
        const newWafItem = {
          name: state.wafVendor,
          vendor: state.wafVendor,
          type: isPluginWaf ? 'plugin' : 'proxy',
          detail: 'Actively challenged or blocked automated requests during probe',
          evidence: 'HTTP 403 / challenge response',
          isBlocking: true
        };
        if (isPluginWaf) {
          const existingPlugin = securityPlugins.find(p => p.name.toLowerCase().includes(vendorLower));
          if (existingPlugin) existingPlugin.isBlocking = true;
          else securityPlugins.push(newWafItem);
        } else {
          cloudFirewalls.push(newWafItem);
        }
      }
    }

    const hasCloud = cloudFirewalls.length > 0;
    const hasPlugin = securityPlugins.length > 0;
    const isBlocking = state.wafDetected;

    // 2. Render Hero Banner
    const banner = document.createElement('div');
    if (isBlocking) {
      banner.className = 'firewall-banner blocking';
      banner.innerHTML = `
        <div class="firewall-banner-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>
        <div class="firewall-banner-content">
          <div class="firewall-banner-title">
            <span>Active WAF Blocking Enforced</span>
            <span class="row-badge badge-danger">CHALLENGE / 403</span>
          </div>
          <div class="firewall-banner-desc">Automated probes were actively challenged or blocked by <strong>${escapeHtml(state.wafVendor || 'WAF')}</strong>. The site is actively filtering incoming requests.</div>
        </div>
      `;
    } else if (hasCloud && hasPlugin) {
      banner.className = 'firewall-banner dual-shield';
      banner.innerHTML = `
        <div class="firewall-banner-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div class="firewall-banner-content">
          <div class="firewall-banner-title">
            <span>Dual Protection: Proxy WAF & Security Plugin</span>
            <span class="row-badge badge-proxy">BOTH DETECTED</span>
          </div>
          <div class="firewall-banner-desc">This site is protected by both an <strong>Edge Cloud/Proxy Firewall</strong> (${cloudFirewalls.map(c => escapeHtml(c.name)).join(', ')}) and a <strong>WordPress Security Plugin</strong> (${securityPlugins.map(p => escapeHtml(p.name)).join(', ')}).</div>
        </div>
      `;
    } else if (hasCloud) {
      banner.className = 'firewall-banner single-shield';
      banner.innerHTML = `
        <div class="firewall-banner-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div class="firewall-banner-content">
          <div class="firewall-banner-title">
            <span>Cloud / Proxy Firewall Detected</span>
            <span class="row-badge badge-proxy">EDGE WAF</span>
          </div>
          <div class="firewall-banner-desc">Traffic routes through <strong>${cloudFirewalls.map(c => escapeHtml(c.name)).join(', ')}</strong> at the DNS/CDN edge before reaching the origin web server.</div>
        </div>
      `;
    } else if (hasPlugin) {
      banner.className = 'firewall-banner single-shield';
      banner.innerHTML = `
        <div class="firewall-banner-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div class="firewall-banner-content">
          <div class="firewall-banner-title">
            <span>WordPress Security Plugin Active</span>
            <span class="row-badge badge-plugin">APPLICATION WAF</span>
          </div>
          <div class="firewall-banner-desc">Protected by <strong>${securityPlugins.map(p => escapeHtml(p.name)).join(', ')}</strong> at the application level to guard logins, REST API, and uploads.</div>
        </div>
      `;
    } else {
      banner.className = 'firewall-banner';
      banner.innerHTML = `
        <div class="firewall-banner-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div class="firewall-banner-content">
          <div class="firewall-banner-title">
            <span>No Firewall or Security Plugin Detected</span>
            <span class="row-badge badge-neutral">CLEAN / EXPOSED</span>
          </div>
          <div class="firewall-banner-desc">Neither cloud proxy headers (Cloudflare, Sucuri, Imperva) nor known WordPress security plugins were found.</div>
        </div>
      `;
    }
    tabContent.appendChild(banner);

    // 3. Stats Overview Grid
    const statGrid = document.createElement('div');
    statGrid.className = 'firewall-stat-grid';
    statGrid.innerHTML = `
      <div class="firewall-stat-box">
        <div class="firewall-stat-val" style="color:${hasCloud ? 'var(--accent)' : 'var(--text-secondary)'}">${cloudFirewalls.length}</div>
        <div class="firewall-stat-lbl">Cloud WAFs</div>
      </div>
      <div class="firewall-stat-box">
        <div class="firewall-stat-val" style="color:${hasPlugin ? '#9333ea' : 'var(--text-secondary)'}">${securityPlugins.length}</div>
        <div class="firewall-stat-lbl">Security Plugins</div>
      </div>
      <div class="firewall-stat-box">
        <div class="firewall-stat-val" style="color:${isBlocking ? 'var(--danger)' : (hasCloud || hasPlugin ? 'var(--success)' : 'var(--text-muted)')}">
          ${isBlocking ? 'Blocking' : (hasCloud || hasPlugin ? 'Active' : 'None')}
        </div>
        <div class="firewall-stat-lbl">WAF State</div>
      </div>
    `;
    tabContent.appendChild(statGrid);

    // 4. Section: Cloud & Proxy Firewalls
    const cloudHeader = document.createElement('div');
    cloudHeader.className = 'section-label';
    cloudHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:14px;';
    cloudHeader.innerHTML = `
      <span>Cloud & Proxy Firewalls / CDNs</span>
      <span class="row-badge ${hasCloud ? 'badge-proxy' : 'badge-neutral'}">${cloudFirewalls.length} detected</span>
    `;
    tabContent.appendChild(cloudHeader);

    if (cloudFirewalls.length > 0) {
      cloudFirewalls.forEach(fw => {
        tabContent.appendChild(createFirewallRow({
          ...fw,
          type: 'proxy',
          status: fw.isBlocking ? 'blocking' : 'active'
        }));
      });
    } else {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'font-size:11px;color:var(--text-muted);padding:8px 12px;background:var(--surface-1);border-radius:6px;margin-bottom:8px;';
      emptyNote.textContent = 'No edge proxy firewalls (Cloudflare, Sucuri CloudProxy, Imperva Incapsula, Akamai, AWS WAF) detected.';
      tabContent.appendChild(emptyNote);
    }

    // 5. Section: WordPress Security Plugins
    const pluginHeader = document.createElement('div');
    pluginHeader.className = 'section-label';
    pluginHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:14px;';
    pluginHeader.innerHTML = `
      <span>WordPress Security Plugins & App Firewalls</span>
      <span class="row-badge ${hasPlugin ? 'badge-plugin' : 'badge-neutral'}">${securityPlugins.length} detected</span>
    `;
    tabContent.appendChild(pluginHeader);

    if (securityPlugins.length > 0) {
      securityPlugins.forEach(p => {
        tabContent.appendChild(createFirewallRow({
          ...p,
          type: 'plugin',
          status: p.isBlocking ? 'blocking' : 'active'
        }));
      });
    } else {
      const emptyNote = document.createElement('div');
      emptyNote.style.cssText = 'font-size:11px;color:var(--text-muted);padding:8px 12px;background:var(--surface-1);border-radius:6px;margin-bottom:8px;';
      emptyNote.textContent = 'No WordPress security plugins (Wordfence, Solid Security, NinjaFirewall, Sucuri Scanner, Shield) detected.';
      tabContent.appendChild(emptyNote);
    }

    // 6. Section: Recon / Security Intelligence Notes
    const intelHeader = document.createElement('div');
    intelHeader.className = 'section-label';
    intelHeader.style.cssText = 'margin-top:16px;';
    intelHeader.textContent = 'Reconnaissance & Pentest Intelligence';
    tabContent.appendChild(intelHeader);

    const intelCard = document.createElement('div');
    intelCard.style.cssText = 'background:var(--surface-1);border:1px solid var(--border);border-radius:6px;padding:10px 12px;font-size:11px;line-height:1.5;color:var(--text-secondary);';
    
    let tips = [];
    if (cloudFirewalls.some(c => c.name.toLowerCase().includes('cloudflare'))) {
      tips.push('<strong>Cloudflare Edge:</strong> Origin IP is masked. Look for origin exposure via SPF/MX DNS records, historical DNS (SecurityTrails, Censys), or SSL cert SANs.');
    }
    if (securityPlugins.some(p => p.name.toLowerCase().includes('wordfence'))) {
      tips.push('<strong>Wordfence Detected:</strong> Monitors request frequency and triggers IP blocks on repeated 404s/sensitive path scans. Set scan delay to 250ms+ in Settings.');
    }
    if (securityPlugins.some(p => p.name.toLowerCase().includes('ninja'))) {
      tips.push('<strong>NinjaFirewall:</strong> Operates at the PHP interpreter level via <code>auto_prepend_file</code> before WordPress boots, effectively stopping common traversal probes.');
    }
    if (isBlocking) {
      tips.push('<strong>Active Blocking:</strong> Endpoint enumeration was intercepted. Active scan was automatically throttled/halted to prevent IP bans.');
    }
    if (tips.length === 0) {
      tips.push('<strong>Direct Origin Exposed:</strong> No fronting proxy WAF detected. The server responds directly without edge DDoS/WAF filtering.');
    }

    intelCard.innerHTML = tips.map(t => `<div style="margin-bottom:6px;">• ${t}</div>`).join('');
    tabContent.appendChild(intelCard);
  }
  
  function renderReport() {
    try {
      renderReportTab(tabContent, getState());
    } catch (e) {
      tabContent.innerHTML = '<div class="locked-state"><p>Report module failed to render.</p></div>';
    }
  }
  
  // Subscribe to data changes to re-render active tab
  subscribe('passiveData', () => {
    switchTab(activeTab); // re-evaluate lock states (admin, users) and render
  });
  subscribe('activeResults', renderTabContent);
  subscribe('wafDetected', renderTabContent);
  subscribe('scanProgress', () => { if (getState().status === 'scanning') renderTabContent(); });
  subscribe('completedCategories', () => switchTab(activeTab)); // re-evaluate lock states
  subscribe('status', () => switchTab(activeTab));
  subscribe('wpscanStatus', () => { if (activeTab === 'wpscan') renderTabContent(); });
  subscribe('wpscanLogs', () => { if (activeTab === 'wpscan') updateOrRenderWpscanLogs(); });
  subscribe('wpscanResults', () => { if (activeTab === 'wpscan') renderTabContent(); });
  subscribe('wpscanApiKey', () => { if (activeTab === 'wpscan') renderTabContent(); });
  subscribe('wpscanSelectedTargets', () => { if (activeTab === 'wpscan') renderTabContent(); });
  
  // Initial render
  switchTab('overview');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

