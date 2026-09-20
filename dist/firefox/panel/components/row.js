// SVG icon paths (Lucide icons)
const ICONS = {
  wordpress: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="m8 12 1.5 6L12 12l2.5 6L16 12"/>',
  puzzle: '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18-.894-.527-.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.404 2.404 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="11.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'
};

export function makeSvgIcon(name, size = 16) {
  const paths = ICONS[name] || ICONS.folder;
  return `<svg class="row-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export function createRow(iconName, label) {
  const row = document.createElement('div');
  row.className = 'result-row';
  row.innerHTML = `
    ${makeSvgIcon(iconName)}
    <span class="row-label">${escapeHtml(label)}</span>
  `;
  return row;
}

export function createExternalLinkRow(label, url, status, badgeClass) {
  const row = document.createElement('div');
  row.className = 'result-row clickable';
  row.innerHTML = `
    ${makeSvgIcon('folder')}
    <span class="row-label" style="flex:1">${escapeHtml(label)}</span>
    ${status != null ? `<span class="row-badge ${badgeClass || 'badge-neutral'}">${status}</span>` : ''}
    ${makeSvgIcon('external-link', 14)}
  `;
  row.addEventListener('click', () => {
    const browser = globalThis.browser || globalThis.chrome;
    browser.tabs.create({ url });
  });
  return row;
}

export function createUserRow(label, url, sourceBadge) {
  const row = document.createElement('div');
  row.className = 'result-row' + (url ? ' clickable' : '');
  row.innerHTML = `
    ${makeSvgIcon('user')}
    <span class="row-label" style="flex:1">${escapeHtml(label)}</span>
    ${sourceBadge ? `<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">${escapeHtml(sourceBadge)}</span>` : ''}
    ${url ? makeSvgIcon('external-link', 14) : ''}
  `;
  if (url) {
    row.title = `Verify user at: ${url}`;
    row.addEventListener('click', () => {
      const browser = globalThis.browser || globalThis.chrome;
      browser.tabs.create({ url });
    });
  }
  return row;
}

export function createPluginRow(label, url, sourceBadge, cveCount) {
  const row = document.createElement('div');
  row.className = 'result-row' + (url ? ' clickable' : '');

  let sourceHtml = '';
  if (sourceBadge === 'passive') {
    sourceHtml = '<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">passive</span>';
  } else if (sourceBadge?.includes('passive')) {
    sourceHtml = '<span class="row-badge badge-success" style="margin-right:4px;font-size:10px;">passive+active</span>';
  } else if (sourceBadge === 'active') {
    sourceHtml = '<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">active</span>';
  } else if (sourceBadge) {
    sourceHtml = `<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">${escapeHtml(sourceBadge)}</span>`;
  }

  let vulnHtml = '';
  if (cveCount && cveCount > 0) {
    vulnHtml = `<span class="row-badge badge-danger" style="margin-right:4px;font-size:10px;">${cveCount} CVE</span>`;
  }

  row.innerHTML = `
    ${makeSvgIcon('puzzle')}
    <span class="row-label" style="flex:1">${escapeHtml(label)}</span>
    ${sourceHtml}
    ${vulnHtml}
    ${url ? makeSvgIcon('external-link', 14) : ''}
  `;

  if (url) {
    row.title = `Verify plugin at: ${url}`;
    row.addEventListener('click', () => {
      const browser = globalThis.browser || globalThis.chrome;
      browser.tabs.create({ url });
    });
  }

  return row;
}

export function createThemeRow(theme) {
  const row = document.createElement('div');
  const url = theme.url;
  row.className = 'result-row' + (url ? ' clickable' : '');

  const label = theme.name ? `${theme.name} (${theme.slug})` : theme.slug;
  const statusBadge = theme.isActive
    ? '<span class="row-badge badge-success" style="margin-right:4px;font-size:10px;">ACTIVE</span>'
    : '<span class="row-badge badge-warning" style="margin-right:4px;font-size:10px;">INACTIVE</span>';
  
  const verBadge = theme.version
    ? `<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">v${escapeHtml(theme.version)}</span>`
    : '';

  const vulnBadge = theme.vulnerabilities && theme.vulnerabilities.length > 0
    ? `<span class="row-badge badge-danger" style="margin-right:4px;font-size:10px;">${theme.vulnerabilities.length} CVE</span>`
    : '';

  row.innerHTML = `
    ${makeSvgIcon('palette')}
    <span class="row-label" style="flex:1">${escapeHtml(label)}</span>
    ${statusBadge}
    ${verBadge}
    ${vulnBadge}
    ${url ? makeSvgIcon('external-link', 14) : ''}
  `;

  if (url) {
    row.title = `Verify theme stylesheet at: ${url}`;
    row.addEventListener('click', () => {
      const browser = globalThis.browser || globalThis.chrome;
      browser.tabs.create({ url });
    });
  }
  return row;
}

export function createMediaRow(item) {
  const row = document.createElement('div');
  const url = item.url;
  row.className = 'result-row' + (url ? ' clickable' : '');

  const iconName = item.isDocument ? 'file-text' : 'image';
  const label = item.title || item.filename || 'Media Item';
  
  let mimeBadgeClass = 'badge-neutral';
  if (item.isDocument) mimeBadgeClass = 'badge-warning';

  const cleanMime = (item.mimeType || 'file').replace(/^application\//, '').replace(/^image\//, '');
  const mimeBadge = `<span class="row-badge ${mimeBadgeClass}" style="margin-right:4px;font-size:10px;">${escapeHtml(cleanMime)}</span>`;
  
  const dateBadge = item.date
    ? `<span style="color:var(--text-secondary);font-size:10px;margin-right:6px;">${escapeHtml(item.date.slice(0, 10))}</span>`
    : '';

  row.innerHTML = `
    ${makeSvgIcon(iconName)}
    <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;">
      <span class="row-label">${escapeHtml(label)}</span>
    </div>
    ${dateBadge}
    ${mimeBadge}
    ${url ? makeSvgIcon('external-link', 14) : ''}
  `;

  if (url) {
    row.title = `Open media: ${url}`;
    row.addEventListener('click', () => {
      const browser = globalThis.browser || globalThis.chrome;
      browser.tabs.create({ url });
    });
  }
  return row;
}

export function createFindingRow(finding) {
  const severityMap = {
    high: 'severity-high',
    medium: 'severity-medium',
    low: 'severity-low'
  };
  const row = document.createElement('div');
  row.className = 'result-row';
  row.innerHTML = `
    ${makeSvgIcon('alert-triangle')}
    <div style="flex:1">
      <div class="row-label">${escapeHtml(finding.title)}</div>
      <div class="row-detail">${escapeHtml(finding.detail || '')}</div>
    </div>
    <span class="row-badge ${severityMap[finding.severity] || 'severity-low'}">${finding.severity}</span>
  `;
  return row;
}

export function createFirewallRow(item) {
  const row = document.createElement('div');
  row.className = 'result-row';
  
  const isProxy = item.type === 'proxy';
  const typeBadgeClass = isProxy ? 'badge-proxy' : 'badge-plugin';
  const typeLabel = isProxy ? 'Cloud / Proxy WAF' : 'WP Security Plugin';
  
  let statusBadge = '';
  if (item.isBlocking) {
    statusBadge = '<span class="row-badge badge-danger" style="margin-right:4px;font-size:10px;">BLOCKING</span>';
  } else if (item.status === 'active') {
    statusBadge = '<span class="row-badge badge-success" style="margin-right:4px;font-size:10px;">ACTIVE</span>';
  } else {
    statusBadge = '<span class="row-badge badge-neutral" style="margin-right:4px;font-size:10px;">DETECTED</span>';
  }

  row.innerHTML = `
    ${makeSvgIcon('shield')}
    <div style="flex:1;min-width:0;margin-right:8px;">
      <div class="row-label" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-weight:600;">${escapeHtml(item.name)}</span>
        ${item.vendor ? `<span style="font-size:11px;color:var(--text-muted);">(${escapeHtml(item.vendor)})</span>` : ''}
      </div>
      <div class="row-detail" style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
        ${escapeHtml(item.detail || (isProxy ? 'Edge proxy firewall, DDoS mitigation & reverse-proxy routing' : 'Application-layer security scanner, login protect & firewall'))}
      </div>
      ${item.evidence ? `<div style="font-size:10px;color:var(--text-muted);font-family:ui-monospace,monospace;margin-top:3px;">Evidence: ${escapeHtml(item.evidence)}</div>` : ''}
    </div>
    ${statusBadge}
    <span class="row-badge ${typeBadgeClass}" style="font-size:10px;">${escapeHtml(typeLabel)}</span>
  `;
  return row;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

