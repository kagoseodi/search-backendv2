const { pool } = require('../../db/pool');
const { tokenizeQuery } = require('../indexer/tokenize');
const { scoreDocuments } = require('./bm25');

// Safety cap per term so one extremely common word can't pull the whole
// index into memory. This trades a little ranking precision on very broad
// queries for predictable memory/latency.
const MAX_POSTINGS_PER_TERM = 5000;
const DEFAULT_LIMIT = 20;

async function getIndexStats() {
  const { rows } = await pool.query('SELECT doc_count, total_length FROM index_stats WHERE id = 1');
  const { doc_count, total_length } = rows[0] || { doc_count: 0, total_length: 0 };
  const docCount = Number(doc_count) || 0;
  const totalLength = Number(total_length) || 0;
  const avgDocLength = docCount > 0 ? totalLength / docCount : 0;
  return { docCount, avgDocLength };
}

/**
 * Runs a BM25-ranked search against the local index.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<{query:string, totalHits:number, results:object[]}>}
 */
async function search(query, limit = DEFAULT_LIMIT) {
  const terms = [...new Set(tokenizeQuery(query))];
  if (terms.length === 0) {
    return { query, totalHits: 0, results: [] };
  }

  const { docCount, avgDocLength } = await getIndexStats();
  if (docCount === 0) {
    return { query, totalHits: 0, results: [] };
  }

  // Pull all postings for the query terms, capped per term, joined with the
  // document metadata we'll need to render results.
  const { rows } = await pool.query(
    `SELECT term, document_id, tf_body, tf_title
     FROM (
       SELECT term, document_id, tf_body, tf_title,
              row_number() OVER (PARTITION BY term ORDER BY tf_body + tf_title DESC) AS rn
       FROM postings
       WHERE term = ANY($1::text[])
     ) ranked
     WHERE rn <= $2`,
    [terms, MAX_POSTINGS_PER_TERM]
  );

  if (rows.length === 0) {
    return { query, totalHits: 0, results: [] };
  }

  const postingsByTerm = new Map();
  const docIds = new Set();
  for (const row of rows) {
    if (!postingsByTerm.has(row.term)) postingsByTerm.set(row.term, new Map());
    postingsByTerm.get(row.term).set(row.document_id, {
      tfBody: row.tf_body,
      tfTitle: row.tf_title
    });
    docIds.add(row.document_id);
  }

  const docsResult = await pool.query(
    `SELECT id, url, title, snippet, body_length FROM documents WHERE id = ANY($1::bigint[])`,
    [[...docIds]]
  );

  const docLengths = new Map();
  const docMeta = new Map();
  for (const doc of docsResult.rows) {
    docLengths.set(doc.id, doc.body_length);
    docMeta.set(doc.id, doc);
  }

  const scores = scoreDocuments(terms, postingsByTerm, docLengths, docCount, avgDocLength);

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const results = ranked.map(([documentId, score]) => {
    const doc = docMeta.get(documentId);
    return {
      id: `idx-${documentId}`,
      url: doc.url,
      title: doc.title,
      snippet: doc.snippet,
      score: Math.round(score * 1000) / 1000,
      source: 'web'
    };
  });

  return { query, totalHits: scores.size, results };
}

module.exports = { search };
