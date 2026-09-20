const browser = globalThis.browser || globalThis.chrome;

export async function scanMedia(origin, onMediaFound, passiveData, signal = null) {
  const mediaMap = new Map(); // url -> mediaItem

  function reportMedia(item) {
    if (signal?.aborted) return;
    if (!item?.url) return;
    if (!mediaMap.has(item.url)) {
      mediaMap.set(item.url, item);
      if (onMediaFound) onMediaFound(item);
    }
  }

  function processMediaItems(items, base, sourceName = 'rest-api') {
    let count = 0;
    if (!Array.isArray(items)) return 0;
    for (const item of items) {
      if (signal?.aborted) return count;
      if (!item || typeof item !== 'object') continue;

      const url = item.source_url || 
                  item.guid?.rendered || 
                  item.link || 
                  item.media_details?.sizes?.full?.source_url || 
                  (item.media_details?.file ? `${base}/wp-content/uploads/${item.media_details.file}` : '');

      if (!url) continue;

      let filename = '';
      try {
        const parsed = new URL(url);
        filename = parsed.pathname.split('/').filter(Boolean).pop() || '';
      } catch (e) {
        filename = url.split('/').filter(Boolean).pop() || '';
      }

      const rawTitle = (typeof item.title === 'string' ? item.title : item.title?.rendered) || '';
      const title = rawTitle.replace(/<[^>]+>/g, '').trim() || item.slug || filename || `Media #${item.id}`;
      const mimeType = item.mime_type || 'application/octet-stream';
      const isDocument = /pdf|doc|docx|xls|xlsx|csv|zip|tar|gz|sql|bak|txt|json|xml/i.test(mimeType + ' ' + filename);

      reportMedia({
        id: item.id || null,
        title,
        filename,
        url,
        mimeType,
        mediaType: item.media_type || 'file',
        isDocument,
        date: item.date || null,
        authorId: item.author || null,
        source: sourceName
      });
      count++;
    }
    return count;
  }

  // Seed with passively discovered media from the page DOM
  if (passiveData?.media?.length > 0) {
    for (const item of passiveData.media) {
      reportMedia(item);
    }
  }

  // Determine potential WordPress root paths (e.g. if installed in a subdirectory)
  const candidateBases = new Set([origin]);
  if (passiveData?.url) {
    try {
      const parsed = new URL(passiveData.url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        candidateBases.add(`${parsed.origin}/${segments[0]}`);
      }
    } catch (e) { /* ignore */ }
  }

  const MAX_PAGES = 30; // Enumerate up to 3,000 media attachments
  let restSucceeded = false;

  // Method 1: WordPress REST API with multi-page pagination
  for (const base of candidateBases) {
    if (signal?.aborted) return Array.from(mediaMap.values());
    if (restSucceeded) break;

    const baseEndpoints = [
      { url: `${base}/wp-json/wp/v2/media`, perPage: 100 },
      { url: `${base}/wp-json/wp/v2/media`, perPage: 50 },
      { url: `${base}/wp-json/wp/v2/media`, perPage: 20 },
      { url: `${base}/?rest_route=/wp/v2/media`, perPage: 100 },
      { url: `${base}/?rest_route=/wp/v2/media`, perPage: 50 }
    ];

    for (const epConfig of baseEndpoints) {
      if (signal?.aborted) return Array.from(mediaMap.values());
      try {
        const delim = epConfig.url.includes('?') ? '&' : '?';
        const firstPageUrl = `${epConfig.url}${delim}per_page=${epConfig.perPage}&page=1`;

        const res = await fetch(firstPageUrl, {
          method: 'GET',
          redirect: 'follow',
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
          signal
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            restSucceeded = true;
            processMediaItems(data, base, 'rest-api');

            // Determine total pages from header or infer from count
            const totalPagesHeader = parseInt(res.headers?.get('x-wp-totalpages') || '0', 10);
            const totalPages = totalPagesHeader > 0 ? Math.min(totalPagesHeader, MAX_PAGES) : (data.length >= epConfig.perPage ? MAX_PAGES : 1);

            // Fetch subsequent pages to enumerate bigger number of media
            for (let p = 2; p <= totalPages; p++) {
              if (signal?.aborted) return Array.from(mediaMap.values());
              try {
                const nextUrl = `${epConfig.url}${delim}per_page=${epConfig.perPage}&page=${p}`;
                const nextRes = await fetch(nextUrl, {
                  method: 'GET',
                  redirect: 'follow',
                  credentials: 'include',
                  headers: { 'Accept': 'application/json' },
                  signal
                });

                if (!nextRes.ok) break;
                const nextData = await nextRes.json();
                if (!Array.isArray(nextData) || nextData.length === 0) break;

                processMediaItems(nextData, base, 'rest-api');
                if (nextData.length < epConfig.perPage) break; // Reached last page
              } catch (ePage) {
                break;
              }
            }
            break; // Finished this base
          }
        }
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return Array.from(mediaMap.values());
        // Try next candidate
      }
    }
  }

  // Method 1b: Active Tab Same-Origin fallback with multi-page pagination
  if (!restSucceeded && browser.tabs?.query) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id && tabs[0]?.url) {
        let tabOrigin = '';
        try { tabOrigin = new URL(tabs[0].url).origin; } catch (e) {}
        if (tabOrigin === origin) {
          let page = 1;
          let totalPages = 1;
          while (page <= totalPages && page <= MAX_PAGES) {
            const tabRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'FETCH_MEDIA_REST', page, perPage: 100 });
            if (tabRes?.ok && Array.isArray(tabRes.data) && tabRes.data.length > 0) {
              restSucceeded = true;
              processMediaItems(tabRes.data, origin, 'rest-api-tab');
              totalPages = tabRes.totalPages > 0 ? Math.min(tabRes.totalPages, MAX_PAGES) : (tabRes.data.length >= 100 ? MAX_PAGES : 1);
              if (tabRes.data.length < 100) break;
              page++;
            } else {
              break;
            }
          }
        }
      }
    } catch (e) {
      // Ignore content script message error
    }
  }

  // Method 2: Attachment XML Sitemaps (probe pages 1 to 5)
  for (const base of candidateBases) {
    if (signal?.aborted) return Array.from(mediaMap.values());
    for (let sitemapIdx = 1; sitemapIdx <= 5; sitemapIdx++) {
      if (signal?.aborted) return Array.from(mediaMap.values());
      try {
        const sitemapUrl = `${base}/wp-sitemap-posts-attachment-${sitemapIdx}.xml`;
        const res = await fetch(sitemapUrl, {
          method: 'GET',
          redirect: 'follow',
          signal
        });

        if (!res.ok) break; // Stop on 404
        const body = await res.text();
        const locMatches = body.matchAll(/<loc>([^<]+)<\/loc>/g);
        let foundCount = 0;
        for (const m of locMatches) {
          if (signal?.aborted) return Array.from(mediaMap.values());
          const pageUrl = m[1].trim();
          if (!pageUrl) continue;
          foundCount++;

          let filename = '';
          try {
            const parsed = new URL(pageUrl);
            filename = parsed.pathname.split('/').filter(Boolean).pop() || '';
          } catch (e) {
            filename = pageUrl.split('/').pop() || '';
          }

          const isDocument = /pdf|doc|docx|xls|xlsx|csv|zip|tar|gz|sql|bak/i.test(filename);
          reportMedia({
            id: null,
            title: filename || 'Attachment Page',
            filename,
            url: pageUrl,
            mimeType: isDocument ? 'application/document' : 'text/html',
            mediaType: 'attachment-page',
            isDocument,
            date: null,
            authorId: null,
            source: 'sitemap'
          });
        }
        if (foundCount === 0) break;
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return Array.from(mediaMap.values());
        break;
      }
    }
  }

  return Array.from(mediaMap.values());
}

