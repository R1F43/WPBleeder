const browser = globalThis.browser || globalThis.chrome;

export async function scanUsers(origin, onUserFound, signal = null) {
  const users = new Map(); // slug -> user object, for deduplication
  
  function reportUser(user) {
    if (signal?.aborted) return;
    if (!users.has(user.slug)) {
      users.set(user.slug, user);
      if (onUserFound) onUserFound(user);
    } else {
      const existing = users.get(user.slug);
      let updated = false;
      if (!existing.name && user.name) {
        existing.name = user.name;
        updated = true;
      }
      if (!existing.url && user.url) {
        existing.url = user.url;
        updated = true;
      }
      if (updated && onUserFound) onUserFound(existing);
    }
  }

  // Method 1: Author archives (?author=N)
  try {
    for (let i = 1; i <= 10; i++) {
      if (signal?.aborted) return Array.from(users.values());
      try {
        const url = `${origin}/?author=${i}`;
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',  // We'll extract from final URL
          signal
        });
        
        // Check final URL for /author/slug/ pattern
        const finalUrl = response.url;
        const match = finalUrl.match(/\/author\/([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          reportUser({
            slug: match[1],
            id: i,
            name: null,
            source: 'author-archive',
            url: finalUrl || `${origin}/author/${match[1]}/`
          });
        }
        
        // If 404 or no redirect, this author ID doesn't exist — stop trying further IDs
        if (response.status === 404) break;
        
      } catch (e) { /* continue to next ID */ }
    }
  } catch (e) { /* method failed, continue */ }
  
  // Method 2: REST API /wp-json/wp/v2/users
  try {
    if (signal?.aborted) return Array.from(users.values());
    const response = await fetch(`${origin}/wp-json/wp/v2/users`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal
    });
    
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        for (const user of data) {
          if (signal?.aborted) return Array.from(users.values());
          const slug = user.slug || `user-${user.id}`;
          reportUser({
            slug,
            id: user.id,
            name: user.name || null,
            source: 'rest-api',
            url: `${origin}/wp-json/wp/v2/users/${user.id}`
          });
        }
      }
    }
  } catch (e) { /* method failed, continue */ }
  
  // Method 3: Sitemap /wp-sitemap-users-1.xml
  try {
    if (signal?.aborted) return Array.from(users.values());
    const response = await fetch(`${origin}/wp-sitemap-users-1.xml`, {
      method: 'GET',
      signal
    });
    
    if (response.ok) {
      const body = await response.text();
      const locMatches = body.matchAll(/<loc>([^<]+)<\/loc>/g);
      for (const m of locMatches) {
        if (signal?.aborted) return Array.from(users.values());
        const url = m[1];
        const match = url.match(/\/author\/([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          reportUser({
            slug: match[1],
            id: null,
            name: null,
            source: 'sitemap',
            url
          });
        }
      }
    }
  } catch (e) { /* method failed, continue */ }
  
  // Method 4: Posts with embedded author (/wp-json/wp/v2/posts?per_page=10&_embed=author)
  try {
    if (signal?.aborted) return Array.from(users.values());
    const response = await fetch(`${origin}/wp-json/wp/v2/posts?per_page=10&_embed=author`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal
    });

    if (response.ok) {
      const posts = await response.json();
      if (Array.isArray(posts)) {
        for (const post of posts) {
          if (signal?.aborted) return Array.from(users.values());
          const authors = post._embedded?.author;
          if (Array.isArray(authors)) {
            for (const a of authors) {
              if (a.slug) {
                reportUser({
                  slug: a.slug,
                  id: a.id || null,
                  name: a.name || null,
                  source: 'post-embed',
                  url: a.link || `${origin}/wp-json/wp/v2/posts?_embed=author`
                });
              }
            }
          }
        }
      }
    }
  } catch (e) { /* method failed, continue */ }

  // Method 5: RSS Feed creator (/feed/)
  try {
    if (signal?.aborted) return Array.from(users.values());
    const response = await fetch(`${origin}/feed/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      signal
    });

    if (response.ok) {
      const xml = await response.text();
      const creatorMatches = xml.matchAll(/<dc:creator>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/dc:creator>/gi);
      for (const m of creatorMatches) {
        if (signal?.aborted) return Array.from(users.values());
        const rawCreator = (m[1] || m[2] || '').trim();
        if (rawCreator) {
          const slug = rawCreator.toLowerCase().replace(/\s+/g, '-');
          reportUser({
            slug,
            id: null,
            name: rawCreator,
            source: 'rss-feed',
            url: `${origin}/feed/`
          });
        }
      }
    }
  } catch (e) { /* method failed, continue */ }
  
  return Array.from(users.values());
}
