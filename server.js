const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const QRCode = require("qrcode");

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

function isAdmin(req) {
  const user = req.query.user || "";
  const pass = req.query.pass || "";
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

function baseUrl(req) {
  return req.protocol + "://" + req.get("host");
}

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

app.get("/", (req, res) => {
  res.redirect("/outil.html");
});

/* LECTURE PUBLIQUE POUR ADMIN + APPLI */
app.get("/api/admin", async (req, res) => {
  try {
    const tools = await pool.query("SELECT * FROM tools ORDER BY id ASC");
    const users = await pool.query("SELECT * FROM users ORDER BY nom ASC");
    const mouvements = await pool.query("SELECT * FROM mouvements ORDER BY id DESC LIMIT 100");

    res.json({
      tools: tools.rows,
      users: users.rows,
      mouvements: mouvements.rows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ tools: [], users: [], mouvements: [] });
  }
});

/* CREER UTILISATEUR DEPUIS APPLI */
app.get("/api/add-user-admin", async (req, res) => {
  try {
    const { nom, pin } = req.query;

    if (!nom || !pin) return res.send("Nom ou PIN manquant");

    await pool.query(
      "INSERT INTO users(nom,pin) VALUES($1,$2) ON CONFLICT (nom) DO NOTHING",
      [nom.trim(), pin.trim()]
    );

    res.send("OK");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* AJOUT OUTIL ADMIN PROTEGE */
app.get("/api/add-tool", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    const nom = String(req.query.nom || "").trim();
    if (!nom) return res.send("Nom manquant");

    await pool.query(
      "INSERT INTO tools(nom) VALUES($1) ON CONFLICT (nom) DO NOTHING",
      [nom]
    );

    res.send("OK");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* SUPPRIMER OUTIL ADMIN PROTEGE */
app.get("/api/delete-tool", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    await pool.query("DELETE FROM tools WHERE id=$1", [req.query.id]);

    res.send("OK");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* SUPPRIMER UTILISATEUR ADMIN PROTEGE */
app.get("/api/delete-user", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(401).send("Accès refusé");

    const id = req.query.id;
    const nom = req.query.nom;

    if (id) {
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    } else if (nom) {
      await pool.query("DELETE FROM users WHERE nom=$1", [nom]);
    }

    res.send("OK");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* PRENDRE OUTIL */
app.get("/api/take", async (req, res) => {
  try {
    const nom = String(req.query.nom || "").trim();
    const pin = String(req.query.pin || "").trim();
    const id = String(req.query.id || "").trim();

    const user = await pool.query(
      "SELECT * FROM users WHERE LOWER(nom)=LOWER($1) AND pin=$2",
      [nom, pin]
    );

    if (!user.rows.length) return res.send("Utilisateur incorrect");

    const toolResult = await pool.query(
      "SELECT * FROM tools WHERE id::text=$1 OR LOWER(nom)=LOWER($1)",
      [id]
    );

    if (!toolResult.rows.length) return res.send("Outil introuvable");

    const tool = toolResult.rows[0];

    if (tool.en_cours) return res.send("Déjà pris par " + tool.emprunteur);

    await pool.query(
      `UPDATE tools
       SET emprunteur=$1, en_cours=true, date_sortie=$2
       WHERE id=$3`,
      [user.rows[0].nom, new Date().toLocaleString("fr-FR"), tool.id]
    );

    await pool.query(
      "INSERT INTO mouvements(utilisateur, action, outil) VALUES($1,$2,$3)",
      [user.rows[0].nom, "SORTIE", tool.nom]
    );

    res.send("Outil pris");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* RENDRE OUTIL */
app.get("/api/return", async (req, res) => {
  try {
    const nom = String(req.query.nom || "").trim();
    const pin = String(req.query.pin || "").trim();
    const id = String(req.query.id || "").trim();

    const user = await pool.query(
      "SELECT * FROM users WHERE LOWER(nom)=LOWER($1) AND pin=$2",
      [nom, pin]
    );

    if (!user.rows.length) return res.send("Utilisateur incorrect");

    const toolResult = await pool.query(
      "SELECT * FROM tools WHERE id::text=$1 OR LOWER(nom)=LOWER($1)",
      [id]
    );

    if (!toolResult.rows.length) return res.send("Outil introuvable");

    const tool = toolResult.rows[0];

    if (!tool.en_cours) return res.send("Outil déjà disponible");

    if (tool.emprunteur.toLowerCase() !== user.rows[0].nom.toLowerCase()) {
      return res.send("Impossible : pris par " + tool.emprunteur);
    }

    await pool.query(
      `UPDATE tools
       SET emprunteur='', en_cours=false, date_sortie=''
       WHERE id=$1`,
      [tool.id]
    );

    await pool.query(
      "INSERT INTO mouvements(utilisateur, action, outil) VALUES($1,$2,$3)",
      [user.rows[0].nom, "RETOUR", tool.nom]
    );

    res.send("Outil rendu");
  } catch (e) {
    console.error(e);
    res.send("Erreur");
  }
});

/* QR CODE */
app.get("/qrcode/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const url = `${baseUrl(req)}/outil.html?tool=${encodeURIComponent(id)}`;
    const qr = await QRCode.toDataURL(url);

    res.send(`
      <html>
      <body style="font-family:Arial;text-align:center;background:#07162c;color:white;padding:30px">
        <h1>QR outil ${id}</h1>
        <img src="${qr}" style="background:white;padding:15px;border-radius:20px;width:320px;max-width:90%">
        <p>${url}</p>
      </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Erreur QR");
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("🚀 ProControl lancé sur port " + PORT);
    });
  })
  .catch((e) => {
    console.error("Erreur init DB", e);
    process.exit(1);
  });
