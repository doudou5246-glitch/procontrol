const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= INIT DB =================
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

// ================= ADD USER =================
app.get('/api/add-user', async (req, res) => {
  try {
    const { nom, pin } = req.query;

    await pool.query(`
      INSERT INTO users (nom, pin)
      VALUES ($1, $2)
      ON CONFLICT (nom) DO NOTHING
    `, [nom, pin]);

    res.send("✅ utilisateur ok");
  } catch (e) {
    res.send("❌ erreur user");
  }
});

// ================= ADD TOOL =================
app.get('/api/add-tool', async (req, res) => {
  try {
    const { nom } = req.query;

    const result = await pool.query(
      "INSERT INTO tools (nom) VALUES ($1) RETURNING id",
      [nom]
    );

    res.send("✅ outil ID=" + result.rows[0].id);
  } catch (e) {
    res.send("❌ erreur tool");
  }
});

// ================= TAKE =================
app.get('/api/take', async (req, res) => {
  try {
    const { id, nom, pin } = req.query;

    // créer user si besoin
    await pool.query(`
      INSERT INTO users (nom, pin)
      VALUES ($1, $2)
      ON CONFLICT (nom) DO NOTHING
    `, [nom, pin]);

    // vérifier PIN
    const user = await pool.query(
      "SELECT * FROM users WHERE nom=$1 AND pin=$2",
      [nom, pin]
    );

    if (user.rows.length === 0) {
      return res.send("❌ PIN incorrect");
    }

    // vérifier outil
    const tool = await pool.query(
      "SELECT * FROM tools WHERE id=$1",
      [id]
    );

    if (!tool.rows.length) {
      return res.send("❌ outil introuvable");
    }

    if (tool.rows[0].en_cours) {
      return res.send("❌ Déjà pris par " + tool.rows[0].emprunteur);
    }

    // prise
    await pool.query(`
      UPDATE tools
      SET emprunteur=$1, en_cours=true, date_sortie=NOW()
      WHERE id=$2
    `, [nom, id]);

    res.send("✅ Pris");
  } catch (e) {
    console.error(e);
    res.send("❌ erreur serveur");
  }
});

// ================= RETURN =================
app.get('/api/return', async (req, res) => {
  try {
    const { id } = req.query;

    await pool.query(`
      UPDATE tools
      SET emprunteur=NULL, en_cours=false
      WHERE id=$1
    `, [id]);

    res.send("✅ Rendu");
  } catch (e) {
    res.send("❌ erreur retour");
  }
});

// ================= ADMIN =================
app.get('/api/admin', async (req, res) => {
  try {
    const tools = await pool.query("SELECT * FROM tools ORDER BY id");
    const users = await pool.query("SELECT * FROM users ORDER BY nom");

    res.json({
      tools: tools.rows,
      users: users.rows
    });
  } catch (e) {
    res.json({ tools: [], users: [] });
  }
});

// ================= QR =================
app.get('/qrcode/:id', async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/outil.html?id=${req.params.id}`;
  const qr = await QRCode.toDataURL(url);

  res.send(`<h2>QR ${req.params.id}</h2><img src="${qr}">`);
});

// ================= START =================
initDb().then(() => {
  app.listen(3000, () => console.log("SERVEUR OK"));
});
