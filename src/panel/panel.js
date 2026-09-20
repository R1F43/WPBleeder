import { initState, getState, subscribe } from './state.js';
import { initHeader } from './components/header.js';
import { initChips } from './components/chips.js';
import { initTabs } from './components/tabs.js';
import { initSettingsDrawer } from './components/settings-drawer.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize all UI components immediately for instant rendering (<10ms paint)
  initHeader();
  initChips();
  initTabs();
  initSettingsDrawer();
  
  const state = getState();
  
  // 2. Set up reactive bindings
  const domainEl = document.getElementById('target-domain');
  subscribe('domain', (domain) => {
    if (domainEl) domainEl.textContent = domain || 'No WordPress site detected';
  });
  if (domainEl) domainEl.textContent = state.domain || 'No WordPress site detected';
  
  // Update metric cards
  function updateMetrics() {
    const s = getState();
    const metricVersion = document.getElementById('metric-version');
    const metricPlugins = document.getElementById('metric-plugins');
    const metricUsers = document.getElementById('metric-users');
    const metricFindings = document.getElementById('metric-findings');
    const metricFirewall = document.getElementById('metric-firewall');
    
    if (metricVersion) {
      const v = s.passiveData?.wpVersion?.meta || 
                s.passiveData?.wpVersion?.assets || 
                s.activeResults?.paths?.find(p => p.path === '/readme.html' && p.extractedVersion)?.extractedVersion || 
                '–';
      metricVersion.textContent = v;
    }
    
    if (metricPlugins) {
      const activePlugins = (s.activeResults?.plugins || []).map(p => typeof p === 'string' ? p : p.slug);
      const passivePlugins = (s.passiveData?.plugins || []).map(p => typeof p === 'string' ? p : p.slug);
      const allPluginSlugs = new Set([...activePlugins, ...passivePlugins]);

      if (allPluginSlugs.size > 0) {
        metricPlugins.textContent = allPluginSlugs.size;
        metricPlugins.title = `${allPluginSlugs.size} plugins detected (${activePlugins.length} active, ${passivePlugins.length} passive)`;
      } else if (s.status === 'scanning') {
        metricPlugins.textContent = '…';
      } else if (s.passiveData) {
        metricPlugins.textContent = '0';
      } else {
        metricPlugins.textContent = '–';
      }
    }
    
    if (metricUsers) {
      const activeUsers = (s.activeResults?.users || []).map(u => typeof u === 'string' ? u : (u.slug || u.name || u.login));
      const passiveAuthors = (s.passiveData?.authors || []).map(a => a.slug || a.name);
      const allUsers = new Set([...activeUsers, ...passiveAuthors].filter(Boolean));

      if (allUsers.size > 0) {
        metricUsers.textContent = allUsers.size;
        metricUsers.title = `${allUsers.size} users detected (${activeUsers.length} active, ${passiveAuthors.length} passive)`;
      } else if (s.status === 'scanning') {
        metricUsers.textContent = '…';
      } else if (s.passiveData) {
        metricUsers.textContent = '0';
      } else {
        metricUsers.textContent = '–';
      }
    }
    
    if (metricFindings) {
      if (s.activeResults?.findings) {
        metricFindings.textContent = s.activeResults.findings.length;
      } else {
        metricFindings.textContent = '–';
      }
    }

    if (metricFirewall) {
      const secItems = s.passiveData?.security || [];
      const hasWaf = s.wafDetected;
      const wafVendor = s.wafVendor;

      // Also check if any known security plugins exist in active or passive plugins
      const activePlugins = (s.activeResults?.plugins || []).map(p => typeof p === 'string' ? p : p.slug);
      const passivePlugins = s.passiveData?.plugins || [];
      const allPlugins = new Set([...activePlugins, ...passivePlugins]);
      
      const extraSec = [];
      if (allPlugins.has('wordfence') && !secItems.some(i => i.name.toLowerCase().includes('wordfence'))) {
        extraSec.push('Wordfence Security');
      }
      if ((allPlugins.has('better-wp-security') || allPlugins.has('solid-security')) && !secItems.some(i => i.name.toLowerCase().includes('solid') || i.name.toLowerCase().includes('ithemes'))) {
        extraSec.push('Solid Security');
      }
      if (allPlugins.has('ninjafirewall') && !secItems.some(i => i.name.toLowerCase().includes('ninja'))) {
        extraSec.push('NinjaFirewall');
      }
      if (allPlugins.has('sucuri-scanner') && !secItems.some(i => i.name.toLowerCase().includes('sucuri'))) {
        extraSec.push('Sucuri Security');
      }

      const totalItems = Array.from(new Set([...secItems.map(s => s.name), ...extraSec]));
      
      if (hasWaf && wafVendor) {
        metricFirewall.textContent = wafVendor;
        metricFirewall.title = `Active WAF Blocking: ${wafVendor}`;
      } else if (totalItems.length === 1) {
        metricFirewall.textContent = totalItems[0];
        metricFirewall.title = `${totalItems[0]} detected`;
      } else if (totalItems.length > 1) {
        metricFirewall.textContent = `${totalItems.length} Found`;
        metricFirewall.title = totalItems.join(', ');
      } else if (hasWaf) {
        metricFirewall.textContent = 'Active WAF';
        metricFirewall.title = 'Active WAF Blocking detected';
      } else if (s.passiveData) {
        metricFirewall.textContent = 'None';
        metricFirewall.title = 'No firewall or security plugin detected';
      } else {
        metricFirewall.textContent = '–';
      }
    }
  }
  
  subscribe('passiveData', updateMetrics);
  subscribe('activeResults', updateMetrics);
  subscribe('wafDetected', updateMetrics);
  updateMetrics();

  // Metric card click-to-tab navigation
  document.getElementById('card-version')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="overview"]')?.click();
  });
  document.getElementById('card-plugins')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="plugins"]')?.click();
  });
  document.getElementById('card-users')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="users"]')?.click();
  });
  document.getElementById('card-findings')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="findings"]')?.click();
  });
  document.getElementById('card-firewall')?.addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="firewall"]')?.click();
  });
  
  // Handle disabled state
  subscribe('enabled', (enabled) => {
    const main = document.getElementById('main-content');
    if (main) {
      if (enabled) main.classList.remove('disabled-overlay');
      else main.classList.add('disabled-overlay');
    }
  });
  if (!state.enabled) {
    document.getElementById('main-content')?.classList.add('disabled-overlay');
  }
  
  // Progress bar
  subscribe('scanProgress', (progress) => {
    const fill = document.getElementById('progress-fill');
    if (fill && progress) {
      fill.style.width = `${progress.percent || 0}%`;
    }
  });

  // 3. Hydrate state asynchronously in background
  initState();
});
