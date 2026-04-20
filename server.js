const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(q, params=[]) {
  return pool.query(q, params);
}

// ================= DB INIT =================
async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false,
      date_sortie TIMESTAMP
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

// ================= USER AUTO =================
async function createUser(nom, pin) {
  await query(`
    INSERT INTO users (nom, pin)
    VALUES ($1, $2)
    ON CONFLICT (nom) DO NOTHING
  `, [nom, pin]);
}

// ================= ADD TOOL =================
app.get("/api/add-tool", async (req, res) => {
  const { nom } = req.query;
  if (!nom) return res.send("nom requis");

  const result = await query(
    "INSERT INTO tools (nom) VALUES ($1) RETURNING id",
    [nom]
  );

  res.send("outil créé ID=" + result.rows[0].id);
});

// ================= ADMIN =================
app.get("/api/admin", async (req, res) => {
  const tools = await query("SELECT * FROM tools ORDER BY id");
  const users = await query("SELECT nom FROM users ORDER BY nom");
  const mouvements = await query("SELECT * FROM mouvements ORDER BY id DESC LIMIT 20");

  res.json({
    tools: tools.rows,
    users: users.rows,
    mouvements: mouvements.rows
  });
});

// ================= PRENDRE =================
app.get("/api/take", async (req, res) => {
  const { id, nom, pin } = req.query;

  if (!id || !nom || !pin) return res.send("❌ champs requis");

  await createUser(nom, pin);

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ PIN incorrect");
  }

  const tool = await query("SELECT * FROM tools WHERE id=$1", [id]);

  if (!tool.rows.length) return res.send("❌ outil inexistant");

  if (tool.rows[0].en_cours) {
    return res.send("❌ déjà pris");
  }

  await query(
    "UPDATE tools SET emprunteur=$1, en_cours=true, date_sortie=NOW() WHERE id=$2",
    [nom, id]
  );

  await query(
    "INSERT INTO mouvements (tool_id, utilisateur, action) VALUES ($1,$2,'prise')",
    [id, nom]
  );

  res.send("✅ pris par " + nom);
});

// ================= RENDRE =================
app.get("/api/return", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ PIN incorrect");
  }

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

// ================= QR CODE =================
app.get('/qrcode/:id', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/outil.html?id=${req.params.id}`;
  const qr = await QRCode.toDataURL(url);

  res.send(`
    <h1>QR outil ${req.params.id}</h1>
    <img src="${qr}">
    <p>${url}</p>
  `);
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, () => console.log("Serveur OK"));
});
