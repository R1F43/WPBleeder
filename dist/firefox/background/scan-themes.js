const browser = globalThis.browser || globalThis.chrome;

export function getThemeTasks(origin, passiveTheme, signal = null) {
  // Returns an async function that loads the theme wordlist and generates queue tasks
  return async function loadAndCreateTasks() {
    let wordlist = [];
    try {
      const url = browser.runtime.getURL('data/theme-wordlist.json');
      const response = await fetch(url, { signal });
      wordlist = await response.json();
    } catch (e) {
      console.error('Failed to load theme wordlist:', e);
      wordlist = [];
    }

    const allSlugs = new Set(wordlist);
    if (passiveTheme?.slug) {
      allSlugs.add(passiveTheme.slug);
    }

    const activeSlug = passiveTheme?.slug ? passiveTheme.slug.toLowerCase() : null;

    const tasks = [];
    for (const slug of allSlugs) {
      tasks.push(async () => {
        if (signal?.aborted) return null;
        const styleUrl = `${origin}/wp-content/themes/${slug}/style.css`;
        const isActive = Boolean(activeSlug && slug.toLowerCase() === activeSlug);
        const result = {
          slug,
          name: null,
          version: null,
          author: null,
          status: isActive ? 'active' : 'inactive',
          isActive,
          url: styleUrl,
          found: false
        };

        try {
          const response = await fetch(styleUrl, {
            method: 'GET',
            redirect: 'follow',
            signal
          });

          // If redirected away from the stylesheet (e.g. to homepage, 404 page, or login)
          if (response.redirected) {
            try {
              const finalUrl = new URL(response.url);
              if (!finalUrl.pathname.endsWith(`/${slug}/style.css`)) {
                if (isActive) {
                  result.found = true;
                  result.version = passiveTheme.version || null;
                  result.name = passiveTheme.name || slug;
                }
                return result;
              }
            } catch (e) {
              // Ignore parse error
            }
          }

          if (response.ok) {
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            // Reject HTML error pages or redirects masquerading as 200 OK
            if (contentType.includes('text/html') || contentType.includes('application/json')) {
              if (isActive) {
                result.found = true;
                result.version = passiveTheme.version || null;
                result.name = passiveTheme.name || slug;
              }
              return result;
            }

            const text = await response.text();
            const trimmed = text.trim();

            // Reject HTML documents (like 404/homepages returned with 200 OK)
            if (
              trimmed.startsWith('<!DOCTYPE') ||
              trimmed.startsWith('<html') ||
              /<html[\s>]/i.test(text) ||
              /<body[\s>]/i.test(text)
            ) {
              if (isActive) {
                result.found = true;
                result.version = passiveTheme.version || null;
                result.name = passiveTheme.name || slug;
              }
              return result;
            }

            // WordPress style.css MUST have a "Theme Name:" header comment
            const nameMatch = text.match(/Theme Name\s*:\s*([^\r\n]+)/i);
            if (nameMatch) {
              result.found = true;
              result.name = nameMatch[1].trim();

              const verMatch = text.match(/Version\s*:\s*([0-9a-zA-Z\.\-_]+)/i);
              if (verMatch) {
                result.version = verMatch[1].trim();
              }

              const authorMatch = text.match(/Author\s*:\s*([^\r\n]+)/i);
              if (authorMatch) {
                result.author = authorMatch[1].trim();
              }
            }
          }
        } catch (err) {
          if (signal?.aborted || err.name === 'AbortError') return null;
          result.error = err.message;
        }

        // If passive detection already detected this theme, ensure it's marked found
        if (isActive && !result.found) {
          result.found = true;
          result.version = passiveTheme.version || result.version;
          result.name = passiveTheme.name || result.name || slug;
        }

        return result;
      });
    }

    wordlist = null;
    return tasks;
  };
}
