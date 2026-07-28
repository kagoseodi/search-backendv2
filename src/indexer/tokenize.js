const { stemmer } = require('stemmer');

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'did', 'do', 'does', 'doing', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'he',
  'her', 'here', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me',
  'more', 'most', 'my', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'with', 'would', 'you', 'your'
]);

/**
 * Turns raw text into an array of index-ready terms:
 * lowercase -> split on non-alphanumerics -> drop stopwords -> stem.
 * Stemming means "running", "runs", "ran"(ish) collapse toward "run", so a
 * search for "run" also matches pages that only say "running".
 */
function tokenize(text) {
  if (!text) return [];
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const withoutStopWords = raw.filter((w) => !STOP_WORDS.has(w) && w.length > 1);
  return withoutStopWords.map((w) => stemmer(w));
}

/**
 * Tokenizes a search query. If every term happens to be a stopword (e.g. the
 * query IS "the"), fall back to the raw terms rather than returning nothing.
 */
function tokenizeQuery(text) {
  const raw = (text.toLowerCase().match(/[a-z0-9]+/g) || []);
  const filtered = raw.filter((w) => !STOP_WORDS.has(w) && w.length > 1);
  const terms = filtered.length > 0 ? filtered : raw;
  return terms.map((w) => stemmer(w));
}

/** Counts occurrences of each item in an array. */
function countFrequencies(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  return counts;
}

module.exports = { tokenize, tokenizeQuery, countFrequencies, STOP_WORDS };
