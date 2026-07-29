/**
 * The frontend has pre-built tabs (All / Movies / Google / Wikipedia /
 * YouTube / Social Matrix) that filter on a `source` field. We derive that
 * field honestly from the crawled page's own domain, rather than faking it.
 * "google" is used as the bucket label for general web results, matching
 * how that tab is already used in the UI (it doesn't mean the result
 * actually came from Google - nothing here does).
 */
function classifySource(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'google';
  }

  if (host.endsWith('wikipedia.org')) return 'wikipedia';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('archive.org')) return 'archive';
  return 'google';
}

module.exports = { classifySource };
