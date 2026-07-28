const { URL } = require('url');

// Tracking params that don't change page content - stripping them means
// "example.com/a?utm_source=x" and "example.com/a?utm_source=y" collapse to
// the same document instead of being crawled/indexed twice.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'igshid'
]);

/**
 * Resolves a possibly-relative href against a base URL and normalizes it:
 * lowercased host, no fragment, no tracking params, no trailing slash
 * (except for bare domain roots). Returns null for anything that isn't
 * http/https or fails to parse.
 */
function normalizeUrl(href, baseUrl) {
  try {
    const parsed = new URL(href, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return null;
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

module.exports = { normalizeUrl, getDomain };
