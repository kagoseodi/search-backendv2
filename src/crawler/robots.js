const axios = require('axios');
const robotsParser = require('robots-parser');
const { pool } = require('../../db/pool');

const USER_AGENT = 'GoseodiBot/1.0 (+https://github.com/kagoseodi/search-backend)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refetch robots.txt at most once a day per domain

const memoryCache = new Map(); // domain -> { parser, fetchedAt }

async function fetchRobotsTxt(domain) {
  const robotsUrl = `https://${domain}/robots.txt`;
  try {
    const response = await axios.get(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: () => true
    });
    // A 404/403 on robots.txt conventionally means "no restrictions" - treat
    // as allow-all rather than blocking the whole domain.
    if (response.status >= 200 && response.status < 300) {
      return response.data;
    }
    return '';
  } catch (err) {
    console.warn(`[Robots] Could not fetch robots.txt for ${domain}: ${err.message}`);
    return '';
  }
}

async function getRobotsParser(domain) {
  const cached = memoryCache.get(domain);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.parser;
  }

  // Check the DB cache before hitting the network again (survives process restarts).
  const dbRow = await pool.query(
    'SELECT rules_text, fetched_at FROM robots_cache WHERE domain = $1',
    [domain]
  );

  let rulesText;
  if (dbRow.rows.length > 0 && Date.now() - new Date(dbRow.rows[0].fetched_at).getTime() < CACHE_TTL_MS) {
    rulesText = dbRow.rows[0].rules_text;
  } else {
    rulesText = await fetchRobotsTxt(domain);
    await pool.query(
      `INSERT INTO robots_cache (domain, rules_text, fetched_at)
       VALUES ($1, $2, now())
       ON CONFLICT (domain) DO UPDATE SET rules_text = $2, fetched_at = now()`,
      [domain, rulesText]
    );
  }

  const parser = robotsParser(`https://${domain}/robots.txt`, rulesText || '');
  memoryCache.set(domain, { parser, fetchedAt: Date.now() });
  return parser;
}

/** Returns { allowed: boolean, crawlDelayMs: number|null } for a given URL. */
async function checkRobotsPermission(url, domain) {
  const parser = await getRobotsParser(domain);
  const allowed = parser.isAllowed(url, USER_AGENT) !== false; // treat undefined as allowed
  const crawlDelaySec = parser.getCrawlDelay(USER_AGENT);
  return {
    allowed,
    crawlDelayMs: crawlDelaySec ? crawlDelaySec * 1000 : null
  };
}

module.exports = { checkRobotsPermission, USER_AGENT };
