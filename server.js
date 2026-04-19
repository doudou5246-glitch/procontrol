const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {

  // USERS
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL
    );
  `);

  // TOOLS
  await query(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      nom TEXT,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false,
      date_sortie TIMESTAMP
    );
  `);

  // AJOUT USER TEST
  await query(`
    INSERT INTO users (nom, pin)
    VALUES ('Pierre', '1234')
    ON CONFLICT (nom) DO NOTHING;
  `);

  // AJOUT OUTIL TEST
  await query(`
    INSERT INTO tools (nom)
    VALUES ('Perceuse')
    ON CONFLICT DO NOTHING;
  `);
}

app.get("/api/tools", async (req, res) => {
  const result = await query("SELECT * FROM tools");
  res.json(result.rows);
});

app.get("/api/take", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ Code incorrect");
  }

  const tool = await query(
    "SELECT * FROM tools WHERE id=$1",
    [id]
  );

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

  res.send("✅ Pris par " + nom);
});

app.get("/api/return", async (req, res) => {
  const { id, nom, pin } = req.query;

  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ Code incorrect");
  }

  const tool = await query(
    "SELECT * FROM tools WHERE id=$1",
    [id]
  );

  if (!tool.rows.length) {
    return res.send("❌ Outil introuvable");
  }

  if (tool.rows[0].emprunteur !== nom) {
    return res.send("❌ Pas ton outil");
  }

  await query(
    "UPDATE tools SET emprunteur=NULL, en_cours=false WHERE id=$1",
    [id]
  );

  res.send("✅ Rendu");
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log("Serveur lancé !");
    });
  })
  .catch(err => {
    console.error(err);
  });
