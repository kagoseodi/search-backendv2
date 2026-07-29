require('dotenv').config();
const { indexDocument } = require('../src/indexer/indexer');
const { search } = require('../src/search/search');
const { pool } = require('../db/pool');

const pages = [
  {
    url: 'https://example.com/js-intro',
    domain: 'example.com',
    title: 'Introduction to JavaScript Programming',
    snippet: 'Learn the basics of JavaScript.',
    bodyText: 'JavaScript is a programming language used to make websites interactive. ' +
      'JavaScript runs in the browser and on servers via Node.js. Learning JavaScript is a great first step for web development.'
  },
  {
    url: 'https://example.com/python-intro',
    domain: 'example.com',
    title: 'Introduction to Python Programming',
    snippet: 'Learn the basics of Python.',
    bodyText: 'Python is a programming language known for readability. Python is widely used in data science, ' +
      'automation, and web development with frameworks like Django and Flask.'
  },
  {
    url: 'https://example.com/cooking',
    domain: 'example.com',
    title: 'How to Bake Bread at Home',
    snippet: 'A simple bread recipe.',
    bodyText: 'Baking bread at home requires flour, water, yeast, and salt. Kneading the dough develops gluten. ' +
      'Bake at a high temperature for a crusty loaf.'
  },
  {
    url: 'https://example.com/web-dev-general',
    domain: 'example.com',
    title: 'Web Development Overview',
    snippet: 'A broad look at building websites.',
    bodyText: 'Web development involves HTML, CSS, and JavaScript. Backend web development often uses languages ' +
      'like Python, JavaScript (Node.js), or Ruby. Search engines crawl and index the web to power search.'
  }
];

async function main() {
  console.log('--- Indexing synthetic pages ---');
  for (const page of pages) {
    const mode = await indexDocument(page);
    console.log(`  ${mode}: ${page.url}`);
  }

  console.log('\n--- Re-indexing the same JS page (should be "unchanged") ---');
  console.log('  ', await indexDocument(pages[0]));

  console.log('\n--- Query: "javascript" ---');
  console.log(JSON.stringify(await search('javascript'), null, 2));

  console.log('\n--- Query: "programming language" ---');
  const r2 = await search('programming language');
  r2.results.forEach((r) => console.log(`  [${r.score}] ${r.title} - ${r.url}`));

  console.log('\n--- Query: "bread" (should NOT match JS/Python pages) ---');
  const r3 = await search('bread');
  r3.results.forEach((r) => console.log(`  [${r.score}] ${r.title} - ${r.url}`));

  console.log('\n--- Query: "the a an" (all stopwords) ---');
  console.log(JSON.stringify(await search('the a an'), null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
