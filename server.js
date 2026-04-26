require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;
const ADMIN_PASS = "Admin2026!";

/* =========================
   NEON
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ Neon connecté"))
  .catch(err => console.log("❌ Neon erreur :", err));

/* =========================
   STATIC
========================= */
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   TABLES
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
   HELPERS
========================= */
function isAdmin(req) {
  return req.query.pass === ADMIN_PASS;
}

/* =========================
   APP ROUTES (compatibles HTML actuel)
========================= */

/* register */
app.get("/api/register", async (req, res) => {
  try {
    const { nom, pin } = req.query;

    if (!nom || !pin) return res.send("Erreur");

    await pool.query(
      "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
      [nom, pin]
    );

    res.send("OK");
  } catch {
    res.send("Erreur");
  }
});

/* login */
app.get("/api/login", async (req, res) => {
  try {
    const { nom, pin } = req.query;

    const r = await pool.query(
      "SELECT * FROM users WHERE nom=$1 AND pin=$2",
      [nom, pin]
    );

    if (r.rows.length) res.send("OK");
    else res.send("Erreur");
  } catch {
    res.send("Erreur");
  }
});

/* prendre outil */
app.get("/api/take-tool", async (req, res) => {
  try {
    const { user, tool } = req.query;

    const r = await pool.query(
      "SELECT * FROM tools WHERE LOWER(nom)=LOWER($1) OR id::text=$1",
      [tool]
    );

    if (!r.rows.length) return res.send("Outil introuvable");

    if (r.rows[0].en_cours) return res.send("Déjà pris");

    await pool.query(`
      UPDATE tools
      SET emprunteur=$1,
          en_cours=true,
          date_sortie=$2
      WHERE id=$3
    `, [
      user,
      new Date().toLocaleString("fr-FR"),
      r.rows[0].id
    ]);

    res.send("OK");

  } catch {
    res.send("Erreur");
  }
});

/* rendre outil */
app.get("/api/return-tool", async (req, res) => {
  try {
    const { tool } = req.query;

    await pool.query(`
      UPDATE tools
      SET emprunteur='',
          en_cours=false,
          date_sortie=''
      WHERE LOWER(nom)=LOWER($1) OR id::text=$1
    `, [tool]);

    res.send("OK");

  } catch {
    res.send("Erreur");
  }
});

/* liste outils */
app.get("/api/tools", async (req, res) => {
  const r = await pool.query("SELECT * FROM tools ORDER BY nom ASC");
  res.json(r.rows);
});

/* =========================
   ADMIN
========================= */

app.get("/api/admin", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const users = await pool.query("SELECT * FROM users ORDER BY nom ASC");
  const tools = await pool.query("SELECT * FROM tools ORDER BY nom ASC");

  res.json({
    users: users.rows,
    tools: tools.rows
  });
});

/* add tool */
app.get("/api/add-tool", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  const nom = req.query.nom;

  await pool.query(
    "INSERT INTO tools(nom) VALUES($1) ON CONFLICT (nom) DO NOTHING",
    [nom]
  );

  res.send("OK");
});

/* delete tool */
app.get("/api/delete-tool", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  await pool.query(
    "DELETE FROM tools WHERE id=$1",
    [req.query.id]
  );

  res.send("OK");
});

/* add user admin */
app.get("/api/add-user-admin", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

  await pool.query(
    "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
    [req.query.nom, req.query.pin]
  );

  res.send("OK");
});

/* delete user */
app.get("/api/delete-user", async (req, res) => {
  if (!isAdmin(req)) return res.send("Accès refusé");

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
