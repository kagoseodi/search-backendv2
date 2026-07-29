const { pool } = require('../../db/pool');
const { normalizeUrl, getDomain } = require('./urlUtils');

/** Adds URLs to the queue, silently skipping ones already known (queued, done, or failed). */
async function enqueueUrls(hrefs, baseUrl, depth) {
  const seen = new Set();
  const rows = [];

  for (const href of hrefs) {
    const normalized = normalizeUrl(href, baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const domain = getDomain(normalized);
    if (!domain) continue;
    rows.push({ url: normalized, domain, depth });
  }

  if (rows.length === 0) return 0;

  const values = [];
  const params = [];
  let i = 1;
  for (const row of rows) {
    values.push(`($${i++}, $${i++}, $${i++})`);
    params.push(row.url, row.domain, row.depth);
  }

  const result = await pool.query(
    `INSERT INTO crawl_queue (url, domain, depth)
     VALUES ${values.join(', ')}
     ON CONFLICT (url) DO NOTHING
     RETURNING id`,
    params
  );
  return result.rowCount;
}

/**
 * Picks the next URL to crawl. Prefers domains that either haven't been
 * fetched yet or whose per-domain crawl_delay has elapsed, and skips domains
 * already at the per-run page cap or flagged disallowed. This is what keeps
 * a "broad" crawl from hammering one host or spiraling into one site.
 */
async function claimNextUrl({ maxPagesPerDomain }) {
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT q.id, q.url, q.domain, q.depth
       FROM crawl_queue q
       LEFT JOIN domain_stats d ON d.domain = q.domain
       WHERE q.status = 'pending'
         AND COALESCE(d.disallowed, false) = false
         AND COALESCE(d.pages_crawled, 0) < $1
         AND (
           d.last_fetched_at IS NULL
           OR d.last_fetched_at < now() - (COALESCE(d.crawl_delay_ms, 1000) || ' milliseconds')::interval
         )
       ORDER BY q.discovered_at ASC
       LIMIT 1
       FOR UPDATE OF q SKIP LOCKED
     )
     UPDATE crawl_queue
     SET status = 'in_progress'
     FROM candidate
     WHERE crawl_queue.id = candidate.id
     RETURNING crawl_queue.id, crawl_queue.url, crawl_queue.domain, crawl_queue.depth`,
    [maxPagesPerDomain]
  );

  return rows[0] || null;
}

async function markDone(queueId, domain) {
  await pool.query(
    `UPDATE crawl_queue SET status = 'done', processed_at = now() WHERE id = $1`,
    [queueId]
  );
  await touchDomain(domain, { success: true });
}

async function markFailed(queueId, domain, errorMessage) {
  await pool.query(
    `UPDATE crawl_queue SET status = 'failed', processed_at = now(), error = $2 WHERE id = $1`,
    [queueId, String(errorMessage).slice(0, 500)]
  );
  await touchDomain(domain, { success: false });
}

async function markDisallowed(queueId, domain) {
  await pool.query(
    `UPDATE crawl_queue SET status = 'disallowed', processed_at = now() WHERE id = $1`,
    [queueId]
  );
}

async function touchDomain(domain, { success, crawlDelayMs }) {
  await pool.query(
    `INSERT INTO domain_stats (domain, pages_crawled, last_fetched_at, crawl_delay_ms)
     VALUES ($1, $2, now(), COALESCE($3, 1000))
     ON CONFLICT (domain) DO UPDATE SET
       pages_crawled = domain_stats.pages_crawled + $2,
       last_fetched_at = now(),
       crawl_delay_ms = COALESCE($3, domain_stats.crawl_delay_ms)`,
    [domain, success ? 1 : 0, crawlDelayMs || null]
  );
}

async function setDomainDisallowed(domain) {
  await pool.query(
    `INSERT INTO domain_stats (domain, disallowed)
     VALUES ($1, true)
     ON CONFLICT (domain) DO UPDATE SET disallowed = true`,
    [domain]
  );
}

async function queueDepth() {
  const { rows } = await pool.query(
    `SELECT status, count(*) FROM crawl_queue GROUP BY status`
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}

module.exports = {
  enqueueUrls,
  claimNextUrl,
  markDone,
  markFailed,
  markDisallowed,
  touchDomain,
  setDomainDisallowed,
  queueDepth
};
