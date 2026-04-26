require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_CODE = "Admin2026!";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let users = [];
let tools = [];

/* =========================
   LOAD DATA FROM NEON
========================= */
async function loadData() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nom TEXT UNIQUE,
        pin TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tools (
        id BIGINT PRIMARY KEY,
        nom TEXT,
        utilisateur TEXT,
        statut TEXT
      );
    `);

    const u = await pool.query("SELECT * FROM users ORDER BY nom");
    const t = await pool.query("SELECT * FROM tools ORDER BY id");

    users = u.rows;
    tools = t.rows;

    console.log("✅ Neon connecté");
  } catch (err) {
    console.log("❌ Erreur Neon :", err.message);
  }
}

/* =========================
   SAVE USER
========================= */
async function saveUser(nom, pin) {
  await pool.query(
    `INSERT INTO users(nom,pin)
     VALUES($1,$2)
     ON CONFLICT(nom)
     DO UPDATE SET pin=EXCLUDED.pin`,
    [nom, pin]
  );
}

/* =========================
   SAVE TOOL
========================= */
async function saveTool(tool) {
  await pool.query(
    `INSERT INTO tools(id,nom,utilisateur,statut)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(id)
     DO UPDATE SET
     nom=EXCLUDED.nom,
     utilisateur=EXCLUDED.utilisateur,
     statut=EXCLUDED.statut`,
    [tool.id, tool.nom, tool.utilisateur, tool.statut]
  );
}

/* =========================
   DATA
========================= */
app.get("/api/data", (req, res) => {
  res.json({ users, tools });
});

/* =========================
   ADD USER
========================= */
app.get("/api/add-user", async (req, res) => {
  const { code, nom, pin } = req.query;

  if (code !== ADMIN_CODE) return res.send("Accès refusé");
  if (!nom || !pin) return res.send("Champs manquants");

  const exist = users.find(u => u.nom === nom);

  if (exist) return res.send("Utilisateur existe déjà");

  const user = { nom, pin };
  users.push(user);

  await saveUser(nom, pin);

  res.send("OK");
});

/* =========================
   ADD TOOL
========================= */
app.get("/api/add-tool", async (req, res) => {
  const { code, nom } = req.query;

  if (code !== ADMIN_CODE) return res.send("Accès refusé");
  if (!nom) return res.send("Nom manquant");

  const tool = {
    id: Date.now(),
    nom,
    utilisateur: "",
    statut: "Libre"
  };

  tools.push(tool);

  await saveTool(tool);

  res.send("OK");
});

/* =========================
   TAKE TOOL
========================= */
app.get("/api/take", async (req, res) => {
  const { nom, pin, id } = req.query;

  const user = users.find(
    u => u.nom === nom && u.pin === pin
  );

  if (!user) return res.send("Utilisateur invalide");

  const tool = tools.find(
    t =>
      String(t.id) === String(id) ||
      t.nom.toLowerCase() === String(id).toLowerCase()
  );

  if (!tool) return res.send("Outil introuvable");

  if (tool.statut === "Pris")
    return res.send("Déjà pris");

  tool.statut = "Pris";
  tool.utilisateur = nom;

  await saveTool(tool);

  res.send("Outil pris");
});

/* =========================
   RETURN TOOL
========================= */
app.get("/api/return", async (req, res) => {
  const { nom, pin, id } = req.query;

  const user = users.find(
    u => u.nom === nom && u.pin === pin
  );

  if (!user) return res.send("Utilisateur invalide");

  const tool = tools.find(
    t =>
      String(t.id) === String(id) ||
      t.nom.toLowerCase() === String(id).toLowerCase()
  );

  if (!tool) return res.send("Outil introuvable");

  tool.statut = "Libre";
  tool.utilisateur = "";

  await saveTool(tool);

  res.send("Outil rendu");
});

/* =========================
   START
========================= */
loadData().then(() => {
  app.listen(PORT, () => {
    console.log("🚀 ProControl lancé sur port " + PORT);
  });
});
