// ============================================================================
// Backend "Pixelfe Idle" (jeu Godot) — greffé sur le même serveur Node que
// Les Royaumes Brisés, mais entièrement isolé dans ce fichier : sa propre
// sauvegarde (server/data/idle.json, jamais comptes.json), ses propres
// routes (/api/idle/...) et son propre WebSocket (/idle-chat). Objectif :
// zéro risque de casser le jeu web existant en ajoutant ces fonctionnalités.
// server.js n'a que deux points d'accroche : gererRequeteHTTP (avant de
// servir les fichiers statiques) et gererUpgrade (avant wss RPG).
// ============================================================================

const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { WebSocketServer } = require("ws");

const CHEMIN_DONNEES = path.join(__dirname, "data", "idle.json");
let donnees = { comptes: {}, guildes: {} };

function charger() {
  try {
    donnees = JSON.parse(fs.readFileSync(CHEMIN_DONNEES, "utf8"));
  } catch {
    donnees = { comptes: {}, guildes: {} };
  }
  if (!donnees.comptes) donnees.comptes = {};
  if (!donnees.guildes) donnees.guildes = {};
}
charger();

let sauvegardeEnAttente = false;
function sauvegarder() {
  if (sauvegardeEnAttente) return;
  sauvegardeEnAttente = true;
  setImmediate(() => {
    sauvegardeEnAttente = false;
    try {
      fs.mkdirSync(path.dirname(CHEMIN_DONNEES), { recursive: true });
      fs.writeFileSync(CHEMIN_DONNEES, JSON.stringify(donnees));
    } catch (err) {
      console.error("Échec de sauvegarde idle.json :", err.message);
    }
  });
}

const TAILLE_MAX_CORPS = 10 * 1024;
function lireCorpsJSON(req) {
  return new Promise((resolve, reject) => {
    let corps = "";
    let tropGrand = false;
    req.on("data", (morceau) => {
      corps += morceau;
      if (corps.length > TAILLE_MAX_CORPS) {
        tropGrand = true;
        reject(new Error("Corps trop volumineux"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tropGrand) return;
      try {
        resolve(corps ? JSON.parse(corps) : {});
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

function repondreJSON(res, statut, donneesReponse) {
  res.writeHead(statut, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(donneesReponse));
}

function idGuildeAleatoire() {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const HP_BOSS_GUILDE_DEFAUT = 5000;

function assurerCompte(jeton, pseudo) {
  if (!donnees.comptes[jeton]) {
    donnees.comptes[jeton] = { pseudo: pseudo || "Aventurier", score: 0, guildeId: null };
  }
  if (pseudo) donnees.comptes[jeton].pseudo = String(pseudo).slice(0, 20);
  return donnees.comptes[jeton];
}

// --- Chat global (WebSocket séparé du jeu web RPG) --------------------------
const wssChat = new WebSocketServer({ noServer: true });
const clientsChat = new Set();
wssChat.on("connection", (ws) => {
  clientsChat.add(ws);
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "chat" && typeof msg.texte === "string" && typeof msg.pseudo === "string") {
      const payload = JSON.stringify({
        type: "chat",
        pseudo: msg.pseudo.slice(0, 20),
        texte: msg.texte.slice(0, 200),
      });
      for (const client of clientsChat) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }
  });
  ws.on("close", () => clientsChat.delete(ws));
});

function gererUpgrade(req, socket, head) {
  if (req.url.startsWith("/idle-chat")) {
    wssChat.handleUpgrade(req, socket, head, (ws) => wssChat.emit("connection", ws, req));
    return true;
  }
  return false;
}

// --- Routes HTTP -------------------------------------------------------------
function gererRequeteHTTP(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Enregistre/actualise le score du joueur (classement asynchrone) —
  // appelé périodiquement par le client Godot, pas de notion de "combat"
  // simulé serveur : le score est calculé côté client (puissance courante).
  if (req.method === "POST" && url.pathname === "/api/idle/enregistrer") {
    lireCorpsJSON(req)
      .then((corps) => {
        const jeton = String(corps.jeton || "").trim();
        const pseudo = String(corps.pseudo || "Aventurier").slice(0, 20);
        const score = Math.max(0, Math.floor(Number(corps.score) || 0));
        if (!jeton) return repondreJSON(res, 400, { erreur: "Jeton manquant." });
        const compte = assurerCompte(jeton, pseudo);
        compte.score = score;
        sauvegarder();
        repondreJSON(res, 200, { ok: true });
      })
      .catch(() => repondreJSON(res, 400, { erreur: "Requête invalide." }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/idle/classement") {
    const classement = Object.values(donnees.comptes)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((c) => ({ pseudo: c.pseudo, score: c.score }));
    repondreJSON(res, 200, { classement });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/idle/guilde/creer") {
    lireCorpsJSON(req)
      .then((corps) => {
        const jeton = String(corps.jeton || "").trim();
        const pseudo = String(corps.pseudo || "Aventurier").slice(0, 20);
        const nom = String(corps.nom || "").trim().slice(0, 24);
        if (!jeton || !nom) return repondreJSON(res, 400, { erreur: "Jeton ou nom manquant." });
        const compte = assurerCompte(jeton, pseudo);
        if (compte.guildeId && donnees.guildes[compte.guildeId]) {
          return repondreJSON(res, 409, { erreur: "Tu es déjà dans une guilde." });
        }
        const id = idGuildeAleatoire();
        donnees.guildes[id] = {
          nom,
          membres: [jeton],
          hpBoss: HP_BOSS_GUILDE_DEFAUT,
          hpBossMax: HP_BOSS_GUILDE_DEFAUT,
          victoires: 0,
        };
        compte.guildeId = id;
        sauvegarder();
        repondreJSON(res, 200, { ok: true, guildeId: id });
      })
      .catch(() => repondreJSON(res, 400, { erreur: "Requête invalide." }));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/idle/guilde/rejoindre") {
    lireCorpsJSON(req)
      .then((corps) => {
        const jeton = String(corps.jeton || "").trim();
        const pseudo = String(corps.pseudo || "Aventurier").slice(0, 20);
        const guildeId = String(corps.guildeId || "").trim();
        if (!jeton) return repondreJSON(res, 400, { erreur: "Jeton manquant." });
        const compte = assurerCompte(jeton, pseudo);
        const guilde = donnees.guildes[guildeId];
        if (!guilde) return repondreJSON(res, 404, { erreur: "Guilde introuvable." });
        if (compte.guildeId && compte.guildeId !== guildeId) {
          return repondreJSON(res, 409, { erreur: "Tu es déjà dans une guilde." });
        }
        if (!guilde.membres.includes(jeton)) guilde.membres.push(jeton);
        compte.guildeId = guildeId;
        sauvegarder();
        repondreJSON(res, 200, { ok: true });
      })
      .catch(() => repondreJSON(res, 400, { erreur: "Requête invalide." }));
    return true;
  }

  // Une "contribution" = un coup porté au boss commun de guilde — le client
  // envoie un montant de dégâts (dérivé de sa puissance courante), pas de
  // simulation de combat côté serveur pour rester simple.
  if (req.method === "POST" && url.pathname === "/api/idle/guilde/contribuer") {
    lireCorpsJSON(req)
      .then((corps) => {
        const jeton = String(corps.jeton || "").trim();
        const degats = Math.max(0, Math.floor(Number(corps.degats) || 0));
        const compte = donnees.comptes[jeton];
        if (!compte || !compte.guildeId) return repondreJSON(res, 400, { erreur: "Pas dans une guilde." });
        const guilde = donnees.guildes[compte.guildeId];
        if (!guilde) return repondreJSON(res, 404, { erreur: "Guilde introuvable." });

        guilde.hpBoss -= degats;
        let vaincu = false;
        if (guilde.hpBoss <= 0) {
          vaincu = true;
          guilde.victoires += 1;
          guilde.hpBossMax = Math.round(guilde.hpBossMax * 1.25);
          guilde.hpBoss = guilde.hpBossMax;
        }
        sauvegarder();
        repondreJSON(res, 200, {
          ok: true,
          hpBoss: Math.max(guilde.hpBoss, 0),
          hpBossMax: guilde.hpBossMax,
          vaincu,
          victoires: guilde.victoires,
        });
      })
      .catch(() => repondreJSON(res, 400, { erreur: "Requête invalide." }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/idle/guilde/info") {
    const jeton = String(url.searchParams.get("jeton") || "").trim();
    const compte = donnees.comptes[jeton];
    if (!compte || !compte.guildeId || !donnees.guildes[compte.guildeId]) {
      repondreJSON(res, 200, { guilde: null });
      return true;
    }
    const guilde = donnees.guildes[compte.guildeId];
    repondreJSON(res, 200, {
      guilde: {
        id: compte.guildeId,
        nom: guilde.nom,
        hpBoss: Math.max(guilde.hpBoss, 0),
        hpBossMax: guilde.hpBossMax,
        victoires: guilde.victoires,
        membres: guilde.membres.map((j) => (donnees.comptes[j] ? donnees.comptes[j].pseudo : "?")),
      },
    });
    return true;
  }

  return false;
}

module.exports = { gererRequeteHTTP, gererUpgrade };
