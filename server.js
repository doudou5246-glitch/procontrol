require("dotenv").config();

const express = require("express");
const path = require("path");
const QRCode = require("qrcode");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

const ADMIN_USER = "admin";
const ADMIN_PASS = "Admin2026!";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =======================
   NEON DATABASE
======================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      nom TEXT UNIQUE,
      pin TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tools (
      id BIGINT PRIMARY KEY,
      nom TEXT,
      emprunteur TEXT,
      en_cours BOOLEAN,
      date_sortie TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      date TEXT,
      utilisateur TEXT,
      action TEXT,
      outil TEXT
    );
  `);

  console.log("✅ Neon connecté");
}

function now() {
  return new Date().toLocaleString("fr-FR");
}

function isAdmin(req) {
  const user = req.query.user || "";
  const pass = req.query.pass || "";
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

function publicUrl(req) {
  return req.protocol + "://" + req.get("host");
}

/* =======================
   ROOT
======================= */

app.get("/", (req, res) => {
  res.redirect("/outil.html");
});

/* =======================
   ADMIN DATA
======================= */

app.get("/api/admin", async (req, res) => {
  const users = await pool.query("SELECT * FROM users ORDER BY nom");
  const tools = await pool.query("SELECT * FROM tools ORDER BY id DESC");
  const mouvements = await pool.query("SELECT * FROM mouvements ORDER BY id DESC LIMIT 100");

  res.json({
    users: users.rows,
    tools: tools.rows,
    mouvements: mouvements.rows
  });
});

/* =======================
   USERS
======================= */

app.get("/api/add-user-admin", async (req, res) => {
  const { nom, pin } = req.query;

  if (!nom || !pin) return res.send("Nom ou PIN manquant");

  const exist = await pool.query(
    "SELECT * FROM users WHERE LOWER(nom)=LOWER($1)",
    [nom]
  );

  if (exist.rows.length) return res.send("Utilisateur déjà existant");

  await pool.query(
    "INSERT INTO users(id,nom,pin) VALUES($1,$2,$3)",
    [Date.now(), nom, pin]
  );

  res.send("Utilisateur ajouté");
});

app.get("/api/delete-user", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { id } = req.query;

  await pool.query("DELETE FROM users WHERE id=$1", [id]);

  res.send("Utilisateur supprimé");
});

/* =======================
   TOOLS
======================= */

app.get("/api/add-tool", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { nom } = req.query;
  if (!nom) return res.send("Nom manquant");

  const id = Date.now();

  await pool.query(
    `INSERT INTO tools(id,nom,emprunteur,en_cours,date_sortie)
     VALUES($1,$2,'',false,'')`,
    [id, nom]
  );

  res.json({
    message: "Outil ajouté",
    id,
    nom,
    qr: publicUrl(req) + "/qrcode/" + id
  });
});

app.get("/api/delete-tool", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { id } = req.query;

  await pool.query("DELETE FROM tools WHERE id=$1", [id]);

  res.send("Outil supprimé");
});

/* =======================
   TAKE TOOL
======================= */

app.get("/api/take", async (req, res) => {
  const { nom, pin, id } = req.query;

  const user = await pool.query(
    `SELECT * FROM users
     WHERE LOWER(nom)=LOWER($1)
     AND pin=$2`,
    [nom, pin]
  );

  if (!user.rows.length) return res.send("Utilisateur incorrect");

  const tool = await pool.query(
    "SELECT * FROM tools WHERE id=$1",
    [id]
  );

  if (!tool.rows.length) return res.send("Outil introuvable");

  if (tool.rows[0].en_cours)
    return res.send("Déjà pris par " + tool.rows[0].emprunteur);

  await pool.query(
    `UPDATE tools
     SET en_cours=true,
         emprunteur=$1,
         date_sortie=$2
     WHERE id=$3`,
    [nom, now(), id]
  );

  await pool.query(
    `INSERT INTO mouvements(date,utilisateur,action,outil)
     VALUES($1,$2,'SORTIE',$3)`,
    [now(), nom, tool.rows[0].nom]
  );

  res.send("Outil pris");
});

/* =======================
   RETURN TOOL
======================= */

app.get("/api/return", async (req, res) => {
  const { nom, pin, id } = req.query;

  const user = await pool.query(
    `SELECT * FROM users
     WHERE LOWER(nom)=LOWER($1)
     AND pin=$2`,
    [nom, pin]
  );

  if (!user.rows.length) return res.send("Utilisateur incorrect");

  const tool = await pool.query(
    "SELECT * FROM tools WHERE id=$1",
    [id]
  );

  if (!tool.rows.length) return res.send("Outil introuvable");

  await pool.query(
    `UPDATE tools
     SET en_cours=false,
         emprunteur='',
         date_sortie=''
     WHERE id=$1`,
    [id]
  );

  await pool.query(
    `INSERT INTO mouvements(date,utilisateur,action,outil)
     VALUES($1,$2,'RETOUR',$3)`,
    [now(), nom, tool.rows[0].nom]
  );

  res.send("Outil rendu");
});

/* =======================
   QR CODE
======================= */

app.get("/qrcode/:id", async (req, res) => {
  const id = req.params.id;

  const url =
    publicUrl(req) +
    "/outil.html?tool=" +
    encodeURIComponent(id);

  const qr = await QRCode.toDataURL(url);

  res.send(`
  <html>
  <body style="background:#07162c;color:white;text-align:center;padding:30px;font-family:Arial">
  <h1>QR outil ${id}</h1>
  <img src="${qr}" style="width:320px;background:white;padding:15px;border-radius:20px">
  <p>${url}</p>
  </body>
  </html>
  `);
});

/* =======================
   START
======================= */

initDB().then(() => {
  app.listen(PORT, () => {
    console.log("🚀 ProControl lancé sur port " + PORT);
  });
});
