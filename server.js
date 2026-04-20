const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================= DB =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params = []) {
  return pool.query(text, params);
}

// ================= INIT DB =================
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
      nom TEXT,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false,
      date_sortie TIMESTAMP
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      outil_id INTEGER,
      utilisateur TEXT,
      action TEXT,
      date TIMESTAMP DEFAULT NOW()
    );
  `);
}

// ================= PAGE HOME =================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ================= LOGIN AUTO =================
app.get("/api/login", async (req, res) => {
  const { nom, pin } = req.query;

  let user = await query("SELECT * FROM users WHERE nom=$1", [nom]);

  if (user.rows.length === 0) {
    await query("INSERT INTO users (nom, pin) VALUES ($1,$2)", [nom, pin]);
    return res.send("✅ Compte créé");
  }

  if (user.rows[0].pin !== pin) {
    return res.send("❌ Mauvais PIN");
  }

  res.send("✅ Connecté");
});

// ================= PRENDRE OUTIL =================
app.get("/api/take", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ Code incorrect");
  }

  const tool = await query("SELECT * FROM tools WHERE id=$1", [id]);

  if (!tool.rows.length) {
    return res.send("❌ Outil introuvable");
  }

  if (tool.rows[0].en_cours) {
    return res.send("❌ Déjà pris");
  }

  await query(
    "UPDATE tools SET emprunteur=$1, en_cours=true, date_sortie=NOW() WHERE id=$2",
    [nom, id]
  );

  await query(
    "INSERT INTO mouvements (outil_id, utilisateur, action) VALUES ($1,$2,'prise')",
    [id, nom]
  );

  res.send("✅ Pris par " + nom);
});

// ================= RENDRE OUTIL =================
app.get("/api/return", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ Code incorrect");
  }

  const tool = await query("SELECT * FROM tools WHERE id=$1", [id]);

  if (tool.rows[0].emprunteur !== nom) {
    return res.send("❌ Pas ton outil");
  }

  await query(
    "UPDATE tools SET emprunteur=NULL, en_cours=false WHERE id=$1",
    [id]
  );

  await query(
    "INSERT INTO mouvements (outil_id, utilisateur, action) VALUES ($1,$2,'retour')",
    [id, nom]
  );

  res.send("✅ Rendu");
});

// ================= CREER OUTIL =================
app.get("/api/create-tool", async (req, res) => {
  const { nom } = req.query;

  const result = await query(
    "INSERT INTO tools (nom) VALUES ($1) RETURNING id",
    [nom]
  );

  const id = result.rows[0].id;

  res.send(`
    <h2>Outil créé ✅</h2>
    <p>${nom}</p>
    <a href="/qrcode/${id}">📱 QR CODE</a>
  `);
});

// ================= QR CODE =================
app.get("/qrcode/:id", async (req, res) => {
  const id = req.params.id;

  const url = `https://${req.get('host')}/outil.html?id=${id}`;

  const qr = await QRCode.toDataURL(url);

  res.send(`
    <html>
    <body style="text-align:center;font-family:Arial">
      <h2>QR Code outil ${id}</h2>
      <img src="${qr}" width="300"/>
      <p>${url}</p>
    </body>
    </html>
  `);
});

// ================= ADMIN =================
app.get("/api/admin", async (req, res) => {
  const tools = await query("SELECT * FROM tools ORDER BY id");
  const logs = await query("SELECT * FROM mouvements ORDER BY id DESC");

  res.json({
    tools: tools.rows,
    mouvements: logs.rows
  });
});

// ================= START =================
const PORT = process.env.PORT || 10000;

// ajouter user
app.get("/api/add-user", async (req, res) => {
  const { nom, pin } = req.query;
  await query("INSERT INTO users (nom, pin) VALUES ($1,$2)", [nom, pin]);
  res.send("user ajouté");
});

// supprimer user
app.get("/api/delete-user", async (req, res) => {
  const { nom } = req.query;
  await query("DELETE FROM users WHERE nom=$1", [nom]);
  res.send("user supprimé");
});

// modifier add-tool pour prendre nom dynamique
app.get("/api/add-tool", async (req, res) => {
  const { nom } = req.query;

  await query(`
    INSERT INTO tools (nom, en_cours)
    VALUES ($1, false)
  `, [nom]);

  res.send("outil ajouté");
});

// ADMIN complet
app.get("/api/admin", async (req, res) => {
  const tools = await query("SELECT * FROM tools");
  const users = await query("SELECT * FROM users");

  res.json({
    tools: tools.rows,
    users: users.rows
  });

initDb().then(() => {
  app.listen(PORT, () => {
    console.log("Serveur OK sur port", PORT);
  });
});
