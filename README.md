# Bénin Explorer — Back-end paiement Moneroo

Petit serveur Node/Express qui :
1. crée un paiement Moneroo (`POST /api/create-payment`) et renvoie l'URL de paiement,
2. reçoit la confirmation de Moneroo (`POST /api/webhook/moneroo`) et débloque l'accès,
3. dit à l'appli si un email a payé (`GET /api/access?email=...`).

La **clé secrète Moneroo reste sur ce serveur** — elle n'est jamais dans le site HTML.

---

## Déploiement sur Render — pas à pas

### 1. Mettre ce dossier sur GitHub
- Crée un dépôt GitHub (ex. `benin-explorer-backend`).
- Pousse **le contenu de ce dossier** (`server.js`, `package.json`, `.gitignore`, `render.yaml`, `README.md`).
- ⚠️ Ne pousse jamais de vraie clé : le `.gitignore` exclut déjà `.env` et `paid.json`.

### 2. Créer le service sur Render
- Va sur https://render.com → connecte-toi → **New +** → **Web Service**.
- Choisis **Build and deploy from a Git repository** → sélectionne ton dépôt.
- Réglages :
  - **Runtime** : Node
  - **Build Command** : `npm install`
  - **Start Command** : `npm start`
  - **Instance Type** : Free
  - (Si le code n'est pas à la racine du dépôt, mets le sous-dossier dans **Root Directory**.)

### 3. Ajouter les variables d'environnement  ← **SECTION À REMPLIR**
Onglet **Environment** → **Add Environment Variable**, ajoute :

| Clé | Valeur |
|-----|--------|
| `MONEROO_SECRET_KEY` | ta clé **secrète** Moneroo (`sk_live_...` ou `sk_test_...`) |
| `PRICE` | `3000` |
| `CURRENCY` | `XOF` |
| `FRONTEND_URL` | l'URL publique de ton site, **sans slash final** (ex. `https://benin-explorer.netlify.app`) |

> `PORT` est fourni automatiquement par Render — ne l'ajoute pas.

### 4. Déployer
- Clique **Create Web Service**. Render installe et démarre.
- Tu obtiens une URL du type `https://benin-explorer-backend.onrender.com`.
- Teste-la dans le navigateur : elle doit afficher `Bénin Explorer backend ✓ (Moneroo)`.

### 5. Configurer le webhook côté Moneroo  ← **À FAIRE dans le tableau de bord Moneroo**
- Dans Moneroo → **Développeurs / Webhooks**, ajoute l'URL :
  `https://TON-SERVICE.onrender.com/api/webhook/moneroo`
- C'est ce qui débloque l'accès automatiquement après un paiement réussi.

### 6. Relier le site au serveur  ← **SECTION À MODIFIER dans le HTML**
Dans `benin-explorer-saas.html`, tout en haut du script, mets ton URL Render :
```js
const BACKEND_URL = "https://TON-SERVICE.onrender.com";
```
Puis héberge le site (Netlify, Vercel, GitHub Pages…) sur l'URL que tu as mise dans `FRONTEND_URL`.

---

## Ce que tu dois modifier — résumé

- **Sur Render (Environment)** : `MONEROO_SECRET_KEY`, `FRONTEND_URL` (et si besoin `PRICE`, `CURRENCY`).
- **Dans le HTML** : la constante `BACKEND_URL`.
- **Dans Moneroo** : l'URL du webhook.
- **Dans `server.js`** : normalement **rien**. Deux exceptions possibles :
  - les 3 repères `⚙️ À CONFIRMER` (si les noms de champs de l'API Moneroo diffèrent de la doc) ;
  - le bloc `🔁 REMPLACER PAR UNE VRAIE BASE` si tu veux une persistance fiable (voir ci-dessous).

---

## ⚠️ Deux limites à connaître

1. **Offre gratuite Render = mise en veille.** Après ~15 min sans trafic, le service s'endort ; la 1ʳᵉ requête suivante met ~30–50 s à répondre (démarrage à froid). Sans gravité pour tester ; pour la prod, passe en offre payante ou ajoute un « ping » régulier.

2. **Stockage `paid.json` = éphémère.** Sur Render gratuit, le disque est remis à zéro à chaque redéploiement/redémarrage → tu peux perdre la liste des « payés ». Pour de la vraie prod, remplace les fonctions `markPaid` / `hasPaid` (repère `🔁 REMPLACER PAR UNE VRAIE BASE`) par une base de données (Render Postgres, Supabase…). Je peux te le faire quand tu veux.

---

## Tester en local (optionnel)
```bash
npm install
MONEROO_SECRET_KEY=sk_test_xxx PRICE=3000 CURRENCY=XOF FRONTEND_URL=http://localhost:5500 npm start
# serveur sur http://localhost:3000
```
