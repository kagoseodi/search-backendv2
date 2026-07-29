require('dotenv').config();
const { runCrawlLoop, seedQueue } = require('./src/crawler/crawler');
const { migrate } = require('./db/migrate');

const PAGE_BUDGET_PER_BATCH = Number(process.env.CRAWL_PAGE_BUDGET || 50);
const MAX_PAGES_PER_DOMAIN = Number(process.env.CRAWL_MAX_PAGES_PER_DOMAIN || 200);
const MIN_DELAY_MS = Number(process.env.CRAWL_MIN_DELAY_MS || 300);
const BATCH_PAUSE_MS = Number(process.env.CRAWL_BATCH_PAUSE_MS || 5000);

const SEED_URLS = require('./seed_list.json');

/**
 * This is meant to run as a Render "Background Worker" service - a process
 * with no HTTP port that just runs continuously. Keeping the crawler out of
 * the web service means a big crawl run can never block or time out a
 * search request.
 */
async function main() {
  await migrate();

  const added = await seedQueue(SEED_URLS);
  console.log(`[Worker] Seeded ${added} new URL(s) from seed_list.json.`);

  console.log('[Worker] Starting continuous crawl loop. Ctrl+C to stop.');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { processed } = await runCrawlLoop({
      pageBudget: PAGE_BUDGET_PER_BATCH,
      maxPagesPerDomain: MAX_PAGES_PER_DOMAIN,
      minDelayMs: MIN_DELAY_MS
    });

    if (processed === 0) {
      console.log(`[Worker] Frontier looks empty or stalled. Sleeping ${BATCH_PAUSE_MS}ms before retrying.`);
    }
    await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
