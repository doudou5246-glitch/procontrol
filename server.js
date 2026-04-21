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

async function query(q, params=[]) {
  try {
    return await pool.query(q, params);
  } catch (e) {
    console.error("DB ERROR:", e.message);
    return { rows: [] };
  }
}

// ================= INIT =================
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE,
      pin TEXT
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      nom TEXT,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      tool_id INTEGER,
      utilisateur TEXT,
      action TEXT,
      date TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ================= ADD USER =================
app.get("/api/add-user", async (req, res) => {
  const { nom, pin } = req.query;

  if (!nom || !pin) return res.send("❌ champs requis");

 await pool.query(`
INSERT INTO users (nom, pin)
VALUES ($1, $2)
ON CONFLICT (nom) DO NOTHING
`, [nom, pin]);

  res.send("✅ utilisateur OK");
});

// ================= ADD TOOL =================
app.get("/api/add-tool", async (req, res) => {
  const { nom } = req.query;

  if (!nom) return res.send("❌ nom requis");

  const result = await query(
    "INSERT INTO tools (nom) VALUES ($1) RETURNING id",
    [nom]
  );

  res.send("✅ outil ID=" + result.rows[0]?.id);
});

// ================= PRENDRE =================
app.get('/api/take', async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await pool.query(
    'SELECT * FROM users WHERE nom=$1 AND pin=$2',
    [nom, pin]
  );

  if (user.rows.length === 0) {
    // création auto
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

  res.send("✅ Pris");
});

// ================= RENDRE =================
app.get("/api/return", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) return res.send("❌ PIN incorrect");

  await query(
    "UPDATE tools SET emprunteur=NULL, en_cours=false WHERE id=$1",
    [id]
  );

  await query(
    "INSERT INTO mouvements (tool_id, utilisateur, action) VALUES ($1,$2,'retour')",
    [id, nom]
  );

  res.send("✅ rendu");
});

// ================= ADMIN =================
app.get("/api/admin", async (req, res) => {
  const tools = await query("SELECT * FROM tools ORDER BY id");
  const users = await query("SELECT * FROM users");
  const mouvements = await query("SELECT * FROM mouvements ORDER BY id DESC");

  res.json({
    tools: tools.rows,
    users: users.rows,
    mouvements: mouvements.rows
  });
});

// ================= QR =================
app.get("/qrcode/:id", async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/outil.html?id=${req.params.id}`;
  const qr = await QRCode.toDataURL(url);

  res.send(`
    <h1>QR outil ${req.params.id}</h1>
    <img src="${qr}">
    <p>${url}</p>
  `);
});

// ================= START =================
const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Serveur OK");
  });
});
