// =====================================================================
//  Bénin Explorer — Back-end paiement Moneroo
//  Node.js + Express. À déployer sur Render (voir README.md).
//
//  Rôle :
//   1) POST /api/create-payment  -> crée un paiement Moneroo, renvoie l'URL de paiement
//   2) POST /api/webhook/moneroo -> reçoit la notification Moneroo, vérifie, débloque l'accès
//   3) GET  /api/access          -> l'appli demande "cet email a-t-il payé ?"
//   4) GET  /                    -> page de santé (pour vérifier que le serveur tourne)
//
//  👉 Les seules choses à régler sont les VARIABLES D'ENVIRONNEMENT (voir .env.example
//     et le README). Le code ci-dessous n'a normalement pas besoin d'être modifié,
//     sauf les 2 repères "⚙️ À CONFIRMER" si les noms de champs Moneroo diffèrent.
// =====================================================================

import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------
//  CONFIGURATION (vient des variables d'environnement — voir README/Render)
// ---------------------------------------------------------------------
const PORT              = process.env.PORT || 3000;                 // Render fournit PORT automatiquement
const MONEROO_SECRET    = process.env.MONEROO_SECRET_KEY || "";     // clé SECRÈTE Moneroo (sk_live_... / sk_test_...)
const PRICE             = parseInt(process.env.PRICE || "3000", 10);// montant en FCFA
const CURRENCY          = process.env.CURRENCY || "XOF";            // devise (XOF = Franc CFA)
const FRONTEND_URL      = process.env.FRONTEND_URL || "";           // URL publique de ton site (ex: https://benin-explorer.netlify.app)
const MONEROO_API       = "https://api.moneroo.io/v1";              // base de l'API Moneroo

// Autorise ton site à appeler ce serveur (CORS). Si FRONTEND_URL est vide -> autorise tout (à éviter en prod).
app.use(cors({ origin: FRONTEND_URL || true }));

// ---------------------------------------------------------------------
//  STOCKAGE DES ACCÈS PAYÉS
//  ⚠️ Version simple : un fichier JSON. Sur Render (offre gratuite), le disque est
//     EPHÉMÈRE : il est remis à zéro à chaque redéploiement/redémarrage.
//     Pour de la vraie production, remplace ce bloc par une base de données
//     (Render Postgres, Supabase, etc.). Cherche "// 🔁 REMPLACER PAR UNE VRAIE BASE".
// ---------------------------------------------------------------------
const DB_FILE = "./paid.json";
function loadPaid() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return {}; }
}
function savePaid(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error("savePaid", e.message); }
}
function markPaid(email, info) {          // 🔁 REMPLACER PAR UNE VRAIE BASE
  const db = loadPaid();
  db[email.toLowerCase()] = { paid: true, at: new Date().toISOString(), ...info };
  savePaid(db);
}
function hasPaid(email) {                  // 🔁 REMPLACER PAR UNE VRAIE BASE
  if (!email) return false;
  const db = loadPaid();
  return !!(db[email.toLowerCase()] && db[email.toLowerCase()].paid);
}

// ---------------------------------------------------------------------
//  1) CRÉER UN PAIEMENT
//     L'appli envoie { email, name }. On appelle Moneroo, on renvoie l'URL de paiement.
// ---------------------------------------------------------------------
app.post("/api/create-payment", async (req, res) => {
  try {
    const { email, name } = req.body || {};
    if (!email) return res.status(400).json({ error: "email manquant" });
    if (!MONEROO_SECRET) return res.status(500).json({ error: "MONEROO_SECRET_KEY non configurée sur le serveur" });

    const parts = String(name || "Client").trim().split(/\s+/);
    const first_name = parts[0] || "Client";
    const last_name  = parts.slice(1).join(" ") || parts[0] || "Client";

    // Après le paiement, Moneroo renvoie l'utilisateur ici (avec son email pour débloquer)
    const return_url = `${FRONTEND_URL}/?email=${encodeURIComponent(email)}&status=return`;

    // ⚙️ À CONFIRMER : structure du corps attendue par Moneroo (voir docs.moneroo.io)
    const body = {
      amount: PRICE,                 // ⚙️ À CONFIRMER : XOF = pas de décimales, donc 3000 = 3000 FCFA
      currency: CURRENCY,
      description: "Accès à vie — Bénin Explorer",
      customer: { email, first_name, last_name },
      return_url,
      metadata: { email }            // on retrouvera l'email dans le webhook
    };

    const r = await fetch(`${MONEROO_API}/payments/initialize`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MONEROO_SECRET}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    // ⚙️ À CONFIRMER : nom du champ de l'URL de paiement (souvent data.checkout_url)
    const checkoutUrl = data?.data?.checkout_url || data?.checkout_url || data?.data?.url;
    if (!r.ok || !checkoutUrl) {
      console.error("Moneroo init KO:", r.status, JSON.stringify(data));
      return res.status(502).json({ error: "Échec création paiement Moneroo", detail: data });
    }
    return res.json({ checkout_url: checkoutUrl });
  } catch (e) {
    console.error("create-payment", e);
    return res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
//  2) WEBHOOK MONEROO
//     Moneroo appelle cette route quand un paiement change d'état.
//     Pour être SÛR (sans dépendre de la signature), on revérifie le paiement
//     directement auprès de l'API Moneroo avant de débloquer l'accès.
// ---------------------------------------------------------------------
app.post("/api/webhook/moneroo", async (req, res) => {
  try {
    const evt = req.body || {};
    // ⚙️ À CONFIRMER : où se trouve l'id du paiement dans le webhook (souvent data.id)
    const paymentId = evt?.data?.id || evt?.id;
    if (!paymentId) return res.status(200).json({ ok: true }); // on répond 200 pour éviter les renvois en boucle

    // Re-vérification côté serveur = source de vérité
    const r = await fetch(`${MONEROO_API}/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${MONEROO_SECRET}`, "Accept": "application/json" }
    });
    const data = await r.json();
    const pay = data?.data || data;
    const status = String(pay?.status || "").toLowerCase();
    const email  = pay?.metadata?.email || pay?.customer?.email;

    // ⚙️ À CONFIRMER : la valeur de succès ("success" chez Moneroo)
    if (status === "success" && email) {
      markPaid(email, { paymentId, amount: pay?.amount });
      console.log("✅ Paiement confirmé:", email, paymentId);
    } else {
      console.log("ℹ️ Webhook reçu, statut =", status, "email =", email);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook", e);
    return res.status(200).json({ ok: true }); // toujours 200 pour ne pas déclencher de renvois
  }
});

// ---------------------------------------------------------------------
//  3) VÉRIFIER L'ACCÈS (l'appli demande : cet email a-t-il payé ?)
// ---------------------------------------------------------------------
app.get("/api/access", (req, res) => {
  const email = req.query.email;
  res.json({ paid: hasPaid(email) });
});

// (Optionnel) Vérifier un paiement à la volée au retour, si le webhook a du retard
app.get("/api/verify", async (req, res) => {
  try {
    const email = req.query.email;
    if (hasPaid(email)) return res.json({ paid: true });
    return res.json({ paid: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------
//  4) SANTÉ
// ---------------------------------------------------------------------
app.get("/", (_req, res) => res.send("Bénin Explorer backend ✓ (Moneroo)"));

app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
