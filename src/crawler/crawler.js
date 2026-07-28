const axios = require('axios');
const cheerio = require('cheerio');
const { checkRobotsPermission, USER_AGENT } = require('./robots');
const frontier = require('./frontier');
const { indexDocument } = require('../indexer/indexer');
const { getDomain } = require('./urlUtils');

const MAX_DEPTH = 4;
const MAX_LINKS_PER_PAGE = 25; // cap how many outlinks from one page we enqueue, to avoid link-farm blowups
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2_000_000; // skip indexing huge pages (avoids pathological memory use)

function extractPage(url, html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, iframe, noscript, svg, button, form').remove();

  const title = $('title').first().text().trim() || $('h1').first().text().trim() || url;
  let snippet = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || '';

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  if (!snippet) {
    snippet = bodyText.slice(0, 200) + (bodyText.length > 200 ? '...' : '');
  }

  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) links.push(href);
  });

  return { title, snippet, bodyText, links: links.slice(0, MAX_LINKS_PER_PAGE) };
}

/** Crawls, indexes, and expands the frontier for a single queued URL. */
async function processQueuedUrl(queueItem) {
  const { id: queueId, url, domain, depth } = queueItem;

  const { allowed, crawlDelayMs } = await checkRobotsPermission(url, domain);
  if (crawlDelayMs) await frontier.touchDomain(domain, { success: false, crawlDelayMs });
  if (!allowed) {
    await frontier.markDisallowed(queueId, domain);
    return { status: 'disallowed', url };
  }

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: MAX_BODY_BYTES,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      validateStatus: (s) => s >= 200 && s < 400
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html')) {
      await frontier.markDone(queueId, domain);
      return { status: 'skipped-non-html', url };
    }

    const { title, snippet, bodyText, links } = extractPage(url, response.data);
    await indexDocument({ url, domain, title, snippet, bodyText });
    await frontier.markDone(queueId, domain);

    if (depth < MAX_DEPTH && links.length > 0) {
      await frontier.enqueueUrls(links, url, depth + 1);
    }

    return { status: 'indexed', url, title };
  } catch (err) {
    await frontier.markFailed(queueId, domain, err.message);
    return { status: 'error', url, error: err.message };
  }
}

/**
 * Runs the crawl loop until either the page budget is spent or the frontier
 * is empty / stalled (nothing currently eligible under politeness rules).
 * Meant to be called from worker.js, not from an inbound HTTP request.
 */
async function runCrawlLoop({ pageBudget = 50, maxPagesPerDomain = 200, minDelayMs = 300 } = {}) {
  let processed = 0;
  let consecutiveEmpty = 0;

  while (processed < pageBudget && consecutiveEmpty < 5) {
    const item = await frontier.claimNextUrl({ maxPagesPerDomain });
    if (!item) {
      consecutiveEmpty += 1;
      await new Promise((r) => setTimeout(r, 1000)); // frontier may free up as domain delays elapse
      continue;
    }
    consecutiveEmpty = 0;

    const result = await processQueuedUrl(item);
    console.log(`[Crawler] ${result.status}: ${result.url}${result.error ? ` (${result.error})` : ''}`);
    processed += 1;

    await new Promise((r) => setTimeout(r, minDelayMs));
  }

  console.log(`[Crawler] Loop finished. Pages processed this run: ${processed}`);
  return { processed };
}

async function seedQueue(urls) {
  let total = 0;
  for (const url of urls) {
    const domain = getDomain(url);
    if (!domain) continue;
    total += await frontier.enqueueUrls([url], url, 0);
  }
  return total;
}

module.exports = { processQueuedUrl, runCrawlLoop, seedQueue };
