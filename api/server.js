const express = require('express');
const { Pool } = require('pg');

const PORT = process.env.API_PORT || 3000;
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'appuser',
  password: process.env.DB_PASSWORD || 'changeme',
});

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (e) {
    res.status(503).json({ status: 'not ready', error: e.message });
  }
});

app.get('/tasks', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id');
  res.json(rows);
});

app.post('/tasks', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { rows } = await pool.query(
    'INSERT INTO tasks(title) VALUES($1) RETURNING *', [title]
  );
  res.status(201).json(rows[0]);
});

app.put('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, done } = req.body;
  const { rows } = await pool.query(
    `UPDATE tasks SET title = COALESCE($1, title),
                      done  = COALESCE($2, done)
     WHERE id = $3 RETURNING *`,
    [title, done, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

app.delete('/tasks/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('schema ready');
}

migrate()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`API on :${PORT} (db=${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME})`);
  }))
  .catch(err => { console.error('migration failed', err); process.exit(1); });