// Anti-triche / anti-automatisation (auto-clic, auto-farm, bots, agents IA).
//
// Principe : aucune détection n'est parfaite, on combine donc
//   1. des limites dures (cadence de messages, de chat, sockets par IP) ;
//   2. l'analyse de la cadence et de la régularité des appuis de touches
//      (un humain est irrégulier, une macro/un script non) ;
//   3. l'analyse du comportement de farm (beaucoup de kills sans bouger) ;
//   4. une vérification humaine périodique ("cliquez sur le symbole X"),
//      déclenchée aussi dès qu'un comportement est suspect ;
//   5. le signal de l'environnement client (navigateur piloté, événements
//      clavier/souris synthétiques), facile à falsifier mais qui écarte les
//      automatisations naïves et les agents pilotant un navigateur.
// Sanctions progressives : expulsion, puis bannissement 1 h / 24 h / 7 j,
// mémorisées par jeton (et par IP à partir de la 3e sanction).
//
// ANTICHEAT=off désactive tout (tests locaux).

const fs = require("fs");
const path = require("path");

const ACTIF = process.env.ANTICHEAT !== "off";
const CHEMIN = path.join(__dirname, "data", "sanctions.json");

const CODE_EXPULSE = 4001;
const CODE_BANNI = 4003;

const TOUCHES_SORTS = ["a", "z", "e", "r"];
const MSG_MAX_PAR_SECONDE = 200;
const CHAT_MAX = 5; // messages
const CHAT_FENETRE_MS = 10000;
const SOCKETS_MAX_PAR_IP = 8;

const VERIF_DELAI_MS = 45000;
const VERIF_REACTION_MIN_MS = 400;
const VERIF_INTERVALLE_MIN_MS = 30 * 60 * 1000;
const VERIF_INTERVALLE_ALEA_MS = 20 * 60 * 1000;
const VERIF_ECART_MIN_SUSPECT_MS = 3 * 60 * 1000;

const SYMBOLES = [
  { id: "epee", label: "l'épée", emoji: "⚔️" },
  { id: "bouclier", label: "le bouclier", emoji: "🛡️" },
  { id: "potion", label: "la potion", emoji: "🧪" },
  { id: "gemme", label: "la gemme", emoji: "💎" },
  { id: "etoile", label: "l'étoile", emoji: "⭐" },
  { id: "cle", label: "la clé", emoji: "🔑" },
  { id: "coeur", label: "le cœur", emoji: "❤️" },
  { id: "lune", label: "la lune", emoji: "🌙" },
];

let sanctions = {}; // "j:<jeton>" | "ip:<adresse>" -> { strikes, dernier, banJusqua }
try {
  sanctions = JSON.parse(fs.readFileSync(CHEMIN, "utf8")) || {};
} catch {
  sanctions = {};
}
function sauver() {
  try {
    fs.mkdirSync(path.dirname(CHEMIN), { recursive: true });
    fs.writeFileSync(CHEMIN, JSON.stringify(sanctions));
  } catch (err) {
    console.error("Anti-triche : sauvegarde des sanctions impossible :", err.message);
  }
}

const socketsParIp = new Map();

function dureeBan(strikes) {
  if (strikes <= 1) return 0; // 1re : simple expulsion
  if (strikes === 2) return 60 * 60 * 1000;
  if (strikes === 3) return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function messageBan(ms) {
  const min = Math.ceil(ms / 60000);
  return min >= 120 ? `${Math.ceil(min / 60)} h` : `${min} min`;
}

// Vérifie à la connexion. Retourne null si OK, sinon { code, raison }.
function verifierConnexion(jeton, ip) {
  if (!ACTIF) return null;
  const maintenant = Date.now();
  for (const cle of [jeton ? `j:${jeton}` : null, `ip:${ip}`]) {
    const s = cle && sanctions[cle];
    if (s && s.banJusqua > maintenant) {
      return { code: CODE_BANNI, raison: `Accès suspendu (comportement automatisé). Réessayez dans ${messageBan(s.banJusqua - maintenant)}.` };
    }
  }
  if ((socketsParIp.get(ip) || 0) >= SOCKETS_MAX_PAR_IP) {
    return { code: CODE_EXPULSE, raison: "Trop de connexions depuis cette adresse." };
  }
  return null;
}

function stats(valeurs) {
  const n = valeurs.length;
  let somme = 0;
  for (const v of valeurs) somme += v;
  const moyenne = somme / n;
  let variance = 0;
  for (const v of valeurs) variance += (v - moyenne) * (v - moyenne);
  return { moyenne, cv: moyenne > 0 ? Math.sqrt(variance / n) / moyenne : 0 };
}

// Crée le suivi d'une connexion. `joueur` : objet joueur du serveur.
function creerSuivi(ws, joueur, jeton, ip) {
  const s = {
    ws, joueur, jeton, ip,
    msgs: [], // horodatages des derniers messages
    chat: [],
    precedent: {},
    appuis: { a: [], z: [], e: [], r: [] },
    dernierInput: 0,
    verif: null, // { nonce, envoye, attendu }
    prochaineVerif: Date.now() + VERIF_INTERVALLE_MIN_MS + Math.random() * VERIF_INTERVALLE_ALEA_MS,
    derniereVerif: 0,
    suspicions: 0,
    historique: [], // { t, kills, x } toutes les 10 s
    envNonFiables: 0,
    ferme: false,
  };
  if (ACTIF) socketsParIp.set(ip, (socketsParIp.get(ip) || 0) + 1);
  return s;
}

function liberer(s) {
  if (!ACTIF || s.liberee) return;
  s.liberee = true;
  const n = (socketsParIp.get(s.ip) || 1) - 1;
  if (n <= 0) socketsParIp.delete(s.ip);
  else socketsParIp.set(s.ip, n);
}

function sanctionner(s, raison) {
  if (s.ferme) return;
  s.ferme = true;
  const maintenant = Date.now();
  const cles = [s.jeton ? `j:${s.jeton}` : null].filter(Boolean);
  let strikes = 1;
  for (const cle of cles) {
    let e = sanctions[cle];
    if (!e || maintenant - e.dernier > 30 * 24 * 60 * 60 * 1000) e = { strikes: 0, dernier: 0, banJusqua: 0 };
    e.strikes++;
    e.dernier = maintenant;
    e.banJusqua = dureeBan(e.strikes) ? maintenant + dureeBan(e.strikes) : 0;
    e.derniereRaison = raison;
    sanctions[cle] = e;
    strikes = e.strikes;
  }
  if (strikes >= 3) {
    const cle = `ip:${s.ip}`;
    const e = sanctions[cle] || { strikes: 0, dernier: 0, banJusqua: 0 };
    e.strikes = strikes;
    e.dernier = maintenant;
    e.banJusqua = maintenant + dureeBan(strikes);
    sanctions[cle] = e;
  }
  sauver();
  console.warn(`Anti-triche : sanction #${strikes} (${raison}) joueur ${s.joueur && s.joueur.id} ip ${s.ip}`);
  const ban = dureeBan(strikes);
  const texte = ban
    ? `Comportement automatisé détecté (${raison}). Accès suspendu ${messageBan(ban)}.`
    : `Comportement automatisé détecté (${raison}). Prochaine fois : suspension du compte.`;
  try {
    s.ws.send(JSON.stringify({ type: "sanction", texte, ban: !!ban }));
    s.ws.close(ban ? CODE_BANNI : CODE_EXPULSE, texte.slice(0, 120));
  } catch {}
}

// Suspicion : envoie une vérification humaine (au plus une toutes les 3 min).
function suspecter(s, raison) {
  s.suspicions++;
  console.warn(`Anti-triche : suspicion (${raison}) joueur ${s.joueur && s.joueur.id}`);
  const maintenant = Date.now();
  if (!s.verif && maintenant - s.derniereVerif > VERIF_ECART_MIN_SUSPECT_MS) lancerVerif(s, raison);
  // Suspicions répétées malgré des vérifications réussies : expulsion.
  if (s.suspicions >= 4) sanctionner(s, "automatisation répétée");
}

function lancerVerif(s, raison) {
  if (s.verif || s.ferme) return;
  const melange = SYMBOLES.slice().sort(() => Math.random() - 0.5).slice(0, 4);
  const attendu = melange[Math.floor(Math.random() * melange.length)];
  const maintenant = Date.now();
  s.verif = { nonce: Math.random().toString(36).slice(2), envoye: maintenant, attendu: attendu.id, raison };
  s.derniereVerif = maintenant;
  s.joueur.invulnerableRestant = Math.max(s.joueur.invulnerableRestant || 0, VERIF_DELAI_MS / 1000 + 2);
  try {
    s.ws.send(JSON.stringify({
      type: "verif", nonce: s.verif.nonce, delai: VERIF_DELAI_MS,
      consigne: `Vérification anti-bot : cliquez sur ${attendu.label}.`,
      options: melange.map((m) => ({ id: m.id, emoji: m.emoji })),
    }));
  } catch {}
}

function repondreVerif(s, msg) {
  const v = s.verif;
  if (!v || msg.nonce !== v.nonce) return;
  const delai = Date.now() - v.envoye;
  s.verif = null;
  s.prochaineVerif = Date.now() + VERIF_INTERVALLE_MIN_MS + Math.random() * VERIF_INTERVALLE_ALEA_MS;
  if (msg.choix !== v.attendu) return sanctionner(s, "vérification échouée");
  if (delai < VERIF_REACTION_MIN_MS) return sanctionner(s, "réponse inhumaine");
  if (msg.fiable === false) return sanctionner(s, "clic synthétique");
}

// Signale l'environnement (navigateur piloté, événements non fiables).
function noterEnvironnement(s, msg) {
  if (!ACTIF) return;
  if (msg.webdriver === true) return sanctionner(s, "navigateur automatisé");
  const nf = Math.max(0, Math.min(1e6, Number(msg.nonFiables) || 0));
  s.envNonFiables = nf;
  if (nf >= 5) sanctionner(s, "touches simulées");
}

// Appelé pour CHAQUE message reçu. Retourne false si le message est à ignorer.
function noterMessage(s, message) {
  if (!ACTIF) return true;
  const t = Date.now();
  s.msgs.push(t);
  while (s.msgs.length && t - s.msgs[0] > 1000) s.msgs.shift();
  if (s.msgs.length > MSG_MAX_PAR_SECONDE) {
    sanctionner(s, "inondation de messages");
    return false;
  }
  if (s.ferme) return false;
  if (message.type === "chat") {
    s.chat.push(t);
    while (s.chat.length && t - s.chat[0] > CHAT_FENETRE_MS) s.chat.shift();
    if (s.chat.length > CHAT_MAX) {
      if (s.chat.length > CHAT_MAX * 4) sanctionner(s, "spam de chat");
      return false;
    }
  } else if (message.type === "verif") {
    repondreVerif(s, message);
    return false;
  } else if (message.type === "env") {
    noterEnvironnement(s, message);
    return false;
  } else if (message.type === "input") {
    analyserInput(s, message, t);
  }
  return true;
}

function analyserInput(s, m, t) {
  s.dernierInput = t;
  for (const k of TOUCHES_SORTS) {
    const actuel = !!m[k];
    if (actuel && !s.precedent[k]) {
      const liste = s.appuis[k];
      liste.push(t);
      if (liste.length > 90) liste.shift();
      verifierCadence(s, k, t);
    }
    s.precedent[k] = actuel;
  }
}

function verifierCadence(s, touche, t) {
  const liste = s.appuis[touche];
  // Cadence : tous sorts confondus, sur 5 s (lissage des rafales réseau).
  let total5s = 0;
  let total1s = 0;
  for (const k of TOUCHES_SORTS) {
    for (let i = s.appuis[k].length - 1; i >= 0; i--) {
      const age = t - s.appuis[k][i];
      if (age > 5000) break;
      total5s++;
      if (age <= 1000) total1s++;
    }
  }
  if (total5s >= 45 || total1s >= 16) return sanctionner(s, "auto-clic (cadence)");
  // Régularité : ≥ 40 intervalles quasi identiques = macro.
  if (liste.length >= 41) {
    const intervalles = [];
    for (let i = liste.length - 40; i < liste.length; i++) intervalles.push(liste[i] - liste[i - 1]);
    if (intervalles.every((v) => v > 0 && v < 2500)) {
      const { moyenne, cv } = stats(intervalles);
      if (moyenne >= 60 && cv < 0.035) {
        s.appuis[touche] = []; // repart de zéro : une seule suspicion par série
        suspecter(s, "auto-clic (régularité)");
      }
    }
  }
}

// Appelé toutes les secondes depuis la boucle du serveur.
function tick(s) {
  if (!ACTIF || s.ferme) return;
  const t = Date.now();
  if (s.verif && t - s.verif.envoye > VERIF_DELAI_MS + 3000) {
    s.verif = null;
    return sanctionner(s, "vérification sans réponse");
  }
  // Vérification périodique, seulement pour un joueur qui joue activement.
  if (!s.verif && t >= s.prochaineVerif) {
    if (t - s.dernierInput < 60000) lancerVerif(s, "périodique");
    else s.prochaineVerif = t + 5 * 60 * 1000;
  }
  // Échantillon de comportement toutes les 10 s.
  const j = s.joueur;
  const dernier = s.historique[s.historique.length - 1];
  if (!dernier || t - dernier.t >= 10000) {
    s.historique.push({ t, kills: (j.statsVie && j.statsVie.monstresTues) || 0, x: j.x, zone: j.zone });
    while (s.historique.length > 61) s.historique.shift();
    analyserFarm(s, t);
  }
}

function analyserFarm(s, t) {
  const h = s.historique;
  if (h.length < 61) return; // 10 min d'historique
  const debut = h[0];
  const fin = h[h.length - 1];
  const kills = fin.kills - debut.kills;
  // Depuis la dernière suspicion, on laisse passer 10 min avant de re-juger.
  if (t - (s.dernierJugementFarm || 0) < 10 * 60 * 1000) return;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const e of h) {
    if (e.zone !== debut.zone) return; // a changé de carte : pas un farm statique
    xMin = Math.min(xMin, e.x);
    xMax = Math.max(xMax, e.x);
  }
  if (kills >= 150 && xMax - xMin < 150) {
    s.dernierJugementFarm = t;
    suspecter(s, "farm immobile");
  } else if (kills >= 400) {
    s.dernierJugementFarm = t;
    suspecter(s, "cadence de kills inhumaine");
  }
}

module.exports = {
  ACTIF, CODE_EXPULSE, CODE_BANNI,
  verifierConnexion, creerSuivi, liberer, noterMessage, tick, sanctionner,
};
