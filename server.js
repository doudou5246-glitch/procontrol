const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function baseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function isAdmin(user, pass) {
  return user === ADMIN_USERNAME && pass === ADMIN_PASSWORD;
}

async function q(sql, params = []) {
  return pool.query(sql, params);
}

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nom TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS tools (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      emprunteur TEXT,
      en_cours BOOLEAN DEFAULT false,
      date_sortie TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS mouvements (
      id SERIAL PRIMARY KEY,
      tool_id INTEGER REFERENCES tools(id) ON DELETE SET NULL,
      tool_nom TEXT,
      utilisateur TEXT,
      action TEXT NOT NULL,
      date TIMESTAMP DEFAULT NOW()
    );
  `);
}

app.get('/', (req, res) => {
  res.redirect('/outil.html');
});

/* =========================
   UTILISATEURS PUBLIC
========================= */

app.get('/api/public-users', async (req, res) => {
  try {
    const result = await q('SELECT nom FROM users ORDER BY nom');
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.get('/api/register', async (req, res) => {
  try {
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!nom || !pin) {
      return res.status(400).send('Nom et PIN requis');
    }

    const exists = await q('SELECT id FROM users WHERE nom = $1', [nom]);
    if (exists.rows.length) {
      return res.status(409).send('Utilisateur déjà existant');
    }

    await q('INSERT INTO users (nom, pin) VALUES ($1, $2)', [nom, pin]);
    res.send('Compte créé');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/login', async (req, res) => {
  try {
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!nom || !pin) {
      return res.status(400).send('Nom et PIN requis');
    }

    const user = await q(
      'SELECT id FROM users WHERE nom = $1 AND pin = $2',
      [nom, pin]
    );

    if (!user.rows.length) {
      return res.status(401).send('PIN incorrect');
    }

    res.send('Connecté');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

/* =========================
   OUTILS UTILISATEUR
========================= */

app.get('/api/tool/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await q('SELECT * FROM tools WHERE id = $1', [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Outil introuvable' });
    }

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/take', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!id || !nom || !pin) {
      return res.status(400).send('Champs requis');
    }

    const user = await q(
      'SELECT id FROM users WHERE nom = $1 AND pin = $2',
      [nom, pin]
    );

    if (!user.rows.length) {
      return res.status(401).send('PIN incorrect');
    }

    const toolRes = await q('SELECT * FROM tools WHERE id = $1', [id]);
    if (!toolRes.rows.length) {
      return res.status(404).send('Outil introuvable');
    }

    const tool = toolRes.rows[0];

    if (tool.en_cours) {
      return res.status(409).send(`Déjà pris par ${tool.emprunteur}`);
    }

    await q(
      `UPDATE tools
       SET emprunteur = $1, en_cours = true, date_sortie = NOW()
       WHERE id = $2`,
      [nom, id]
    );

    await q(
      `INSERT INTO mouvements (tool_id, tool_nom, utilisateur, action)
       VALUES ($1, $2, $3, 'prise')`,
      [id, tool.nom, nom]
    );

    res.send('Outil pris');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/return', async (req, res) => {
  try {
    const id = Number(req.query.id);
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!id || !nom || !pin) {
      return res.status(400).send('Champs requis');
    }

    const user = await q(
      'SELECT id FROM users WHERE nom = $1 AND pin = $2',
      [nom, pin]
    );

    if (!user.rows.length) {
      return res.status(401).send('PIN incorrect');
    }

    const toolRes = await q('SELECT * FROM tools WHERE id = $1', [id]);
    if (!toolRes.rows.length) {
      return res.status(404).send('Outil introuvable');
    }

    const tool = toolRes.rows[0];

    if (!tool.en_cours) {
      return res.status(409).send('Outil déjà libre');
    }

    if (tool.emprunteur !== nom) {
      return res.status(403).send(`Cet outil est affecté à ${tool.emprunteur}`);
    }

    await q(
      `UPDATE tools
       SET emprunteur = NULL, en_cours = false, date_sortie = NULL
       WHERE id = $1`,
      [id]
    );

    await q(
      `INSERT INTO mouvements (tool_id, tool_nom, utilisateur, action)
       VALUES ($1, $2, $3, 'retour')`,
      [id, tool.nom, nom]
    );

    res.send('Outil rendu');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/my-tools', async (req, res) => {
  try {
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    const user = await q(
      'SELECT id FROM users WHERE nom = $1 AND pin = $2',
      [nom, pin]
    );

    if (!user.rows.length) {
      return res.status(401).json([]);
    }

    const result = await q(
      'SELECT * FROM tools WHERE emprunteur = $1 ORDER BY id',
      [nom]
    );

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.get('/api/return-all', async (req, res) => {
  try {
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    const user = await q(
      'SELECT id FROM users WHERE nom = $1 AND pin = $2',
      [nom, pin]
    );

    if (!user.rows.length) {
      return res.status(401).send('PIN incorrect');
    }

    const tools = await q(
      'SELECT * FROM tools WHERE emprunteur = $1',
      [nom]
    );

    for (const tool of tools.rows) {
      await q(
        `UPDATE tools
         SET emprunteur = NULL, en_cours = false, date_sortie = NULL
         WHERE id = $1`,
        [tool.id]
      );

      await q(
        `INSERT INTO mouvements (tool_id, tool_nom, utilisateur, action)
         VALUES ($1, $2, $3, 'retour')`,
        [tool.id, tool.nom, nom]
      );
    }

    res.send('Tout le matériel a été rendu');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

/* =========================
   ADMIN
========================= */

app.get('/api/admin', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');

    if (!isAdmin(user, pass)) {
      return res.status(401).json({ error: 'Accès refusé' });
    }

    const tools = await q('SELECT * FROM tools ORDER BY id');
    const users = await q('SELECT nom, pin, created_at FROM users ORDER BY nom');
    const mouvements = await q(`
      SELECT id, tool_id, tool_nom, utilisateur, action, date
      FROM mouvements
      ORDER BY id DESC
      LIMIT 100
    `);

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

app.get('/api/add-user-admin', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!isAdmin(user, pass)) return res.status(401).send('Accès refusé');
    if (!nom || !pin) return res.status(400).send('Nom et PIN requis');

    const exists = await q('SELECT id FROM users WHERE nom = $1', [nom]);
    if (exists.rows.length) {
      return res.status(409).send('Utilisateur déjà existant');
    }

    await q('INSERT INTO users (nom, pin) VALUES ($1, $2)', [nom, pin]);
    res.send('Utilisateur ajouté');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/delete-user', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');
    const nom = String(req.query.nom || '').trim();

    if (!isAdmin(user, pass)) return res.status(401).send('Accès refusé');

    const usingTools = await q(
      'SELECT id FROM tools WHERE emprunteur = $1',
      [nom]
    );

    if (usingTools.rows.length) {
      return res.status(409).send('Utilisateur a encore du matériel');
    }

    await q('DELETE FROM users WHERE nom = $1', [nom]);
    res.send('Utilisateur supprimé');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/update-user-pin', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');
    const nom = String(req.query.nom || '').trim();
    const pin = String(req.query.pin || '').trim();

    if (!isAdmin(user, pass)) return res.status(401).send('Accès refusé');
    if (!nom || !pin) return res.status(400).send('Nom et PIN requis');

    await q('UPDATE users SET pin = $1 WHERE nom = $2', [pin, nom]);
    res.send('PIN mis à jour');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/add-tool', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');
    const nom = String(req.query.nom || '').trim();

    if (!isAdmin(user, pass)) return res.status(401).send('Accès refusé');
    if (!nom) return res.status(400).send('Nom outil requis');

    const result = await q(
      'INSERT INTO tools (nom) VALUES ($1) RETURNING id, nom',
      [nom]
    );

    const id = result.rows[0].id;

    res.json({
      message: 'Outil ajouté',
      id,
      nom,
      qrUrl: `${baseUrl(req)}/qrcode/${id}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/delete-tool', async (req, res) => {
  try {
    const user = String(req.query.user || '');
    const pass = String(req.query.pass || '');
    const id = Number(req.query.id);

    if (!isAdmin(user, pass)) return res.status(401).send('Accès refusé');

    await q('DELETE FROM tools WHERE id = $1', [id]);
    res.send('Outil supprimé');
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur serveur');
  }
});

/* =========================
   QR
========================= */

app.get('/qrcode/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const url = `${baseUrl(req)}/outil.html?tool=${id}`;
    const qr = await QRCode.toDataURL(url);

    res.send(`
      <html>
      <head><meta charset="UTF-8"><title>QR outil ${id}</title></head>
      <body style="font-family:Arial;text-align:center;padding:24px">
        <h2>QR Code outil ${id}</h2>
        <img src="${qr}" style="max-width:320px;width:100%" />
        <p>${url}</p>
      </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send('Erreur QR');
  }
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur OK sur ${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Erreur init DB', e);
    process.exit(1);
  });
