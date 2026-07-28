const crypto = require('crypto');
const { pool } = require('../../db/pool');
const { tokenize, countFrequencies } = require('./tokenize');

function hashBody(bodyText) {
  return crypto.createHash('sha256').update(bodyText || '').digest('hex');
}

/**
 * Indexes (or re-indexes) one crawled page.
 * @param {object} page - { url, domain, title, snippet, bodyText }
 * @returns {'inserted'|'updated'|'unchanged'|'skipped'}
 */
async function indexDocument(page) {
  const { url, domain, title, snippet, bodyText } = page;
  if (!url || !bodyText) return 'skipped';

  const contentHash = hashBody(bodyText);
  const titleTerms = tokenize(title || '');
  const bodyTerms = tokenize(bodyText);
  const bodyLength = bodyTerms.length;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id, content_hash, body_length FROM documents WHERE url = $1',
      [url]
    );

    let documentId;
    let mode;
    let lengthDelta;

    if (existing.rows.length === 0) {
      const inserted = await client.query(
        `INSERT INTO documents (url, domain, title, snippet, body_length, content_hash, crawled_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         RETURNING id`,
        [url, domain, title || url, snippet || '', bodyLength, contentHash]
      );
      documentId = inserted.rows[0].id;
      mode = 'inserted';
      lengthDelta = bodyLength;
    } else {
      const row = existing.rows[0];
      documentId = row.id;

      if (row.content_hash === contentHash) {
        // Page hasn't changed since last crawl - just bump crawled_at and move on.
        await client.query('UPDATE documents SET crawled_at = now() WHERE id = $1', [documentId]);
        await client.query('COMMIT');
        return 'unchanged';
      }

      lengthDelta = bodyLength - row.body_length;
      await client.query(
        `UPDATE documents
         SET title = $1, snippet = $2, body_length = $3, content_hash = $4,
             crawled_at = now(), updated_at = now()
         WHERE id = $5`,
        [title || url, snippet || '', bodyLength, contentHash, documentId]
      );
      // Content changed, so the old postings for this doc are stale - drop and rebuild them.
      await client.query('DELETE FROM postings WHERE document_id = $1', [documentId]);
      mode = 'updated';
    }

    const titleCounts = countFrequencies(titleTerms);
    const bodyCounts = countFrequencies(bodyTerms);
    const allTerms = new Set([...titleCounts.keys(), ...bodyCounts.keys()]);

    if (allTerms.size > 0) {
      const values = [];
      const params = [];
      let i = 1;
      for (const term of allTerms) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(term, documentId, bodyCounts.get(term) || 0, titleCounts.get(term) || 0);
      }
      await client.query(
        `INSERT INTO postings (term, document_id, tf_body, tf_title) VALUES ${values.join(', ')}`,
        params
      );
    }

    await client.query(
      `UPDATE index_stats
       SET doc_count = doc_count + $1, total_length = total_length + $2
       WHERE id = 1`,
      [mode === 'inserted' ? 1 : 0, lengthDelta]
    );

    await client.query('COMMIT');
    return mode;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[Indexer] Failed to index ${url}:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { indexDocument, hashBody };
