/**
 * WPBleeder — Passive Detection Content Script
 *
 * Runs at document_idle on every page. Makes ZERO network requests.
 * Only reads what the browser already fetched to render the page.
 * Sends results to background via runtime.sendMessage.
 */
(function passiveDetect() {
  'use strict';

  const browser = globalThis.browser || globalThis.chrome;

  // --- WordPress detection signals ---

  function isWordPress() {
    // Meta generator tag
    const metaGen = document.querySelector('meta[name="generator"][content^="WordPress"]');
    if (metaGen) return true;

    const html = document.documentElement.innerHTML;

    // wp-content paths in any tag
    if (/\/wp-content\/(themes|plugins)\//i.test(html)) return true;

    // wp-includes references
    if (/\/wp-includes\//i.test(html)) return true;

    // WP emoji or embed scripts
    if (/wp-emoji-release\.min\.js/i.test(html)) return true;
    if (/wp-embed\.min\.js/i.test(html)) return true;

    // Body classes from WP block editor
    const body = document.body;
    if (body && (body.classList.contains('wp-site-blocks') ||
        body.className.match(/wp-block-/))) return true;

    // wp-json link in head
    const wpJsonLink = document.querySelector('link[rel="https://api.w.org/"]');
    if (wpJsonLink) return true;

    return false;
  }

  // --- Extraction functions ---

  function extractCoreVersion() {
    const result = { meta: null, assets: null, mismatch: false, feedUrl: null };

    // 1. From meta generator
    try {
      const metaGen = document.querySelector('meta[name="generator"]');
      if (metaGen && metaGen.content) {
        const match = metaGen.content.match(/WordPress\s+([\d.]+)/i);
        if (match) result.meta = match[1];
      }
    } catch (e) { /* ignore */ }

    // 2. From RSS feed link in head
    try {
      const rssLink = document.querySelector('link[rel="alternate"][type="application/rss+xml"]');
      if (rssLink && rssLink.href) {
        result.feedUrl = rssLink.href;
      }
    } catch (e) { /* ignore */ }

    // 3. From native core ?ver= query strings on scripts and styles
    try {
      const versionWeights = {};
      const elements = document.querySelectorAll('script[src], link[href]');
      const wpVerPattern = /[?&]ver=([\d]+\.[\d]+(?:\.[\d]+)?)/;

      // High-confidence native WordPress core assets that strictly use $wp_version
      const highConfidencePatterns = [
        /\/wp-includes\/css\/dist\/block-library\//i,
        /\/wp-includes\/js\/wp-emoji-release(\.min)?\.js/i,
        /\/wp-includes\/js\/wp-embed(\.min)?\.js/i,
        /\/wp-includes\/js\/comment-reply(\.min)?\.js/i,
        /\/wp-includes\/css\/dashicons(\.min)?\.css/i,
        /\/wp-includes\/css\/admin-bar(\.min)?\.css/i,
        /\/wp-includes\/js\/admin-bar(\.min)?\.js/i,
        /\/wp-includes\/js\/wp-util(\.min)?\.js/i,
        /\/wp-includes\/js\/wp-a11y(\.min)?\.js/i,
        /\/wp-includes\/css\/buttons(\.min)?\.css/i,
        /\/wp-includes\/css\/editor(\.min)?\.css/i,
        /\/wp-includes\/js\/media-views(\.min)?\.js/i
      ];

      // Vendor/bundled directories in wp-includes that have their OWN library versions (NOT WordPress version)
      const vendorExcludePattern = /\/wp-includes\/(js\/jquery|js\/tinymce|js\/codemirror|js\/plupload|js\/swfobject|js\/dist\/vendor|js\/jcrop|js\/imgareaselect)/i;

      for (const el of elements) {
        const url = el.src || el.href || '';
        if (!url || typeof url !== 'string') continue;

        // CRITICAL: Exclude /wp-content/ completely! Plugins and themes have their own versions.
        if (/\/wp-content\//i.test(url)) continue;

        // Must be located in /wp-includes/
        if (!/\/wp-includes\//i.test(url)) continue;

        // Must NOT be a third-party bundled vendor library (e.g. jQuery 3.7.1)
        if (vendorExcludePattern.test(url)) continue;

        const match = url.match(wpVerPattern);
        if (match) {
          const ver = match[1];
          // High-confidence native core files receive heavy weighting (+5), others get +1
          const isHighConfidence = highConfidencePatterns.some(p => p.test(url));
          const weight = isHighConfidence ? 5 : 1;
          versionWeights[ver] = (versionWeights[ver] || 0) + weight;
        }
      }

      // Most weighted version is the true WordPress core version
      let maxWeight = 0;
      for (const [ver, weight] of Object.entries(versionWeights)) {
        if (weight > maxWeight) {
          maxWeight = weight;
          result.assets = ver;
        }
      }
    } catch (e) { /* ignore */ }

    // 4. Mismatch detection (e.g. spoofed generator tag)
    if (result.meta && result.assets && result.meta !== result.assets) {
      result.mismatch = true;
    }

    return result;
  }

  function extractTheme() {
    try {
      const links = document.querySelectorAll('link[rel="stylesheet"][href*="wp-content/themes/"]');
      for (const link of links) {
        const href = link.href || '';
        const slugMatch = href.match(/\/wp-content\/themes\/([a-zA-Z0-9_-]+)\//);
        if (!slugMatch) continue;

        const slug = slugMatch[1];
        let version = null;
        const verMatch = href.match(/[?&]ver=([\d.]+)/);
        if (verMatch) version = verMatch[1];

        return { slug, version };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function extractPassivePlugins() {
    try {
      const pluginMap = new Map(); // slug -> { slug, version, url }
      const origin = window.location.origin;

      function addPlugin(slug, url = null, version = null) {
        if (!slug) return;
        const cleanSlug = String(slug).toLowerCase().trim();
        if (cleanSlug.length <= 1 || cleanSlug === 'index.php' || cleanSlug.startsWith('wp-')) return;

        let fullUrl = url;
        if (fullUrl) {
          try {
            fullUrl = new URL(fullUrl, origin).href;
          } catch (e) {}
        } else {
          fullUrl = `${origin}/wp-content/plugins/${cleanSlug}/readme.txt`;
        }

        if (!pluginMap.has(cleanSlug)) {
          pluginMap.set(cleanSlug, {
            slug: cleanSlug,
            version: version || null,
            url: fullUrl
          });
        } else {
          const existing = pluginMap.get(cleanSlug);
          if (!existing.version && version) existing.version = version;
          if ((!existing.url || existing.url.endsWith('/readme.txt')) && url) {
            existing.url = fullUrl;
          }
        }
      }

      function checkResource(url) {
        if (!url || typeof url !== 'string') return;
        const match = url.match(/\/wp-content\/plugins\/([a-zA-Z0-9_-]+)/i);
        if (match) {
          const slug = match[1];
          let ver = null;
          const verMatch = url.match(/[?&]ver=([\d.]+)/);
          if (verMatch) ver = verMatch[1];
          addPlugin(slug, url, ver);
        }
      }

      function checkString(str) {
        if (!str || typeof str !== 'string') return;
        const pluginPattern = /\/wp-content\/plugins\/([a-zA-Z0-9_-]+)/gi;
        let match;
        while ((match = pluginPattern.exec(str)) !== null) {
          addPlugin(match[1]);
        }
      }

      // 1. Raw HTML of document
      const html = document.documentElement.innerHTML;
      checkString(html);

      // 2. DOM elements attributes (handles resolved URLs and lazy-loading)
      const elements = document.querySelectorAll('script, link, img, source, a, style, iframe, form');
      for (const el of elements) {
        if (el.src) checkResource(el.src);
        if (el.href) checkResource(el.href);
        const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-rocket-src') || el.getAttribute('data-lazy-src');
        if (dataSrc) checkResource(dataSrc);
        checkString(el.getAttribute('src'));
        checkString(el.getAttribute('href'));
        checkString(el.getAttribute('data-srcset'));
        checkString(el.getAttribute('srcset'));
        checkString(el.id);
        checkString(el.className);
      }

      // 3. Performance resource entries (fetches, stylesheets, scripts)
      try {
        if (window.performance && typeof window.performance.getEntriesByType === 'function') {
          const resources = window.performance.getEntriesByType('resource');
          for (const r of resources) {
            checkResource(r.name);
          }
        }
      } catch (e) {}

      // 4. Well-known plugin signature indicators in scripts, IDs, classes, globals
      const wellKnownPlugins = [
        { slug: 'wp-rocket', pattern: /rocket-lazyload|wp_rocket|rocketloader|wprocket/i },
        { slug: 'elementor', pattern: /elementor-frontend|elementorFrontendConfig|class="[^"]*elementor/i },
        { slug: 'elementor-pro', pattern: /elementor-pro|elementorProFrontendConfig/i },
        { slug: 'fluentform', pattern: /fluentform|fluent_forms|fluent-form/i },
        { slug: 'gtm-kit', pattern: /gtm-kit|gtmkit/i },
        { slug: 'pixelyoursite', pattern: /pixelyoursite|pys_options|pysEvents/i },
        { slug: 'review-schema', pattern: /review-schema|schema-review/i },
        { slug: 'affiliate-wp', pattern: /affiliate-wp|affwp_/i },
        { slug: 'easy-digital-downloads-pro', pattern: /easy-digital-downloads|edd-pro/i },
        { slug: 'edd-custom-prices', pattern: /edd-custom-prices/i },
        { slug: 'wordfence', pattern: /wordfence|wfvt_|wfls-/i },
        { slug: 'contact-form-7', pattern: /contact-form-7|wpcf7/i },
        { slug: 'woocommerce', pattern: /woocommerce|wc-cart/i },
        { slug: 'yoast-seo', pattern: /yoast-seo|wp-seo/i },
        { slug: 'rank-math', pattern: /rank-math/i },
        { slug: 'wpforms', pattern: /wpforms/i }
      ];

      for (const p of wellKnownPlugins) {
        if (!pluginMap.has(p.slug)) {
          if (p.pattern.test(html)) {
            addPlugin(p.slug, `${origin}/wp-content/plugins/${p.slug}/readme.txt`);
          }
        }
      }

      return Array.from(pluginMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
    } catch (e) { return []; }
  }

  function extractAuthors() {
    const authors = new Map(); // slug -> { slug, name, source, url }

    function addAuthor(slug, name, source, url = null) {
      if (!slug) return;
      const cleanSlug = String(slug).trim().toLowerCase();
      if (!cleanSlug || cleanSlug.length < 1 || cleanSlug === 'admin-ajax.php') return;
      
      const authorUrl = url || `${window.location.origin}/author/${cleanSlug}/`;
      if (!authors.has(cleanSlug)) {
        authors.set(cleanSlug, {
          slug: cleanSlug,
          name: name ? String(name).trim() : null,
          source,
          url: authorUrl
        });
      } else {
        const existing = authors.get(cleanSlug);
        if (!existing.name && name) {
          existing.name = String(name).trim();
        }
        if (!existing.url && authorUrl) {
          existing.url = authorUrl;
        }
      }
    }

    try {
      // 1. Schema.org JSON-LD structured data in <head> or <body>
      const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of ldJsonScripts) {
        try {
          const json = JSON.parse(script.textContent);
          // Can be single object, array, or @graph
          const items = Array.isArray(json) ? json : (json?.['@graph'] ? json['@graph'] : [json]);
          for (const item of items) {
            if (!item) continue;
            // Check Person type directly
            if (item['@type'] === 'Person') {
              const url = item.url || item['@id'] || '';
              const match = url.match(/\/author\/([a-zA-Z0-9_.-]+)/);
              const slug = match ? match[1] : (item.name ? item.name.toLowerCase().replace(/\s+/g, '-') : null);
              if (slug) addAuthor(slug, item.name || null, 'json-ld', url || window.location.href);
            }
            // Check author property on Article, BlogPosting, WebPage
            if (item.author) {
              const authorObj = Array.isArray(item.author) ? item.author[0] : item.author;
              if (typeof authorObj === 'object' && authorObj) {
                const url = authorObj.url || authorObj['@id'] || '';
                const match = url.match(/\/author\/([a-zA-Z0-9_.-]+)/);
                const slug = match ? match[1] : (authorObj.name ? authorObj.name.toLowerCase().replace(/\s+/g, '-') : null);
                if (slug) addAuthor(slug, authorObj.name || null, 'json-ld', url || window.location.href);
              } else if (typeof authorObj === 'string') {
                addAuthor(authorObj.toLowerCase().replace(/\s+/g, '-'), authorObj, 'json-ld', window.location.href);
              }
            }
          }
        } catch (e) { /* ignore JSON parsing errors */ }
      }

      // 2. Meta tags (<meta name="author">, <meta property="article:author">)
      const metaAuthor = document.querySelector('meta[name="author"]');
      if (metaAuthor && metaAuthor.content) {
        addAuthor(metaAuthor.content.toLowerCase().replace(/\s+/g, '-'), metaAuthor.content, 'meta-tag', window.location.href);
      }

      const articleAuthor = document.querySelector('meta[property="article:author"]');
      if (articleAuthor && articleAuthor.content) {
        const url = articleAuthor.content;
        const match = url.match(/\/author\/([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          addAuthor(match[1], null, 'meta-tag', url);
        }
      }

      // 3. Author archive links: /author/username/
      const authorLinks = document.querySelectorAll('a[href*="/author/"]');
      for (const link of authorLinks) {
        const href = link.href || '';
        const match = href.match(/\/author\/([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          const name = link.textContent?.trim() || null;
          addAuthor(match[1], name, 'author-link', href);
        }
      }

      // 4. ?author=N links in HTML
      const authorParamLinks = document.querySelectorAll('a[href*="?author="]');
      for (const link of authorParamLinks) {
        const href = link.href || '';
        const match = href.match(/[?&]author=(\d+)/);
        if (match) {
          const id = match[1];
          const name = link.textContent?.trim() || null;
          addAuthor(`author-id-${id}`, name, 'param', href);
        }
      }

      // 5. Post bylines & author card selectors
      const bylineSelectors = ['.author a', '.vcard a', '.byline a', '[rel="author"]', '.entry-author a', '.post-author a'];
      for (const selector of bylineSelectors) {
        try {
          const els = document.querySelectorAll(selector);
          for (const el of els) {
            const href = el.href || '';
            const match = href.match(/\/author\/([a-zA-Z0-9_.-]+)/);
            if (match && match[1]) {
              const name = el.textContent?.trim() || null;
              addAuthor(match[1], name, 'byline', href);
            }
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    return Array.from(authors.values());
  }

  function extractAdminSignals() {
    const signals = {
      isLoginPage: false,
      loginLinks: [],
      registrationLinks: [],
      hasLoginForm: false,
      hasRegisterForm: false,
      ajaxUrl: null
    };

    try {
      const path = window.location.pathname.toLowerCase();

      // Is current page a login page?
      if (path.includes('wp-login.php') || path.includes('wp-admin') || path.includes('/login') || path.includes('/signin')) {
        signals.isLoginPage = true;
      }

      // Check on-page forms
      const forms = document.querySelectorAll('form');
      for (const form of forms) {
        const action = (form.getAttribute('action') || '').toLowerCase();
        const id = (form.id || '').toLowerCase();
        const className = (form.className || '').toLowerCase();
        const hasPwd = form.querySelector('input[type="password"]');

        if (id === 'loginform' || action.includes('wp-login.php') || className.includes('login') || (hasPwd && (action.includes('login') || id.includes('login')))) {
          signals.hasLoginForm = true;
        }

        if (id === 'registerform' || action.includes('register') || className.includes('register') || (action.includes('wp-login.php') && action.includes('register'))) {
          signals.hasRegisterForm = true;
        }
      }

      // Find links pointing to login/admin/register
      const links = document.querySelectorAll('a[href]');
      const seen = new Set();
      for (const a of links) {
        const h = a.href || '';
        const lowerH = h.toLowerCase();
        if (seen.has(h)) continue;

        if (lowerH.includes('wp-login.php') || lowerH.includes('/wp-admin') || lowerH.includes('/login') || lowerH.includes('/admin')) {
          seen.add(h);
          signals.loginLinks.push({ text: (a.textContent || '').trim().slice(0, 40) || 'Login Link', url: h });
        } else if (lowerH.includes('action=register') || lowerH.includes('wp-register.php') || lowerH.includes('/register') || lowerH.includes('/signup')) {
          seen.add(h);
          signals.registrationLinks.push({ text: (a.textContent || '').trim().slice(0, 40) || 'Register Link', url: h });
        }
      }

      // Extract admin-ajax or REST API root from scripts
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        const ajaxMatch = text.match(/(?:ajax_url|ajaxurl)\s*[:=]\s*["']([^"']+)["']/i);
        if (ajaxMatch && ajaxMatch[1]) {
          signals.ajaxUrl = ajaxMatch[1];
          break;
        }
      }

    } catch (e) { /* ignore */ }

    return signals;
  }

  function extractFirewallsAndSecurity(detectedPlugins = []) {
    const detected = [];
    try {
      const html = document.documentElement.innerHTML.toLowerCase();
      const cookies = document.cookie || '';

      // Helper to add unique detection
      function addDetected(name, vendor, type, source) {
        if (!detected.some(d => d.name.toLowerCase() === name.toLowerCase() || d.vendor.toLowerCase() === vendor.toLowerCase())) {
          detected.push({ name, vendor, type, source });
        }
      }

      // 1. WordPress Security & Firewall Plugins
      const securityPluginRules = [
        { name: 'Wordfence Security', vendor: 'Wordfence', type: 'plugin', pattern: /wordfence|wf-active|wfls-|wfvt_|wordfence_verifiedhuman|your access to this site has been limited|generated by wordfence/i },
        { name: 'Solid Security (iThemes)', vendor: 'SolidWP', type: 'plugin', pattern: /better-wp-security|solid-security|itsec/i },
        { name: 'Sucuri Security', vendor: 'Sucuri', type: 'plugin', pattern: /sucuri-scanner/i },
        { name: 'All-in-One WP Security', vendor: 'AIOWPS', type: 'plugin', pattern: /all-in-one-wp-security|aiowpsec/i },
        { name: 'NinjaFirewall', vendor: 'NinjaTechnologies', type: 'plugin', pattern: /ninjafirewall|nfw_/i },
        { name: 'Shield Security', vendor: 'Shield', type: 'plugin', pattern: /shield-security|wp-simple-firewall/i },
        { name: 'BBQ: Block Bad Queries', vendor: 'BBQ', type: 'plugin', pattern: /bbq-firewall/i },
        { name: 'WP Cerber Security', vendor: 'Cerber', type: 'plugin', pattern: /wp-cerber|cerber/i },
        { name: 'SecuPress', vendor: 'SecuPress', type: 'plugin', pattern: /secupress/i },
        { name: 'CleanTalk Security', vendor: 'CleanTalk', type: 'plugin', pattern: /cleantalk|apbct/i },
        { name: 'MalCare Security', vendor: 'MalCare', type: 'plugin', pattern: /malcare|blogvault/i }
      ];

      for (const rule of securityPluginRules) {
        if (rule.pattern.test(html)) {
          addDetected(rule.name, rule.vendor, rule.type, 'passive-dom');
        }
      }

      // 2. Check DOM elements (scripts, links, IDs, classes) for security plugins
      const domSecurityEls = document.querySelectorAll('script, link, div, form');
      for (const el of domSecurityEls) {
        const text = ((el.src || '') + ' ' + (el.href || '') + ' ' + (el.id || '') + ' ' + (el.className || '')).toLowerCase();
        if (text.includes('wordfence') || text.includes('wfls-') || text.includes('wf-active')) {
          addDetected('Wordfence Security', 'Wordfence', 'plugin', 'script-tag');
        }
        if (text.includes('sucuri')) {
          addDetected('Sucuri Security', 'Sucuri', 'plugin', 'script-tag');
        }
        if (text.includes('better-wp-security') || text.includes('solid-security')) {
          addDetected('Solid Security (iThemes)', 'SolidWP', 'plugin', 'script-tag');
        }
      }

      // 3. Check performance resource entries (catches scripts/beacons even if blocked by Firefox ETP)
      try {
        if (window.performance && typeof window.performance.getEntriesByType === 'function') {
          const resources = window.performance.getEntriesByType('resource');
          for (const r of resources) {
            const name = (r.name || '').toLowerCase();
            if (name.includes('/cdn-cgi/')) {
              addDetected('Cloudflare', 'Cloudflare', 'proxy', 'resource-cdn-cgi');
            }
            if (name.includes('wordfence') || name.includes('wfls') || name.includes('wfvt_')) {
              addDetected('Wordfence Security', 'Wordfence', 'plugin', 'resource-timing');
            }
            if (name.includes('sucuri')) {
              addDetected('Sucuri Security', 'Sucuri', 'plugin', 'resource-timing');
            }
          }
        }
      } catch (e) {}

      // 4. Cloud / Proxy Firewalls & CDNs
      const proxyRules = [
        { name: 'Cloudflare', vendor: 'Cloudflare', type: 'proxy', pattern: /challenges\.cloudflare\.com|cloudflareinsights|rocket-loader|\/cdn-cgi\/|cdnjs\.cloudflare\.com/i },
        { name: 'Imperva Incapsula', vendor: 'Imperva', type: 'proxy', pattern: /_incapsula_resource|visid_incap/i },
        { name: 'Akamai', vendor: 'Akamai', type: 'proxy', pattern: /akam\.net|akamaized\.net/i },
        { name: 'Sucuri CloudProxy', vendor: 'Sucuri', type: 'proxy', pattern: /sucuri website firewall|cloudproxy/i },
        { name: 'LiteSpeed / QUIC.cloud', vendor: 'LiteSpeed', type: 'proxy', pattern: /quic\.cloud|litespeed/i }
      ];

      for (const rule of proxyRules) {
        if (rule.pattern.test(html)) {
          addDetected(rule.name, rule.vendor, rule.type, 'passive-dom');
        }
      }

      // 5. Cookie Signatures
      if (/__cf_bm|cf_clearance|__cflb/i.test(cookies)) {
        addDetected('Cloudflare', 'Cloudflare', 'proxy', 'cookie-signature');
      }
      if (/wfvt_|wfls-|wordfence/i.test(cookies)) {
        addDetected('Wordfence Security', 'Wordfence', 'plugin', 'cookie-signature');
      }

      // 6. Cross-reference detected plugin slugs
      if (Array.isArray(detectedPlugins)) {
        const slugs = detectedPlugins.map(p => typeof p === 'string' ? p : p.slug);
        if (slugs.includes('wordfence')) {
          addDetected('Wordfence Security', 'Wordfence', 'plugin', 'plugin-slug');
        }
        if (slugs.includes('better-wp-security') || slugs.includes('solid-security')) {
          addDetected('Solid Security (iThemes)', 'SolidWP', 'plugin', 'plugin-slug');
        }
        if (slugs.includes('sucuri-scanner')) {
          addDetected('Sucuri Security', 'Sucuri', 'plugin', 'plugin-slug');
        }
        if (slugs.includes('ninjafirewall')) {
          addDetected('NinjaFirewall', 'NinjaTechnologies', 'plugin', 'plugin-slug');
        }
      }

    } catch (e) { /* ignore */ }

    return detected;
  }

  function extractPassiveMedia() {
    const media = new Map();

    function addMediaItem(rawUrl, title = null) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        // Only accept media from wp-content/uploads/
        if (!parsed.pathname.includes('/wp-content/uploads/')) return;

        const cleanUrl = parsed.origin + parsed.pathname;
        if (media.has(cleanUrl)) return;

        const filename = parsed.pathname.split('/').filter(Boolean).pop() || '';
        if (!filename) return;

        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const isDoc = /pdf|doc|docx|xls|xlsx|csv|zip|tar|gz|sql|bak|txt|json|xml/i.test(ext);
        const isImg = /jpg|jpeg|png|gif|webp|svg|ico|bmp|avif/i.test(ext);
        const isVid = /mp4|webm|ogv|mov|m4v/i.test(ext);
        const isAud = /mp3|wav|ogg|m4a/i.test(ext);

        let type = 'file';
        if (isDoc) type = 'document';
        else if (isImg) type = 'image';
        else if (isVid) type = 'video';
        else if (isAud) type = 'audio';

        // Extract upload date from path: /uploads/YYYY/MM/
        const dateMatch = parsed.pathname.match(/\/uploads\/(\d{4})\/(\d{2})\//);
        const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-01` : null;

        media.set(cleanUrl, {
          id: null,
          title: (title && title.length < 80) ? title.trim() : filename,
          filename,
          url: cleanUrl,
          mimeType: isDoc ? `application/${ext}` : (isImg ? `image/${ext}` : `media/${ext}`),
          mediaType: type,
          isDocument: isDoc,
          date,
          authorId: null,
          source: 'passive-dom'
        });
      } catch (e) { /* ignore URL parse error */ }
    }

    try {
      // 1. Image elements (src and srcset)
      const imgs = document.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        if (src) addMediaItem(src, img.alt || img.title || null);

        const srcset = img.srcset || img.getAttribute('data-srcset') || '';
        if (srcset) {
          const parts = srcset.split(',');
          for (const part of parts) {
            const u = part.trim().split(/\s+/)[0];
            if (u) addMediaItem(u, img.alt || img.title || null);
          }
        }
      }

      // 2. Links to uploads (documents, downloads, full-size images)
      const links = document.querySelectorAll('a[href*="/wp-content/uploads/"]');
      for (const a of links) {
        addMediaItem(a.href, a.textContent?.trim() || a.title || null);
      }

      // 3. Picture and source elements
      const sources = document.querySelectorAll('source[srcset]');
      for (const s of sources) {
        const parts = (s.srcset || '').split(',');
        for (const part of parts) {
          const u = part.trim().split(/\s+/)[0];
          if (u) addMediaItem(u, null);
        }
      }

      // 4. Video and Audio elements
      const mediaTags = document.querySelectorAll('video[src], audio[src], video source[src], audio source[src]');
      for (const el of mediaTags) {
        const src = el.src || el.getAttribute('src') || '';
        if (src) addMediaItem(src, null);
      }
    } catch (e) { /* ignore */ }

    return Array.from(media.values());
  }

  // --- Main ---

  async function runPassiveDetect() {
    try {
      // Check if extension is enabled
      const settings = await browser.storage.local.get({ 'settings:enabled': true });
      if (!settings['settings:enabled']) {
        return; // Extension is disabled — do not perform detection
      }

      if (!isWordPress()) {
        browser.runtime.sendMessage({ type: 'NOT_WORDPRESS' }).catch(() => {});
        return;
      }

      const plugins = extractPassivePlugins();

      const passiveData = {
        domain: window.location.hostname,
        url: window.location.href,
        isWordPress: true,
        timestamp: Date.now(),
        wpVersion: extractCoreVersion(),
        theme: extractTheme(),
        plugins,
        authors: extractAuthors(),
        adminSignals: extractAdminSignals(),
        security: extractFirewallsAndSecurity(plugins),
        media: extractPassiveMedia()
      };

      browser.runtime.sendMessage({
        type: 'PASSIVE_RESULTS',
        data: passiveData
      }).catch(() => {
        // Panel/background might not be listening yet — that's fine
      });

    } catch (e) {
      // Content script should never throw unhandled errors
    }
  }

  // Run automatically on page load
  runPassiveDetect();

  // Listen for messages from background/panel
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && (message.type === 'TRIGGER_PASSIVE_SCAN' || message.type === 'RESCAN_PASSIVE')) {
      runPassiveDetect();
    } else if (message && message.type === 'FETCH_MEDIA_REST') {
      const page = message.page || 1;
      const perPage = message.perPage || 100;
      fetch(`/wp-json/wp/v2/media?per_page=${perPage}&page=${page}`, {
        headers: { 'Accept': 'application/json' }
      })
      .then(async res => {
        if (!res.ok) {
          if (page === 1) {
            const r2 = await fetch('/wp-json/wp/v2/media', { headers: { 'Accept': 'application/json' } });
            return { data: r2.ok ? await r2.json() : [], totalPages: 1 };
          }
          return { data: [], totalPages: 1 };
        }
        const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
        const data = await res.json();
        return { data: Array.isArray(data) ? data : [], totalPages };
      })
      .then(result => sendResponse({ ok: true, data: result.data, totalPages: result.totalPages }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // Keep message port open for async response
    }
  });
})();
