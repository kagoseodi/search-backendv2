require('dotenv').config();
const frontier = require('../src/crawler/frontier');
const { processQueuedUrl, seedQueue } = require('../src/crawler/crawler');
const { search } = require('../src/search/search');
const { pool } = require('../db/pool');

async function main() {
  console.log('--- Seeding frontier with a real page ---');
  const added = await seedQueue(['https://github.com/kagoseodi/search-backend']);
  console.log(`  Enqueued: ${added}`);

  console.log('\n--- Claiming and processing it ---');
  const item = await frontier.claimNextUrl({ maxPagesPerDomain: 200 });
  console.log('  Claimed:', item);

  const result = await processQueuedUrl(item);
  console.log('  Result:', result);

  console.log('\n--- Queue state after processing (should show discovered outlinks) ---');
  console.log('  ', await frontier.queueDepth());

  console.log('\n--- Searching the newly indexed page ---');
  const results = await search('search backend crawler');
  results.results.forEach((r) => console.log(`  [${r.score}] ${r.title} - ${r.url}`));

  await pool.end();
}

main().catch((err) => {
  console.error('LIVE TEST FAILED:', err);
  process.exit(1);
});
