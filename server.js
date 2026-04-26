require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   CONFIG
========================= */

const ADMIN_USER = "admin";
const ADMIN_PASS = "Admin2026!";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   EXPRESS
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   INIT DATABASE
========================= */

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tools (
      id BIGSERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      emprunteur TEXT DEFAULT '',
      en_cours BOOLEAN DEFAULT false,
      date_sortie TEXT DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      utilisateur TEXT,
      action TEXT,
      outil TEXT,
      date_action TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Neon connecté");
}

initDb();

/* =========================
   HELPERS
========================= */

function isAdmin(req) {
  return (
    req.query.user === ADMIN_USER &&
    req.query.pass === ADMIN_PASS
  );
}

/* =========================
   ADMIN LOGIN TEST
========================= */

app.get("/api/admin", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Accès refusé");

  const tools = await pool.query("SELECT * FROM tools ORDER BY id ASC");
  const users = await pool.query("SELECT * FROM users ORDER BY id ASC");
  const mouvements = await pool.query(`
    SELECT * FROM mouvements
    ORDER BY id DESC
    LIMIT 50
  `);

  res.json({
    tools: tools.rows,
    users: users.rows,
    mouvements: mouvements.rows
  });
});

/* =========================
   USERS
========================= */

app.get("/api/register", async (req, res) => {
  try {
    const { nom, pin } = req.query;
    if (!nom || !pin) return res.send("Nom ou PIN manquant");

    await pool.query(
      "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
      [nom.trim(), pin.trim()]
    );

    res.send("OK");
  } catch (e) {
    res.send("Erreur");
  }
});

app.get("/api/login", async (req, res) => {
  const { nom, pin } = req.query;

  const r = await pool.query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (r.rows.length) return res.send("OK");
  res.send("Utilisateur invalide");
});

/* =========================
   ADMIN USERS
========================= */

app.get("/api/add-user-admin", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const { nom, pin } = req.query;

  await pool.query(
    "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
    [nom, pin]
  );

  res.send("OK");
});

app.get("/api/delete-user", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const { nom } = req.query;

  await pool.query("DELETE FROM users WHERE nom=$1", [nom]);

  res.send("OK");
});

/* =========================
   TOOLS
========================= */

app.get("/api/add-tool", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const { nom } = req.query;

  await pool.query(
    "INSERT INTO tools(nom) VALUES($1) ON CONFLICT (nom) DO NOTHING",
    [nom]
  );

  res.send("OK");
});

app.get("/api/delete-tool", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const { id } = req.query;

  await pool.query("DELETE FROM tools WHERE id=$1", [id]);

  res.send("OK");
});

/* =========================
   PRENDRE OUTIL
========================= */

app.get("/api/take", async (req, res) => {
  const { nom, outil } = req.query;

  let r = await pool.query(
    "SELECT * FROM tools WHERE id::text=$1 OR LOWER(nom)=LOWER($1)",
    [outil]
  );

  if (!r.rows.length) return res.send("Outil introuvable");

  const t = r.rows[0];

  if (t.en_cours) return res.send("Déjà pris");

  await pool.query(`
    UPDATE tools
    SET en_cours=true,
        emprunteur=$1,
        date_sortie=$2
    WHERE id=$3
  `, [nom, new Date().toLocaleString("fr-FR"), t.id]);

  await pool.query(
    "INSERT INTO mouvements(utilisateur,action,outil) VALUES($1,$2,$3)",
    [nom, "PRISE", t.nom]
  );

  res.send("OK");
});

/* =========================
   RENDRE OUTIL
========================= */

app.get("/api/give", async (req, res) => {
  const { outil } = req.query;

  let r = await pool.query(
    "SELECT * FROM tools WHERE id::text=$1 OR LOWER(nom)=LOWER($1)",
    [outil]
  );

  if (!r.rows.length) return res.send("Outil introuvable");

  const t = r.rows[0];

  await pool.query(`
    UPDATE tools
    SET en_cours=false,
        emprunteur='',
        date_sortie=''
    WHERE id=$1
  `, [t.id]);

  await pool.query(
    "INSERT INTO mouvements(utilisateur,action,outil) VALUES($1,$2,$3)",
    [t.emprunteur, "RETOUR", t.nom]
  );

  res.send("OK");
});

/* =========================
   LISTES APP
========================= */

app.get("/api/tools", async (req, res) => {
  const r = await pool.query("SELECT * FROM tools ORDER BY nom ASC");
  res.json(r.rows);
});

app.get("/api/my-tools", async (req, res) => {
  const { nom } = req.query;

  const r = await pool.query(
    "SELECT * FROM tools WHERE emprunteur=$1 AND en_cours=true",
    [nom]
  );

  res.json(r.rows);
});

/* ========================= */

app.listen(PORT, () => {
  console.log("🚀 ProControl lancé sur port " + PORT);
});
