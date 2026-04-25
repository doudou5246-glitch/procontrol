const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;
const QRCode = require("qrcode");

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

/* =======================
   ADMIN DATA
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

  if (!nom || !pin) return res.send("Nom ou pin manquant");

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
  const { id } = req.query;
  const db = load();

  db.users = db.users.filter(u => String(u.id) !== String(id));

  save(db);
  res.send("Utilisateur supprimé");
});

/* =======================
   TOOLS
======================= */

app.get("/api/add-tool", (req, res) => {
  const { nom } = req.query;
  const db = load();

  if (!nom) return res.send("Nom manquant");

  db.tools.push({
    id: Date.now(),
    nom,
    emprunteur: "",
    en_cours: false,
    date_sortie: ""
  });

  save(db);
  res.send("Outil ajouté");
});

app.get("/api/delete-tool", (req, res) => {
  const { id } = req.query;
  const db = load();

  db.tools = db.tools.filter(t => String(t.id) !== String(id));

  save(db);
  res.send("Outil supprimé");
});

/* =======================
   PRENDRE
======================= */

app.get("/api/take", (req, res) => {
  const { nom, pin, id } = req.query;
  const db = load();

  const user = db.users.find(
    u =>
      u.nom.toLowerCase() === nom.toLowerCase() &&
      u.pin === pin
  );

  if (!user) return res.send("Utilisateur incorrect");

  const tool = db.tools.find(t => String(t.id) === String(id));

  if (!tool) return res.send("Outil introuvable");

  if (tool.en_cours)
    return res.send("Déjà pris par " + tool.emprunteur);

  tool.en_cours = true;
  tool.emprunteur = nom;
  tool.date_sortie = now();

  db.mouvements.push({
    date: now(),
    utilisateur: nom,
    action: "SORTIE",
    outil: tool.nom
  });

  save(db);
  res.send("OK");
});

/* =======================
   RENDRE
======================= */

app.get("/api/return", (req, res) => {
  const { nom, pin, id } = req.query;
  const db = load();

  const user = db.users.find(
    u =>
      u.nom.toLowerCase() === nom.toLowerCase() &&
      u.pin === pin
  );

  if (!user) return res.send("Utilisateur incorrect");

  const tool = db.tools.find(t => String(t.id) === String(id));

  if (!tool) return res.send("Outil introuvable");

  tool.en_cours = false;
  tool.emprunteur = "";
  tool.date_sortie = "";

  db.mouvements.push({
    date: now(),
    utilisateur: nom,
    action: "RETOUR",
    outil: tool.nom
  });

  save(db);
  res.send("OK");
});

app.get("/qrcode/:id", async (req,res)=>{

const id=req.params.id;

const url=
req.protocol+
"://"+
req.get("host")+
"/outil.html?tool="+id;

const qr = await QRCode.toDataURL(url);

res.send(`
<html>
<body style="text-align:center;font-family:Arial;background:#0b1730;color:white;padding:30px;">
<h1>QR outil ${id}</h1>
<img src="${qr}" style="background:white;padding:15px;border-radius:20px;width:320px;">
<p>${url}</p>
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
