const browser = globalThis.browser || globalThis.chrome;

const XMLRPC_PAYLOAD = `<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName><params></params></methodCall>`;

export async function scanXmlrpc(origin, signal = null) {
  const url = `${origin}/xmlrpc.php`;
  const result = {
    url,
    enabled: false,
    methods: [],
    status: null
  };
  
  if (signal?.aborted) return result;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml'
      },
      body: XMLRPC_PAYLOAD,
      signal
    });
    
    result.status = response.status;
    
    if (response.ok) {
      const body = await response.text();
      // Parse method names from XML response
      if (body.includes('<methodResponse>')) {
        const methodMatches = body.matchAll(/<string>([^<]+)<\/string>/g);
        for (const m of methodMatches) {
          result.methods.push(m[1]);
        }
        result.enabled = result.methods.length > 0;
      }
    }
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') return result;
    result.error = err.message;
  }
  
  return result;
}
