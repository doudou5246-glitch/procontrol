const express = require("express");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 10000;

const ADMIN_USER = "admin";
const ADMIN_PASS = "Admin2026!";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DB = path.join(__dirname, "data.json");

function load() {
  if (!fs.existsSync(DB)) {
    fs.writeFileSync(
      DB,
      JSON.stringify(
        {
          tools: [],
          users: [],
          mouvements: []
        },
        null,
        2
      )
    );
  }

  return JSON.parse(fs.readFileSync(DB, "utf8"));
}

function save(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
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

app.get("/api/admin", (req, res) => {
  const db = load();
  res.json(db);
});

/* =======================
   USERS
======================= */

app.get("/api/add-user-admin", (req, res) => {
  const { nom, pin } = req.query;
  const db = load();

  if (!nom || !pin) return res.send("Nom ou PIN manquant");

  const exist = db.users.find(
    u => u.nom.toLowerCase() === nom.toLowerCase()
  );

  if (exist) return res.send("Utilisateur déjà existant");

  db.users.push({
    id: Date.now(),
    nom,
    pin
  });

  save(db);
  res.send("Utilisateur ajouté");
});

app.get("/api/delete-user", (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { id } = req.query;
  const db = load();

  const user = db.users.find(u => String(u.id) === String(id));

  if (user) {
    const hasTools = db.tools.some(t => t.emprunteur === user.nom);
    if (hasTools) {
      return res.send("Impossible : utilisateur avec matériel en cours");
    }
  }

  db.users = db.users.filter(u => String(u.id) !== String(id));

  save(db);
  res.send("Utilisateur supprimé");
});

/* =======================
   TOOLS
======================= */

app.get("/api/add-tool", (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { nom } = req.query;
  const db = load();

  if (!nom) return res.send("Nom manquant");

  const id = Date.now();

  db.tools.push({
    id,
    nom,
    emprunteur: "",
    en_cours: false,
    date_sortie: ""
  });

  save(db);

  res.json({
    message: "Outil ajouté",
    id,
    nom,
    qr: publicUrl(req) + "/qrcode/" + id
  });
});

app.get("/api/delete-tool", (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Accès refusé");

  const { id } = req.query;
  const db = load();

  db.tools = db.tools.filter(t => String(t.id) !== String(id));

  save(db);
  res.send("Outil supprimé");
});

/* =======================
   TAKE TOOL
======================= */

app.get("/api/take", (req, res) => {
  const { nom, pin, id } = req.query;
  const db = load();

  const user = db.users.find(
    u =>
      u.nom.toLowerCase() === String(nom || "").toLowerCase() &&
      u.pin === pin
  );

  if (!user) return res.send("Utilisateur incorrect");

  const tool = db.tools.find(t => String(t.id) === String(id));

  if (!tool) return res.send("Outil introuvable");

  if (tool.en_cours) {
    return res.send("Déjà pris par " + tool.emprunteur);
  }

  tool.en_cours = true;
  tool.emprunteur = user.nom;
  tool.date_sortie = now();

  db.mouvements.push({
    date: now(),
    utilisateur: user.nom,
    action: "SORTIE",
    outil: tool.nom
  });

  save(db);
  res.send("Outil pris");
});

/* =======================
   RETURN TOOL
======================= */

app.get("/api/return", (req, res) => {
  const { nom, pin, id } = req.query;
  const db = load();

  const user = db.users.find(
    u =>
      u.nom.toLowerCase() === String(nom || "").toLowerCase() &&
      u.pin === pin
  );

  if (!user) return res.send("Utilisateur incorrect");

  const tool = db.tools.find(t => String(t.id) === String(id));

  if (!tool) return res.send("Outil introuvable");

  if (!tool.en_cours) return res.send("Outil déjà disponible");

  if (tool.emprunteur !== user.nom) {
    return res.send("Impossible : outil pris par " + tool.emprunteur);
  }

  tool.en_cours = false;
  tool.emprunteur = "";
  tool.date_sortie = "";

  db.mouvements.push({
    date: now(),
    utilisateur: user.nom,
    action: "RETOUR",
    outil: tool.nom
  });

  save(db);
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
});

/* =======================
   START
======================= */

app.listen(PORT, () => {
  console.log("Serveur OK port " + PORT);
});
