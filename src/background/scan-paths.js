const browser = globalThis.browser || globalThis.chrome;

const BASE_PATHS = [
  // Core detection & config
  { path: '/robots.txt', method: 'GET', checkRobots: true },
  { path: '/wp-admin/', method: 'HEAD' },
  { path: '/wp-login.php', method: 'HEAD' },
  { path: '/wp-json/', method: 'HEAD', checkCors: true },
  { path: '/wp-content/uploads/', method: 'GET', checkDirListing: true },
  { path: '/wp-cron.php', method: 'HEAD' },
  { path: '/xmlrpc.php', method: 'HEAD' },
  { path: '/wp-config.php.bak', method: 'HEAD' },
  { path: '/wp-config.php~', method: 'HEAD' },
  { path: '/wp-config-sample.php', method: 'HEAD' },
  { path: '/.env', method: 'HEAD' },
  { path: '/wp-content/debug.log', method: 'HEAD' },
  { path: '/readme.html', method: 'GET', checkReadme: true },
  { path: '/license.txt', method: 'HEAD' },

  // WordPress Lifecycle & Admin Setup Endpoints
  { path: '/wp-admin/install.php', method: 'HEAD' },
  { path: '/wp-admin/upgrade.php', method: 'HEAD' },
  { path: '/wp-admin/setup-config.php', method: 'HEAD' },
  { path: '/wp-links-opml.php', method: 'HEAD' },
  { path: '/wp-trackback.php', method: 'HEAD' },

  // Sitemaps & Feed Enumeration
  { path: '/wp-sitemap.xml', method: 'HEAD' },
  { path: '/sitemap_index.xml', method: 'HEAD' },
  { path: '/sitemap.xml', method: 'HEAD' },
  { path: '/comments/feed/', method: 'HEAD' }
];

export function parseRobotsTxt(text) {
  const disallow = [];
  const allow = [];
  const sitemaps = [];
  const customPaths = [];

  if (!text || typeof text !== 'string') {
    return { disallow, allow, sitemaps, customPaths };
  }

  const lines = text.split(/\r?\n/);
  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const commentIdx = line.indexOf('#');
    if (commentIdx > -1) {
      line = line.slice(0, commentIdx).trim();
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (!value) continue;

    if (directive === 'disallow') {
      if (!disallow.includes(value)) disallow.push(value);
      const cleaned = cleanRobotsPath(value);
      if (cleaned && !customPaths.includes(cleaned)) {
        customPaths.push(cleaned);
      }
    } else if (directive === 'allow') {
      if (!allow.includes(value)) allow.push(value);
    } else if (directive === 'sitemap') {
      if (!sitemaps.includes(value)) sitemaps.push(value);
    }
  }

  return { disallow, allow, sitemaps, customPaths };
}

function cleanRobotsPath(p) {
  if (!p || p === '/' || p === '/*') return null;
  let clean = p.replace(/\*.*$/, '').replace(/\$$/, '').trim();
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (clean === '/' || clean.length < 2) return null;
  return clean;
}

export function getPathTasks(origin, signal = null) {
  return BASE_PATHS.map(pathDef => {
    return async () => {
      if (signal?.aborted) return null;
      const url = `${origin}${pathDef.path}`;
      const result = {
        path: pathDef.path,
        url,
        status: null,
        accessible: false,
        redirectUrl: null,
        dirListing: false,
        corsWildcard: false,
        source: 'standard'
      };
      
      try {
        const method = pathDef.method === 'GET' || pathDef.checkDirListing || pathDef.checkCors || pathDef.checkRobots || pathDef.checkReadme ? 'GET' : 'HEAD';
        const response = await fetch(url, {
          method,
          redirect: 'follow',
          signal
        });
        
        result.status = response.status;
        result.accessible = response.status >= 200 && response.status < 400;
        
        if (response.redirected) {
          result.redirectUrl = response.url;
        }
        
        // Parse robots.txt
        if (pathDef.checkRobots && response.ok) {
          const body = await response.text();
          result.robotsData = parseRobotsTxt(body);
          result.rawRobots = body;
        }
        
        // Check for directory listing
        if (pathDef.checkDirListing && response.ok) {
          const body = await response.text();
          if (body.includes('Index of /') || body.includes('<title>Index of')) {
            result.dirListing = true;
          }
        }

        // Check readme.html for core version
        if (pathDef.checkReadme && response.ok) {
          const body = await response.text();
          const verMatch = body.match(/Version\s+([\d.]+)/i) || body.match(/<br\s*\/?>\s*Version\s+([\d.]+)/i);
          if (verMatch) {
            result.extractedVersion = verMatch[1];
          }
        }
        
        // Check CORS headers on wp-json
        if (pathDef.checkCors) {
          const acao = response.headers.get('Access-Control-Allow-Origin');
          if (acao === '*') {
            result.corsWildcard = true;
          }
        }
        
      } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') return null;
        result.status = 0;
        result.error = err.message;
      }
      
      return result;
    };
  });
}

export function createExtraPathTask(origin, path, source = 'robots.txt', signal = null) {
  return async () => {
    if (signal?.aborted) return null;
    const url = `${origin}${path}`;
    const result = {
      path,
      url,
      status: null,
      accessible: false,
      redirectUrl: null,
      dirListing: false,
      corsWildcard: false,
      source
    };

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal
      });

      result.status = response.status;
      result.accessible = response.status >= 200 && response.status < 400;

      if (response.redirected) {
        result.redirectUrl = response.url;
      }

      if (response.ok) {
        const body = await response.text();
        if (body.includes('Index of /') || body.includes('<title>Index of')) {
          result.dirListing = true;
        }
      }
    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') return null;
      result.status = 0;
      result.error = err.message;
    }

    return result;
  };
}
