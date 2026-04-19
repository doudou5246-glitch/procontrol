ProControl - version Render + Neon

Ce pack est conçu pour éviter les problèmes de réseau local.
Objectif : une vraie URL web pour téléphone + QR code.

Étapes :
1. Créer un repo GitHub
2. Uploader ce projet dans le repo
3. Créer une base gratuite Neon
4. Copier la DATABASE_URL Neon
5. Créer un Web Service gratuit sur Render
6. Lier le repo GitHub
7. Définir les variables :
   - DATABASE_URL
   - PUBLIC_BASE_URL
   - NODE_ENV=production

Tests locaux :
npm install
set DATABASE_URL=ta_chaine_postgres
npm start

Important :
- Cette version utilise PostgreSQL, pas SQLite
- Le QR code s'appuie sur PUBLIC_BASE_URL une fois en ligne
