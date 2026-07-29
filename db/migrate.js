const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  console.log('[Migrate] Applying schema.sql...');
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('[Migrate] Schema applied successfully.');
  } finally {
    client.release();
  }
}

// Allow running directly: node db/migrate.js
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error('[Migrate] Failed:', err);
      process.exit(1);
    });
}

module.exports = { migrate };
