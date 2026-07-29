const assert = require('assert');
const { normalizeUrl, getDomain } = require('../src/crawler/urlUtils');
const robotsParser = require('robots-parser');

console.log('--- URL normalization ---');
const cases = [
  ['/about', 'https://Example.com/page', 'https://example.com/about'],
  ['https://example.com/page#section', 'https://example.com', 'https://example.com/page'],
  ['https://example.com/page/', 'https://example.com', 'https://example.com/page'],
  ['https://example.com/page?utm_source=x&b=2', 'https://example.com', 'https://example.com/page?b=2'],
  ['mailto:someone@example.com', 'https://example.com', null],
  ['javascript:void(0)', 'https://example.com', null]
];
for (const [href, base, expected] of cases) {
  const result = normalizeUrl(href, base);
  assert.strictEqual(result, expected, `normalizeUrl(${href}) => ${result}, expected ${expected}`);
  console.log(`  OK: ${href} -> ${result}`);
}
assert.strictEqual(getDomain('https://Example.com/x'), 'example.com');
console.log('  OK: getDomain lowercases host');

console.log('\n--- robots.txt parsing ---');
const robotsTxt = `
User-agent: *
Disallow: /private/
Crawl-delay: 2

User-agent: GoseodiBot
Disallow: /no-bots-allowed/
`;
const parser = robotsParser('https://example.com/robots.txt', robotsTxt);
assert.strictEqual(parser.isAllowed('https://example.com/public/page', 'GoseodiBot/1.0'), true);
assert.strictEqual(parser.isAllowed('https://example.com/no-bots-allowed/x', 'GoseodiBot/1.0'), false);
// A GoseodiBot-specific group fully overrides the wildcard group (per the robots.txt
// spec, the most specific matching group wins rather than merging) - so /private/
// only applies to '*', not to GoseodiBot, which has no rule against it.
assert.strictEqual(parser.isAllowed('https://example.com/private/page', 'GoseodiBot/1.0'), true);
// A generic crawler with no dedicated group falls under '*' and IS blocked from /private/.
assert.strictEqual(parser.isAllowed('https://example.com/private/page', 'SomeOtherBot/1.0'), false);
console.log('  OK: allow/disallow rules respected, including group-specificity precedence');

console.log('\nAll crawler-utility tests passed.');
