const browser = globalThis.browser || globalThis.chrome;

export function renderReportTab(container, state) {
  container.innerHTML = '';
  
  if (!state.passiveData && !state.activeResults) {
    container.innerHTML = '<div class="locked-state"><p>No scan data to export yet. Run an active or passive scan to generate a report.</p></div>';
    return;
  }
  
  // Controls Grid
  const controls = document.createElement('div');
  controls.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;';
  
  const btnHtml = document.createElement('button');
  btnHtml.className = 'scan-btn';
  btnHtml.style.cssText = 'padding:8px;font-size:11px;';
  btnHtml.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> Download HTML';

  const btnJson = document.createElement('button');
  btnJson.className = 'scan-btn';
  btnJson.style.cssText = 'padding:8px;font-size:11px;';
  btnJson.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> Download JSON';

  const btnMd = document.createElement('button');
  btnMd.className = 'scan-btn';
  btnMd.style.cssText = 'padding:8px;font-size:11px;';
  btnMd.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> Download MD';

  const btnCopyMd = document.createElement('button');
  btnCopyMd.className = 'scan-btn';
  btnCopyMd.style.cssText = 'padding:8px;font-size:11px;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);';
  btnCopyMd.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy Markdown';

  const btnCopyJson = document.createElement('button');
  btnCopyJson.className = 'scan-btn';
  btnCopyJson.style.cssText = 'padding:8px;font-size:11px;background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);grid-column: span 2;';
  btnCopyJson.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy JSON';
  
  controls.appendChild(btnHtml);
  controls.appendChild(btnJson);
  controls.appendChild(btnMd);
  controls.appendChild(btnCopyMd);
  controls.appendChild(btnCopyJson);
  container.appendChild(controls);
  
  // Preview summary
  const preview = document.createElement('div');
  preview.className = 'settings-note';
  const items = [];
  if (state.passiveData) items.push('passive detection data');
  if (state.activeResults?.paths?.length) items.push(`${state.activeResults.paths.length} paths`);
  if (state.activeResults?.plugins?.length) items.push(`${state.activeResults.plugins.length} plugins`);
  if (state.activeResults?.themes?.length) items.push(`${state.activeResults.themes.length} themes`);
  if (state.activeResults?.users?.length) items.push(`${state.activeResults.users.length} users`);
  if (state.activeResults?.media?.length) items.push(`${state.activeResults.media.length} media`);
  if (state.activeResults?.xmlrpc?.enabled) items.push(`XML-RPC (${state.activeResults.xmlrpc.methods?.length || 0} methods)`);
  if (state.activeResults?.findings?.length) items.push(`${state.activeResults.findings.length} findings`);
  if (state.wpscanResults) items.push(`WPScan (${state.wpscanResults.totalVulnerabilities || 0} vulns)`);
  preview.textContent = items.length > 0 ? `Export includes: ${items.join(', ')}` : 'Export includes passive data only';
  container.appendChild(preview);
  
  // Action Handlers
  btnHtml.addEventListener('click', () => exportHTML(state));
  btnJson.addEventListener('click', () => exportJSON(state));
  btnMd.addEventListener('click', () => exportMarkdown(state));
  
  btnCopyJson.addEventListener('click', async () => {
    const data = buildReportData(state);
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    btnCopyJson.textContent = 'Copied JSON!';
    setTimeout(() => { btnCopyJson.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy JSON'; }, 1500);
  });

  btnCopyMd.addEventListener('click', async () => {
    const data = buildReportData(state);
    const md = buildMarkdownReport(data);
    await navigator.clipboard.writeText(md);
    btnCopyMd.textContent = 'Copied Markdown!';
    setTimeout(() => { btnCopyMd.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Copy Markdown'; }, 1500);
  });
}

function buildReportData(state) {
  return {
    target: state.domain,
    scanDate: new Date().toISOString(),
    passive: state.passiveData || null,
    active: state.activeResults ? {
      categoriesRun: Array.from(state.completedCategories || []),
      paths: state.activeResults.paths || [],
      admin: state.activeResults.admin || null,
      plugins: state.activeResults.plugins || [],
      themes: state.activeResults.themes || [],
      users: state.activeResults.users || [],
      media: state.activeResults.media || [],
      xmlrpc: state.activeResults.xmlrpc || null,
      findings: state.activeResults.findings || [],
      vulnerabilities: state.activeResults.vulnerabilities || []
    } : null,
    wpscan: state.wpscanResults || null,
    wafDetected: state.wafDetected || false,
    wafVendor: state.wafVendor || null
  };
}

function getReportFilename(ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `WPBleader_${time}.${ext}`;
}

function exportJSON(state) {
  const data = buildReportData(state);
  const json = JSON.stringify(data, null, 2);
  downloadFile(getReportFilename('json'), json, 'application/json');
}

function exportHTML(state) {
  const data = buildReportData(state);
  const html = buildHtmlReport(data);
  downloadFile(getReportFilename('html'), html, 'text/html');
}

function exportMarkdown(state) {
  const data = buildReportData(state);
  const md = buildMarkdownReport(data);
  downloadFile(getReportFilename('md'), md, 'text/markdown');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatPathSource(p) {
  if (p.source === 'robots.txt') {
    return 'Active probe (discovered via robots.txt)';
  }
  if (p.source === 'passive') {
    return 'Passive in-page detection';
  }
  if (p.source === 'standard' || !p.source) {
    return 'Active probe (standard wordlist)';
  }
  return `Active probe (${p.source})`;
}

function buildMarkdownReport(data) {
  let md = `# WPBleeder Recon Report — ${data.target}\n\n`;
  md += `- **Date:** ${data.scanDate}\n`;
  md += `- **WAF:** ${data.wafDetected ? data.wafVendor || 'Detected' : 'None detected'}\n`;
  if (data.passive?.wpVersion) {
    md += `- **WordPress Version:** ${data.passive.wpVersion.meta || data.passive.wpVersion.assets || 'Unknown'}\n`;
  }
  if (data.passive?.theme) {
    md += `- **Theme:** ${data.passive.theme.slug} (${data.passive.theme.version || 'unknown'})\n`;
  }
  md += '\n';

  const secItems = data.passive?.security || [];
  if (secItems.length > 0 || data.wafDetected) {
    md += `## Firewall & Security Controls\n\n`;
    if (data.wafDetected) {
      md += `> **Active WAF Enforcement:** Automated requests challenged or blocked by **${data.wafVendor || 'WAF'}**.\n\n`;
    }
    md += `| Component | Type | Vendor | Status |\n|---|---|---|---|\n`;
    for (const s of secItems) {
      md += `| ${s.name} | ${s.type === 'proxy' ? 'Cloud / Proxy Firewall' : 'WP Security Plugin'} | ${s.vendor || '-'} | Detected |\n`;
    }
    md += '\n';
  }

  if (data.wpscan && data.wpscan.totalVulnerabilities > 0) {
    const w = data.wpscan;
    md += `## WPScan Vulnerabilities (${w.totalVulnerabilities})\n\n`;
    if (w.core?.vulnerabilities?.length) {
      md += `### WordPress Core ${w.core.version}\n`;
      for (const v of w.core.vulnerabilities) {
        md += `- **${v.title}** (Fixed in: ${v.fixed_in || 'N/A'}${v.cvss?.score ? `, CVSS: ${v.cvss.score}` : ''})\n`;
      }
      md += '\n';
    }
    if (w.theme?.vulnerabilities?.length) {
      md += `### Theme: ${w.theme.slug} (${w.theme.version || 'unknown'})\n`;
      for (const v of w.theme.vulnerabilities) {
        md += `- **${v.title}** (Fixed in: ${v.fixed_in || 'N/A'})\n`;
      }
      md += '\n';
    }
    if (w.plugins?.length) {
      for (const p of w.plugins) {
        if (p.vulnerabilities?.length) {
          md += `### Plugin: ${p.slug} (${p.version || 'unknown'})\n`;
          for (const v of p.vulnerabilities) {
            md += `- **${v.title}** (Fixed in: ${v.fixed_in || 'N/A'}${v.cvss?.score ? `, CVSS: ${v.cvss.score}` : ''})\n`;
          }
          md += '\n';
        }
      }
    }
  }

  if (data.active?.findings?.length) {
    md += `## Security Findings (${data.active.findings.length})\n\n`;
    for (const f of data.active.findings) {
      md += `### [${f.severity.toUpperCase()}] ${f.title}\n`;
      md += `${f.detail}\n\n`;
    }
  }

  if (data.active?.paths?.length) {
    const sortedPaths = [...data.active.paths].sort((a, b) => {
      const statusA = (a.status != null && a.status > 0) ? a.status : 999;
      const statusB = (b.status != null && b.status > 0) ? b.status : 999;
      if (statusA !== statusB) return statusA - statusB;
      return (a.path || '').localeCompare(b.path || '');
    });

    md += `## Probed Paths (${sortedPaths.length})\n\n`;
    md += `| Path | Status | Discovery Source | Details |\n|---|---|---|---|\n`;
    for (const p of sortedPaths) {
      const details = [
        p.redirectUrl ? `Redirect: ${p.redirectUrl}` : '',
        p.dirListing ? 'Directory listing enabled' : '',
        p.corsWildcard ? 'CORS: *' : ''
      ].filter(Boolean).join('; ');
      md += `| ${p.path} | ${p.status || 'N/A'} | ${formatPathSource(p)} | ${details || '-'} |\n`;
    }
    md += '\n';
  }

  if (data.active?.admin) {
    const a = data.active.admin;
    md += `## Admin & Authentication Portal\n\n`;
    md += `- **Login Portal:** ${a.loginAccessible ? 'EXPOSED' : (a.isHiddenLogin ? 'HIDDEN' : 'UNKNOWN')} (${a.loginUrl || 'N/A'})\n`;
    md += `- **User Registration:** ${a.registrationEnabled ? 'OPEN' : 'CLOSED / DISABLED'}\n`;
    if (a.endpoints?.length) {
      const sortedAdminEndpoints = [...a.endpoints].sort((x, y) => {
        const statusX = (x.status != null && x.status > 0) ? x.status : 999;
        const statusY = (y.status != null && y.status > 0) ? y.status : 999;
        if (statusX !== statusY) return statusX - statusY;
        return (x.name || '').localeCompare(y.name || '');
      });
      md += `\n| Endpoint | Path | Status | Details |\n|---|---|---|---|\n`;
      for (const ep of sortedAdminEndpoints) {
        md += `| ${ep.name} | ${ep.path} | ${ep.status || 'N/A'} | ${ep.detail || '-'} |\n`;
      }
    }
    md += '\n';
  }

  if (data.active?.xmlrpc) {
    const x = data.active.xmlrpc;
    md += `## XML-RPC\n\n`;
    md += `- **Status:** ${x.enabled ? 'ENABLED' : 'DISABLED'} (HTTP ${x.status || 'N/A'})\n`;
    if (x.methods?.length) {
      md += `- **Methods (${x.methods.length}):** ${x.methods.join(', ')}\n\n`;
    }
  }

  if (data.active?.plugins?.length) {
    md += `## Identified Plugins (${data.active.plugins.length})\n\n`;
    md += `| Plugin Slug | Version | Source | Verification Link |\n|---|---|---|---|\n`;
    for (const p of data.active.plugins) {
      const link = p.url ? `[Verify ↗](${p.url})` : '-';
      md += `| ${p.slug} | ${p.version || 'Unknown'} | ${p.source || 'active'} | ${link} |\n`;
    }
    md += '\n';
  }

  if (data.active?.themes?.length) {
    md += `## Identified Themes (${data.active.themes.length})\n\n`;
    md += `| Theme Name | Slug | Version | Status | Known CVEs |\n|---|---|---|---|---|\n`;
    for (const t of data.active.themes) {
      const cveCount = t.vulnerabilities?.length || 0;
      md += `| ${t.name || t.slug} | ${t.slug} | ${t.version || 'Unknown'} | ${t.isActive ? 'ACTIVE' : 'INACTIVE'} | ${cveCount > 0 ? `${cveCount} CVEs` : 'Clean'} |\n`;
    }
    md += '\n';
  }

  if (data.active?.users?.length) {
    md += `## Enumerated Users (${data.active.users.length})\n\n`;
    md += `| Username / Slug | Display Name | Discovery Method |\n|---|---|---|\n`;
    for (const u of data.active.users) {
      md += `| ${u.slug} | ${u.name || '-'} | ${u.source || 'archive'} |\n`;
    }
    md += '\n';
  }

  if (data.active?.media?.length) {
    md += `## Enumerated Media Attachments (${data.active.media.length})\n\n`;
    md += `| Title / Filename | Type | MIME Type | Upload Date | URL |\n|---|---|---|---|---|\n`;
    for (const m of data.active.media) {
      md += `| ${m.title || m.filename} | ${m.isDocument ? 'Document' : 'Image/Media'} | ${m.mimeType || 'unknown'} | ${m.date ? m.date.slice(0, 10) : 'N/A'} | ${m.url} |\n`;
    }
    md += '\n';
  }

  return md;
}

function buildHtmlReport(data) {
  const severityColor = { high: '#dc2626', medium: '#d97706', low: '#6b7280' };
  
  let wpscanHtml = '';
  if (data.wpscan && data.wpscan.totalVulnerabilities > 0) {
    const w = data.wpscan;
    wpscanHtml += `<h2>WPScan Vulnerabilities (${w.totalVulnerabilities})</h2>`;
    if (w.core?.vulnerabilities?.length) {
      wpscanHtml += `<h3>WordPress Core ${escapeHtml(w.core.version)}</h3><table><tr><th>Title</th><th>Fixed In</th></tr>${w.core.vulnerabilities.map(v => `<tr><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.fixed_in || 'N/A')}</td></tr>`).join('')}</table>`;
    }
    if (w.themes?.length) {
      for (const t of w.themes) {
        if (t.vulnerabilities?.length) {
          wpscanHtml += `<h3>Theme: ${escapeHtml(t.name || t.slug)} (${escapeHtml(t.version || 'unknown')})</h3><table><tr><th>Title</th><th>Fixed In</th></tr>${t.vulnerabilities.map(v => `<tr><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.fixed_in || 'N/A')}</td></tr>`).join('')}</table>`;
        }
      }
    } else if (w.theme?.vulnerabilities?.length) {
      wpscanHtml += `<h3>Theme: ${escapeHtml(w.theme.slug)}</h3><table><tr><th>Title</th><th>Fixed In</th></tr>${w.theme.vulnerabilities.map(v => `<tr><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.fixed_in || 'N/A')}</td></tr>`).join('')}</table>`;
    }
    if (w.plugins?.length) {
      for (const p of w.plugins) {
        if (p.vulnerabilities?.length) {
          wpscanHtml += `<h3>Plugin: ${escapeHtml(p.slug)} (${escapeHtml(p.version || 'unknown')})</h3><table><tr><th>Title</th><th>Fixed In</th></tr>${p.vulnerabilities.map(v => `<tr><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.fixed_in || 'N/A')}</td></tr>`).join('')}</table>`;
        }
      }
    }
  }

  let pathsHtml = '';
  if (data.active?.paths?.length) {
    const sortedPaths = [...data.active.paths].sort((a, b) => {
      const statusA = (a.status != null && a.status > 0) ? a.status : 999;
      const statusB = (b.status != null && b.status > 0) ? b.status : 999;
      if (statusA !== statusB) return statusA - statusB;
      return (a.path || '').localeCompare(b.path || '');
    });

    pathsHtml = `<h2>Paths (${sortedPaths.length})</h2><p class="section-desc">Sorted in ascending order by HTTP status code.</p><table><tr><th>Path</th><th>Status</th><th>Discovery Source (Active/Passive)</th><th>Details</th></tr>${sortedPaths.map(p => {
      const details = [
        p.redirectUrl ? `Redirect: ${escapeHtml(p.redirectUrl)}` : '',
        p.dirListing ? 'Directory Listing Enabled' : '',
        p.corsWildcard ? 'CORS: *' : ''
      ].filter(Boolean).join('; ');
      const statusBadge = p.status >= 200 && p.status < 300 ? `<span class="badge badge-success">${p.status}</span>` :
                          p.status >= 300 && p.status < 400 ? `<span class="badge badge-warning">${p.status}</span>` :
                          p.status === 403 || p.status === 404 ? `<span class="badge badge-neutral">${p.status}</span>` :
                          `<span class="badge badge-danger">${p.status || 'N/A'}</span>`;
      const sourceBadge = p.source === 'robots.txt' ? `<span class="badge badge-warning">Active (via robots.txt)</span>` :
                          p.source === 'passive' ? `<span class="badge badge-neutral">Passive in-page</span>` :
                          `<span class="badge badge-neutral">Active (wordlist)</span>`;
      return `<tr><td><code>${escapeHtml(p.path)}</code></td><td>${statusBadge}</td><td>${sourceBadge} <small style="color:#6b7280;">(${escapeHtml(formatPathSource(p))})</small></td><td>${details || '-'}</td></tr>`;
    }).join('')}</table>`;
  }

  let adminHtml = '';
  if (data.active?.admin) {
    const a = data.active.admin;
    adminHtml = `<h2>Admin & Authentication Portal</h2><p>Login Portal: <strong>${a.loginAccessible ? 'EXPOSED' : (a.isHiddenLogin ? 'HIDDEN' : 'UNKNOWN')}</strong> | Registration: <strong>${a.registrationEnabled ? 'OPEN' : 'CLOSED'}</strong></p>`;
    if (a.endpoints?.length) {
      const sortedAdminEndpoints = [...a.endpoints].sort((x, y) => {
        const statusX = (x.status != null && x.status > 0) ? x.status : 999;
        const statusY = (y.status != null && y.status > 0) ? y.status : 999;
        if (statusX !== statusY) return statusX - statusY;
        return (x.name || '').localeCompare(y.name || '');
      });
      adminHtml += `<table><tr><th>Endpoint</th><th>Path</th><th>Status</th><th>Detail</th></tr>${sortedAdminEndpoints.map(ep => {
        const statusBadge = ep.status >= 200 && ep.status < 300 ? `<span class="badge badge-success">${ep.status}</span>` :
                            ep.status >= 300 && ep.status < 400 ? `<span class="badge badge-warning">${ep.status}</span>` :
                            ep.status === 403 || ep.status === 404 ? `<span class="badge badge-neutral">${ep.status}</span>` :
                            `<span class="badge badge-danger">${ep.status || 'N/A'}</span>`;
        return `<tr><td><strong>${escapeHtml(ep.name)}</strong></td><td><code>${escapeHtml(ep.path)}</code></td><td>${statusBadge}</td><td>${escapeHtml(ep.detail || '')}</td></tr>`;
      }).join('')}</table>`;
    }
  }

  let xmlrpcHtml = '';
  if (data.active?.xmlrpc) {
    const x = data.active.xmlrpc;
    xmlrpcHtml = `<h2>XML-RPC</h2><p>Status: <strong>${x.enabled ? 'ENABLED' : 'DISABLED'}</strong> (HTTP ${x.status || 'N/A'})</p>${x.methods?.length ? `<p>Methods (${x.methods.length}): ${x.methods.map(m => `<code>${escapeHtml(m)}</code>`).join(', ')}</p>` : ''}`;
  }
  
  let pluginsHtml = '';
  if (data.active?.plugins?.length) {
    pluginsHtml = `<h2>Plugins (${data.active.plugins.length})</h2><table><tr><th>Slug</th><th>Version</th><th>Source</th><th>Verification Link</th></tr>${data.active.plugins.map(p => `<tr><td><strong>${escapeHtml(p.slug)}</strong></td><td>${escapeHtml(p.version || 'unknown')}</td><td>${escapeHtml(p.source || '')}</td><td>${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" style="color:#0284c7;text-decoration:none;font-size:11px;">Verify ↗</a>` : '-'}</td></tr>`).join('')}</table>`;
  }

  let themesHtml = '';
  if (data.active?.themes?.length) {
    themesHtml = `<h2>Themes (${data.active.themes.length})</h2><table><tr><th>Theme Name</th><th>Slug</th><th>Version</th><th>Status</th><th>Known CVEs</th><th>Stylesheet</th></tr>${data.active.themes.map(t => {
      const statusBadge = t.isActive ? '<span class="badge badge-success">ACTIVE</span>' : '<span class="badge badge-warning">INACTIVE (LEFTOVER)</span>';
      const cveBadge = t.vulnerabilities?.length > 0 ? `<span class="badge badge-danger">${t.vulnerabilities.length} CVE</span>` : '<span class="badge badge-success">Clean</span>';
      return `<tr><td><strong>${escapeHtml(t.name || t.slug)}</strong></td><td><code>${escapeHtml(t.slug)}</code></td><td>${escapeHtml(t.version || 'unknown')}</td><td>${statusBadge}</td><td>${cveBadge}</td><td><a href="${escapeHtml(t.url)}" target="_blank" style="color:#0284c7;text-decoration:none;font-size:11px;">style.css ↗</a></td></tr>`;
    }).join('')}</table>`;
  }
  
  let usersHtml = '';
  if (data.active?.users?.length) {
    usersHtml = `<h2>Users (${data.active.users.length})</h2><table><tr><th>Slug / Username</th><th>Display Name</th><th>Source</th></tr>${data.active.users.map(u => `<tr><td><strong>${escapeHtml(u.slug)}</strong></td><td>${escapeHtml(u.name || '')}</td><td>${escapeHtml(u.source || '')}</td></tr>`).join('')}</table>`;
  }

  let mediaHtml = '';
  if (data.active?.media?.length) {
    const docCount = data.active.media.filter(m => m.isDocument).length;
    mediaHtml = `<h2>Media Attachments (${data.active.media.length})</h2><p class="section-desc">${docCount > 0 ? `<span class="badge badge-warning">${docCount} Documents / Archives</span> ` : ''}Publicly accessible files uploaded to WordPress media library.</p><table><tr><th>Filename / Title</th><th>Type</th><th>MIME Type</th><th>Upload Date</th><th>File Link</th></tr>${data.active.media.map(m => {
      const typeBadge = m.isDocument ? '<span class="badge badge-warning">Document</span>' : '<span class="badge badge-neutral">Media</span>';
      return `<tr><td><strong>${escapeHtml(m.title || m.filename)}</strong></td><td>${typeBadge}</td><td><code>${escapeHtml(m.mimeType || 'unknown')}</code></td><td>${escapeHtml(m.date ? m.date.slice(0, 10) : '-')}</td><td><a href="${escapeHtml(m.url)}" target="_blank" style="color:#0284c7;text-decoration:none;font-size:11px;">View File ↗</a></td></tr>`;
    }).join('')}</table>`;
  }
  
  let findingsHtml = '';
  if (data.active?.findings?.length) {
    findingsHtml = `<h2>Security Findings (${data.active.findings.length})</h2>${data.active.findings.map(f => `<div style="margin-bottom:8px;padding:8px 12px;border-left:3px solid ${severityColor[f.severity] || '#6b7280'};background:#f9fafb;border-radius:4px;"><strong>${escapeHtml(f.title)}</strong> <span style="color:${severityColor[f.severity]};font-size:11px;text-transform:uppercase;">${f.severity}</span><div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(f.detail || '')}</div></div>`).join('')}`;
  }

  let firewallHtml = '';
  const secItems = data.passive?.security || [];
  if (secItems.length > 0 || data.wafDetected) {
    firewallHtml = `<h2>Firewall & Security Controls</h2>`;
    if (data.wafDetected) {
      firewallHtml += `<div style="margin-bottom:10px;padding:8px 12px;background:#fee2e2;border-left:3px solid #dc2626;border-radius:4px;font-size:12px;"><strong>Active WAF Enforcement:</strong> Probes were actively challenged or blocked by <strong>${escapeHtml(data.wafVendor || 'WAF')}</strong>.</div>`;
    }
    if (secItems.length > 0) {
      firewallHtml += `<table><tr><th>Component</th><th>Type</th><th>Vendor</th><th>Layer</th></tr>${secItems.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td><span class="badge ${s.type === 'proxy' ? 'badge-neutral' : 'badge-warning'}">${s.type === 'proxy' ? 'Cloud / Proxy Firewall' : 'WP Security Plugin'}</span></td><td>${escapeHtml(s.vendor || 'N/A')}</td><td>${s.type === 'proxy' ? 'DNS / Reverse Proxy Edge' : 'Application / Core Hook'}</td></tr>`).join('')}</table>`;
    }
  }

  let securitySummary = '';
  if (secItems.length > 0 || data.wafDetected) {
    securitySummary = `<p>Firewall & Protection: <strong>${data.wafDetected ? (data.wafVendor || 'Active WAF Blocking') + ' | ' : ''}${secItems.map(s => `${escapeHtml(s.name)} (${s.type === 'proxy' ? 'Proxy Firewall' : 'Security Plugin'})`).join(', ')}</strong></p>`;
  }
  
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>WPBleeder Report — ${escapeHtml(data.target)}</title><style>body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;max-width:850px;margin:40px auto;padding:0 20px;color:#18181b;line-height:1.5;background:#fafafa;}h1{font-size:22px;margin-bottom:6px;}h2{font-size:16px;margin-top:28px;border-bottom:1px solid #e5e7eb;padding-bottom:6px;}h3{font-size:14px;margin-top:16px;}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;}th{background:#f4f4f5;font-weight:600;font-size:12px;color:#52525b;}tr:last-child td{border-bottom:none;}.meta{font-size:12px;color:#6b7280;margin-bottom:20px;}.section-desc{font-size:12px;color:#71717a;margin:4px 0 8px 0;}code{background:#f1f5f9;padding:2px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace;color:#0f172a;}.badge{display:inline-block;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:500;}.badge-success{background:#dcfce7;color:#15803d;}.badge-warning{background:#fef3c7;color:#b45309;}.badge-danger{background:#fee2e2;color:#b91c1c;}.badge-neutral{background:#f1f5f9;color:#475569;}</style></head><body><h1>WPBleeder Reconnaissance Report</h1><p class="meta">Target: <strong>${escapeHtml(data.target)}</strong> | Generated: ${escapeHtml(data.scanDate)} | WAF: ${data.wafDetected ? escapeHtml(data.wafVendor || 'detected') : 'None'}</p>${data.passive ? `<h2>Overview</h2><p>WordPress version: <strong>${escapeHtml(data.passive.wpVersion?.meta || data.passive.wpVersion?.assets || 'unknown')}</strong></p><p>Theme: <strong>${escapeHtml(data.passive.theme?.slug || 'unknown')}</strong> ${data.passive.theme?.version ? `(${escapeHtml(data.passive.theme.version)})` : ''}</p>${securitySummary}` : ''}${firewallHtml}${wpscanHtml}${findingsHtml}${adminHtml}${xmlrpcHtml}${pathsHtml}${themesHtml}${pluginsHtml}${usersHtml}${mediaHtml}</body></html>`;
}
