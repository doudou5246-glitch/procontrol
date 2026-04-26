require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 10000;
const ADMIN_PASS = "Admin2026!";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   STATIC FILES
========================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   TEST DB
========================= */

pool.connect()
  .then(() => console.log("✅ Neon connecté"))
  .catch(err => console.log("❌ Neon erreur :", err));

/* =========================
   INIT TABLES
========================= */

async function initDB() {
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
}

initDB();

/* =========================
   PUBLIC ROUTES APP
========================= */

/* créer profil depuis appli */
app.post("/api/register", async (req, res) => {
  try {
    const { nom, pin } = req.body;

    if (!nom || !pin) {
      return res.json({ ok: false, msg: "Nom + PIN requis" });
    }

    await pool.query(
      "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
      [nom, pin]
    );

    res.json({ ok: true });

  } catch (e) {
    res.json({ ok: false, msg: "Erreur register" });
  }
});

/* connexion appli */
app.post("/api/login", async (req, res) => {
  try {
    const { nom, pin } = req.body;

    const r = await pool.query(
      "SELECT * FROM users WHERE nom=$1 AND pin=$2",
      [nom, pin]
    );

    res.json({ ok: r.rows.length > 0 });

  } catch (e) {
    res.json({ ok: false });
  }
});

/* liste outils */
app.get("/api/tools", async (req, res) => {
  const r = await pool.query("SELECT * FROM tools ORDER BY nom ASC");
  res.json(r.rows);
});

/* prendre outil */
app.post("/api/take-tool", async (req, res) => {
  try {
    const { nom, outil } = req.body;

    const r = await pool.query(
      "SELECT * FROM tools WHERE LOWER(nom)=LOWER($1)",
      [outil]
    );

    if (!r.rows.length) {
      return res.json({ ok: false, msg: "Outil introuvable" });
    }

    if (r.rows[0].en_cours) {
      return res.json({ ok: false, msg: "Déjà pris" });
    }

    await pool.query(
      `UPDATE tools
       SET emprunteur=$1,
           en_cours=true,
           date_sortie=$2
       WHERE LOWER(nom)=LOWER($3)`,
      [nom, new Date().toLocaleString("fr-FR"), outil]
    );

    res.json({ ok: true });

  } catch (e) {
    res.json({ ok: false });
  }
});

/* rendre outil */
app.post("/api/return-tool", async (req, res) => {
  try {
    const { outil } = req.body;

    await pool.query(
      `UPDATE tools
       SET emprunteur='',
           en_cours=false,
           date_sortie=''
       WHERE LOWER(nom)=LOWER($1)`,
      [outil]
    );

    res.json({ ok: true });

  } catch (e) {
    res.json({ ok: false });
  }
});

/* =========================
   ADMIN ROUTES
========================= */

function checkAdmin(req) {
  return req.query.pass === ADMIN_PASS || req.body.pass === ADMIN_PASS;
}

/* dashboard admin */
app.get("/api/admin", async (req, res) => {
  if (!checkAdmin(req)) {
    return res.send("Accès refusé");
  }

  const users = await pool.query("SELECT * FROM users ORDER BY nom ASC");
  const tools = await pool.query("SELECT * FROM tools ORDER BY nom ASC");

  res.json({
    users: users.rows,
    tools: tools.rows
  });
});

/* ajout outil */
app.get("/api/add-tool", async (req, res) => {
  if (!checkAdmin(req)) {
    return res.send("Accès refusé");
  }

  const nom = req.query.nom;

  await pool.query(
    "INSERT INTO tools(nom) VALUES($1) ON CONFLICT (nom) DO NOTHING",
    [nom]
  );

  res.send("OK");
});

/* suppression outil */
app.get("/api/delete-tool", async (req, res) => {
  if (!checkAdmin(req)) {
    return res.send("Accès refusé");
  }

  await pool.query(
    "DELETE FROM tools WHERE id=$1",
    [req.query.id]
  );

  res.send("OK");
});

/* ajout user admin */
app.get("/api/add-user-admin", async (req, res) => {
  if (!checkAdmin(req)) {
    return res.send("Accès refusé");
  }

  await pool.query(
    "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
    [req.query.nom, req.query.pin]
  );

  res.send("OK");
});

/* delete user */
app.get("/api/delete-user", async (req, res) => {
  if (!checkAdmin(req)) {
    return res.send("Accès refusé");
  }

  await pool.query(
    "DELETE FROM users WHERE nom=$1",
    [req.query.nom]
  );

  res.send("OK");
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("🚀 ProControl lancé sur port " + PORT);
});
