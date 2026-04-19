const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS lieux (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL UNIQUE
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS materiel (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('stock', 'outil'))
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY,
      materiel_id INTEGER NOT NULL REFERENCES materiel(id) ON DELETE CASCADE,
      lieu_id INTEGER NOT NULL REFERENCES lieux(id) ON DELETE CASCADE,
      quantite INTEGER NOT NULL DEFAULT 0,
      UNIQUE (materiel_id, lieu_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      materiel_id INTEGER NOT NULL REFERENCES materiel(id) ON DELETE CASCADE,
      lieu_id INTEGER REFERENCES lieux(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('sortie', 'retour', 'ajout_stock', 'transfert')),
      utilisateur TEXT,
      etat TEXT,
      quantite INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      date TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`INSERT INTO lieux (nom) VALUES ('Chambéry') ON CONFLICT (nom) DO NOTHING;`);
  await query(`INSERT INTO lieux (nom) VALUES ('Grenoble') ON CONFLICT (nom) DO NOTHING;`);
}

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/lieux', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM lieux ORDER BY nom');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lieux', async (req, res) => {
  try {
    const nom = String(req.body.nom || '').trim();
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    await query('INSERT INTO lieux (nom) VALUES ($1)', [nom]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/materiel', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT m.id, m.nom, m.type, COALESCE(SUM(s.quantite), 0) AS stock_total
      FROM materiel m
      LEFT JOIN stock s ON s.materiel_id = m.id
      GROUP BY m.id, m.nom, m.type
      ORDER BY m.nom
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/materiel', async (req, res) => {
  try {
    const nom = String(req.body.nom || '').trim();
    const type = String(req.body.type || '').trim();
    if (!nom) return res.status(400).json({ error: 'Nom requis' });
    if (!['stock', 'outil'].includes(type)) return res.status(400).json({ error: 'Type invalide' });
    await query('INSERT INTO materiel (nom, type) VALUES ($1, $2)', [nom, type]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT s.id, s.quantite,
             m.id AS materiel_id, m.nom AS materiel_nom, m.type,
             l.id AS lieu_id, l.nom AS lieu_nom
      FROM stock s
      JOIN materiel m ON m.id = s.materiel_id
      JOIN lieux l ON l.id = s.lieu_id
      ORDER BY l.nom, m.nom
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/stocks', async (req, res) => {
  try {
    const materiel_id = Number(req.body.materiel_id);
    const lieu_id = Number(req.body.lieu_id);
    const quantite = Number(req.body.quantite);
    if (!materiel_id || !lieu_id || !Number.isFinite(quantite)) {
      return res.status(400).json({ error: 'Champs invalides' });
    }

    await query(`
      INSERT INTO stock (materiel_id, lieu_id, quantite)
      VALUES ($1, $2, $3)
      ON CONFLICT (materiel_id, lieu_id)
      DO UPDATE SET quantite = stock.quantite + EXCLUDED.quantite
    `, [materiel_id, lieu_id, quantite]);

    await query(`
      INSERT INTO mouvements (materiel_id, lieu_id, action, quantite, note)
      VALUES ($1, $2, 'ajout_stock', $3, 'Ajout manuel de stock')
    `, [materiel_id, lieu_id, quantite]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sortie', async (req, res) => {
  const client = await pool.connect();
  try {
    const materiel_id = Number(req.body.materiel_id);
    const lieu_id = Number(req.body.lieu_id);
    const quantite = Math.max(1, Number(req.body.quantite || 1));
    const utilisateur = String(req.body.utilisateur || '').trim();

    if (!materiel_id || !lieu_id || !utilisateur) {
      return res.status(400).json({ error: 'Champs requis' });
    }

    await client.query('BEGIN');

    const current = await client.query(
      'SELECT quantite FROM stock WHERE materiel_id = $1 AND lieu_id = $2 FOR UPDATE',
      [materiel_id, lieu_id]
    );

    if (!current.rows.length || Number(current.rows[0].quantite) < quantite) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stock insuffisant' });
    }

    await client.query(
      'UPDATE stock SET quantite = quantite - $1 WHERE materiel_id = $2 AND lieu_id = $3',
      [quantite, materiel_id, lieu_id]
    );

    await client.query(`
      INSERT INTO mouvements (materiel_id, lieu_id, action, utilisateur, quantite)
      VALUES ($1, $2, 'sortie', $3, $4)
    `, [materiel_id, lieu_id, utilisateur, quantite]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.post('/api/retour', async (req, res) => {
  try {
    const materiel_id = Number(req.body.materiel_id);
    const lieu_id = Number(req.body.lieu_id);
    const utilisateur = String(req.body.utilisateur || '').trim();
    const etat = String(req.body.etat || 'bon').trim();

    if (!materiel_id || !lieu_id || !utilisateur) {
      return res.status(400).json({ error: 'Champs requis' });
    }

    await query(`
      INSERT INTO stock (materiel_id, lieu_id, quantite)
      VALUES ($1, $2, 1)
      ON CONFLICT (materiel_id, lieu_id)
      DO UPDATE SET quantite = stock.quantite + 1
    `, [materiel_id, lieu_id]);

    await query(`
      INSERT INTO mouvements (materiel_id, lieu_id, action, utilisateur, etat, quantite)
      VALUES ($1, $2, 'retour', $3, $4, 1)
    `, [materiel_id, lieu_id, utilisateur, etat]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mouvements', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT mv.id, mv.action, mv.utilisateur, mv.etat, mv.quantite, mv.note,
             TO_CHAR(mv.date, 'YYYY-MM-DD HH24:MI:SS') AS date,
             m.nom AS materiel_nom, m.type, l.nom AS lieu_nom
      FROM mouvements mv
      JOIN materiel m ON m.id = mv.materiel_id
      LEFT JOIN lieux l ON l.id = mv.lieu_id
      ORDER BY mv.id DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/qrcode/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/?id=${id}`;
    const qr = await QRCode.toDataURL(url);
    res.send(`
      <html><body style="font-family:Arial;text-align:center;padding:24px">
      <h2>QR Code matériel ${id}</h2>
      <img src="${qr}" style="max-width:320px;width:100%" />
      <p>${url}</p>
      </body></html>
    `);
  } catch (e) {
    res.status(500).send('Erreur QR code');
  }
});
app.get("/api/tools", async (req, res) => {
  const result = await query("SELECT * FROM tools");
  res.json(result.rows);
});
app.get("/api/add-tool", async (req, res) => {
  await query(`
    INSERT INTO tools (nom)
    VALUES ('Perceuse')
  `);
  res.send("outil ajouté");
});
app.get("/api/tools", async (req, res) => {
  const result = await query("SELECT * FROM tools");
  res.json(result.rows);
});
app.get("/api/take", async (req, res) => {
  const { id, nom, pin } = req.query;

  // vérifier utilisateur
  const user = await query(
    "SELECT * FROM users WHERE nom=$1 AND pin=$2",
    [nom, pin]
  );

  if (user.rows.length === 0) {
    return res.send("❌ Code incorrect");
  }

  // vérifier si déjà pris
  const tool = await query(
    "SELECT * FROM tools WHERE id=$1",
    [id]
  );

  if (tool.rows[0].en_cours) {
    return res.send("❌ Outil déjà pris");
  }

  // enregistrer
  await query(
    "UPDATE tools SET emprunteur=$1, en_cours=true, date_sortie=NOW() WHERE id=$2",
    [nom, id]
  );

  res.send("✅ Outil pris par " + nom);
});
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ProControl déployable lancé sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erreur initialisation DB :', err);
    process.exit(1);
  });

