require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./db/pool');
const { search } = require('./src/search/search');
const { migrate } = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // required to hit the seeding endpoint

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || req.query.query || '').trim();
  if (!query) return res.json({ query: '', totalHits: 0, results: [] });

  try {
    const result = await search(query, Number(req.query.limit) || 20);
    res.json(result);
  } catch (err) {
    console.error('[API] /api/search failed:', err.message);
    res.status(500).json({ error: 'Search failed. Please try again shortly.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT doc_count, total_length FROM index_stats WHERE id = 1');
    const queue = await pool.query(`SELECT status, count(*) FROM crawl_queue GROUP BY status`);
    res.json({
      indexedDocuments: Number(rows[0]?.doc_count || 0),
      queue: Object.fromEntries(queue.rows.map((r) => [r.status, Number(r.count)]))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lets you add new seed URLs to the crawl frontier without redeploying the
// worker. Protected by a shared-secret header since it's a write endpoint.
app.post('/api/seed', async (req, res) => {
  if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
  if (urls.length === 0) return res.status(400).json({ error: 'Provide { urls: string[] }' });

  const { seedQueue } = require('./src/crawler/crawler');
  const added = await seedQueue(urls);
  res.json({ added });
});

// Frontend catch-all - keep this last.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await migrate(); // idempotent - safe to run on every boot
  app.listen(PORT, HOST, () => {
    console.log(`Search engine web server listening on http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
