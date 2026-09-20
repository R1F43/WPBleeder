export function aggregateFindings(scanResults, passiveData) {
  const findings = [];
  
  // Check paths results for sensitive file exposure
  if (scanResults.paths) {
    for (const p of scanResults.paths) {
      // Directory listing on uploads
      if (p.dirListing && p.path.includes('/uploads')) {
        findings.push({
          id: 'dir-listing-uploads',
          title: 'Directory listing enabled on uploads',
          detail: `${p.path} returns an index page — uploaded files are browsable.`,
          severity: 'high',
          source: 'paths',
          evidence: p.url
        });
      }
      
      // Sensitive files accessible
      const sensitiveFiles = ['/wp-config.php.bak', '/wp-config.php~', '/.env', '/wp-content/debug.log'];
      if (sensitiveFiles.includes(p.path) && p.accessible) {
        findings.push({
          id: `sensitive-file-${p.path}`,
          title: `Sensitive file accessible: ${p.path}`,
          detail: `${p.path} returned HTTP ${p.status} — may contain credentials or debug information.`,
          severity: 'high',
          source: 'paths',
          evidence: p.url
        });
      }
      
      // wp-cron accessible
      if (p.path === '/wp-cron.php' && p.accessible) {
        findings.push({
          id: 'wp-cron-accessible',
          title: 'WP-Cron publicly accessible',
          detail: 'wp-cron.php is reachable — can be abused for DoS or information disclosure.',
          severity: 'low',
          source: 'paths',
          evidence: p.url
        });
      }
      
      // CORS wildcard on wp-json
      if (p.corsWildcard) {
        findings.push({
          id: 'cors-wildcard-wp-json',
          title: 'CORS wildcard on REST API',
          detail: 'wp-json returns Access-Control-Allow-Origin: * — API responses accessible from any origin.',
          severity: 'medium',
          source: 'paths',
          evidence: p.url
        });
      }
    }
  }
  
  // XML-RPC enabled
  if (scanResults.xmlrpc?.enabled) {
    findings.push({
      id: 'xmlrpc-enabled',
      title: 'XML-RPC is enabled',
      detail: `${scanResults.xmlrpc.methods.length} methods available — potential for brute-force amplification and pingback abuse.`,
      severity: 'medium',
      source: 'xmlrpc',
      evidence: scanResults.xmlrpc.url
    });
  }
  
  // Registration enabled
  if (scanResults.admin?.registrationEnabled) {
    findings.push({
      id: 'user-registration-open',
      title: 'User registration is enabled publicly',
      detail: 'The WordPress registration endpoint is open — anyone can register a subscriber/user account.',
      severity: 'medium',
      source: 'admin',
      evidence: scanResults.admin.registrationUrl || '/wp-login.php?action=register'
    });
  }

  // Disallowed robots.txt path accessible
  if (scanResults.paths) {
    for (const p of scanResults.paths) {
      if (p.source === 'robots.txt' && p.accessible && p.status === 200) {
        findings.push({
          id: `robots-disallow-accessible-${p.path}`,
          title: `Disallowed path from robots.txt is accessible: ${p.path}`,
          detail: `${p.path} was explicitly disallowed in robots.txt but returned HTTP 200 OK.`,
          severity: 'low',
          source: 'robots.txt',
          evidence: p.url
        });
      }
    }
  }

  // Version mismatch from passive data
  if (passiveData?.wpVersion?.mismatch) {
    findings.push({
      id: 'version-mismatch',
      title: 'WordPress version mismatch detected',
      detail: `Meta generator reports ${passiveData.wpVersion.meta} but asset version strings suggest ${passiveData.wpVersion.assets} — someone may have attempted to hide the version.`,
      severity: 'low',
      source: 'passive',
      evidence: 'meta generator vs ?ver= query strings'
    });
  }

  // User enumeration
  if (scanResults.users && scanResults.users.length > 0) {
    findings.push({
      id: 'usernames-discovered',
      title: `${scanResults.users.length} WordPress username(s) discovered`,
      detail: `Enumerated ${scanResults.users.length} valid username(s) (${scanResults.users.slice(0, 5).map(u => u.slug).join(', ')}${scanResults.users.length > 5 ? '...' : ''}). This facilitates targeted credential brute-forcing.`,
      severity: 'low',
      source: 'users',
      evidence: scanResults.users.map(u => u.slug).join(', ')
    });
  }

  // Inactive themes installed on server
  if (scanResults.themes) {
    const inactiveThemes = scanResults.themes.filter(t => !t.isActive && t.found);
    if (inactiveThemes.length > 0) {
      findings.push({
        id: 'inactive-themes-installed',
        title: `${inactiveThemes.length} inactive / leftover theme(s) installed on server`,
        detail: `Found inactive theme directory: ${inactiveThemes.map(t => t.slug).join(', ')}. Inactive themes should be deleted to eliminate potential unmaintained attack vectors.`,
        severity: 'medium',
        source: 'themes',
        evidence: inactiveThemes.map(t => t.url).join(', ')
      });
    }

    // Vulnerable themes
    const vulnerableThemes = scanResults.themes.filter(t => t.vulnerabilities && t.vulnerabilities.length > 0);
    for (const vt of vulnerableThemes) {
      findings.push({
        id: `vuln-theme-${vt.slug}`,
        title: `Vulnerable WordPress Theme: ${vt.name || vt.slug} (${vt.vulnerabilities.length} known CVEs)`,
        detail: `Theme ${vt.slug} (v${vt.version || 'unknown'}) has ${vt.vulnerabilities.length} known vulnerability records in WPScan database.`,
        severity: 'high',
        source: 'themes',
        evidence: vt.url
      });
    }
  }

  // Media library exposure
  if (scanResults.media && scanResults.media.length > 0) {
    const docs = scanResults.media.filter(m => m.isDocument);
    if (docs.length > 0) {
      findings.push({
        id: 'sensitive-media-documents-exposed',
        title: `${docs.length} uploaded document/archive file(s) exposed in media library`,
        detail: `Publicly accessible media includes non-image documents (e.g. ${docs.slice(0, 3).map(d => d.filename || d.title).join(', ')}).`,
        severity: 'medium',
        source: 'media',
        evidence: docs.slice(0, 5).map(d => d.url).join(', ')
      });
    } else {
      findings.push({
        id: 'media-library-public',
        title: 'Public REST API Media Library exposed',
        detail: `${scanResults.media.length} media item(s) enumerable via /wp-json/wp/v2/media.`,
        severity: 'low',
        source: 'media',
        evidence: '/wp-json/wp/v2/media'
      });
    }
  }

  // Firewall / WAF detection findings
  const securityItems = passiveData?.security || [];
  if (securityItems.length > 0) {
    findings.push({
      id: 'security-firewall-detected',
      title: `Security / Firewall detected: ${securityItems.map(s => s.name).join(', ')}`,
      detail: `Active protection identified: ${securityItems.map(s => `${s.name} (${s.type})`).join(', ')}.`,
      severity: 'low',
      source: 'security',
      evidence: securityItems.map(s => s.name).join(', ')
    });
  }
  
  return findings;
}
