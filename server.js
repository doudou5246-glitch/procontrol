const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================= DATABASE ================= */

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE,
      pin TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      nom TEXT,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false,
      date_sortie TIMESTAMP
    );
  `);
}

/* ================= USER ================= */

app.get('/api/add-user', async (req, res) => {
  const { nom, pin } = req.query;

  if (!nom || !pin) return res.send("❌ manquant");

  await pool.query(`
    INSERT INTO users (nom, pin)
    VALUES ($1, $2)
    ON CONFLICT (nom) DO NOTHING
  `, [nom, pin]);

  res.send("✅ utilisateur ok");
});

/* ================= TOOL ================= */

app.get('/api/add-tool', async (req, res) => {
  const { nom } = req.query;

  await pool.query(`
    INSERT INTO tools (nom) VALUES ($1)
  `, [nom]);

  res.send("outil ajouté");
});

/* ================= TAKE ================= */

app.get('/api/take', async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await pool.query(
    'SELECT * FROM users WHERE nom=$1 AND pin=$2',
    [nom, pin]
  );

  if (user.rows.length === 0) {
    await pool.query(`
      INSERT INTO users (nom, pin)
      VALUES ($1, $2)
      ON CONFLICT (nom) DO NOTHING
    `, [nom, pin]);
  }

  await pool.query(`
    UPDATE tools
    SET emprunteur=$1, en_cours=true, date_sortie=NOW()
    WHERE id=$2
  `, [nom, id]);

  res.send("✅ pris");
});

/* ================= RETURN ================= */

app.get('/api/return', async (req, res) => {
  const { id } = req.query;

  await pool.query(`
    UPDATE tools
    SET emprunteur=NULL, en_cours=false
    WHERE id=$1
  `, [id]);

  res.send("✅ rendu");
});

/* ================= ADMIN ================= */

app.get('/api/admin', async (req, res) => {
  const tools = await pool.query('SELECT * FROM tools ORDER BY id');
  const users = await pool.query('SELECT * FROM users ORDER BY nom');

  res.json({
    tools: tools.rows,
    users: users.rows
  });
});

/* ================= QR CODE ================= */

app.get('/qrcode/:id', async (req, res) => {
  const id = req.params.id;

  const url = `${req.protocol}://${req.get('host')}/outil.html?id=${id}`;
  const qr = await QRCode.toDataURL(url);

  res.send(`
    <h1>QR Code outil ${id}</h1>
    <img src="${qr}" />
    <p>${url}</p>
  `);
});

/* ================= START ================= */

initDb().then(() => {
  app.listen(3000, () => console.log("OK"));
});
