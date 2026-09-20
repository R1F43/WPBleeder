const browser = globalThis.browser || globalThis.chrome;

export function getPluginTasks(origin, passivePlugins) {
  // Returns a function that loads the wordlist and returns task functions
  // Caller should await this, then enqueue the returned tasks
  return async function loadAndCreateTasks() {
    // Lazy-load the plugin wordlist
    let wordlist;
    try {
      const url = browser.runtime.getURL('data/plugin-wordlist.json');
      const response = await fetch(url, { signal });
      wordlist = await response.json();
    } catch (e) {
      console.error('Failed to load plugin wordlist:', e);
      return [];
    }
    
    // Merge with passive plugins (deduplicate)
    const allSlugs = new Set(wordlist);
    const passiveSlugs = new Set((passivePlugins || []).map(p => typeof p === 'string' ? p : p.slug));
    passiveSlugs.forEach(slug => allSlugs.add(slug));
    
    const tasks = [];
    for (const slug of allSlugs) {
      tasks.push(async () => {
        if (signal?.aborted) return null;
        const readmeUrl = `${origin}/wp-content/plugins/${slug}/readme.txt`;
        const result = {
          slug,
          version: null,
          url: readmeUrl,
          source: passiveSlugs.has(slug) ? 'passive+active' : 'active',
          found: false
        };
        
        try {
          const response = await fetch(readmeUrl, {
            method: 'GET',
            redirect: 'follow',
            signal
          });

          // If redirected away from the plugin readme (e.g. to homepage, 404 page, or login)
          if (response.redirected) {
            try {
              const finalUrl = new URL(response.url);
              if (!finalUrl.pathname.endsWith(`/${slug}/readme.txt`)) {
                return result;
              }
            } catch (e) {
              // Ignore parse error
            }
          }
          
          if (response.ok) {
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('text/html') || contentType.includes('application/json')) {
              return result;
            }

            const body = await response.text();
            const trimmed = body.trim();
            if (
              trimmed.startsWith('<!DOCTYPE') ||
              trimmed.startsWith('<html') ||
              /<html[\s>]/i.test(body) ||
              /<body[\s>]/i.test(body)
            ) {
              return result;
            }

            // Parse standard WordPress plugin readme headers
            const isReadme = /===\s*|plugin name|contributors|stable tag|tested up to|requires at least/i.test(body);
            const match = body.match(/stable\s*tag\s*:\s*([0-9a-zA-Z\.\-_]+)/i);
            if (match || isReadme) {
              result.found = true;
              if (match) {
                result.version = match[1].trim();
                // Ignore "trunk" as a version
                if (result.version.toLowerCase() === 'trunk') result.version = null;
              }
            }
          }
        } catch (err) {
          if (signal?.aborted || err.name === 'AbortError') return null;
          result.error = err.message;
        }
        
        return result;
      });
    }
    
    // Add passive-only plugins that might not be in the wordlist
    // (already handled above via Set merge)
    
    // Clean up wordlist reference
    wordlist = null;
    
    return tasks;
  };
}
