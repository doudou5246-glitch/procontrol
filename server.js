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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
      nom TEXT NOT NULL,
      emprunteur TEXT DEFAULT '',
      en_cours BOOLEAN DEFAULT false,
      date_sortie TEXT DEFAULT ''
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

app.get("/", (req, res) => {
  res.redirect("/outil.html");
});

/* =======================
   PUBLIC DATA
======================= */

app.get("/api/admin", async (req, res) => {
  try {
    const users = await pool.query("SELECT * FROM users ORDER BY nom ASC");
    const tools = await pool.query("SELECT * FROM tools ORDER BY id ASC");
    const mouvements = await pool.query("SELECT * FROM mouvements ORDER BY id DESC LIMIT 100");

    res.json({
      tools: tools.rows,
      users: users.rows,
      mouvements: mouvements.rows
    });
  } catch (e) {
    console.error(e);
    res.json({ tools: [], users: [], mouvements: [] });
  }
});

/* =======================
   USERS
======================= */

app.get("/api/add-user-admin", async (req, res) => {
  try {
    const { nom, pin } = req.query;

    if (!nom || !pin) return res.send("Nom ou PIN manquant");

    const exist = await pool.query(
      "SELECT * FROM users WHERE LOWER(nom)=LOWER($1)",
      [nom]
    );

    if (exist.rows.length) return res.send("Utilisateur déjà existant");

    await pool.query(
      "INSERT INTO users(nom, pin) VALUES($1, $2)",
      [nom, pin]
    );

    res.send("Utilisateur ajouté");
  } catch (e) {
    console.error(e);
    res.send("Erreur utilisateur");
  }
});

app.get("/api/delete-user", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    const { id } = req.query;

    const user = await pool.query("SELECT * FROM users WHERE id=$1", [id]);

    if (user.rows.length) {
      const hasTools = await pool.query(
        "SELECT * FROM tools WHERE emprunteur=$1",
        [user.rows[0].nom]
      );

      if (hasTools.rows.length) {
        return res.send("Impossible : utilisateur avec matériel en cours");
      }
    }

    await pool.query("DELETE FROM users WHERE id=$1", [id]);

    res.send("Utilisateur supprimé");
  } catch (e) {
    console.error(e);
    res.send("Erreur suppression utilisateur");
  }
});

/* =======================
   TOOLS
======================= */

app.get("/api/add-tool", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    const { nom } = req.query;

    if (!nom) return res.send("Nom manquant");

    const result = await pool.query(
      `INSERT INTO tools(nom, emprunteur, en_cours, date_sortie)
       VALUES($1, '', false, '')
       RETURNING id, nom`,
      [nom]
    );

    const tool = result.rows[0];

    res.json({
      message: "Outil ajouté",
      id: tool.id,
      nom: tool.nom,
      qr: publicUrl(req) + "/qrcode/" + tool.id
    });
  } catch (e) {
    console.error(e);
    res.send("Erreur ajout outil");
  }
});

app.get("/api/delete-tool", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    const { id } = req.query;

    await pool.query("DELETE FROM tools WHERE id=$1", [id]);

    res.send("Outil supprimé");
  } catch (e) {
    console.error(e);
    res.send("Erreur suppression outil");
  }
});

/* =======================
   TAKE TOOL
======================= */

app.get("/api/take", async (req, res) => {
  try {
    const { nom, pin, id } = req.query;

    const user = await pool.query(
      `SELECT * FROM users
       WHERE LOWER(nom)=LOWER($1)
       AND pin=$2`,
      [nom || "", pin || ""]
    );

    if (!user.rows.length) return res.send("Utilisateur incorrect");

    const tool = await pool.query(
      "SELECT * FROM tools WHERE id::text=$1",
      [String(id || "")]
    );

    if (!tool.rows.length) return res.send("Outil introuvable");

    const t = tool.rows[0];

    if (t.en_cours) {
      return res.send("Déjà pris par " + t.emprunteur);
    }

    await pool.query(
      `UPDATE tools
       SET en_cours=true,
           emprunteur=$1,
           date_sortie=$2
       WHERE id=$3`,
      [user.rows[0].nom, now(), t.id]
    );

    await pool.query(
      `INSERT INTO mouvements(date, utilisateur, action, outil)
       VALUES($1, $2, 'SORTIE', $3)`,
      [now(), user.rows[0].nom, t.nom]
    );

    res.send("Outil pris");
  } catch (e) {
    console.error(e);
    res.send("Erreur prise outil");
  }
});

/* =======================
   RETURN TOOL
======================= */

app.get("/api/return", async (req, res) => {
  try {
    const { nom, pin, id } = req.query;

    const user = await pool.query(
      `SELECT * FROM users
       WHERE LOWER(nom)=LOWER($1)
       AND pin=$2`,
      [nom || "", pin || ""]
    );

    if (!user.rows.length) return res.send("Utilisateur incorrect");

    const tool = await pool.query(
      "SELECT * FROM tools WHERE id::text=$1",
      [String(id || "")]
    );

    if (!tool.rows.length) return res.send("Outil introuvable");

    const t = tool.rows[0];

    if (!t.en_cours) return res.send("Outil déjà disponible");

    if (String(t.emprunteur).toLowerCase() !== String(user.rows[0].nom).toLowerCase()) {
      return res.send("Impossible : outil pris par " + t.emprunteur);
    }

    await pool.query(
      `UPDATE tools
       SET en_cours=false,
           emprunteur='',
           date_sortie=''
       WHERE id=$1`,
      [t.id]
    );

    await pool.query(
      `INSERT INTO mouvements(date, utilisateur, action, outil)
       VALUES($1, $2, 'RETOUR', $3)`,
      [now(), user.rows[0].nom, t.nom]
    );

    res.send("Outil rendu");
  } catch (e) {
    console.error(e);
    res.send("Erreur retour outil");
  }
});

/* =======================
   QR CODE
======================= */

app.get("/qrcode/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const url =
      publicUrl(req) +
      "/outil.html?tool=" +
      encodeURIComponent(id);

    const qr = await QRCode.toDataURL(url);

    res.send(`
      <html>
      <head>
        <title>QR outil ${id}</title>
        <style>
          body{
            font-family:Arial;
            background:#07162c;
            color:white;
            text-align:center;
            padding:30px;
          }
          img{
            width:320px;
            max-width:90%;
            background:white;
            padding:15px;
            border-radius:20px;
          }
          .box{
            background:#162845;
            padding:25px;
            border-radius:18px;
            display:inline-block;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>QR outil ${id}</h1>
          <img src="${qr}">
          <p>${url}</p>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.send("Erreur QR");
  }
});

/* =======================
   START
======================= */

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Serveur OK port " + PORT);
    });
  })
  .catch((e) => {
    console.error("Erreur init Neon :", e);
    process.exit(1);
  });
