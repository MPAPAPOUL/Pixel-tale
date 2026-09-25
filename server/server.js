// ============================================================================
// Serveur — Les Royaumes Brisés (prototype web)
// ----------------------------------------------------------------------------
// Comme pour le premier prototype : le serveur est la SEULE source de
// vérité. Les clients envoient uniquement leur état d'input ("je tiens la
// flèche droite", "je viens d'appuyer sur saut") ; c'est le serveur qui
// calcule la physique (gravité, collisions, saut) à un rythme fixe, puis
// diffuse la position résultante à tout le monde. Le client ne fait que
// dessiner ce qu'on lui envoie.
// ============================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { WebSocketServer } = require("ws");

// process.env.PORT : hébergeurs comme Glitch/Render/Railway imposent leur
// propre port via cette variable d'environnement — 3000 reste le repli pour
// une exécution en local (voir README).
const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, "..", "client");

// ---------------------------------------------------------------------------
// Configuration du monde et de la physique
// ---------------------------------------------------------------------------

// Deux mondes séparés : Vert-Hige (l'île principale, 0 → MONDE_LARGEUR_VERTHIGE)
// et l'Antre du Sire-Hano, une VRAIE map à part (sa propre plage de
// coordonnées, à partir de x=0 elle aussi). On passe de l'une à l'autre en
// franchissant la porte du donjon — chaque joueur qui la franchit obtient sa
// propre instance de l'arène (son propre combat contre Sire-Hano), pas un
// espace partagé par tout le serveur. PORTE_DONJON_X reste la position de la
// porte dans Vert-Hige (mur invisible tant que la clé n'est pas complète).
const PORTE_DONJON_X = 2400;
const MONDE_LARGEUR_VERTHIGE = PORTE_DONJON_X + 60;
const LARGEUR_ARENE_DONJON = 1380; // arène agrandie (était 760)
const MONDE_HAUTEUR = 640; // hauteur commune aux deux mondes

const JOUEUR_LARGEUR = 36;
// La hitbox va du bas (pieds, ancrés au sol — voir toutes les affectations
// "p.y = ... - JOUEUR_HAUTEUR" ci-dessous) vers le HAUT. Le sprite dessiné
// côté client (voir dessinerSprite/dessinerJoueurs) est nettement plus
// grand que l'ancienne hitbox de 48 — la hitbox ne couvrait alors qu'un
// peu moins de la moitié du personnage visible, du bassin aux pieds,
// laissant tout le torse/la tête hors de portée des coups (aussi bien pour
// toucher un monstre au corps-à-corps que pour se faire toucher). 103
// correspond à la hauteur RÉELLEMENT dessinée du sprite (48 × l'ancien
// facteur d'échelle 2.15 côté client) : la hitbox couvre maintenant tout
// le personnage visible, sans changer sa taille à l'écran (voir la
// réduction correspondante du facteur d'échelle côté client).
const JOUEUR_HAUTEUR = 103;
// Facteur d'aplatissement vertical à l'accroupissement — DOIT rester égal au
// squashY du sprite côté client (voir dessinerJoueurs, "const squashY =
// p.accroupi ? 0.62 : 1"), sans quoi les sorts partiraient d'une hauteur qui
// ne correspond plus au personnage affiché à l'écran.
const FACTEUR_HAUTEUR_ACCROUPI = 0.62;

const GRAVITE = 1800; // px/s²
const VITESSE_DEPLACEMENT = 230; // px/s
const VITESSE_SAUT = -640; // px/s (négatif = vers le haut)
const VITESSE_CHUTE_MAX = 900; // px/s

const TICK_MS = 1000 / 30; // 30 mises à jour physiques par seconde
const HP_REGEN_PAR_SECONDE = 2; // régénération de vie passive de base (PV/s) — voir aussi le bonus "regenPv" de l'équipement légendaire/mythique

// Plateformes statiques de la zone (rectangles). La première est le sol
// général de l'île — cohérent avec le GDD : les bords sont sécurisés, on ne
// peut pas tomber dans le vide. Les autres forment le relief à explorer.
// Écarts calibrés pour la physique actuelle (saut ≈ 110px de haut,
// ≈ 160px de large en vol) — à retoucher au playtest si besoin.
const PLATEFORMES_VERTHIGE = [
  { x: 0, y: 600, width: MONDE_LARGEUR_VERTHIGE, height: 40 }, // sol
  { x: 60, y: 480, width: 120, height: 24 },
  { x: 260, y: 420, width: 140, height: 24 },
  { x: 460, y: 500, width: 160, height: 24 },
  { x: 680, y: 420, width: 120, height: 24 },
  { x: 860, y: 340, width: 140, height: 24 },
  { x: 1060, y: 460, width: 160, height: 24 },
  { x: 1260, y: 400, width: 120, height: 24 },
  { x: 1260, y: 290, width: 120, height: 24 }, // tour au-dessus de la précédente
  { x: 1460, y: 520, width: 180, height: 24 },
  { x: 1700, y: 430, width: 120, height: 24 },
  { x: 1880, y: 350, width: 140, height: 24 },
  { x: 2080, y: 470, width: 160, height: 24 },
  { x: 2280, y: 560, width: 100, height: 24 },
];

// Arène de l'Antre du Sire-Hano — map à part entière, coordonnées locales
// (x=0 = mur d'entrée / porte retour vers Vert-Hige). Agrandie pour laisser
// plus de place aux 3 mobs à traquer, au combat de boss à plusieurs
// répliques, et aux déplacements verticaux.
const PLATEFORMES_DONJON = [
  { x: 0, y: 600, width: LARGEUR_ARENE_DONJON, height: 40 }, // sol de lave figée
  { x: 80, y: 520, width: 150, height: 24 },
  { x: 300, y: 440, width: 150, height: 24 },
  { x: 540, y: 500, width: 150, height: 24 },
  { x: 760, y: 400, width: 160, height: 24 },
  { x: 620, y: 300, width: 140, height: 24 }, // à-pic au-dessus de l'arène centrale
  { x: 960, y: 520, width: 160, height: 24 },
  { x: 1180, y: 430, width: 150, height: 24 },
];

// Deux Troubalourd, chacun patrouillant sur sa plateforme d'origine.
// (voir plus bas : les monstres sont créés après leur configuration)

// Chaque classe a 4 actions : 3 sorts de base (touches A / Z / E) et une
// ultime (touche R, cooldown long). Types possibles :
// - "melee"      : frappe en mêlée dans la direction du regard
// - "projectile" : tir qui vole en ligne droite ; "transperce: true" = ne
//                   s'arrête pas au premier monstre touché
// - "dash"       : charge rapide vers l'avant qui inflige des dégâts au
//                   contact pendant le déplacement
// - "aoe"        : explosion de zone autour (ou légèrement devant) le
//                   joueur, sans notion de trajectoire

const CLASSES = {
  dorken: {
    label: "Dorken",
    couleur: "#c1502e",
    hpMax: 120,
    manaMax: 60,
    manaRegen: 8, // mana par seconde
    attaques: {
      a: { nom: "Coup d'épée", type: "melee", degats: 14, cooldown: 0.5, portee: 54, coutMana: 8 },
      z: { nom: "Frappe lourde", type: "melee", degats: 26, cooldown: 1.1, portee: 54, coutMana: 18 },
      e: { nom: "Charge", type: "dash", degats: 10, cooldown: 2.5, duree: 0.22, vitesseDash: 900, coutMana: 20 },
      r: { nom: "Cri de guerre", type: "aoe", degats: 40, cooldown: 9, portee: 0, rayon: 110, coutMana: 45 },
    },
  },
  quater: {
    label: "Quater",
    couleur: "#4f9d69",
    hpMax: 80,
    manaMax: 80,
    manaRegen: 10,
    // decalageY : remonte le point de départ des flèches de 2px par rapport
    // au centre du joueur (demande explicite, elles partaient trop bas).
    attaques: {
      a: { nom: "Tir rapide", type: "projectile", degats: 9, cooldown: 0.35, vitesse: 620, rayon: 5, porteeMax: 650, coutMana: 6, decalageY: -2 },
      z: { nom: "Tir puissant", type: "projectile", degats: 20, cooldown: 1.0, vitesse: 480, rayon: 7, porteeMax: 700, coutMana: 16, decalageY: -2 },
      e: { nom: "Tir perçant", type: "projectile", degats: 14, cooldown: 1.4, vitesse: 550, rayon: 6, porteeMax: 750, transperce: true, coutMana: 20, decalageY: -2 },
      r: { nom: "Volée de flèches", type: "volee", degats: 14, cooldown: 8, vitesse: 620, rayon: 6, porteeMax: 700, nombre: 5, ecartY: 12, coutMana: 40, decalageY: -2 },
    },
  },
  krix: {
    label: "Krix",
    couleur: "#5b7fc7",
    hpMax: 60,
    manaMax: 100,
    manaRegen: 12,
    attaques: {
      a: { nom: "Griffe arcane", type: "projectile", degats: 10, cooldown: 0.4, vitesse: 700, rayon: 5, porteeMax: 150, coutMana: 8, effet: "griffe_arcane" },
      z: { nom: "Éclair", type: "projectile", degats: 18, cooldown: 0.85, vitesse: 500, rayon: 7, porteeMax: 650, coutMana: 16, effet: "eclair" },
      e: { nom: "Boule de feu", type: "projectile", degats: 30, cooldown: 1.6, vitesse: 320, rayon: 12, porteeMax: 700, coutMana: 26, effet: "boule_feu" },
      r: { nom: "Explosion arcanique", type: "aoe", degats: 45, cooldown: 9, portee: 160, rayon: 90, coutMana: 45, effet: "explosion_arcanique" },
    },
  },
};
const ORDRE_CLASSES = Object.keys(CLASSES);
const TOUCHES_SORTS = ["a", "z", "e", "r"];

// --- Apparence (écran de création) -----------------------------------------
// Palettes fermées plutôt qu'une couleur hex libre envoyée par le client :
// évite qu'un client trafiqué n'envoie une valeur absurde (ou non-couleur)
// qui casserait le rendu chez tout le monde, puisque `apparence` est
// diffusée publiquement (voir construireEtatPourJoueur). Les couleurs
// doivent rester en phase avec la palette du client (voir PALETTE_CHEVEUX /
// PALETTE_YEUX dans index.html) — la première valeur de chaque liste est la
// teinte d'origine du sprite (voir le commentaire sur `apparence` dans
// creerJoueur).
const PALETTE_CHEVEUX = ["#c9c9c9", "#2b2b2b", "#6b4a2c", "#b35a2e", "#d9b654", "#3a4a7a"];
const PALETTE_YEUX = ["#448636", "#3b6fd6", "#6b4a2c", "#d19a3d", "#8b3bd6", "#8a95a1"];
// Vêtements : pas de valeur par défaut (voir apparence dans creerJoueur,
// couleurVetements: null) — contrairement aux cheveux/yeux, l'armure/robe
// garde la teinte d'origine de la classe tant que le joueur n'a rien choisi.
const PALETTE_VETEMENTS = ["#c1502e", "#4f9d69", "#4f6fb0", "#7c5cc9", "#d9b654", "#3a3a3a", "#e8e8e8"];

// ---------------------------------------------------------------------------
// Monstres
// ---------------------------------------------------------------------------
// Pour ce premier monstre, on garde l'IA la plus simple possible : une
// patrouille de gauche à droite sur sa plateforme d'origine, sans gravité
// propre (il reste "collé" au sommet de sa plateforme). Le combat (dégâts
// au joueur, PV qui baissent) viendra dans une prochaine étape.

// `largeur`/`hauteur` définissent la hitbox de collision (dégâts au contact,
// portée des attaques joueur — voir rectanglesSeChevauchent) ET, côté
// client, la hauteur de rendu du sprite (largeur affichée dérivée du ratio
// naturel de l'image elle-même, voir dessinerSprite) : `hauteur` pilote donc
// déjà fidèlement la taille affichée, mais `largeur` doit être ajustée à la
// main pour rester cohérente avec le ratio largeur/hauteur RÉEL du sprite
// (idle/walk/attack), sans quoi la hitbox déborde très largement du dessin
// (rendant les coups "injustes", dans un sens ou l'autre) ou, à l'inverse,
// laisse le sprite très excentré par rapport à sa propre boîte de collision.
// Valeurs ci-dessous recalculées à partir de la moyenne des ratios
// largeur/hauteur des 3 frames (idle/walk/attack) de chaque sprite, hauteur
// inchangée pour ne pas perturber le gabarit vertical déjà équilibré
// (plateformes, portée de saut par-dessus un monstre, etc.).
const MONSTRES_CONFIG = {
  troubalourd: {
    label: "Troubalourd",
    couleur: "#8a5b3f",
    largeur: 59, // sprite large et trapu (ratio moyen ≈1.13) — était 44, trop étroit
    hauteur: 52,
    vitesse: 55,
    hpMax: 40,
    degatsContact: 10,
    delaiRespawn: 8,
    comportement: "patrouille",
    xp: 8,
  },
  fisselo: {
    label: "Fisselo",
    couleur: "#d99a3f",
    largeur: 20, // sprite plus haut que large (ratio moyen ≈0.78) — était 26 (carré)
    hauteur: 26,
    hitboxLargeur: 40, // zone de collision doublée (voir hitboxMonstre) — le sprite garde sa taille ci-dessus, trop petit pour viser vu sa vitesse erratique
    hitboxHauteur: 52,
    vitesse: 140, // rapide et erratique
    hpMax: 14,
    degatsContact: 5,
    delaiRespawn: 6,
    comportement: "erratique",
    xp: 4,
  },
  tiralark: {
    label: "Tiralark",
    couleur: "#6a8a4f",
    largeur: 40, // ratio moyen ≈0.87 — était 32, légèrement trop étroit
    hauteur: 46,
    vitesse: 40,
    hpMax: 24,
    degatsContact: 6,
    delaiRespawn: 7,
    comportement: "tireur",
    // Configuration du tir du Tiralark (indépendante des sorts joueurs).
    tir: { degats: 8, cooldown: 1.8, vitesse: 340, rayon: 5, porteeMax: 500 },
    xp: 6,
  },
  // Mob élite de l'Antre du Sire-Hano, ajouté aux 3 gabarits historiques
  // (voir TYPES_MOBS_DONJON) — sprite dédié (voir SPRITES_MONSTRES.minotaure
  // côté client), nettement plus costaud pour marquer sa rareté.
  minotaure: {
    label: "Minotaure",
    couleur: "#5a5248",
    largeur: 56, // ratio moyen ≈0.97 (large de carrure) — était 40, trop étroit
    hauteur: 58,
    vitesse: 48,
    hpMax: 90,
    degatsContact: 16,
    delaiRespawn: 10,
    comportement: "patrouille",
    xp: 18,
  },
};

// Compteur global : garantit un id UNIQUE par monstre. L'ancien id dérivé de
// `type` + position de plateforme (`mob-${type}-${x}`) collisionnait dès que
// deux monstres du même type se retrouvaient sur la même plateforme —
// notamment dans les biomes (genererZoneBiome), où la plateforme de chaque
// monstre est tirée au hasard AVEC remise parmi les plateformes surélevées :
// deux monstres partageant alors le même id, le client (qui indexe le hp
// précédent par id, voir hpMonstresPrecedents/detecterImpacts côté client)
// comparait le hp de l'un à celui de l'autre à chaque tick dès qu'ils
// avaient des PV différents, ce qui produisait un nombre de dégâts flottant
// erroné en continu (à l'infini, jamais juste une fois) sur l'un des deux —
// bug reproduit sur un monstre de Crêtes d'Ambre.
let prochainMonstreId = 1;

function creerMonstre(type, plateforme) {
  const cfg = MONSTRES_CONFIG[type];
  const monstre = {
    id: `mob-${type}-${prochainMonstreId++}`,
    type,
    x: plateforme.x + plateforme.width / 2 - cfg.largeur / 2,
    y: plateforme.y - cfg.hauteur,
    vx: 0,
    facing: 1,
    hp: cfg.hpMax,
    hpMax: cfg.hpMax,
    morte: false,
    respawnRestant: 0,
    attaqueAnimRestant: 0, // fenêtre pendant laquelle le client affiche le sprite d'attaque
  };

  if (cfg.comportement === "patrouille" || cfg.comportement === "erratique") {
    monstre.x = plateforme.x + 8;
    monstre.vx = cfg.vitesse;
    monstre.borneGauche = plateforme.x + 6;
    monstre.borneDroite = plateforme.x + plateforme.width - cfg.largeur - 6;
  }
  if (cfg.comportement === "erratique") {
    monstre.prochainChangement = 0.3 + Math.random() * 0.6;
  }
  if (cfg.comportement === "tireur") {
    // Décalage initial aléatoire pour que plusieurs Tiralark ne tirent pas
    // exactement en même temps.
    monstre.cooldownTir = Math.random() * cfg.tir.cooldown;
  }

  // Position de réapparition : pour "patrouille"/"erratique" c'est le bord
  // gauche de leur zone de patrouille, pour "tireur" (immobile) c'est
  // simplement là où il a été placé au départ.
  monstre.xApparition = monstre.x;

  return monstre;
}

// Six monstres : deux de chaque espèce, sur des plateformes différentes.
const monstres = [
  creerMonstre("troubalourd", PLATEFORMES_VERTHIGE[5]), // plateforme x:860
  creerMonstre("troubalourd", PLATEFORMES_VERTHIGE[10]), // plateforme x:1700
  creerMonstre("fisselo", PLATEFORMES_VERTHIGE[2]), // plateforme x:260
  creerMonstre("fisselo", PLATEFORMES_VERTHIGE[9]), // plateforme x:1460
  creerMonstre("tiralark", PLATEFORMES_VERTHIGE[7]), // plateforme x:1260
  creerMonstre("tiralark", PLATEFORMES_VERTHIGE[12]), // plateforme x:2080
];

// ---------------------------------------------------------------------------
// Donjon : L'Antre du Sire-Hano — clé de groupe + boss
// ---------------------------------------------------------------------------
// Pas de système de groupe formel pour cette verticale-slice (question
// encore ouverte dans le GDD) : la clé est donc un pot commun partagé par
// TOUT le serveur — cohérent avec l'esprit "jouer ensemble" du choix
// d'une clé de groupe plutôt qu'individuelle. Chaque Fisselo/Troubalourd/
// Tiralark tué a une chance de faire tomber un fragment ; une fois les
// fragments réunis, la porte du donjon reste ouverte DÉFINITIVEMENT pour
// tout le monde — mais chaque joueur qui la franchit obtient sa PROPRE
// instance de l'Antre (sa propre tentative contre Sire-Hano), pas un espace
// partagé : voir la section "Zones" plus bas.

const FRAGMENTS_CLE_REQUIS = 3;
const CHANCE_DROP_FRAGMENT = 0.5; // par monstre de base tué, tant que la clé n'est pas complète

const donjon = {
  fragments: 0,
  fragmentsRequis: FRAGMENTS_CLE_REQUIS,
  ouvert: false,
  dernierPassageTs: 0, // Date.now() du dernier passage — purement visuel, voir entrerDonjon
};

function essayerDropFragment() {
  if (donjon.ouvert) return; // porte déjà ouverte, plus besoin de fragments
  if (donjon.fragments >= donjon.fragmentsRequis) return;
  if (Math.random() < CHANCE_DROP_FRAGMENT) {
    donjon.fragments++;
    if (donjon.fragments >= donjon.fragmentsRequis) donjon.ouvert = true;
  }
}

// Butin des monstres de l'Antre du Sire-Hano : 10% de chance de laisser
// tomber une arme (épée / arc / bâton), stockée dans l'inventaire PERSONNEL
// du joueur qui a porté le coup fatal — un simple compteur par type pour
// cette verticale-slice, pas encore d'équipement.
const TYPES_ARMES = {
  epee: { label: "Épée", emoji: "🗡️" },
  arc: { label: "Arc", emoji: "🏹" },
  baton: { label: "Bâton", emoji: "🪄" },
};
const ORDRE_ARMES = Object.keys(TYPES_ARMES);

// Objets d'accessoire (casque / jambières / anneau / bottes / bracelet) :
// même principe que les armes, un item "normal" par emplacement pouvant
// tomber des mobs de l'Antre, voir STATS_CASQUE et consorts plus bas pour
// leurs bonus. Regroupés avec ORDRE_ARMES dans le tirage normal ci-dessous
// pour que tous les emplacements d'équipement suivent la même règle de
// drop (10% par mob tué, un type choisi au hasard dans tout le pool).
const ORDRE_ACCESSOIRES_BASE = ["casque", "jambieres", "anneau", "bottes", "bracelet"];
const ORDRE_LOOT_BASE = [...ORDRE_ARMES, ...ORDRE_ACCESSOIRES_BASE];

const CHANCE_DROP_ARME = 0.1;
let prochainLootId = 1;
let prochainObjetAuSolId = 1;

// Rayon (px, distance centre-joueur ↔ centre-objet) dans lequel la touche F
// ramasse un objet posé au sol — voir ramasserObjets, appelée depuis
// simulerPhysique pour chaque joueur dont `input.f` est actif.
const RAYON_RAMASSAGE = 60;
// Un objet non ramassé disparaît au bout de ce délai (secondes), pour ne
// pas laisser le sol d'une instance de donjon abandonnée s'encombrer.
const DUREE_VIE_OBJET_AU_SOL = 90;

// Pose un objet au sol dans `zone`, à la position (x, y) — typiquement
// celle du monstre/boss qui vient de mourir. Le ramassage se fait ensuite
// via la touche F (voir ramasserObjets) : plus d'ajout automatique à
// l'inventaire du tueur.
function deposerObjetAuSol(zone, type, x, y) {
  zone.objetsAuSol.push({ id: prochainObjetAuSolId++, type, x, y, dureeVieRestante: DUREE_VIE_OBJET_AU_SOL });
}

function essayerDropArme(zone, x, y) {
  if (Math.random() >= CHANCE_DROP_ARME) return;
  const type = ORDRE_LOOT_BASE[Math.floor(Math.random() * ORDRE_LOOT_BASE.length)];
  deposerObjetAuSol(zone, type, x, y);
}

// Butin de fin de donjon : à la mort d'un boss (Sire-Hano, Dragon Noir,
// Chevalier Noir), chaque pièce de l'équipement légendaire — une arme
// légendaire (même famille épée/arc/bâton que le loot normal) ET une
// version légendaire de CHAQUE emplacement d'accessoire (armure, casque,
// jambières, anneau, bottes, bracelet) — a SA PROPRE chance de tomber,
// indépendamment des autres (demande explicite du joueur : "chaque
// équipement légendaire à 5% de drop", plus un lot garanti à 100%).
// Ne tombe plus au sol : chaque pièce qui drop va directement dans
// l'inventaire d'un joueur tiré au sort parmi tous les participants du
// combat (tout joueur ayant infligé au moins un coup au boss — voir les
// Sets `attaquants` sur dragon/cn/boss, alimentés depuis
// infligerDegatsDragonNoir / infligerDegatsChevalierNoir /
// infligerDegatsSireHano), pour que le butin soit vraiment partagé entre
// tous les participants plutôt que ramassé par le premier arrivé sur
// place.
const CHANCE_DROP_PIECE_LEGENDAIRE = 0.15; // 15% par pièce (boost, était 5%), indépendamment
const BUNDLE_ACCESSOIRES_LEGENDAIRES = [
  "armureLegendaire",
  "casqueLegendaire",
  "jambieresLegendaire",
  "anneauLegendaire",
  "bottesLegendaire",
  "braceletLegendaire",
];
// Sire-Hano laisse tomber un cran au-dessus (Mythique) des deux autres
// boss (Dragon Noir / Chevalier Noir, restés en Légendaire) — demande
// explicite du joueur, voir les tables STATS_* plus haut pour les stats.
const BUNDLE_ACCESSOIRES_MYTHIQUE = [
  "armureMythique",
  "casqueMythique",
  "jambieresMythique",
  "anneauMythique",
  "bottesMythique",
  "braceletMythique",
];

// `tier` : "legendaire" (Dragon Noir / Chevalier Noir, par défaut) ou
// "mythique" (Sire-Hano) — choisit simplement le suffixe de clé d'objet et
// le pool d'accessoires, le reste de la logique (5% par pièce, partage
// entre participants) est identique pour les deux paliers.
function essayerDropLegendaireBoss(attaquants, tier = "legendaire") {
  const participants = [...(attaquants || [])].map((id) => players.get(id)).filter(Boolean);
  if (participants.length === 0) return; // combat sans joueur connu (ne devrait pas arriver) : rien à distribuer

  const suffixe = tier === "mythique" ? "Mythique" : "Legendaire";
  const bundleAccessoires = tier === "mythique" ? BUNDLE_ACCESSOIRES_MYTHIQUE : BUNDLE_ACCESSOIRES_LEGENDAIRES;
  const typeArme = ORDRE_ARMES[Math.floor(Math.random() * ORDRE_ARMES.length)];
  const cleArme = `${typeArme}${suffixe}`;
  const toutesLesPieces = [cleArme, ...bundleAccessoires];

  // Regroupe les pièces effectivement tombées par bénéficiaire, pour
  // n'afficher qu'un seul toast de butin par joueur même si plusieurs
  // pièces lui reviennent sur le même kill (même logique que ramasserObjets).
  const gainsParJoueur = new Map();
  for (const cle of toutesLesPieces) {
    if (Math.random() >= CHANCE_DROP_PIECE_LEGENDAIRE) continue;
    const beneficiaire = participants[Math.floor(Math.random() * participants.length)];
    beneficiaire.inventaire[cle] = (beneficiaire.inventaire[cle] || 0) + 1;
    if (!gainsParJoueur.has(beneficiaire)) gainsParJoueur.set(beneficiaire, []);
    gainsParJoueur.get(beneficiaire).push(cle);
  }

  for (const [joueur, pieces] of gainsParJoueur) {
    const [premier, ...reste] = pieces;
    joueur.dernierLoot = {
      id: prochainLootId++,
      type: premier,
      bundle: reste,
      legendaire: tier === "legendaire",
      mythique: tier === "mythique",
      expire: Date.now() + 5000,
    };
  }
}

// ---------------------------------------------------------------------------
// Équipement : caractéristiques RPG classiques (Force / Agilité /
// Intelligence / Vitalité), converties en stats dérivées (dégâts, PV max,
// Mana max, vitesse, réduction de cooldown, réduction de dégâts subis).
// Le loot normal (10% sur les mobs de l'Antre) donne un petit bonus dans
// l'attribut "naturel" de son type d'arme ; le SET LÉGENDAIRE (garanti sur
// le coup de grâce de Sire-Hano) est nettement plus puissant : gros bonus
// dans plusieurs attributs à la fois, PLUS un bonus de dégâts/réduction de
// dégâts direct — un vrai saut de puissance pour récompenser le kill du
// boss, pas un simple +quelques%.
// ---------------------------------------------------------------------------

const STATS_ARME = {
  epee: { force: 6 },
  arc: { agilite: 6 },
  baton: { intelligence: 6 },
  // Légendaires (Dragon Noir / Chevalier Noir) : ~7-8× le bonus normal dans
  // l'attribut principal, plus un peu de secondaire, un bonus de dégâts
  // direct (25%), et un bonus de régénération de vie passive ("regenPv",
  // en PV/s — s'ajoute à HP_REGEN_PAR_SECONDE, voir simulerCombat).
  epeeLegendaire: { force: 45, agilite: 15, vitalite: 10, degatsBonusPct: 0.25, regenPv: 1 },
  arcLegendaire: { agilite: 45, force: 15, vitalite: 10, degatsBonusPct: 0.25, regenPv: 1 },
  batonLegendaire: { intelligence: 45, vitalite: 15, agilite: 10, degatsBonusPct: 0.25, regenPv: 1 },
  // Mythiques (Sire-Hano uniquement, voir essayerDropLegendaireBoss) : un
  // cran au-dessus du légendaire sur toutes les stats, régénération incluse.
  epeeMythique: { force: 65, agilite: 22, vitalite: 15, degatsBonusPct: 0.4, regenPv: 2 },
  arcMythique: { agilite: 65, force: 22, vitalite: 15, degatsBonusPct: 0.4, regenPv: 2 },
  batonMythique: { intelligence: 65, vitalite: 22, agilite: 15, degatsBonusPct: 0.4, regenPv: 2 },
};
const STATS_ARMURE = {
  // Pas d'armure "normale" pour l'instant (seul le boss en laisse tomber) :
  // l'armure légendaire est donc un bonus tout terrain (les 4 attributs)
  // plus une réduction de dégâts subis significative (25%) et de la regen.
  armureLegendaire: { vitalite: 60, force: 15, agilite: 15, intelligence: 15, reductionDegatsPct: 0.25, regenPv: 3 },
  armureMythique: { vitalite: 90, force: 22, agilite: 22, intelligence: 22, reductionDegatsPct: 0.35, regenPv: 5 },
};

// Emplacements d'accessoire (casque / jambières / anneau / bottes /
// bracelet) : même règle que l'arme — un item "normal" (petit bonus dans
// un seul attribut, drop de mob à 10% via ORDRE_LOOT_BASE), une version
// légendaire nettement plus forte (gros bonus multi-attributs, tirée au
// sort sur Dragon Noir/Chevalier Noir via BUNDLE_ACCESSOIRES_LEGENDAIRES)
// et une version mythique encore au-dessus (Sire-Hano uniquement, voir
// BUNDLE_ACCESSOIRES_MYTHIQUE).
const STATS_CASQUE = {
  casque: { force: 6 },
  casqueLegendaire: { force: 25, vitalite: 20, intelligence: 10, reductionDegatsPct: 0.08, regenPv: 1 },
  casqueMythique: { force: 38, vitalite: 30, intelligence: 15, reductionDegatsPct: 0.12, regenPv: 2 },
};
const STATS_JAMBIERES = {
  jambieres: { agilite: 6 },
  jambieresLegendaire: { agilite: 25, vitalite: 20, force: 10, regenPv: 1 },
  jambieresMythique: { agilite: 38, vitalite: 30, force: 15, regenPv: 2 },
};
const STATS_ANNEAU = {
  anneau: { intelligence: 6 },
  anneauLegendaire: { intelligence: 25, force: 10, degatsBonusPct: 0.1, regenPv: 1 },
  anneauMythique: { intelligence: 38, force: 15, degatsBonusPct: 0.15, regenPv: 2 },
};
const STATS_BOTTES = {
  bottes: { agilite: 6 },
  bottesLegendaire: { agilite: 30, vitalite: 15, regenPv: 1 },
  bottesMythique: { agilite: 45, vitalite: 22, regenPv: 2 },
};
const STATS_BRACELET = {
  bracelet: { vitalite: 6 },
  braceletLegendaire: { intelligence: 15, agilite: 15, vitalite: 10, regenPv: 2 },
  braceletMythique: { intelligence: 22, agilite: 22, vitalite: 15, regenPv: 3 },
};

// ---------------------------------------------------------------------------
// Paliers d'équipement supplémentaires (T1 = tier de base ci-dessus, déjà
// existant sans suffixe ; T2/T3/T4 générés ici par boucle) — pour suivre la
// progression de niveau des mobs des régions étendues (voir BIOMES_DEFINITION
// plus bas : +10 niveau de mob par région, un palier d'équipement tous les
// ~20 niveaux). Générés plutôt qu'écrits à la main pour rester strictement
// cohérents avec le tier de base (même attribut "naturel" par arme/accessoire
// que STATS_ARME/STATS_CASQUE/etc. ci-dessus), tout en restant nettement
// en-dessous des sets légendaires du boss.
// ---------------------------------------------------------------------------
const VALEUR_BONUS_PAR_TIER = { 2: 16, 3: 28, 4: 42 };
const ATTRIBUT_ARME = { epee: "force", arc: "agilite", baton: "intelligence" };
const ATTRIBUT_ACCESSOIRE = { casque: "force", jambieres: "agilite", anneau: "intelligence", bottes: "agilite", bracelet: "vitalite" };

for (const [arme, attribut] of Object.entries(ATTRIBUT_ARME)) {
  for (const tier of [2, 3, 4]) {
    STATS_ARME[`${arme}T${tier}`] = { [attribut]: VALEUR_BONUS_PAR_TIER[tier] };
  }
}
// Pas d'armure "normale" tant que seul le boss en laissait tomber (voir plus
// haut) : on comble maintenant les 4 paliers de base avec un bonus réparti
// sur les 4 attributs (comme la légendaire, mais nettement plus modeste).
for (const tier of [1, 2, 3, 4]) {
  const valeur = tier === 1 ? 10 : VALEUR_BONUS_PAR_TIER[tier] + 4;
  STATS_ARMURE[`armureT${tier}`] = {
    vitalite: Math.round(valeur * 1.4),
    force: Math.round(valeur * 0.3),
    agilite: Math.round(valeur * 0.3),
    intelligence: Math.round(valeur * 0.3),
  };
}
const TABLE_STATS_ACCESSOIRE = { casque: STATS_CASQUE, jambieres: STATS_JAMBIERES, anneau: STATS_ANNEAU, bottes: STATS_BOTTES, bracelet: STATS_BRACELET };
for (const [categorie, attribut] of Object.entries(ATTRIBUT_ACCESSOIRE)) {
  const table = TABLE_STATS_ACCESSOIRE[categorie];
  for (const tier of [2, 3, 4]) {
    table[`${categorie}T${tier}`] = { [attribut]: VALEUR_BONUS_PAR_TIER[tier] };
  }
}

// Pools de drop par tier (arme + armure + 5 accessoires) utilisés par les
// zones de biome via essayerDropArmeTiere (le donjon garde son propre
// essayerDropArme/ORDRE_LOOT_BASE inchangé, pour ne rien casser côté Antre).
const CLES_LOOT_PAR_TIER = {
  1: ["epee", "arc", "baton", "armureT1", "casque", "jambieres", "anneau", "bottes", "bracelet"],
  2: ["epeeT2", "arcT2", "batonT2", "armureT2", "casqueT2", "jambieresT2", "anneauT2", "bottesT2", "braceletT2"],
  3: ["epeeT3", "arcT3", "batonT3", "armureT3", "casqueT3", "jambieresT3", "anneauT3", "bottesT3", "braceletT3"],
  4: ["epeeT4", "arcT4", "batonT4", "armureT4", "casqueT4", "jambieresT4", "anneauT4", "bottesT4", "braceletT4"],
};

// Table centrale catégorie d'équipement → table de stats de ses items.
// Utilisée pour valider le message "equiper" et pour additionner les
// bonus (statsEquipement ci-dessous) de façon générique, sans lister
// chaque catégorie à la main à chaque fois.
const STATS_PAR_CATEGORIE = {
  arme: STATS_ARME,
  armure: STATS_ARMURE,
  casque: STATS_CASQUE,
  jambieres: STATS_JAMBIERES,
  anneau: STATS_ANNEAU,
  bottes: STATS_BOTTES,
  bracelet: STATS_BRACELET,
};

// Clés d'inventaire valides pour chaque catégorie d'équipement (validation
// du message "equiper" — voir le handler ws.on("message")).
const CLES_ARME_EQUIPABLE = Object.keys(STATS_ARME);
const CLES_ARMURE_EQUIPABLE = Object.keys(STATS_ARMURE);

// Conversion attribut → stat dérivée.
const FORCE_VERS_DEGATS_PCT = 0.008; // +0.8% dégâts / point de Force
const INTELLIGENCE_VERS_DEGATS_PCT = 0.004; // +0.4% dégâts / point d'Intelligence
const INTELLIGENCE_VERS_MANA = 2; // +2 Mana max / point d'Intelligence
const VITALITE_VERS_PV = 4; // +4 PV max / point de Vitalité
const AGILITE_VERS_VITESSE = 1.5; // +1.5 px/s / point d'Agilité
const AGILITE_VERS_REDUCTION_COOLDOWN = 0.003; // -0.3% cooldown / point d'Agilité
const REDUCTION_COOLDOWN_MAX = 0.5; // jamais plus de 50% de réduction

// Progression par niveau (indépendante de l'équipement).
const CROISSANCE_HP_PAR_NIVEAU = 8;
const CROISSANCE_MANA_PAR_NIVEAU = 4;
const CROISSANCE_DEGATS_PAR_NIVEAU = 0.02; // +2% dégâts / niveau

// Additionne les bonus d'attributs de l'arme + l'armure actuellement
// équipées (chacune peut être `null`).
// Total des 4 attributs (Force/Agilité/Intelligence/Vitalité) : équipement
// (arme + armure) PLUS les points que le joueur a répartis manuellement
// (voir statsAlouees / le message "assignerPoint", +5 points par niveau).
function statsEquipement(p) {
  const total = { force: 0, agilite: 0, intelligence: 0, vitalite: 0, degatsBonusPct: 0, reductionDegatsPct: 0, regenPv: 0 };
  for (const [categorie, statsParItem] of Object.entries(STATS_PAR_CATEGORIE)) {
    const bonus = statsParItem[p.equipement[categorie]];
    if (!bonus) continue;
    total.force += bonus.force || 0;
    total.agilite += bonus.agilite || 0;
    total.intelligence += bonus.intelligence || 0;
    total.vitalite += bonus.vitalite || 0;
    total.degatsBonusPct += bonus.degatsBonusPct || 0;
    total.reductionDegatsPct += bonus.reductionDegatsPct || 0;
    total.regenPv += bonus.regenPv || 0; // PV/s bonus — équipement légendaire/mythique uniquement
  }
  if (p.statsAlouees) {
    total.force += p.statsAlouees.force || 0;
    total.agilite += p.statsAlouees.agilite || 0;
    total.intelligence += p.statsAlouees.intelligence || 0;
    total.vitalite += p.statsAlouees.vitalite || 0;
  }
  return total;
}

// Multiplicateur de dégâts appliqué à CHAQUE sort au moment où il est
// déclenché (voir declencherAttaque) : niveau + Force + Intelligence +
// bonus direct des objets légendaires.
function multiplicateurDegats(p) {
  const stats = statsEquipement(p);
  const bonusNiveau = (p.niveau - 1) * CROISSANCE_DEGATS_PAR_NIVEAU;
  const bonusAttributs = stats.force * FORCE_VERS_DEGATS_PCT + stats.intelligence * INTELLIGENCE_VERS_DEGATS_PCT;
  return 1 + bonusNiveau + bonusAttributs + stats.degatsBonusPct;
}

// Vitesse de déplacement effective (Agilité), utilisée dans simulerPhysique.
function vitesseEffective(p) {
  return VITESSE_DEPLACEMENT + statsEquipement(p).agilite * AGILITE_VERS_VITESSE;
}

// Réduction de cooldown (Agilité), appliquée dans declencherAttaque.
function reductionCooldown(p) {
  return Math.min(REDUCTION_COOLDOWN_MAX, statsEquipement(p).agilite * AGILITE_VERS_REDUCTION_COOLDOWN);
}

// Recalcule les PV/Mana max effectifs (base de classe + croissance de
// niveau + Vitalité/Intelligence de l'équipement) et ajuste les valeurs
// COURANTES du même delta que le max, pour que le joueur ressente le
// changement immédiatement (un +40 PV max, c'est +40 PV tout de suite) au
// lieu d'un simple plafond caché. Appelée à la création du joueur, à
// chaque changement d'équipement, et à chaque montée de niveau.
function recalculerStatsEquipement(p) {
  const infosClasse = CLASSES[p.classe];
  const stats = statsEquipement(p);
  const nouveauHpMax = Math.round(infosClasse.hpMax + (p.niveau - 1) * CROISSANCE_HP_PAR_NIVEAU + stats.vitalite * VITALITE_VERS_PV);
  const nouveauManaMax = Math.round(infosClasse.manaMax + (p.niveau - 1) * CROISSANCE_MANA_PAR_NIVEAU + stats.intelligence * INTELLIGENCE_VERS_MANA);
  const hpMaxPrecedent = p.hpMax ?? infosClasse.hpMax;
  const manaMaxPrecedent = p.manaMax ?? infosClasse.manaMax;
  p.hp = Math.max(p.alive ? 1 : 0, Math.min(nouveauHpMax, p.hp + (nouveauHpMax - hpMaxPrecedent)));
  p.mana = Math.max(0, Math.min(nouveauManaMax, p.mana + (nouveauManaMax - manaMaxPrecedent)));
  p.hpMax = nouveauHpMax;
  p.manaMax = nouveauManaMax;
}

// ---------------------------------------------------------------------------
// Expérience et niveaux : chaque monstre tué (Vert-Hige ET Antre) ainsi que
// chaque entité de Sire-Hano rapportent de l'XP au joueur qui porte le coup
// fatal ; la victoire finale sur le boss donne un gros bonus additionnel.
// ---------------------------------------------------------------------------

// Coût en XP pour passer du niveau n à n+1 (croissance douce et linéaire —
// largement suffisant pour une verticale-slice).
function xpRequisPourNiveau(niveau) {
  return Math.round(40 + niveau * 25);
}

const XP_SIRE_HANO_ENTITE = 15; // par réplique tuée, quelle que soit la phase
// Récompense de victoire sur les 3 boss du monde (Sire-Hano, Dragon Noir,
// Chevalier Noir) — même XP fixe et même bonus d'or garanti pour les trois,
// demande explicite (boost) : avant, XP variable (100/260/220) et pas d'or
// du tout sur le coup de grâce.
const XP_VICTOIRE_BOSS_MONDE = 666;
const OR_VICTOIRE_BOSS_MONDE = 100;
const XP_SIRE_HANO_VICTOIRE = XP_VICTOIRE_BOSS_MONDE; // bonus unique à la victoire finale, pour le joueur du coup de grâce

// Gemmes (voir le commentaire sur `gemmes` dans creerJoueur) : monnaie rare,
// pas de drop au sol comme l'équipement — auto-collectées comme l'or, mais
// beaucoup plus rarement. Récompense garantie sur les boss du jeu.
const CHANCE_GEMME_MONSTRE = 0.03; // ~3% par monstre du commun tué
const GEMMES_VICTOIRE_SIRE_HANO = 5;
const GEMMES_VICTOIRE_DRAGON_NOIR = 8; // le boss le plus costaud du jeu récompense un peu plus
const GEMMES_VICTOIRE_CHEVALIER_NOIR = 8; // même palier de récompense que le Dragon Noir

// Boutique à gemmes (voir l'icône dédiée côté client, à côté du
// téléporteur) : donne enfin un usage aux gemmes (jusqu'ici jamais
// dépensées nulle part) — de l'équipement légendaire GARANTI en échange,
// alternative fiable au tirage aléatoire des boss (5% par pièce). Mêmes
// clés que TYPES_ARMES côté client (revalidées ici, jamais fait confiance
// au prix envoyé par le client). Le mythique reste volontairement absent
// de cette liste : encore exclusif au coup de grâce sur Sire-Hano.
// `monnaie`/`niveaux` absents = offre d'équipement classique payée en gemmes
// (voir le handler "acheter_gemme" plus bas). "potionNiveau" est la seule
// exception : payée en OR (1 pièce, demande explicite), pas en gemmes, et ne
// remplit pas l'inventaire mais ajoute directement des niveaux (voir
// ajouterNiveaux) — reste dans "la boutique à gemmes" (même modale/icône)
// simplement parce qu'aucune autre boutique n'est accessible partout comme
// celle-ci.
const BOUTIQUE_GEMMES = [
  { item: "epeeLegendaire", prix: 35 },
  { item: "arcLegendaire", prix: 35 },
  { item: "batonLegendaire", prix: 35 },
  { item: "armureLegendaire", prix: 45 },
  { item: "casqueLegendaire", prix: 25 },
  { item: "jambieresLegendaire", prix: 25 },
  { item: "anneauLegendaire", prix: 25 },
  { item: "bottesLegendaire", prix: 25 },
  { item: "braceletLegendaire", prix: 25 },
  { item: "potionNiveau", prix: 1, monnaie: "or", niveaux: 10 },
];

function gainerXp(p, montant) {
  if (!montant || montant <= 0) return;
  p.xp += montant;
  let xpRequis = xpRequisPourNiveau(p.niveau);
  let aMonteDeNiveau = false;
  let niveauxGagnes = 0;
  while (p.xp >= xpRequis) {
    p.xp -= xpRequis;
    p.niveau++;
    p.pointsDisponibles = (p.pointsDisponibles || 0) + 5; // 5 points de caractéristique à répartir manuellement par niveau
    aMonteDeNiveau = true;
    niveauxGagnes++;
    xpRequis = xpRequisPourNiveau(p.niveau);
  }
  if (aMonteDeNiveau) {
    recalculerStatsEquipement(p); // applique la croissance de PV/Mana du nouveau niveau
    p.hp = p.hpMax; // petit bonus de confort : plein PV/Mana à la montée de niveau
    p.mana = p.manaMax;
    // Petit toast de célébration côté client (même mécanique que dernierLoot
    // pour le butin : un id qui change + une expiration, pas d'horloge à
    // synchroniser) — voir la diffusion dans construireEtatJoueur.
    p.derniereMonteeDeNiveau = { niveau: p.niveau, expire: Date.now() + 4000 };
    incrementerQuete(p, "monter_niveau", niveauxGagnes);
  }
}

// Ajoute directement des niveaux sans passer par l'XP (potion de la boutique
// à gemmes, voir BOUTIQUE_GEMMES "potionNiveau") — mêmes effets de bord
// qu'une montée de niveau normale (points de caractéristique, PV/Mana
// recalculés et remplis, toast, progression de la quête "monter_niveau").
function ajouterNiveaux(p, n) {
  if (!n || n <= 0) return;
  p.niveau += n;
  p.pointsDisponibles = (p.pointsDisponibles || 0) + 5 * n;
  recalculerStatsEquipement(p);
  p.hp = p.hpMax;
  p.mana = p.manaMax;
  p.derniereMonteeDeNiveau = { niveau: p.niveau, expire: Date.now() + 4000 };
  incrementerQuete(p, "monter_niveau", n);
}

// ---------------------------------------------------------------------------
// Quêtes journalières : boucle de contenu rejouable — 3 quêtes tirées
// chaque jour (côté serveur, à la connexion + revérifiées périodiquement
// pour les sessions qui tournent à cheval sur minuit), avec une récompense
// en or/XP à réclamer une fois l'objectif atteint. Volontairement simple
// (pas de reset horaire précis ni de fuseau — une "journée" = une date
// calendaire du serveur) : largement suffisant pour donner une raison de
// revenir chaque jour sans complexifier la sauvegarde.
// ---------------------------------------------------------------------------

const MODELES_QUETES = [
  { type: "tuer_monstres", cible: 15, or: 40, xp: 30, texte: "Vaincre 15 monstres" },
  { type: "tuer_monstres", cible: 35, or: 90, xp: 70, texte: "Vaincre 35 monstres" },
  { type: "gagner_or", cible: 100, or: 50, xp: 20, texte: "Amasser 100 pièces d'or" },
  { type: "gagner_or", cible: 250, or: 110, xp: 45, texte: "Amasser 250 pièces d'or" },
  { type: "monter_niveau", cible: 1, or: 60, xp: 0, texte: "Monter d'un niveau" },
];

function dateDuJour() {
  return new Date().toISOString().slice(0, 10); // "AAAA-MM-JJ", suffisant comme clé de rotation quotidienne
}

// Renvoie la date calendaire (même format "AAAA-MM-JJ") immédiatement avant
// `dateStr` — sert uniquement à détecter une connexion deux jours de suite
// pour la série de connexion quotidienne ci-dessous.
function jourPrecedent(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Récompense de connexion quotidienne : cycle de 7 jours (se répète), pensé
// comme les cadeaux de connexion classiques des MMO mobiles — une petite
// raison de plus de revenir chaque jour, à côté des quêtes journalières
// (qui elles demandent de jouer, pas seulement de se connecter). Un seul
// jour = une seule récompense, quel que soit le nombre de connexions ce
// jour-là (voir dernierJour ci-dessous) ; rater un jour civil complet
// remet la série à 1 au lieu de la faire continuer.
// ---------------------------------------------------------------------------

const RECOMPENSES_CONNEXION = [
  { or: 20, xp: 0 },
  { or: 40, xp: 0 },
  { or: 20, xp: 30 },
  { or: 60, xp: 0 },
  { or: 40, xp: 40 },
  { or: 80, xp: 0 },
  { or: 150, xp: 100 }, // jour 7 : la grosse récompense hebdomadaire
];

// Appelée une fois à la connexion (après appliquerProgression, donc sur la
// progression déjà restaurée) — idempotente pour la journée courante :
// rappeler cette fonction plusieurs fois le même jour (reconnexions) ne
// redonne rien, voir la garde sur `dernierJour` en tout début.
function verifierRecompenseConnexion(p) {
  const aujourdhui = dateDuJour();
  if (!p.connexionQuotidienne) p.connexionQuotidienne = { dernierJour: null, serie: 0 };
  const c = p.connexionQuotidienne;
  if (c.dernierJour === aujourdhui) return; // déjà réclamé aujourd'hui, rien à faire

  c.serie = c.dernierJour === jourPrecedent(aujourdhui) ? c.serie + 1 : 1; // continue la série ou la relance à 1
  c.dernierJour = aujourdhui;

  const recompense = RECOMPENSES_CONNEXION[(c.serie - 1) % RECOMPENSES_CONNEXION.length];
  p.or = (p.or || 0) + recompense.or;
  if (recompense.xp > 0) gainerXp(p, recompense.xp);
  // Toast de bienvenue (même mécanique que loot/montée de niveau/haut fait)
  // — jourCycle (1-7) sert à afficher "Jour X/7" côté client, `serie` est
  // le compteur brut (peut dépasser 7, affiché tel quel à titre indicatif).
  p.dernierRecompenseConnexion = {
    serie: c.serie,
    jourCycle: ((c.serie - 1) % RECOMPENSES_CONNEXION.length) + 1,
    or: recompense.or,
    xp: recompense.xp,
    expire: Date.now() + 5000,
  };
}

function genererQuetesJournalieres() {
  // Tire 3 modèles distincts (mélange puis découpe — pas besoin de mieux
  // pour un pool de 5).
  const melange = [...MODELES_QUETES].sort(() => Math.random() - 0.5).slice(0, 3);
  return melange.map((m, i) => ({
    id: `q${i}`,
    type: m.type,
    cible: m.cible,
    progression: 0,
    or: m.or,
    xp: m.xp,
    texte: m.texte,
    reclamee: false,
  }));
}

function assurerQuetesDuJour(p) {
  const aujourdhui = dateDuJour();
  if (p.quetes && p.quetes.date === aujourdhui) return;
  p.quetes = { date: aujourdhui, liste: genererQuetesJournalieres() };
}

function incrementerQuete(p, type, montant) {
  if (!p.quetes || !montant) return;
  for (const q of p.quetes.liste) {
    if (q.type === type && !q.reclamee) q.progression = Math.min(q.cible, q.progression + montant);
  }
}

// ---------------------------------------------------------------------------
// Hauts faits : couche de progression à long terme, à côté des quêtes
// journalières (qui se remettent à zéro chaque jour) — un compteur
// cumulatif qui ne redescend jamais (voir statsVie sur creerJoueur) débloque
// un titre affichable sous le pseudo, dans le monde et au tableau des
// scores. Volontairement plat (pas d'arbre de dépendances) : chaque entrée
// ne dépend que d'un seul compteur ou d'une condition simple, vérifiée à
// chaque événement pertinent via verifierHautsFaits.
// ---------------------------------------------------------------------------

const HAUTS_FAITS = [
  { id: "premier-sang", nom: "Premier Sang", titre: "Aspirant", description: "Vaincre son premier monstre.", cible: 1, stat: "monstresTues" },
  { id: "chasseur", nom: "Chasseur Aguerri", titre: "Chasseur", description: "Vaincre 50 monstres.", cible: 50, stat: "monstresTues" },
  { id: "exterminateur", nom: "Exterminateur", titre: "Exterminateur", description: "Vaincre 250 monstres.", cible: 250, stat: "monstresTues" },
  { id: "veteran", nom: "Vétéran des Royaumes", titre: "Vétéran", description: "Atteindre le niveau 5.", cible: 5, stat: "niveau" },
  { id: "heros", nom: "Héros de Vert-Hige", titre: "Héros", description: "Atteindre le niveau 15.", cible: 15, stat: "niveau" },
  { id: "legende", nom: "Légende Vivante", titre: "Légende Vivante", description: "Atteindre le niveau 30.", cible: 30, stat: "niveau" },
  { id: "fortune", nom: "Petite Fortune", titre: "Fortuné", description: "Amasser 1000 pièces d'or au total.", cible: 1000, stat: "orGagneTotal" },
  { id: "vainqueur-sire-hano", nom: "Bourreau de l'Antre", titre: "Bourreau de Sire-Hano", description: "Vaincre Sire-Hano.", cible: 1, stat: "sireHanoVaincus" },
  { id: "fleau-antre", nom: "Fléau de l'Antre", titre: "Fléau de l'Antre", description: "Vaincre Sire-Hano 10 fois.", cible: 10, stat: "sireHanoVaincus" },
  // Un titre par boss du monde vaincu (demande explicite) — même principe
  // que vainqueur-sire-hano ci-dessus, sur les deux compteurs ajoutés dans
  // statsVie pour l'occasion (voir creerJoueur).
  { id: "vainqueur-dragon-noir", nom: "Écailles du Dragon", titre: "Tueur du Dragon Noir", description: "Vaincre le Dragon Noir.", cible: 1, stat: "dragonNoirVaincus" },
  { id: "vainqueur-chevalier-noir", nom: "Heaume Brisé", titre: "Vainqueur du Chevalier Noir", description: "Vaincre le Chevalier Noir.", cible: 1, stat: "chevalierNoirVaincus" },
  { id: "devoue", nom: "Serviteur Dévoué", titre: "Dévoué", description: "Réclamer 20 quêtes journalières.", cible: 20, stat: "questesReclamees" },
  { id: "eclatant", nom: "Éclat Légendaire", titre: "Éclatant", description: "Équiper un objet légendaire.", cible: 1, stat: "equipementLegendaire" },
  { id: "collectionneur-gemmes", nom: "Collectionneur de Gemmes", titre: "Gemmologue", description: "Amasser 50 gemmes au total.", cible: 50, stat: "gemmesGagneesTotal" },
  // Un titre par zone débloquée (demande explicite) — même compteur "niveau"
  // que veteran/heros/legende ci-dessus, aux mêmes paliers que le gate
  // d'accès du téléporteur (voir DESTINATIONS_TELEPORTEUR/niveauRequis) :
  // le titre se débloque exactement au niveau où la zone devient
  // accessible. Vert-Hige (niveau 1, zone de départ) n'a pas d'entrée ici,
  // rien à "débloquer".
  { id: "zone-estenoise", nom: "Bienvenue à Estenoise", titre: "Voyageur d'Estenoise-les-Brumes", description: "Débloquer Estenoise-les-Brumes (niveau 4).", cible: 4, stat: "niveau" },
  { id: "zone-cretes-ambre", nom: "Sur les Crêtes", titre: "Arpenteur des Crêtes d'Ambre", description: "Débloquer les Crêtes d'Ambre (niveau 7).", cible: 7, stat: "niveau" },
  { id: "zone-marais-de-suin", nom: "Bottes Boueuses", titre: "Marcheur du Marais de Suin", description: "Débloquer le Marais de Suin (niveau 10).", cible: 10, stat: "niveau" },
  { id: "zone-foret-chuchote", nom: "Voix dans les Bois", titre: "Auditeur de la Forêt Chuchote", description: "Débloquer la Forêt Chuchote (niveau 13).", cible: 13, stat: "niveau" },
  { id: "zone-pics-verglaces", nom: "Souffle Glacé", titre: "Grimpeur des Pics Verglacés", description: "Débloquer les Pics Verglacés (niveau 16).", cible: 16, stat: "niveau" },
  { id: "zone-dunes-cendrees", nom: "Vent de Cendre", titre: "Nomade des Dunes Cendrées", description: "Débloquer les Dunes Cendrées (niveau 19).", cible: 19, stat: "niveau" },
  { id: "zone-abysses-luisantes", nom: "Lueur des Profondeurs", titre: "Plongeur des Abysses Luisantes", description: "Débloquer les Abysses Luisantes (niveau 22).", cible: 22, stat: "niveau" },
  { id: "zone-jardins-petrifies", nom: "Pierre et Racine", titre: "Jardinier Pétrifié", description: "Débloquer les Jardins Pétrifiés (niveau 25).", cible: 25, stat: "niveau" },
  { id: "zone-couronne-orage", nom: "Au Sommet du Monde", titre: "Seigneur de la Couronne d'Orage", description: "Débloquer la Couronne d'Orage (niveau 28).", cible: 28, stat: "niveau" },
];

// `statOuNiveau` : la plupart des hauts faits regardent p.statsVie[stat],
// mais "niveau" regarde directement p.niveau (déjà cumulatif par nature) et
// "equipementLegendaire" est un booléen dérivé de l'équipement actuel
// plutôt qu'un compteur — ces deux cas sont gérés à part ci-dessous.
function valeurStatHautFait(p, stat) {
  if (stat === "niveau") return p.niveau;
  if (stat === "equipementLegendaire") {
    return Object.values(p.equipement || {}).some((cle) => cle && /legendaire|mythique/i.test(cle)) ? 1 : 0;
  }
  return (p.statsVie && p.statsVie[stat]) || 0;
}

// Appelée après tout événement pouvant faire progresser un haut fait (kill,
// gain d'or, montée de niveau, victoire sur le boss, réclamation de quête,
// équipement) — idempotente et bon marché (une douzaine de comparaisons),
// donc appelée largement plutôt que de traquer finement quel haut fait
// pourrait avoir bougé à chaque site d'appel.
function verifierHautsFaits(p) {
  if (!p.hautsFaitsDebloques) p.hautsFaitsDebloques = [];
  for (const hf of HAUTS_FAITS) {
    if (p.hautsFaitsDebloques.includes(hf.id)) continue;
    if (valeurStatHautFait(p, hf.stat) >= hf.cible) {
      p.hautsFaitsDebloques.push(hf.id);
      // Le premier haut fait débloqué équipe automatiquement son titre si
      // le joueur n'en a encore choisi aucun — sinon on laisse son choix
      // actuel intact (voir message "definirTitre" pour changer plus tard).
      if (!p.titreActif) p.titreActif = hf.titre;
      p.dernierHautFait = { id: hf.id, nom: hf.nom, titre: hf.titre, expire: Date.now() + 5000 };
    }
  }
}

// Sire-Hano combat en 3 phases : l'original puis, à chaque mort, ses PV
// restants se scindent en davantage de répliques plus petites — 1 entité,
// puis 2, puis 4 en phase finale (voir GDD §5 révisé). Chaque entité, quelle
// que soit la phase, dispose du même répertoire de 3 attaques (mêlée
// agressive, volée de projectiles, zone au sol télégraphiée) — c'est le
// nombre d'adversaires simultanés qui augmente, pas leur intelligence
// individuelle. Ces réglages sont communs à toutes les instances du donjon.
const SIRE_HANO_LARGEUR_BASE = 60;
const SIRE_HANO_HAUTEUR_BASE = 70;
const SIRE_HANO_Y_SOL = 600; // ligne de sol commune, quelle que soit la taille de l'entité
const SIRE_HANO_VITESSE = 95;
const SIRE_HANO_HP_ORIGINAL = 480;

const PHASES_SIRE_HANO = [
  { nom: "Sire-Hano", ratioHp: 1, nombre: 1, echelle: 1 },
  { nom: "Réplique de Sire-Hano", ratioHp: 0.5, nombre: 2, echelle: 0.8 },
  { nom: "Dernière réplique de Sire-Hano", ratioHp: 0.25, nombre: 4, echelle: 0.62 },
];

const SIRE_HANO_ATTAQUES = {
  melee: { degats: 16, cooldown: 1.3, portee: 60 },
  volee: { degats: 11, cooldown: 3.4, vitesse: 420, rayon: 8, porteeMax: 700, nombre: 3, ecartY: 14 },
  aoe: { degats: 32, cooldown: 6.5, rayon: 95, telegraphe: 0.9 },
};

let prochainSireHanoId = 1;

// Répartit `nombre` points d'apparition régulièrement espacés dans l'arène
// (coordonnées LOCALES à l'instance, x=0 → côté entrée), pour que les
// répliques n'apparaissent pas toutes les unes sur les autres.
function positionsEntreesPhase(nombre, largeurArene) {
  const marge = 90;
  const largeurUtile = largeurArene - marge * 2;
  const positions = [];
  for (let i = 0; i < nombre; i++) {
    const t = nombre === 1 ? 0.5 : i / (nombre - 1);
    positions.push(Math.round(marge + t * largeurUtile));
  }
  return positions;
}

function creerEntiteSireHano(phaseIndex, xCentre) {
  const phase = PHASES_SIRE_HANO[phaseIndex];
  const largeur = Math.round(SIRE_HANO_LARGEUR_BASE * phase.echelle);
  const hauteur = Math.round(SIRE_HANO_HAUTEUR_BASE * phase.echelle);
  // Les PV totaux de la phase (ratioHp de l'original) sont répartis à parts
  // égales entre toutes les entités de cette phase.
  const hpMax = Math.max(1, Math.round((SIRE_HANO_HP_ORIGINAL * phase.ratioHp) / phase.nombre));
  return {
    id: prochainSireHanoId++,
    hp: hpMax,
    hpMax,
    largeur,
    hauteur,
    x: Math.round(xCentre - largeur / 2),
    y: SIRE_HANO_Y_SOL - hauteur,
    vx: 0,
    facing: -1,
    morte: false,
    invulnerableRestant: 1.2,
    cooldowns: { melee: 1, volee: 2.5, aoe: 4 },
    attaqueAnimRestant: 0,
    aoeEnAttente: null, // { x, y, rayon, degats, tempsRestant, telegrapheMax }
    // Phase 3 ("Dernière réplique") : hitbox étendue de 2px vers le haut —
    // demande explicite, la silhouette réduite (échelle 0.62) la rendait trop
    // dure à toucher par le dessus. Purement une extension de collision, la
    // taille du sprite (largeur/hauteur ci-dessus) ne change pas.
    hitboxSupHaut: phaseIndex === 2 ? 2 : 0,
  };
}

// Rectangle de collision d'une entité de Sire-Hano — voir hitboxSupHaut
// ci-dessus (uniquement non-nul en phase 3).
function hitboxEntiteSireHano(entite) {
  const sup = entite.hitboxSupHaut || 0;
  return { x: entite.x, y: entite.y - sup, largeur: entite.largeur, hauteur: entite.hauteur + sup };
}

// Démarre (ou relance à la phase suivante) le combat de Sire-Hano pour une
// instance de donjon donnée.
function demarrerPhaseSireHano(instance, phaseIndex) {
  const boss = instance.sireHano;
  boss.phaseIndex = phaseIndex;
  const phase = PHASES_SIRE_HANO[phaseIndex];
  boss.entites = positionsEntreesPhase(phase.nombre, instance.largeur).map((x) => creerEntiteSireHano(phaseIndex, x));
}

// ---------------------------------------------------------------------------
// Dragon Noir : boss du monde, posté dans Couronne d'Orage (la dernière
// région, niveau 80) — contrairement à Sire-Hano, pas d'instance dédiée ni
// de porte à débloquer : c'est un unique adversaire posté dans une zone déjà
// partagée par tout le serveur, qui réapparaît un moment après sa défaite
// (voir simulerDragonNoir) plutôt que de nécessiter de re-sortir/rentrer.
// Deux phases : passé sous 50% PV, il se transforme (+100% dégâts infligés
// sur toutes ses attaques, cadence resserrée) — un vrai sursaut de danger en
// fin de combat plutôt qu'une simple jauge qui descend.
// ---------------------------------------------------------------------------

const DRAGON_NOIR_LARGEUR = 84;
const DRAGON_NOIR_HAUTEUR = 66;
const DRAGON_NOIR_VITESSE = 70;
const DRAGON_NOIR_HP = 3600;
const DRAGON_NOIR_RATIO_TRANSFORMATION = 0.5; // passage en phase 2 sous ce ratio de PV
const DRAGON_NOIR_DELAI_RESPAWN = 120; // secondes avant réapparition après défaite
const DRAGON_NOIR_MULTIPLICATEUR_PHASE2 = 2; // +100% dégâts infligés en phase 2
const DRAGON_NOIR_CADENCE_PHASE2 = 0.65; // cooldowns d'attaque x0.65 en phase 2 (plus agressif)
const DRAGON_NOIR_VITESSE_MULTIPLICATEUR_PHASE2 = 1.35; // déplacement plus rapide aussi, pas juste les cooldowns
// Forme humanoïde de la phase 2 : mêmes sorts (griffe/souffle/météore, voir
// DRAGON_NOIR_ATTAQUES), juste plus forts et plus rapides via les
// multiplicateurs ci-dessus — seule la silhouette et le gabarit changent.
const DRAGON_NOIR_HUMAIN_LARGEUR = 46;
const DRAGON_NOIR_HUMAIN_HAUTEUR = 70;

const DRAGON_NOIR_ATTAQUES = {
  griffe: { degats: 26, cooldown: 1.5, portee: 72 },
  // "Souffle ardent" : réutilise le mécanisme de volée de projectiles (même
  // principe que l'ultime Quater / la volée de Sire-Hano) pour simuler un
  // cône de feu dense plutôt qu'un seul projectile.
  souffle: { degats: 13, cooldown: 4.8, vitesse: 360, rayon: 9, porteeMax: 640, nombre: 6, ecartY: 13 },
  // "Météore" : même mécanique de zone télégraphiée que l'AOE de Sire-Hano.
  meteore: { degats: 42, cooldown: 7.5, rayon: 105, telegraphe: 1.1 },
};

function creerDragonNoir(zone) {
  return {
    hp: DRAGON_NOIR_HP,
    hpMax: DRAGON_NOIR_HP,
    phase: 1,
    formeHumaine: false, // bascule à true lors de la transformation en phase 2
    largeur: DRAGON_NOIR_LARGEUR,
    hauteur: DRAGON_NOIR_HAUTEUR,
    x: Math.round(zone.largeur * 0.6),
    y: SIRE_HANO_Y_SOL - DRAGON_NOIR_HAUTEUR,
    vx: 0,
    facing: -1,
    vaincu: false,
    vaincuRestant: 0,
    respawnRestant: 0,
    invulnerableRestant: 1.5,
    attaqueAnimRestant: 0,
    cooldowns: { griffe: 1.5, souffle: 3, meteore: 5 },
    aoeEnAttente: null, // { x, y, rayon, degats, tempsRestant, telegrapheMax }
    // Ids des joueurs ayant infligé au moins un coup pendant ce combat —
    // réinitialisé à chaque réapparition (voir simulerDragonNoir, qui
    // reconstruit l'entité entière via creerDragonNoir) — pool de
    // participants pour le partage du butin légendaire, voir
    // essayerDropLegendaireBoss.
    attaquants: new Set(),
  };
}

// Régénération passive des boss (Dragon Noir, Chevalier Noir, chaque entité
// de Sire-Hano) : 10% de leurs PV max par seconde, mais seulement s'ils n'ont
// reçu aucun coup depuis au moins 3 secondes — demande explicite. Laisse un
// répit à un groupe qui décroche un instant sans permettre de vider un boss
// à petits coups puis de le laisser reposer indéfiniment entre deux passages.
const BOSS_REGEN_DELAI_SANS_COUP = 3; // secondes
const BOSS_REGEN_RATIO_PAR_SECONDE = 0.10; // 10% des PV max par seconde
function appliquerRegenBoss(entite, dtSecondes) {
  if (entite.hp <= 0 || entite.hp >= entite.hpMax) return;
  const depuisDernierCoup = (Date.now() - (entite._dernierCoupTs || 0)) / 1000;
  if (depuisDernierCoup < BOSS_REGEN_DELAI_SANS_COUP) return;
  entite.hp = Math.min(entite.hpMax, entite.hp + entite.hpMax * BOSS_REGEN_RATIO_PAR_SECONDE * dtSecondes);
}

function dragonNoirEstCiblable(zone) {
  return !!zone.dragonNoir && !zone.dragonNoir.vaincu && zone.dragonNoir.respawnRestant <= 0;
}

function infligerDegatsDragonNoir(zone, degats, joueurId) {
  const dragon = zone.dragonNoir;
  if (!dragon || dragon.vaincu || dragon.invulnerableRestant > 0) return;
  dragon.hp = Math.max(0, dragon.hp - degats);
  dragon._dernierCoupTs = Date.now();
  if (joueurId) dragon.attaquants.add(joueurId);

  // Transformation à 50% PV : bascule une seule fois vers la phase 2 (plus
  // de dégâts infligés + cadence resserrée + déplacement plus rapide), ET
  // prend une forme humanoïde (mêmes sorts, juste plus forts/rapides — voir
  // DRAGON_NOIR_ATTAQUES, inchangé) — voir simulerDragonNoir pour l'annonce
  // visuelle côté client (toast + recoloration).
  if (dragon.phase === 1 && dragon.hp <= dragon.hpMax * DRAGON_NOIR_RATIO_TRANSFORMATION) {
    const centreAvant = dragon.x + dragon.largeur / 2;
    dragon.phase = 2;
    dragon.formeHumaine = true;
    dragon.largeur = DRAGON_NOIR_HUMAIN_LARGEUR;
    dragon.hauteur = DRAGON_NOIR_HUMAIN_HAUTEUR;
    // Recentré sur la position précédente pour éviter un "téléport" visible
    // du fait du changement de gabarit, et reposé sur la ligne de sol.
    dragon.x = Math.round(centreAvant - dragon.largeur / 2);
    dragon.y = SIRE_HANO_Y_SOL - dragon.hauteur;
    dragon.invulnerableRestant = 0.8; // court répit pendant la "transformation"
  }

  if (dragon.hp === 0 && !dragon.vaincu) {
    dragon.vaincu = true;
    dragon.vaincuRestant = 3;
    dragon.respawnRestant = DRAGON_NOIR_DELAI_RESPAWN;
    const joueur = players.get(joueurId);
    if (joueur) {
      gainerXp(joueur, XP_VICTOIRE_BOSS_MONDE); // récompense d'XP fixe, indépendante du coup de grâce précis
      joueur.or = (joueur.or || 0) + OR_VICTOIRE_BOSS_MONDE;
      joueur.statsVie.orGagneTotal += OR_VICTOIRE_BOSS_MONDE;
      joueur.gemmes = (joueur.gemmes || 0) + GEMMES_VICTOIRE_DRAGON_NOIR;
      joueur.statsVie.gemmesGagneesTotal += GEMMES_VICTOIRE_DRAGON_NOIR;
      joueur.statsVie.dragonNoirVaincus++;
      verifierHautsFaits(joueur);
    }
    // Même chances de drop légendaire que Sire-Hano, partagées entre tous
    // les participants du combat (voir dragon.attaquants).
    essayerDropLegendaireBoss(dragon.attaquants);
  }
}

// Fait vivre le Dragon Noir dans la zone Couronne d'Orage : IA très proche
// de simulerUneEntiteSireHano (mêmes primitives d'attaque), mais pour une
// entité unique posée dans une zone persistante partagée plutôt qu'une
// instance par joueur, avec gestion de sa propre réapparition différée.
function simulerDragonNoir(dtSecondes) {
  const zone = ZONES_PERSISTANTES.get("couronne-orage");
  const dragon = zone && zone.dragonNoir;
  if (!dragon) return;

  if (dragon.vaincu) {
    dragon.vaincuRestant = Math.max(0, dragon.vaincuRestant - dtSecondes);
    dragon.respawnRestant = Math.max(0, dragon.respawnRestant - dtSecondes);
    if (dragon.respawnRestant <= 0) {
      Object.assign(dragon, creerDragonNoir(zone));
    }
    return;
  }

  appliquerRegenBoss(dragon, dtSecondes);
  if (dragon.invulnerableRestant > 0) dragon.invulnerableRestant = Math.max(0, dragon.invulnerableRestant - dtSecondes);
  if (dragon.attaqueAnimRestant > 0) dragon.attaqueAnimRestant = Math.max(0, dragon.attaqueAnimRestant - dtSecondes);
  for (const touche of Object.keys(dragon.cooldowns)) {
    if (dragon.cooldowns[touche] > 0) dragon.cooldowns[touche] = Math.max(0, dragon.cooldowns[touche] - dtSecondes);
  }

  const multiplicateur = dragon.phase === 2 ? DRAGON_NOIR_MULTIPLICATEUR_PHASE2 : 1;
  const cadence = dragon.phase === 2 ? DRAGON_NOIR_CADENCE_PHASE2 : 1;

  // Détonation d'une zone au sol télégraphiée (météore).
  if (dragon.aoeEnAttente) {
    dragon.aoeEnAttente.tempsRestant -= dtSecondes;
    if (dragon.aoeEnAttente.tempsRestant <= 0) {
      const zoneAoe = dragon.aoeEnAttente;
      for (const p of players.values()) {
        if (!p.alive || p.zone !== zone.id) continue;
        const distance = Math.hypot(p.x + JOUEUR_LARGEUR / 2 - zoneAoe.x, p.y + JOUEUR_HAUTEUR / 2 - zoneAoe.y);
        if (distance <= zoneAoe.rayon) infligerDegatsJoueur(p, zoneAoe.degats, zoneAoe.x);
      }
      zone.effets.push({ id: prochainEffetId++, x: zoneAoe.x, y: zoneAoe.y, rayon: zoneAoe.rayon, couleur: "#ff6a2e", vie: 0.3, vieMax: 0.3 });
      dragon.aoeEnAttente = null;
    }
  }

  if (dragon.invulnerableRestant > 0) return; // pendant la transformation : immobile, inattaquable des DEUX côtés déjà géré au-dessus

  // Cible : joueur vivant le plus proche présent dans Couronne d'Orage.
  let cible = null;
  let distanceMin = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.zone !== zone.id) continue;
    const distance = Math.abs(p.x - dragon.x);
    if (distance < distanceMin) { distanceMin = distance; cible = p; }
  }
  if (!cible) { dragon.vx = 0; return; }

  const centreDragon = dragon.x + dragon.largeur / 2;
  const centreCible = cible.x + JOUEUR_LARGEUR / 2;
  dragon.facing = centreCible < centreDragon ? -1 : 1;
  const distanceCible = Math.abs(centreCible - centreDragon);

  if (distanceCible > DRAGON_NOIR_ATTAQUES.griffe.portee * 0.6) {
    const vitesse = DRAGON_NOIR_VITESSE * (dragon.phase === 2 ? DRAGON_NOIR_VITESSE_MULTIPLICATEUR_PHASE2 : 1);
    dragon.vx = vitesse * dragon.facing;
    dragon.x = Math.max(0, Math.min(zone.largeur - dragon.largeur, dragon.x + dragon.vx * dtSecondes));
  } else {
    dragon.vx = 0;
  }

  if (dragon.cooldowns.griffe <= 0 && distanceCible <= DRAGON_NOIR_ATTAQUES.griffe.portee) {
    const attaque = DRAGON_NOIR_ATTAQUES.griffe;
    const zoneX = dragon.facing >= 0 ? dragon.x + dragon.largeur : dragon.x - attaque.portee;
    if (rectanglesSeChevauchent(zoneX, dragon.y, attaque.portee, dragon.hauteur, cible.x, cible.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR)) {
      infligerDegatsJoueur(cible, Math.round(attaque.degats * multiplicateur), centreDragon);
    }
    dragon.cooldowns.griffe = attaque.cooldown * cadence;
    dragon.attaqueAnimRestant = 0.3;
  }

  if (dragon.cooldowns.souffle <= 0 && distanceCible <= DRAGON_NOIR_ATTAQUES.souffle.porteeMax) {
    const attaque = DRAGON_NOIR_ATTAQUES.souffle;
    for (let i = 0; i < attaque.nombre; i++) {
      zone.projectilesMonstres.push({
        id: prochainProjectileMonstreId++,
        couleur: "#ff8a3a",
        x: dragon.x + (dragon.facing >= 0 ? dragon.largeur : 0),
        y: dragon.y + dragon.hauteur / 2 + (i - (attaque.nombre - 1) / 2) * attaque.ecartY,
        vx: attaque.vitesse * dragon.facing,
        degats: Math.round(attaque.degats * multiplicateur),
        rayon: attaque.rayon,
        porteeMax: attaque.porteeMax,
        distanceParcourue: 0,
      });
    }
    dragon.cooldowns.souffle = attaque.cooldown * cadence;
    dragon.attaqueAnimRestant = 0.35;
  }

  if (dragon.cooldowns.meteore <= 0 && !dragon.aoeEnAttente) {
    const attaque = DRAGON_NOIR_ATTAQUES.meteore;
    dragon.aoeEnAttente = {
      x: centreCible,
      y: cible.y + JOUEUR_HAUTEUR / 2,
      rayon: attaque.rayon,
      degats: Math.round(attaque.degats * multiplicateur),
      tempsRestant: attaque.telegraphe,
      telegrapheMax: attaque.telegraphe,
    };
    dragon.cooldowns.meteore = attaque.cooldown * cadence;
  }
}

// ---------------------------------------------------------------------------
// Zones : Vert-Hige (persistante, un seul monde partagé) et instances de
// l'Antre du Sire-Hano (une par joueur qui franchit la porte, détruite dès
// que tout le monde en est reparti). Chaque zone a son propre jeu de
// plateformes, projectiles, effets et — pour le donjon — son propre combat
// de boss, totalement isolé des autres instances.
// ---------------------------------------------------------------------------

const ZONE_VERTHIGE = "verthige";

const zoneVerthige = {
  id: ZONE_VERTHIGE,
  type: "verthige",
  nom: "Vert-Hige",
  blurb: "L'île de départ : prairies, jungle et la porte de l'Antre.",
  plateformes: PLATEFORMES_VERTHIGE,
  largeur: MONDE_LARGEUR_VERTHIGE,
  hauteur: MONDE_HAUTEUR,
  monstres, // les Fisselo / Troubalourd / Tiralark de l'île (tableau global)
  projectiles: [],
  projectilesMonstres: [],
  effets: [],
  objetsAuSol: [], // butin tombé au sol, à ramasser avec F (voir ramasserObjets)
  sireHano: null, // pas de boss à Vert-Hige
};

const instancesDonjon = new Map(); // id d'instance → zone de donjon
let prochainInstanceId = 1;

// Monstres de l'arène : les mêmes espèces qu'à Vert-Hige (Troubalourd /
// Fisselo / Tiralark), placées sur les plateformes élevées de l'Antre —
// mais ici, une fois tués, ils ne réapparaissent JAMAIS (voir
// simulerRespawnMonstresZone) : l'instance se "vide" au fil du combat.
// Un de chaque type doit être tué avant que Sire-Hano ne s'invoque (voir
// TYPES_MOBS_DONJON / infligerDegatsMonstre).
function peuplerMonstresDonjon() {
  return [
    creerMonstre("troubalourd", PLATEFORMES_DONJON[1]),
    creerMonstre("fisselo", PLATEFORMES_DONJON[3]),
    creerMonstre("tiralark", PLATEFORMES_DONJON[6]),
    creerMonstre("minotaure", PLATEFORMES_DONJON[4]),
  ];
}

// Le boss ne s'invoque qu'une fois un monstre de CHAQUE type tué dans
// l'instance (voir infligerDegatsMonstre) — avant ça, boss.entites reste
// vide (sireHanoEstCiblable() renvoie donc false, et le client affiche une
// jauge de progression à la place de la barre de combat).
const TYPES_MOBS_DONJON = ["troubalourd", "fisselo", "tiralark", "minotaure"];

function creerInstanceDonjon() {
  const id = `donjon-${prochainInstanceId++}`;
  const instance = {
    id,
    type: "donjon",
    plateformes: PLATEFORMES_DONJON,
    largeur: LARGEUR_ARENE_DONJON,
    hauteur: MONDE_HAUTEUR,
    monstres: peuplerMonstresDonjon(),
    projectiles: [],
    projectilesMonstres: [],
    effets: [],
    objetsAuSol: [], // butin tombé au sol, à ramasser avec F (voir ramasserObjets)
    joueurs: new Set(),
    // attaquants : ids de tous les joueurs ayant infligé au moins un coup
    // pendant CE combat (voir infligerDegatsSireHano) — sert de pool de
    // participants pour le partage du butin légendaire, voir
    // essayerDropLegendaireBoss.
    sireHano: { entites: [], phaseIndex: 0, vaincu: false, vaincuRestant: 0, invoque: false, typesTues: new Set(), attaquants: new Set() },
  };
  instancesDonjon.set(id, instance);
  // Pas de demarrerPhaseSireHano ici : le boss reste "dormant" (aucune
  // entité, donc pas ciblable, pas de HUD de combat) tant que les 3 mobs
  // n'ont pas tous été tués.
  return instance;
}

// Appelée depuis infligerDegatsMonstre à chaque mort de mob dans une
// instance du donjon : invoque Sire-Hano dès que les 3 types y sont passés.
function verifierInvocationSireHano(zone, typeMob) {
  const boss = zone.sireHano;
  if (!boss || boss.invoque) return;
  boss.typesTues.add(typeMob);
  if (TYPES_MOBS_DONJON.every((t) => boss.typesTues.has(t))) {
    boss.invoque = true;
    demarrerPhaseSireHano(zone, 0);
  }
}

function zoneDeJoueur(p) {
  if (p.zone === ZONE_VERTHIGE) return zoneVerthige;
  if (p.zone === ZONE_TRONE_AMBRE) return zoneTroneAmbre;
  if (instancesDonjon.has(p.zone)) return instancesDonjon.get(p.zone);
  if (ZONES_PERSISTANTES.has(p.zone)) return ZONES_PERSISTANTES.get(p.zone);
  return zoneVerthige;
}

// Fait entrer un joueur dans une TOUTE NOUVELLE instance du donjon — chaque
// joueur qui franchit la porte a son propre combat contre Sire-Hano.
function entrerDonjon(p) {
  const instance = creerInstanceDonjon();
  instance.joueurs.add(p.id);
  p.zone = instance.id;
  p.x = 30;
  p.y = SIRE_HANO_Y_SOL - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.0;
  // Purement visuel côté Vert-Hige : la porte se referme derrière le
  // joueur qui vient de passer (voir dessinerPorteDonjon côté client),
  // avant de se rouvrir automatiquement à l'approche du suivant.
  donjon.dernierPassageTs = Date.now();
}

// Renvoie un joueur à Vert-Hige, juste devant la porte, et nettoie
// l'instance qu'il quitte si elle devient vide. Utilisé à la fois pour la
// sortie volontaire (icône de porte du HUD) et pour l'abandon depuis
// l'écran de défaite — dans ce second cas le joueur est encore "mort"
// (p.alive === false), on le ressuscite donc au passage.
function sortirDonjon(p) {
  const instance = instancesDonjon.get(p.zone);
  p.zone = ZONE_VERTHIGE;
  p.x = PORTE_DONJON_X - 70;
  p.y = 600 - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.0;
  if (!p.alive) {
    // p.hpMax/p.manaMax sont déjà les valeurs EFFECTIVES (niveau +
    // équipement inclus, voir recalculerStatsEquipement) — pas les valeurs
    // brutes de la classe.
    p.hp = p.hpMax;
    p.mana = p.manaMax;
    p.alive = true;
    p.respawnRestant = 0;
  }
  if (instance) {
    instance.joueurs.delete(p.id);
    if (instance.joueurs.size === 0) instancesDonjon.delete(instance.id);
  }
  // Reverrouille la porte pour forcer un nouveau farming de fragments
  // avant la prochaine tentative — mais SEULEMENT si plus personne n'est
  // en train de tenter sa chance dans le donjon (chaque joueur a sa
  // PROPRE instance, voir entrerDonjon). Sans ce garde-fou, la sortie
  // d'un joueur A (victoire, défaite ou abandon) reverrouillerait aussi
  // la clé — partagée par tout le serveur — de joueurs B/C en train de la
  // récolter ou de combattre dans une instance totalement différente.
  if (instancesDonjon.size === 0) {
    donjon.fragments = 0;
    donjon.ouvert = false;
  }
}

// Réessaie le combat sans quitter l'instance : ressuscite le joueur à
// l'entrée de l'Antre, dans la MÊME instance (les monstres déjà tués
// restent morts, la progression du boss est conservée).
function reessayerDonjon(p) {
  if (p.alive) return;
  p.hp = p.hpMax; // valeur effective (niveau + équipement), voir recalculerStatsEquipement
  p.mana = p.manaMax;
  p.alive = true;
  p.x = 30;
  p.y = SIRE_HANO_Y_SOL - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.5;
}

function* toutesLesZones() {
  yield zoneVerthige;
  yield zoneTroneAmbre;
  yield* instancesDonjon.values();
  yield* ZONES_PERSISTANTES.values();
}

// ---------------------------------------------------------------------------
// Monde étendu : biomes additionnels (zones persistantes et partagées, comme
// Vert-Hige — pas une instance par joueur) et village neutre, tous
// accessibles depuis n'importe où via le réseau de téléporteurs (message
// "teleporter", voir le handler ws.on("message")). Générés une seule fois au
// démarrage du serveur à partir de BIOMES_DEFINITION, avec un générateur de
// plateformes pseudo-aléatoire mais déterministe (seed fixe par biome, pour
// un layout stable entre deux redémarrages) reprenant exactement la forme
// {x, y, width, height} des plateformes écrites à la main plus haut.
// ---------------------------------------------------------------------------

// Petit générateur pseudo-aléatoire seedable (mulberry32) : Math.random()
// n'accepte pas de seed, or on veut un layout de plateformes stable d'un
// redémarrage à l'autre pour chaque biome.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Génère une volée de plateformes en escalier montant, avec un peu
// d'irrégularité — un sol pleine largeur (comme PLATEFORMES_VERTHIGE) puis
// `nbEtages` plateformes de largeur/hauteur variables. Sert à la fois de
// "relief" (les marches demandées) et de terrain de patrouille pour les
// monstres du biome.
function genererPlateformes(rng, largeur, nbEtages) {
  const plateformes = [{ x: 0, y: 600, width: largeur, height: 40 }];
  let x = 70 + Math.floor(rng() * 60);
  for (let i = 0; i < nbEtages; i++) {
    const w = 130 + Math.floor(rng() * 170);
    const y = Math.max(150, 520 - i * 52 - Math.floor(rng() * 40));
    plateformes.push({ x: Math.round(x), y: Math.round(y), width: w, height: 24 });
    x += w + 50 + Math.floor(rng() * 130);
    if (x > largeur - 220) x = 60 + Math.floor(rng() * 90);
  }
  return plateformes;
}

// Une région = un nom + une ambiance + un niveau de mob (progression : +10
// par région successive, comme demandé) — le tier d'équipement qui en
// découle (voir CLES_LOOT_PAR_TIER) et le monstre original qui l'habite sont
// dérivés automatiquement juste après ce tableau.
const BIOMES_DEFINITION = [
  { id: "cretes-ambre", nom: "Crêtes d'Ambre", blurb: "Des falaises de résine durcie où la lumière se fige en flaques dorées.", niveau: 10, monstreNom: "Résinard", couleur: "#c98a2b", teinte: "hue-rotate(15deg) saturate(1.35) brightness(1.05)" },
  { id: "marais-de-suin", nom: "Marais de Suin", blurb: "Un bourbier tenace qui engloutit tout ce qui s'arrête de bouger trop longtemps.", niveau: 20, monstreNom: "Bourbelin", couleur: "#4f6b3a", teinte: "hue-rotate(90deg) saturate(1.4) brightness(0.9)" },
  { id: "foret-chuchote", nom: "Forêt Chuchote", blurb: "Les arbres y murmurent les secrets qu'on leur confie — et ceux qu'on ne leur confie pas.", niveau: 30, monstreNom: "Murmurance", couleur: "#3a6b5f", teinte: "hue-rotate(150deg) saturate(1.3) brightness(0.95)" },
  { id: "pics-verglaces", nom: "Pics Verglacés", blurb: "L'air y coupe autant que la glace sous les bottes.", niveau: 40, monstreNom: "Craquelin", couleur: "#a9d6e5", teinte: "hue-rotate(180deg) saturate(1.5) brightness(1.15)" },
  { id: "dunes-cendrees", nom: "Dunes Cendrées", blurb: "Un désert de cendre froide, vestige d'un feu que plus personne ne se rappelle avoir vu.", niveau: 50, monstreNom: "Cendrelin", couleur: "#8a7a6b", teinte: "grayscale(0.4) saturate(1.1) brightness(0.9)" },
  { id: "abysses-luisantes", nom: "Abysses Luisantes", blurb: "Une faille où la roche elle-même semble respirer une lumière bleutée.", niveau: 60, monstreNom: "Luisereau", couleur: "#3a5f8a", teinte: "hue-rotate(220deg) saturate(1.6) brightness(1.1)" },
  { id: "jardins-petrifies", nom: "Jardins Pétrifiés", blurb: "Un ancien verger dont chaque fruit s'est changé en pierre précieuse.", niveau: 70, monstreNom: "Gravide", couleur: "#8a3a5f", teinte: "hue-rotate(300deg) saturate(1.4) brightness(0.95)" },
  { id: "couronne-orage", nom: "Couronne d'Orage", blurb: "Le sommet du monde connu, où le tonnerre gronde plus bas que les nuages.", niveau: 80, monstreNom: "Fulgurin", couleur: "#d4af37", teinte: "hue-rotate(45deg) saturate(1.6) brightness(1.2)" },
];

// Chaque biome reprend l'un des 3 gabarits de comportement déjà éprouvés
// (patrouille/erratique/tireur), en alternance — même AI, mêmes sprites (via
// `base`), simplement redimensionnés/reteintés/renommés pour rester
// original par région malgré la réutilisation d'assets (aucun nouvel art
// disponible dans cet environnement).
const GABARITS_MONSTRES_BIOME = { patrouille: "troubalourd", erratique: "fisselo", tireur: "tiralark" };
const CYCLE_COMPORTEMENTS = ["patrouille", "erratique", "tireur"];

for (let i = 0; i < BIOMES_DEFINITION.length; i++) {
  const biome = BIOMES_DEFINITION[i];
  const comportement = CYCLE_COMPORTEMENTS[i % CYCLE_COMPORTEMENTS.length];
  const gabarit = GABARITS_MONSTRES_BIOME[comportement];
  const cfgGabarit = MONSTRES_CONFIG[gabarit];
  const echelle = 1 + biome.niveau / 20; // +10 niveau/région → mob nettement plus costaud à chaque nouvelle région

  const monstreCfg = {
    label: biome.monstreNom,
    couleur: biome.couleur,
    largeur: cfgGabarit.largeur,
    hauteur: cfgGabarit.hauteur,
    vitesse: Math.round(cfgGabarit.vitesse * (0.9 + (i % 5) * 0.05)),
    hpMax: Math.round(cfgGabarit.hpMax * echelle),
    degatsContact: Math.round(cfgGabarit.degatsContact * echelle),
    delaiRespawn: cfgGabarit.delaiRespawn,
    comportement,
    xp: Math.round(cfgGabarit.xp * echelle),
    base: gabarit, // sprite réutilisé côté client (voir SPRITES_MONSTRES[m.base])
    teinte: biome.teinte, // filtre CSS appliqué côté client pour rester visuellement distinct
  };
  if (comportement === "tireur") {
    monstreCfg.tir = {
      degats: Math.round(cfgGabarit.tir.degats * echelle),
      cooldown: cfgGabarit.tir.cooldown,
      vitesse: cfgGabarit.tir.vitesse,
      rayon: cfgGabarit.tir.rayon,
      porteeMax: cfgGabarit.tir.porteeMax,
    };
  }
  MONSTRES_CONFIG[biome.id] = monstreCfg;
  biome.typeMonstre = biome.id;
  // Un palier d'équipement tous les ~20 niveaux de mob (T1 pour 10-20, T2
  // pour 30-40, etc.) — voir CLES_LOOT_PAR_TIER.
  biome.tier = biome.niveau <= 20 ? 1 : biome.niveau <= 40 ? 2 : biome.niveau <= 60 ? 3 : 4;
}

// Art dédié pour certaines régions (sprites libres de droit fournis par
// l'utilisateur) : remplace la réutilisation teintée du gabarit par un
// monstre visuellement distinct, sans toucher au gameplay déjà dérivé
// ci-dessus (comportement/stats/xp inchangés — seule l'apparence change).
// Les régions non listées ici gardent le gabarit teinté (aucun asset
// disponible qui leur correspondait mieux visuellement).
// `largeur` recalculée comme pour MONSTRES_CONFIG ci-dessus (moyenne des
// ratios largeur/hauteur des frames idle/walk/attack de chaque sprite dédié,
// `hauteur` inchangée). Note pour epineux/tentacule-vert/faucheur/
// bluetentacle : leurs PNG source contenaient chacun DEUX copies du
// monstre collées l'une à l'autre (dédoublement horizontal ou vertical
// selon le sprite) — probablement un export raté depuis la planche
// d'origine — ce qui, une fois affiché à l'échelle d'un seul, s'étirait ou
// se comprimait de façon incohérente. Les fichiers PNG ont été recadrés
// pour ne garder qu'une seule copie (voir client/sprites/<nom>/*.png) avant
// de recalculer ces ratios ; sans ce nettoyage les ratios ci-dessous
// auraient été faux.
// Hitbox en hauteur doublée pour epineux/tentacule-vert/faucheur/bluetentacle
// (demande explicite : ces 4 monstres paraissaient trop petits/écrasés par
// rapport aux autres une fois le dédoublement de sprite corrigé) — `largeur`
// inchangée, la hitbox devient donc plus haute que large pour ces 4-là.
const ART_DEDIE_PAR_BIOME = {
  "cretes-ambre": { base: "epineux", teinte: null, largeur: 47, hauteur: 120 }, // ratio ≈0.79, hauteur ×2 (était 60, initialement 38)
  "marais-de-suin": { base: "tentacule-vert", teinte: null, largeur: 34, hauteur: 116 }, // ratio ≈0.59, hauteur ×2 (était 58, initialement 46)
  "foret-chuchote": { base: "faucheur", teinte: null, largeur: 57, hauteur: 128 }, // ratio ≈0.88, hauteur ×2 (était 64, initialement 36)
  "dunes-cendrees": { base: "spectre-emergent", teinte: null, largeur: 71, hauteur: 46 }, // spectre très large/aplati, ratio ≈1.54, était 40
  "abysses-luisantes": { base: "bluetentacle", teinte: null, largeur: 29, hauteur: 84 }, // ratio ≈0.69, hauteur ×2 (était 42, initialement 38)
  "jardins-petrifies": { base: "sorcier-4bras", teinte: null, largeur: 69, hauteur: 58 }, // bras écartés, ratio ≈1.18, était 48
  // Les deux dernières régions gardent le gabarit teinté (le dragon DCSS
  // dédié qui y était a été retiré, trop pixelisé à l'échelle du jeu).
};
for (const [id, art] of Object.entries(ART_DEDIE_PAR_BIOME)) {
  if (MONSTRES_CONFIG[id]) Object.assign(MONSTRES_CONFIG[id], art);
}

// Élément grimpable par biome (voir dessinerLianes côté client pour le
// rendu propre à chaque `type`) — un thème cohérent avec l'ambiance de la
// région plutôt que la même liane verte partout : liane pour les biomes
// végétaux/humides, corde pour les biomes rocheux/arides, chaîne pour la
// région électrique, cristal pour l'abysse lumineuse, racine pétrifiée pour
// le jardin de pierre.
const TYPE_GRIMPE_PAR_BIOME = {
  "cretes-ambre": "cristal", // résine figée, aspect cristallin
  "marais-de-suin": "liane", // demande explicite
  "foret-chuchote": "liane",
  "pics-verglaces": "corde",
  "dunes-cendrees": "corde",
  "abysses-luisantes": "cristal",
  "jardins-petrifies": "racine",
  "couronne-orage": "chaine",
};

// Génère la zone persistante d'un biome : plateformes procédurales (seed
// fixe = layout stable), une poignée de monstres du type propre à la région
// répartis sur les plateformes surélevées (jamais au sol, pour ne pas
// bloquer le point d'arrivée du téléporteur), et un élément grimpable (voir
// TYPE_GRIMPE_PAR_BIOME) qui relie la plateforme la PLUS HAUTE au sol —
// garanti sur CHAQUE biome (avant : une région sur deux, et sans garantie de
// réellement relier le haut au bas), en plus des marches déjà données par le
// relief en escalier de genererPlateformes.
function genererZoneBiome(biome, indexSeed) {
  const rng = mulberry32(1000 + indexSeed * 97);
  const largeur = 1400 + Math.floor(rng() * 260);
  const plateformes = genererPlateformes(rng, largeur, 9);
  const plateformesSurelevees = plateformes.slice(1);

  // La plateforme la plus haute (y le plus petit) de tout le relief — c'est
  // elle qu'on relie au sol, pour garantir une connexion du haut vers le bas
  // quelle que soit la disposition tirée au hasard.
  const plateformeSommet = plateformes.reduce((sommet, p) => (p.y < sommet.y ? p : sommet), plateformes[0]);
  const xGrimpe = Math.round(plateformeSommet.x + plateformeSommet.width * (0.3 + rng() * 0.4));
  const SOL_Y = 600;
  const MARGE_BAS = 20; // s'arrête un peu avant le sol, purement esthétique

  const zone = {
    id: biome.id,
    type: "biome",
    nom: biome.nom,
    blurb: biome.blurb,
    niveauMob: biome.niveau,
    tierLoot: biome.tier,
    plateformes,
    largeur,
    hauteur: MONDE_HAUTEUR,
    monstres: [],
    projectiles: [],
    projectilesMonstres: [],
    effets: [],
    objetsAuSol: [],
    sireHano: null,
    lianes: [{
      x: xGrimpe,
      y: plateformeSommet.y,
      hauteur: SOL_Y - plateformeSommet.y - MARGE_BAS,
      type: TYPE_GRIMPE_PAR_BIOME[biome.id] || "liane",
    }],
  };

  // Plateformes mélangées (Fisher-Yates, seed partagée avec le reste de la
  // génération pour un layout stable) plutôt qu'un tirage avec remise : deux
  // monstres sur la MÊME plateforme n'est plus qu'un problème visuel
  // (empilement) une fois les id garantis uniques (voir creerMonstre), mais
  // reste évitable sans coût — et évite de retomber sur le souci d'origine
  // si `creerMonstre` redevenait un jour dérivé de la position.
  const plateformesMelangees = plateformesSurelevees.slice();
  for (let i = plateformesMelangees.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [plateformesMelangees[i], plateformesMelangees[j]] = [plateformesMelangees[j], plateformesMelangees[i]];
  }
  const nbMonstres = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < nbMonstres; i++) {
    const plateforme = plateformesMelangees[i % plateformesMelangees.length] || plateformes[0];
    zone.monstres.push(creerMonstre(biome.typeMonstre, plateforme));
  }
  return zone;
}

// Le village neutre : aucun monstre, un vendeur d'équipement (contre pièces
// d'or, voir le handler "acheter") et deux PNJ "flavor" avec des dialogues
// sommaires et une blague sur la région — la dimension "maison visitable"
// est rendue par de petites façades décoratives dessinées côté client
// autour des PNJ plutôt que par de véritables intérieurs séparés, pour ne
// pas complexifier le système d'instances au-delà de ce que le donjon fait
// déjà.
function genererZoneVillage() {
  const largeur = 1500;
  const plateformes = [
    { x: 0, y: 600, width: largeur, height: 40 },
    { x: 250, y: 470, width: 170, height: 24 },
    { x: 610, y: 420, width: 170, height: 24 },
    { x: 980, y: 470, width: 170, height: 24 },
  ];
  return {
    id: "village",
    type: "village",
    nom: "Estenoise-les-Brumes",
    blurb: "Le seul coin des Royaumes Brisés où personne ne cherche la bagarre.",
    plateformes,
    largeur,
    hauteur: MONDE_HAUTEUR,
    monstres: [],
    projectiles: [],
    projectilesMonstres: [],
    effets: [],
    objetsAuSol: [],
    sireHano: null,
    lianes: [],
    pnjs: [
      {
        id: "vendeur-torvik",
        nom: "Torvik le Bien-Referré",
        type: "vendeur",
        x: 300,
        y: 552,
        dialogue: ["Envie d'un peu d'acier neuf ?", "Tout ce que je vends a déjà sauvé une vie. La mienne, surtout."],
        // Prix x2 (demande explicite) par rapport aux valeurs d'origine
        // (40/55/25).
        boutique: [
          { item: "epee", label: "Épée courte", prix: 80 },
          { item: "arc", label: "Arc simple", prix: 80 },
          { item: "baton", label: "Bâton noueux", prix: 80 },
          { item: "armureT1", label: "Cuirasse rustique", prix: 110 },
          { item: "casque", label: "Casque cabossé", prix: 50 },
          { item: "jambieres", label: "Jambières rapiécées", prix: 50 },
          { item: "anneau", label: "Anneau terni", prix: 50 },
          { item: "bottes", label: "Bottes usées", prix: 50 },
          { item: "bracelet", label: "Bracelet simple", prix: 50 },
        ],
      },
      {
        id: "pnj-oreline",
        nom: "Oreline la Rieuse",
        type: "flavor",
        x: 700,
        y: 552,
        dialogue: [
          "On raconte que Sire-Hano n'a jamais gagné un seul concours de danse, même contre lui-même.",
          "Ici, même les cailloux ont meilleur caractère qu'à la porte de l'Antre.",
        ],
      },
      {
        id: "pnj-bramick",
        nom: "Bramick Trois-Doigts",
        type: "flavor",
        x: 1100,
        y: 552,
        dialogue: [
          "J'ai perdu deux doigts contre un Fisselo. Le troisième, c'est une toute autre histoire.",
          "Le village s'appelle Estenoise-les-Brumes. Ne me demande pas pourquoi, je viens d'arriver moi aussi.",
        ],
      },
    ],
  };
}

const ZONES_PERSISTANTES = new Map();
ZONES_PERSISTANTES.set("village", genererZoneVillage());
BIOMES_DEFINITION.forEach((biome, i) => ZONES_PERSISTANTES.set(biome.id, genererZoneBiome(biome, i)));

// Le Dragon Noir vit dans Couronne d'Orage, la dernière région du jeu (voir
// la section "Dragon Noir" plus haut) — posté là dès le démarrage du
// serveur, pas besoin de porte ni de clé pour l'affronter.
{
  const zoneCouronneOrage = ZONES_PERSISTANTES.get("couronne-orage");
  if (zoneCouronneOrage) zoneCouronneOrage.dragonNoir = creerDragonNoir(zoneCouronneOrage);
}

// Liste envoyée telle quelle au client pour peupler l'onglet téléporteur
// (haut droit de l'écran) — statique après le démarrage du serveur.
// `niveau` reste le niveau des MONSTRES de la région (voir l'échelle de
// stats dans BIOMES_DEFINITION/MONSTRES_CONFIG, inchangé) ; `niveauRequis`
// est un gate d'accès SÉPARÉ et bien plus permissif, +3 par zone dans
// l'ordre de la liste (demande explicite) — vérifié dans le handler du
// message "teleporter" ci-dessous.
const NIVEAU_REQUIS_PALIER = 3;
const DESTINATIONS_TELEPORTEUR = [
  { id: ZONE_VERTHIGE, nom: zoneVerthige.nom, blurb: zoneVerthige.blurb, niveau: 1 },
  { id: "village", nom: ZONES_PERSISTANTES.get("village").nom, blurb: ZONES_PERSISTANTES.get("village").blurb, niveau: 1 },
  ...BIOMES_DEFINITION.map((b) => ({ id: b.id, nom: b.nom, blurb: b.blurb, niveau: b.niveau })),
  // La Salle du Trône n'apparaît PAS ici : contrairement aux biomes, elle ne
  // se rejoint que par sa porte (voir plus bas), pas par le réseau de
  // téléporteurs — cohérent avec le fait que l'entrée s'y paie.
].map((destination, index) => ({ ...destination, niveauRequis: 1 + index * NIVEAU_REQUIS_PALIER }));

// ---------------------------------------------------------------------------
// Donjon : Salle du Trône (Crêtes d'Ambre) — entrée payante, pas de fragments
// ---------------------------------------------------------------------------
// Même porte (visuellement) que l'Antre du Sire-Hano, mais sans clé de
// groupe à récolter : chaque joueur paie sa propre entrée, 500 pièces d'or,
// déduites au moment où il franchit la porte (voir simulerPhysique). Salle
// unique et partagée (pas d'instance par joueur, comme le village) — pour
// l'instant elle ne contient qu'un trône vide (voir dessinerSalleTroneAmbre
// côté client), en attendant d'y intégrer un boss (le Chevalier Noir) plus
// tard.
const PORTE_TRONE_AMBRE_X = 1300; // dans les limites de "cretes-ambre" (largeur procédurale ≈1606, voir genererZoneBiome)
const PRIX_ENTREE_TRONE_AMBRE = 500;
const LARGEUR_TRONE_AMBRE = 1300; // ≥ largeur du viewport (1280) pour que la caméra (clampée à state.world.width - canvas.width) ne laisse jamais voir le ciel au-delà des murs
const ZONE_TRONE_AMBRE = "salle-trone-ambre";

const zoneTroneAmbre = {
  id: ZONE_TRONE_AMBRE,
  type: "salle-trone",
  nom: "Salle du Trône — Crêtes d'Ambre",
  blurb: "Une salle de pierre ambrée, silencieuse, qui attend son maître.",
  plateformes: [{ x: 0, y: 600, width: LARGEUR_TRONE_AMBRE, height: 40 }],
  largeur: LARGEUR_TRONE_AMBRE,
  hauteur: MONDE_HAUTEUR,
  monstres: [],
  projectiles: [],
  projectilesMonstres: [],
  effets: [],
  objetsAuSol: [],
  sireHano: null,
  lianes: [],
  // Position du trône (voir dessinerSalleTroneAmbre côté client) — réservée
  // pour un futur boss, aucune logique de combat pour l'instant.
  trone: { x: LARGEUR_TRONE_AMBRE - 220, y: 600 },
};

// Fait payer puis entrer un joueur dans la Salle du Trône — appelée depuis
// simulerPhysique quand il franchit la porte avec assez d'or (voir plus
// bas) ; le prix est déjà vérifié par l'appelant, pas revérifié ici.
function entrerSalleTroneAmbre(p) {
  p.or = (p.or || 0) - PRIX_ENTREE_TRONE_AMBRE;
  p.zone = ZONE_TRONE_AMBRE;
  p.x = 30;
  p.y = 600 - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.0;
}

// Renvoie un joueur à Crêtes d'Ambre, juste devant la porte — utilisé par
// l'icône de sortie du HUD (message "quitterSalleTroneAmbre").
function sortirSalleTroneAmbre(p) {
  p.zone = "cretes-ambre";
  p.x = PORTE_TRONE_AMBRE_X - 70;
  p.y = 600 - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.0;
}

// ---------------------------------------------------------------------------
// Chevalier Noir : boss de la Salle du Trône (Crêtes d'Ambre) — même schéma
// que le Dragon Noir (entité unique, persistante dans SA zone, pas d'instance
// par joueur, réapparition différée après sa défaite), mais UNE SEULE phase
// pour l'instant (demande explicite du joueur : "il n'a qu'une phase pour le
// moment") — pas de transformation, pas de multiplicateurs de phase 2. Sert
// aussi de trône vide en attendant : le trône lui-même (dessinerSalleTrone
// Ambre côté client) reste inoccupé visuellement, le Chevalier combat au sol
// devant.
// ---------------------------------------------------------------------------

const CHEVALIER_NOIR_LARGEUR = 50;
const CHEVALIER_NOIR_HAUTEUR = 118;
const CHEVALIER_NOIR_VITESSE = 85;
const CHEVALIER_NOIR_HP = 2800;
const CHEVALIER_NOIR_DELAI_RESPAWN = 90; // secondes avant réapparition après défaite

const CHEVALIER_NOIR_ATTAQUES = {
  // Frappe d'épée au contact (voir attack1/attack2 côté client, un vrai
  // swing en deux temps) — seule attaque à courte portée, les trois autres
  // sont des sorts lancés à distance (voir les poses cast-* côté client).
  tranchant: { degats: 22, cooldown: 1.8, portee: 62 },
  // "Lame magique" : projectile rapide (lame-projectile.png) qui explose au
  // contact ou en bout de portée (lame-impact.png, voir `effetImpact`
  // générique dans simulerProjectilesMonstresZone).
  lameMagique: { degats: 24, cooldown: 3.2, vitesse: 320, rayon: 12, porteeMax: 560 },
  // "Éclair" : zone télégraphiée EN COLONNE verticale (pas circulaire comme
  // le météore du Dragon Noir) sous le joueur ciblé — le sprite grandit
  // progressivement pendant le télégraphe (eclair-1 → eclair-2 → eclair-3,
  // voir dessinerTelegrapheColonneEclair côté client) avant de frapper.
  eclair: { degats: 32, cooldown: 6.5, demiLargeur: 34, telegraphe: 1.2 },
  // "Boule de feu" : projectile plus lent qui explose en plusieurs étapes
  // grandissantes (feu-2 → feu-5) à l'impact ou en fin de portée.
  bouleDeFeu: { degats: 20, cooldown: 4.6, vitesse: 210, rayon: 15, porteeMax: 620 },
};

function creerChevalierNoir(zone) {
  return {
    hp: CHEVALIER_NOIR_HP,
    hpMax: CHEVALIER_NOIR_HP,
    largeur: CHEVALIER_NOIR_LARGEUR,
    hauteur: CHEVALIER_NOIR_HAUTEUR,
    x: Math.round(zone.largeur * 0.55),
    y: 600 - CHEVALIER_NOIR_HAUTEUR, // même ligne de sol que la salle (voir plateformes de zoneTroneAmbre)
    vx: 0,
    facing: -1,
    vaincu: false,
    vaincuRestant: 0,
    respawnRestant: 0,
    invulnerableRestant: 1.5,
    attaqueAnimRestant: 0,
    attaqueType: null, // "tranchant" | "lameMagique" | "eclair" | "bouleDeFeu" — pour le choix de pose côté client
    toucheRestant: 0, // brève pose de blessure côté client (voir infligerDegatsChevalierNoir)
    cooldowns: { tranchant: 1, lameMagique: 2, eclair: 3.5, bouleDeFeu: 5 },
    aoeEnAttente: null, // { x, demiLargeur, colonne:true, degats, tempsRestant, telegrapheMax }
    // Voir le champ équivalent de creerDragonNoir : pool de participants
    // pour le partage du butin légendaire (essayerDropLegendaireBoss).
    attaquants: new Set(),
  };
}

function chevalierNoirEstCiblable(zone) {
  return !!zone.chevalierNoir && !zone.chevalierNoir.vaincu && zone.chevalierNoir.respawnRestant <= 0;
}

function infligerDegatsChevalierNoir(zone, degats, joueurId) {
  const cn = zone.chevalierNoir;
  if (!cn || cn.vaincu || cn.invulnerableRestant > 0) return;
  cn.hp = Math.max(0, cn.hp - degats);
  cn._dernierCoupTs = Date.now();
  cn.toucheRestant = 0.22; // pose de blessure brève côté client
  if (joueurId) cn.attaquants.add(joueurId);

  if (cn.hp === 0 && !cn.vaincu) {
    cn.vaincu = true;
    cn.vaincuRestant = 3;
    cn.respawnRestant = CHEVALIER_NOIR_DELAI_RESPAWN;
    const joueur = players.get(joueurId);
    if (joueur) {
      gainerXp(joueur, XP_VICTOIRE_BOSS_MONDE);
      joueur.or = (joueur.or || 0) + OR_VICTOIRE_BOSS_MONDE;
      joueur.statsVie.orGagneTotal += OR_VICTOIRE_BOSS_MONDE;
      joueur.gemmes = (joueur.gemmes || 0) + GEMMES_VICTOIRE_CHEVALIER_NOIR;
      joueur.statsVie.gemmesGagneesTotal += GEMMES_VICTOIRE_CHEVALIER_NOIR;
      joueur.statsVie.chevalierNoirVaincus++;
      verifierHautsFaits(joueur);
    }
    // Même mécanique de drop légendaire que les deux autres boss.
    essayerDropLegendaireBoss(cn.attaquants);
  }
}

// IA très proche de simulerDragonNoir (mêmes primitives), pour une entité
// unique posée dans la Salle du Trône (zone déjà persistante, partagée par
// tout le serveur — pas de logique de ré-instanciation ici).
function simulerChevalierNoir(dtSecondes) {
  const zone = zoneTroneAmbre;
  const cn = zone.chevalierNoir;
  if (!cn) return;

  if (cn.vaincu) {
    cn.vaincuRestant = Math.max(0, cn.vaincuRestant - dtSecondes);
    cn.respawnRestant = Math.max(0, cn.respawnRestant - dtSecondes);
    if (cn.respawnRestant <= 0) {
      Object.assign(cn, creerChevalierNoir(zone));
    }
    return;
  }

  appliquerRegenBoss(cn, dtSecondes);
  if (cn.invulnerableRestant > 0) cn.invulnerableRestant = Math.max(0, cn.invulnerableRestant - dtSecondes);
  if (cn.attaqueAnimRestant > 0) cn.attaqueAnimRestant = Math.max(0, cn.attaqueAnimRestant - dtSecondes);
  if (cn.toucheRestant > 0) cn.toucheRestant = Math.max(0, cn.toucheRestant - dtSecondes);
  for (const touche of Object.keys(cn.cooldowns)) {
    if (cn.cooldowns[touche] > 0) cn.cooldowns[touche] = Math.max(0, cn.cooldowns[touche] - dtSecondes);
  }

  // Détonation de la colonne d'éclair une fois le télégraphe écoulé : frappe
  // tout joueur de la salle dont le centre X tombe dans la demi-largeur de
  // la colonne, quelle que soit sa hauteur (la colonne traverse la salle du
  // "plafond" au sol, comme un éclair qui s'abat).
  if (cn.aoeEnAttente) {
    cn.aoeEnAttente.tempsRestant -= dtSecondes;
    if (cn.aoeEnAttente.tempsRestant <= 0) {
      const zoneAoe = cn.aoeEnAttente;
      for (const p of players.values()) {
        if (!p.alive || p.zone !== zone.id) continue;
        const centreJoueurX = p.x + JOUEUR_LARGEUR / 2;
        if (Math.abs(centreJoueurX - zoneAoe.x) <= zoneAoe.demiLargeur) {
          infligerDegatsJoueur(p, zoneAoe.degats, zoneAoe.x);
        }
      }
      zone.effets.push({ id: prochainEffetId++, x: zoneAoe.x, y: 320, rayon: zoneAoe.demiLargeur, couleur: "#8fd8ff", effet: "eclair_chevalier_impact", vie: 0.35, vieMax: 0.35 });
      cn.aoeEnAttente = null;
    }
  }

  if (cn.invulnerableRestant > 0) return;

  // Cible : joueur vivant le plus proche présent dans la Salle du Trône.
  let cible = null;
  let distanceMin = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.zone !== zone.id) continue;
    const distance = Math.abs(p.x - cn.x);
    if (distance < distanceMin) { distanceMin = distance; cible = p; }
  }
  if (!cible) { cn.vx = 0; return; }

  const centreCn = cn.x + cn.largeur / 2;
  const centreCible = cible.x + JOUEUR_LARGEUR / 2;
  cn.facing = centreCible < centreCn ? -1 : 1;
  const distanceCible = Math.abs(centreCible - centreCn);

  if (distanceCible > CHEVALIER_NOIR_ATTAQUES.tranchant.portee * 0.6) {
    cn.vx = CHEVALIER_NOIR_VITESSE * cn.facing;
    cn.x = Math.max(0, Math.min(zone.largeur - cn.largeur, cn.x + cn.vx * dtSecondes));
  } else {
    cn.vx = 0;
  }

  if (cn.cooldowns.tranchant <= 0 && distanceCible <= CHEVALIER_NOIR_ATTAQUES.tranchant.portee) {
    const attaque = CHEVALIER_NOIR_ATTAQUES.tranchant;
    const zoneX = cn.facing >= 0 ? cn.x + cn.largeur : cn.x - attaque.portee;
    if (rectanglesSeChevauchent(zoneX, cn.y, attaque.portee, cn.hauteur, cible.x, cible.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR)) {
      infligerDegatsJoueur(cible, attaque.degats, centreCn);
    }
    cn.cooldowns.tranchant = attaque.cooldown;
    cn.attaqueAnimRestant = 0.28;
    cn.attaqueType = "tranchant";
  }

  if (cn.cooldowns.lameMagique <= 0 && distanceCible <= CHEVALIER_NOIR_ATTAQUES.lameMagique.porteeMax) {
    const attaque = CHEVALIER_NOIR_ATTAQUES.lameMagique;
    zone.projectilesMonstres.push({
      id: prochainProjectileMonstreId++,
      couleur: "#7fe3ff",
      effet: "lameMagiqueCN",
      effetImpact: "lameImpactCN",
      x: cn.x + (cn.facing >= 0 ? cn.largeur : 0),
      y: cn.y + cn.hauteur * 0.45,
      vx: attaque.vitesse * cn.facing,
      degats: attaque.degats,
      rayon: attaque.rayon,
      porteeMax: attaque.porteeMax,
      distanceParcourue: 0,
    });
    cn.cooldowns.lameMagique = attaque.cooldown;
    cn.attaqueAnimRestant = 0.32;
    cn.attaqueType = "lameMagique";
  }

  if (cn.cooldowns.bouleDeFeu <= 0 && distanceCible <= CHEVALIER_NOIR_ATTAQUES.bouleDeFeu.porteeMax) {
    const attaque = CHEVALIER_NOIR_ATTAQUES.bouleDeFeu;
    zone.projectilesMonstres.push({
      id: prochainProjectileMonstreId++,
      couleur: "#ff8a3a",
      effet: "bouleFeuCN",
      effetImpact: "bouleFeuExplosionCN",
      x: cn.x + (cn.facing >= 0 ? cn.largeur : 0),
      y: cn.y + cn.hauteur * 0.55,
      vx: attaque.vitesse * cn.facing,
      degats: attaque.degats,
      rayon: attaque.rayon,
      porteeMax: attaque.porteeMax,
      distanceParcourue: 0,
    });
    cn.cooldowns.bouleDeFeu = attaque.cooldown;
    cn.attaqueAnimRestant = 0.35;
    cn.attaqueType = "bouleDeFeu";
  }

  if (cn.cooldowns.eclair <= 0 && !cn.aoeEnAttente) {
    const attaque = CHEVALIER_NOIR_ATTAQUES.eclair;
    cn.aoeEnAttente = {
      x: centreCible,
      demiLargeur: attaque.demiLargeur,
      colonne: true,
      degats: attaque.degats,
      tempsRestant: attaque.telegraphe,
      telegrapheMax: attaque.telegraphe,
    };
    cn.cooldowns.eclair = attaque.cooldown;
    cn.attaqueAnimRestant = 0.4;
    cn.attaqueType = "eclair";
  }
}

zoneTroneAmbre.chevalierNoir = creerChevalierNoir(zoneTroneAmbre);

// Point d'arrivée générique pour toute téléportation (voir le handler
// "teleporter") : à quelques pas du bord gauche, au-dessus du sol — la
// gravité fait le reste, comme au premier spawn d'un joueur.
function teleporterVers(p, destinationId) {
  const instance = instancesDonjon.get(p.zone);
  if (instance) {
    instance.joueurs.delete(p.id);
    if (instance.joueurs.size === 0) instancesDonjon.delete(instance.id);
  }
  p.zone = destinationId;
  p.x = 60;
  // Au sol (y=600 partout, voir genererPlateformes/genererZoneVillage/etc.)
  // plutôt que tout en haut de l'écran (y=40) : le joueur retombait certes
  // au sol par la gravité, mais atterrissait parfois sur une plateforme
  // surélevée plutôt que sur le sol si une plateforme se trouvait juste en
  // dessous du point d'arrivée.
  p.y = 600 - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.0;
}

// Variante tiérée de essayerDropArme, réservée aux zones de biome — pool de
// drop dépendant de zone.tierLoot au lieu du pool fixe ORDRE_LOOT_BASE (le
// donjon garde essayerDropArme tel quel, inchangé).
function essayerDropArmeTiere(zone, x, y) {
  if (Math.random() >= CHANCE_DROP_ARME) return;
  const pool = CLES_LOOT_PAR_TIER[zone.tierLoot] || CLES_LOOT_PAR_TIER[1];
  const type = pool[Math.floor(Math.random() * pool.length)];
  deposerObjetAuSol(zone, type, x, y);
}

// ---------------------------------------------------------------------------
// État du jeu
// ---------------------------------------------------------------------------

const players = new Map();
const clients = new Map();
let compteurClasse = 0;
let compteurId = 1;

function creerJoueur() {
  const id = `p${compteurId++}`;
  const classe = ORDRE_CLASSES[compteurClasse % ORDRE_CLASSES.length];
  compteurClasse++;
  const infosClasse = CLASSES[classe];

  return {
    id,
    pseudo: `${infosClasse.label} ${id}`,
    classe,
    couleur: infosClasse.couleur,
    zone: ZONE_VERTHIGE,
    x: 40,
    y: 0,
    vx: 0,
    vy: 0,
    onGround: false,
    accroupi: false,
    facing: 1, // 1 = droite, -1 = gauche
    // Apparence de l'avatar (écran de création) : chaque classe a son
    // propre sprite elfe (voir SPRITES_JOUEURS_ELFE côté client — Dorken =
    // guerrier à l'épée, Quater = archer, Krix = mage), mais la palette de
    // personnalisation reste commune aux trois. `couleurCheveux`/
    // `couleurYeux` pilotent une recoloration canvas côté client (les
    // valeurs par défaut correspondent aux teintes d'origine du sprite
    // Quater, donc un personnage qui ne touche à rien a un rendu identique
    // à l'art de base pour cette classe — pour Dorken/Krix la première
    // valeur de palette ne matche pas forcément exactement leur teinte
    // d'origine, voir le commentaire sur obtenirSpriteRecolore côté
    // client). Note : seul le sprite Quater a un iris de couleur
    // distincte dans l'art source, donc `couleurYeux` n'a pour l'instant
    // aucun effet visuel sur Dorken/Krix (yeux noirs, non recolorables).
    // `couleurVetements` : null par défaut (garde la teinte d'origine de
    // l'armure/robe de la classe) — voir PALETTE_VETEMENTS.
    apparence: { couleurCheveux: "#c9c9c9", couleurYeux: "#448636", couleurVetements: null },
    input: { left: false, right: false, jump: false, bas: false, a: false, z: false, e: false, r: false, f: false },
    hp: infosClasse.hpMax,
    hpMax: infosClasse.hpMax,
    mana: infosClasse.manaMax,
    manaMax: infosClasse.manaMax,
    alive: true,
    invulnerableRestant: 0,
    cooldowns: { a: 0, z: 0, e: 0, r: 0 },
    respawnRestant: 0,
    dashRestant: 0,
    dashVitesse: 0,
    dashDegats: 0,
    dashDejaTouches: [],
    attaqueAnimRestant: 0, // fenêtre pendant laquelle le client affiche le sprite d'attaque
    // Butin personnel de l'Antre du Sire-Hano : armes courantes (drop mob,
    // 10%) et set légendaire (drop du coup de grâce sur le boss, garanti).
    inventaire: {
      epee: 0, arc: 0, baton: 0,
      epeeLegendaire: 0, arcLegendaire: 0, batonLegendaire: 0, armureLegendaire: 0,
    },
    dernierLoot: null, // { type, expire } — petit toast côté client à la ramasse
    // Pièces d'or : gagnées automatiquement à chaque monstre tué (toutes
    // zones confondues, voir infligerDegatsMonstre), dépensées auprès du
    // vendeur du village (message "acheter").
    or: 0,
    // Gemmes : monnaie rare, distincte de l'or — pensée pour une future
    // boutique (pas encore construite). Gagnées beaucoup plus rarement que
    // l'or (petite chance sur les monstres normaux, récompense garantie sur
    // les boss), jamais dépensées automatiquement nulle part pour l'instant.
    gemmes: 0,
    // Progression et équipement (voir la section "Équipement" plus haut).
    niveau: 1,
    xp: 0,
    // Une clé par catégorie d'équipement (voir STATS_PAR_CATEGORIE), ou
    // null si rien n'est équipé dans cet emplacement.
    equipement: { arme: null, armure: null, casque: null, jambieres: null, anneau: null, bottes: null, bracelet: null },
    // Points de caractéristiques à répartir manuellement (+5 par niveau
    // gagné, voir gainerXp) et répartition actuelle du joueur.
    pointsDisponibles: 0,
    statsAlouees: { force: 0, agilite: 0, intelligence: 0, vitalite: 0 },
    // Quêtes journalières (voir assurerQuetesDuJour) — null tant que la
    // première vérification (à la connexion) n'a pas eu lieu.
    quetes: null,
    // Toast de célébration de montée de niveau, même mécanique que
    // dernierLoot (voir gainerXp / construction de l'état envoyé au client).
    derniereMonteeDeNiveau: null,
    // Compteurs CUMULATIFS (jamais remis à zéro, contrairement à la
    // progression des quêtes journalières) — servent uniquement de
    // conditions aux hauts faits, voir verifierHautsFaits plus bas.
    statsVie: { monstresTues: 0, orGagneTotal: 0, questesReclamees: 0, sireHanoVaincus: 0, dragonNoirVaincus: 0, chevalierNoirVaincus: 0, gemmesGagneesTotal: 0 },
    // Hauts faits débloqués (tableau d'ids, voir HAUTS_FAITS) + titre
    // actuellement affiché sous le pseudo (doit être l'un des hauts faits
    // débloqués, ou null) — voir verifierHautsFaits / message "definirTitre".
    hautsFaitsDebloques: [],
    titreActif: null,
    // Toast "HAUT FAIT DÉBLOQUÉ" (même mécanique que loot/montée de niveau).
    dernierHautFait: null,
    // Série de connexion quotidienne (voir verifierRecompenseConnexion) +
    // toast de bienvenue associé, même mécanique.
    connexionQuotidienne: { dernierJour: null, serie: 0 },
    dernierRecompenseConnexion: null,
  };
}

// ---------------------------------------------------------------------------
// Boucle physique (tourne en continu, indépendamment de la fréquence des
// messages reçus des clients — c'est elle qui fait autorité)
// ---------------------------------------------------------------------------

// Ramasse, pour le joueur `p`, tous les objets au sol de sa zone à portée
// de RAYON_RAMASSAGE (appelée en boucle tant que la touche F est
// maintenue — se contente de ne rien trouver une fois le sol nettoyé, pas
// besoin d'un message dédié "one-shot"). Un seul appui peut ramasser
// PLUSIEURS objets d'un coup (utile pour le set légendaire du boss, posé
// en grappe au même endroit) : un seul toast regroupe tout le butin.
function ramasserObjets(zone, p) {
  if (!zone.objetsAuSol || zone.objetsAuSol.length === 0) return;
  const centreX = p.x + JOUEUR_LARGEUR / 2;
  const centreY = p.y + JOUEUR_HAUTEUR / 2;
  const ramasses = [];
  zone.objetsAuSol = zone.objetsAuSol.filter((objet) => {
    const dx = objet.x - centreX;
    const dy = objet.y - centreY;
    if (Math.sqrt(dx * dx + dy * dy) <= RAYON_RAMASSAGE) {
      ramasses.push(objet);
      return false; // retiré du sol
    }
    return true;
  });
  if (ramasses.length === 0) return;
  for (const objet of ramasses) {
    p.inventaire[objet.type] = (p.inventaire[objet.type] || 0) + 1;
  }
  const [premier, ...reste] = ramasses;
  const legendaire = ramasses.some((o) => o.type.endsWith("Legendaire"));
  const mythique = ramasses.some((o) => o.type.endsWith("Mythique")); // jamais au sol en pratique (voir essayerDropLegendaireBoss), gardé par symétrie
  p.dernierLoot = {
    id: prochainLootId++,
    type: premier.type,
    bundle: reste.map((o) => o.type),
    legendaire,
    mythique,
    expire: Date.now() + (legendaire || mythique ? 5000 : 3000),
  };
}

function simulerPhysique(dtSecondes) {
  for (const p of players.values()) {
    if (!p.alive) continue; // le corps reste figé pendant le K.O.
    const zone = zoneDeJoueur(p);

    if (p.input.f) ramasserObjets(zone, p);

    if (p.dashRestant > 0) {
      // Pendant une charge, la vitesse horizontale est imposée par le
      // sort — les touches gauche/droite sont ignorées le temps du dash.
      p.vx = p.dashVitesse;
      p.dashRestant = Math.max(0, p.dashRestant - dtSecondes);
    } else {
      const vitesse = vitesseEffective(p); // Agilité de l'équipement
      p.vx = p.input.left ? -vitesse : p.input.right ? vitesse : 0;
      if (p.input.left) p.facing = -1;
      else if (p.input.right) p.facing = 1;
    }

    p.vy += GRAVITE * dtSecondes;
    if (p.vy > VITESSE_CHUTE_MAX) p.vy = VITESSE_CHUTE_MAX;

    if (p.input.jump && p.onGround) {
      p.vy = VITESSE_SAUT;
      p.onGround = false;
    }

    // Déplacement horizontal, bloqué aux limites de la zone actuelle (bords
    // sécurisés) — et à Vert-Hige, à la porte du donjon tant que la clé de
    // groupe n'est pas complète : elle agit comme un mur invisible.
    p.x += p.vx * dtSecondes;
    const limiteDroite =
      zone.type === "verthige" && !donjon.ouvert
        ? Math.min(zone.largeur - JOUEUR_LARGEUR, PORTE_DONJON_X - JOUEUR_LARGEUR)
        : zone.largeur - JOUEUR_LARGEUR;
    p.x = Math.max(0, Math.min(limiteDroite, p.x));

    // Déplacement vertical + atterrissage sur les plateformes de la zone.
    const basAvant = p.y + JOUEUR_HAUTEUR;
    p.y += p.vy * dtSecondes;
    p.onGround = false;

    for (const plateforme of zone.plateformes) {
      const chevaucheX = p.x + JOUEUR_LARGEUR > plateforme.x && p.x < plateforme.x + plateforme.width;
      const basApres = p.y + JOUEUR_HAUTEUR;
      const atterrit = p.vy >= 0 && basAvant <= plateforme.y + 1 && basApres >= plateforme.y;
      if (chevaucheX && atterrit) {
        p.y = plateforme.y - JOUEUR_HAUTEUR;
        p.vy = 0;
        p.onGround = true;
      }
    }

    // Accroupissement (flèche du bas) : purement cosmétique côté serveur
    // (pas de hitbox réduite, pas de collision plafond dans ce moteur — voir
    // le commentaire sur JOUEUR_HAUTEUR), donc on se contente d'exposer un
    // booléen aux clients pour qu'ils aplatissent le sprite. Ignoré en
    // l'air : s'accroupir en plein saut n'aurait aucun sens visuellement.
    p.accroupi = !!(p.input.bas && p.onGround);

    // Lianes (certains biomes, voir genererZoneBiome) : tant que le joueur
    // maintient Espace/↑ à l'intérieur de la bande verticale d'une liane,
    // la gravité est ignorée et il grimpe doucement, au lieu du simple saut
    // habituel — il retombe normalement dès qu'il relâche la touche ou
    // sort de la zone de la liane.
    if (zone.lianes && zone.lianes.length) {
      const centreJoueur = p.x + JOUEUR_LARGEUR / 2;
      const surLiane = zone.lianes.find(
        (l) => centreJoueur >= l.x - 22 && centreJoueur <= l.x + 22 && p.y + JOUEUR_HAUTEUR >= l.y && p.y <= l.y + l.hauteur
      );
      if (surLiane && p.input.jump) {
        p.vy = -140;
        p.onGround = false;
      }
    }

    // Porte du donjon (Vert-Hige → une TOUTE NOUVELLE instance de l'Antre) :
    // clé complète + contact avec la porte.
    if (zone.type === "verthige" && donjon.ouvert && p.x + JOUEUR_LARGEUR >= PORTE_DONJON_X) {
      entrerDonjon(p);
      continue;
    }
    // Le retour à Vert-Hige depuis l'Antre ne se déclenche plus en marchant
    // jusqu'au bord de la map : c'est désormais l'icône de porte du HUD
    // (message "quitterDonjon") qui le fait, à tout moment, sans dépendre
    // de la position du joueur.

    // Porte de la Salle du Trône (Crêtes d'Ambre) : pas de clé, mais un
    // péage — mur invisible tant que le joueur n'a pas les 500 pièces d'or
    // requises (même principe que le mur de la porte du Sire-Hano avant que
    // la clé de groupe soit complète), puis paiement + entrée dès qu'il la
    // franchit avec assez d'or.
    if (zone.id === "cretes-ambre") {
      if ((p.or || 0) >= PRIX_ENTREE_TRONE_AMBRE) {
        if (p.x + JOUEUR_LARGEUR >= PORTE_TRONE_AMBRE_X) {
          entrerSalleTroneAmbre(p);
          continue;
        }
      } else if (p.x > PORTE_TRONE_AMBRE_X - JOUEUR_LARGEUR) {
        p.x = PORTE_TRONE_AMBRE_X - JOUEUR_LARGEUR;
      }
    }
  }
}

function simulerMonstres(dtSecondes) {
  // Boucle sur TOUTES les zones (Vert-Hige, chaque instance du donjon, et
  // maintenant chaque biome/village) — auparavant limitée au tableau global
  // `monstres` (Vert-Hige uniquement), ce qui laissait les monstres du
  // donjon immobiles ; généralisé ici sans changer la logique par monstre,
  // qui ne dépend que de ses propres bornes (posées à la création, voir
  // creerMonstre).
  for (const zone of toutesLesZones()) {
    for (const m of zone.monstres) {
      if (m.attaqueAnimRestant > 0) m.attaqueAnimRestant = Math.max(0, m.attaqueAnimRestant - dtSecondes);
      if (m.morte) continue;
      const cfg = MONSTRES_CONFIG[m.type];

      if (cfg.comportement === "patrouille") {
        m.x += m.vx * dtSecondes;
        if (m.x < m.borneGauche) {
          m.x = m.borneGauche;
          m.vx = Math.abs(m.vx);
        } else if (m.x > m.borneDroite) {
          m.x = m.borneDroite;
          m.vx = -Math.abs(m.vx);
        }
      } else if (cfg.comportement === "erratique") {
        // Change de direction et de vitesse à intervalles aléatoires courts,
        // pour un mouvement nerveux plutôt qu'un simple aller-retour régulier.
        m.prochainChangement -= dtSecondes;
        if (m.prochainChangement <= 0) {
          m.vx = (Math.random() < 0.5 ? -1 : 1) * cfg.vitesse * (0.5 + Math.random() * 0.5);
          m.prochainChangement = 0.3 + Math.random() * 0.7;
        }
        m.x += m.vx * dtSecondes;
        if (m.x < m.borneGauche) {
          m.x = m.borneGauche;
          m.vx = Math.abs(m.vx);
        } else if (m.x > m.borneDroite) {
          m.x = m.borneDroite;
          m.vx = -Math.abs(m.vx);
        }
      }
      // comportement "tireur" (Tiralark et gabarits dérivés) : reste
      // immobile, voir simulerTirsMonstresZone pour sa logique de tir.
    }
  }
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------
// Principe général, comme pour tout le reste : le serveur décide seul si un
// coup touche et combien de dégâts il fait. Le client se contente d'envoyer
// "j'appuie sur le bouton d'attaque", jamais "j'ai touché tel monstre".

const projectiles = [];
let prochainProjectileId = 1;

const projectilesMonstres = [];
let prochainProjectileMonstreId = 1;

const effets = []; // effets visuels transitoires (ex: explosion d'ultime)
let prochainEffetId = 1;

function rectanglesSeChevauchent(x1, y1, w1, h1, x2, y2, w2, h2) {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

// Rectangle de collision utilisé quand un JOUEUR touche un monstre (mêlée,
// charge, projectile) — distinct de la taille visuelle du sprite (cfg.largeur/
// hauteur) pour permettre d'agrandir la zone où un coup compte sans changer
// le rendu. Si le type définit son propre hitboxLargeur/hitboxHauteur (voir
// fisselo, doublé dans les deux dimensions, centré), ceux-ci priment. Sinon,
// par défaut pour TOUS les monstres (demande explicite) : +30% de hauteur
// UNIQUEMENT VERS LE HAUT — la largeur et le bas de la hitbox restent
// exactement ceux du sprite.
const MULTIPLICATEUR_HITBOX_DEFAUT = 1.3;

function hitboxMonstre(m, cfg) {
  if (cfg.hitboxLargeur || cfg.hitboxHauteur) {
    const largeur = cfg.hitboxLargeur || cfg.largeur;
    const hauteur = cfg.hitboxHauteur || cfg.hauteur;
    return {
      x: m.x - (largeur - cfg.largeur) / 2,
      y: m.y - (hauteur - cfg.hauteur) / 2,
      largeur,
      hauteur,
    };
  }
  const hauteur = Math.round(cfg.hauteur * MULTIPLICATEUR_HITBOX_DEFAUT);
  return {
    x: m.x,
    y: m.y - (hauteur - cfg.hauteur), // toute l'extension vers le haut, rien vers le bas
    largeur: cfg.largeur,
    hauteur,
  };
}

function cercleRectangleSeChevauchent(cx, cy, rayon, rx, ry, rw, rh) {
  const pointProcheX = Math.max(rx, Math.min(cx, rx + rw));
  const pointProcheY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - pointProcheX;
  const dy = cy - pointProcheY;
  return dx * dx + dy * dy <= rayon * rayon;
}

// Le boss d'une instance n'est une cible valide que tant qu'il n'a pas été
// définitivement vaincu (dernière réplique de la dernière phase tuée).
function sireHanoEstCiblable(zone) {
  return !!zone.sireHano && !zone.sireHano.vaincu && zone.sireHano.entites.length > 0;
}

function infligerDegatsMonstre(zone, m, degats, joueurId) {
  if (m.morte) return;
  m.hp = Math.max(0, m.hp - degats);
  if (m.hp === 0) {
    m.morte = true;
    m.respawnRestant = MONSTRES_CONFIG[m.type].delaiRespawn;
    const joueur = players.get(joueurId);
    if (joueur) {
      gainerXp(joueur, MONSTRES_CONFIG[m.type].xp || 0); // tout monstre tué rapporte de l'XP, quelle que soit la zone
      // Pièces d'or : auto-collectées (contrairement à l'équipement, qui
      // reste au sol pour le ramassage à F) — toutes zones confondues.
      const orGagne = Math.max(1, Math.round((MONSTRES_CONFIG[m.type].xp || 1) * 2.5));
      joueur.or = (joueur.or || 0) + orGagne;
      incrementerQuete(joueur, "tuer_monstres", 1);
      incrementerQuete(joueur, "gagner_or", orGagne);
      joueur.statsVie.monstresTues++;
      joueur.statsVie.orGagneTotal += orGagne;
      // Gemmes : monnaie rare, petite chance sur les monstres du commun —
      // voir le commentaire sur `gemmes` dans creerJoueur.
      if (Math.random() < CHANCE_GEMME_MONSTRE) {
        joueur.gemmes = (joueur.gemmes || 0) + 1;
        joueur.statsVie.gemmesGagneesTotal += 1;
      }
      verifierHautsFaits(joueur);
    }
    if (zone.type === "donjon") {
      // Objet posé au sol au centre du monstre mort — voir essayerDropArme /
      // ramasserObjets pour le ramassage à la touche F.
      const cfg = MONSTRES_CONFIG[m.type];
      essayerDropArme(zone, m.x + cfg.largeur / 2, m.y + cfg.hauteur / 2);
      verifierInvocationSireHano(zone, m.type); // invoque le boss une fois les 3 types passés
    } else if (zone.type === "biome") {
      // Régions étendues : même principe que le donjon, mais avec le pool
      // d'équipement tiéré à la couleur du niveau de la région (voir
      // essayerDropArmeTiere / CLES_LOOT_PAR_TIER).
      const cfg = MONSTRES_CONFIG[m.type];
      essayerDropArmeTiere(zone, m.x + cfg.largeur / 2, m.y + cfg.hauteur / 2);
    } else if (zone.type === "verthige") {
      essayerDropFragment(); // Fisselo / Troubalourd / Tiralark de Vert-Hige : chance de fragment de clé
    }
  }
}

// Même principe que infligerDegatsMonstre, mais pour une entité de
// Sire-Hano : quand une entité meurt, elle est simplement retirée du
// combat ; quand la dernière entité d'une phase meurt, soit la phase
// suivante démarre (davantage de répliques, plus petites), soit — en fin de
// dernière phase — c'est la victoire finale.
function infligerDegatsSireHano(zone, entite, degats, joueurId) {
  const boss = zone.sireHano;
  if (!boss || boss.vaincu || entite.morte || entite.invulnerableRestant > 0) return;
  entite.hp = Math.max(0, entite.hp - degats);
  entite._dernierCoupTs = Date.now();
  if (joueurId) boss.attaquants.add(joueurId);
  if (entite.hp > 0) return;

  entite.morte = true;
  boss.entites = boss.entites.filter((e) => e !== entite);

  const joueur = players.get(joueurId);
  if (joueur) gainerXp(joueur, XP_SIRE_HANO_ENTITE); // chaque réplique tuée rapporte de l'XP

  if (boss.entites.length > 0) return; // d'autres répliques de cette phase sont encore en vie

  if (boss.phaseIndex < PHASES_SIRE_HANO.length - 1) {
    demarrerPhaseSireHano(zone, boss.phaseIndex + 1);
  } else {
    boss.vaincu = true;
    boss.vaincuRestant = 8; // petit répit avant le retour automatique à Vert-Hige
    // Coup de grâce final : bonus d'XP + set légendaire garanti pour le
    // joueur qui vient d'achever la toute dernière réplique.
    if (joueur) {
      gainerXp(joueur, XP_SIRE_HANO_VICTOIRE);
      joueur.or = (joueur.or || 0) + OR_VICTOIRE_BOSS_MONDE;
      joueur.statsVie.orGagneTotal += OR_VICTOIRE_BOSS_MONDE;
      joueur.statsVie.sireHanoVaincus++;
      joueur.gemmes = (joueur.gemmes || 0) + GEMMES_VICTOIRE_SIRE_HANO;
      joueur.statsVie.gemmesGagneesTotal += GEMMES_VICTOIRE_SIRE_HANO;
      verifierHautsFaits(joueur);
    }
    // Butin MYTHIQUE (un cran au-dessus du légendaire des deux autres boss)
    // — demande explicite du joueur — va directement à l'inventaire d'un/des
    // participant(s) du combat — voir essayerDropLegendaireBoss.
    essayerDropLegendaireBoss(boss.attaquants, "mythique");
  }
}

function infligerDegatsJoueur(p, degats, sourceX) {
  if (!p.alive || p.invulnerableRestant > 0) return false;
  // Réduction de dégâts subis (armure légendaire) : appliquée ici, au
  // moment de l'impact, pour couvrir toutes les sources (mobs, boss).
  const degatsEffectifs = Math.round(degats * (1 - statsEquipement(p).reductionDegatsPct));
  p.hp = Math.max(0, p.hp - degatsEffectifs);
  p.invulnerableRestant = 1.0;

  // Petit recul pour ressentir l'impact : on pousse le joueur à l'opposé de
  // la source du coup, avec un petit rebond vertical.
  const zone = zoneDeJoueur(p);
  const centreJoueur = p.x + JOUEUR_LARGEUR / 2;
  const direction = centreJoueur < sourceX ? -1 : 1;
  p.x = Math.max(0, Math.min(zone.largeur - JOUEUR_LARGEUR, p.x + direction * 24));
  p.vy = -260;

  if (p.hp === 0) {
    p.alive = false;
    p.respawnRestant = 3;
  }
  return true;
}

function respawnJoueur(p) {
  p.hp = p.hpMax; // valeur effective (niveau + équipement), voir recalculerStatsEquipement
  p.mana = p.manaMax;
  p.alive = true;
  p.x = 60 + Math.random() * 300;
  p.y = 600 - JOUEUR_HAUTEUR;
  p.vx = 0;
  p.vy = 0;
  p.invulnerableRestant = 1.5; // petit répit à la réapparition
}

function respawnMonstre(m) {
  const cfg = MONSTRES_CONFIG[m.type];
  m.hp = cfg.hpMax;
  m.morte = false;
  // Remet le monstre à sa position de départ plutôt qu'à "borneGauche", qui
  // n'existe que pour les comportements "patrouille"/"erratique" — un
  // Tiralark ("tireur") n'en a pas, et se retrouvait avec une position
  // invalide (x = undefined), donc invisible/jamais réapparu.
  m.x = m.xApparition;
  m.vx = cfg.comportement === "tireur" ? 0 : cfg.vitesse;
  if (cfg.comportement === "tireur") {
    m.cooldownTir = Math.random() * cfg.tir.cooldown;
  }
}

// Hauteur/origine Y à utiliser pour un sort lancé par `p`, accordée à son
// hitbox accroupie plutôt qu'à sa hauteur debout — sans ça, un sort lancé en
// étant accroupi partirait toujours du torse du personnage DEBOUT, très
// visiblement décalé par rapport au sprite aplati affiché à l'écran (voir
// FACTEUR_HAUTEUR_ACCROUPI). Ne touche PAS au hurtbox du joueur lui-même
// (les dégâts subis restent sur toute sa hauteur, voir le commentaire sur
// p.accroupi dans simulerPhysique : intentionnellement pas de hitbox
// réduite pour encaisser les coups) — uniquement la hauteur depuis laquelle
// SES PROPRES sorts partent.
function hitboxAttaqueJoueur(p) {
  if (!p.accroupi) return { y: p.y, hauteur: JOUEUR_HAUTEUR };
  const hauteur = Math.round(JOUEUR_HAUTEUR * FACTEUR_HAUTEUR_ACCROUPI);
  return { y: p.y + JOUEUR_HAUTEUR - hauteur, hauteur }; // ancré aux pieds, comme le squash du sprite
}

// `degats` est déjà le montant EFFECTIF (niveau + arme équipée pris en
// compte par l'appelant, voir declencherAttaque) — le projectile le
// transporte tel quel jusqu'à l'impact.
function creerProjectile(p, attaque, degats) {
  const hb = hitboxAttaqueJoueur(p);
  return {
    id: prochainProjectileId++,
    proprietaireId: p.id,
    couleur: p.couleur,
    effet: attaque.effet || "orbe", // pilote le rendu visuel côté client (voir dessinerProjectiles)
    x: p.x + (p.facing >= 0 ? JOUEUR_LARGEUR : 0),
    y: hb.y + hb.hauteur / 2 + (attaque.decalageY || 0),
    vx: attaque.vitesse * p.facing,
    degats,
    rayon: attaque.rayon,
    porteeMax: attaque.porteeMax,
    distanceParcourue: 0,
    transperce: !!attaque.transperce,
    dejaTouches: [],
  };
}

function declencherAttaque(p, zone, touche) {
  const attaque = CLASSES[p.classe].attaques[touche];
  if (!attaque) return;
  p.cooldowns[touche] = attaque.cooldown * (1 - reductionCooldown(p)); // Agilité de l'équipement
  // Petite fenêtre pendant laquelle le client affiche le sprite d'attaque,
  // indépendamment du cooldown (souvent bien plus long) du sort.
  p.attaqueAnimRestant = 0.22;

  // Dégâts effectifs de CE déclenchement : dégâts de base du sort, modifiés
  // par le niveau du joueur et son arme équipée (voir multiplicateurDegats).
  const degats = Math.round(attaque.degats * multiplicateurDegats(p));

  if (attaque.type === "melee") {
    const zoneX = p.facing >= 0 ? p.x + JOUEUR_LARGEUR : p.x - attaque.portee;
    const hb = hitboxAttaqueJoueur(p);
    for (const m of zone.monstres) {
      if (m.morte) continue;
      const cfgMonstre = MONSTRES_CONFIG[m.type];
      const hbMonstre = hitboxMonstre(m, cfgMonstre);
      if (rectanglesSeChevauchent(zoneX, hb.y, attaque.portee, hb.hauteur, hbMonstre.x, hbMonstre.y, hbMonstre.largeur, hbMonstre.hauteur)) {
        infligerDegatsMonstre(zone, m, degats, p.id);
      }
    }
    if (sireHanoEstCiblable(zone)) {
      for (const entite of zone.sireHano.entites) {
        const hbEntite = hitboxEntiteSireHano(entite);
        if (rectanglesSeChevauchent(zoneX, hb.y, attaque.portee, hb.hauteur, hbEntite.x, hbEntite.y, hbEntite.largeur, hbEntite.hauteur)) {
          infligerDegatsSireHano(zone, entite, degats, p.id);
        }
      }
    }
    if (dragonNoirEstCiblable(zone)) {
      const dragon = zone.dragonNoir;
      if (rectanglesSeChevauchent(zoneX, hb.y, attaque.portee, hb.hauteur, dragon.x, dragon.y, dragon.largeur, dragon.hauteur)) {
        infligerDegatsDragonNoir(zone, degats, p.id);
      }
    }
    if (chevalierNoirEstCiblable(zone)) {
      const cn = zone.chevalierNoir;
      if (rectanglesSeChevauchent(zoneX, hb.y, attaque.portee, hb.hauteur, cn.x, cn.y, cn.largeur, cn.hauteur)) {
        infligerDegatsChevalierNoir(zone, degats, p.id);
      }
    }
  } else if (attaque.type === "projectile") {
    zone.projectiles.push(creerProjectile(p, attaque, degats));
  } else if (attaque.type === "volee") {
    // Plusieurs projectiles tirés d'un coup, légèrement décalés
    // verticalement — l'ultime du Quater.
    for (let i = 0; i < attaque.nombre; i++) {
      const proj = creerProjectile(p, attaque, degats);
      proj.y += (i - (attaque.nombre - 1) / 2) * attaque.ecartY;
      zone.projectiles.push(proj);
    }
  } else if (attaque.type === "dash") {
    p.dashRestant = attaque.duree;
    p.dashVitesse = attaque.vitesseDash * p.facing;
    p.dashDegats = degats;
    p.dashDejaTouches = [];
  } else if (attaque.type === "aoe") {
    const hbAoe = hitboxAttaqueJoueur(p);
    const centreX = p.x + JOUEUR_LARGEUR / 2 + attaque.portee * p.facing;
    const centreY = hbAoe.y + hbAoe.hauteur / 2;
    for (const m of zone.monstres) {
      if (m.morte) continue;
      const cfgMonstre = MONSTRES_CONFIG[m.type];
      const centreMonstreX = m.x + cfgMonstre.largeur / 2;
      const centreMonstreY = m.y + cfgMonstre.hauteur / 2;
      const distance = Math.hypot(centreMonstreX - centreX, centreMonstreY - centreY);
      if (distance <= attaque.rayon) infligerDegatsMonstre(zone, m, degats, p.id);
    }
    if (sireHanoEstCiblable(zone)) {
      for (const entite of zone.sireHano.entites) {
        const centreBossX = entite.x + entite.largeur / 2;
        const centreBossY = entite.y + entite.hauteur / 2;
        if (Math.hypot(centreBossX - centreX, centreBossY - centreY) <= attaque.rayon) {
          infligerDegatsSireHano(zone, entite, degats, p.id);
        }
      }
    }
    if (dragonNoirEstCiblable(zone)) {
      const dragon = zone.dragonNoir;
      const centreDragonX = dragon.x + dragon.largeur / 2;
      const centreDragonY = dragon.y + dragon.hauteur / 2;
      if (Math.hypot(centreDragonX - centreX, centreDragonY - centreY) <= attaque.rayon) {
        infligerDegatsDragonNoir(zone, degats, p.id);
      }
    }
    if (chevalierNoirEstCiblable(zone)) {
      const cn = zone.chevalierNoir;
      const centreCnX = cn.x + cn.largeur / 2;
      const centreCnY = cn.y + cn.hauteur / 2;
      if (Math.hypot(centreCnX - centreX, centreCnY - centreY) <= attaque.rayon) {
        infligerDegatsChevalierNoir(zone, degats, p.id);
      }
    }
    zone.effets.push({
      id: prochainEffetId++,
      x: centreX,
      y: centreY,
      rayon: attaque.rayon,
      couleur: p.couleur,
      effet: attaque.effet || "impact",
      vie: 0.4,
      vieMax: 0.4,
    });
  }
}

function simulerCombat(dtSecondes) {
  // Timers, déclenchement des sorts, et dégâts de la charge en cours —
  // indépendant de la zone dans laquelle se trouve le joueur.
  for (const p of players.values()) {
    if (p.invulnerableRestant > 0) p.invulnerableRestant = Math.max(0, p.invulnerableRestant - dtSecondes);

    for (const touche of TOUCHES_SORTS) {
      if (p.cooldowns[touche] > 0) p.cooldowns[touche] = Math.max(0, p.cooldowns[touche] - dtSecondes);
    }
    if (p.attaqueAnimRestant > 0) p.attaqueAnimRestant = Math.max(0, p.attaqueAnimRestant - dtSecondes);

    if (!p.alive) {
      // Dans l'Antre du Sire-Hano, une défaite n'est PAS suivie d'une
      // réapparition automatique : le joueur reste mort jusqu'à ce qu'il
      // choisisse, via la bulle de dialogue du client, de "Réessayer"
      // (reessayerDonjon, même instance) ou de "Quitter le donjon"
      // (sortirDonjon). À Vert-Hige, la réapparition auto après 3s reste
      // inchangée.
      if (zoneDeJoueur(p).type === "donjon") continue;
      p.respawnRestant -= dtSecondes;
      if (p.respawnRestant <= 0) respawnJoueur(p);
      continue;
    }

    // Régénération de mana continue, plafonnée au maximum de la classe.
    const regenClasse = CLASSES[p.classe].manaRegen;
    p.mana = Math.min(p.manaMax, p.mana + regenClasse * dtSecondes);

    // Régénération de vie continue (5 PV/s), plafonnée au maximum.
    // Bonus de régénération des objets légendaires/mythiques équipés (voir
    // le champ "regenPv" de STATS_ARME/STATS_ARMURE/etc. et statsEquipement).
    const regenEffective = HP_REGEN_PAR_SECONDE + statsEquipement(p).regenPv;
    p.hp = Math.min(p.hpMax, p.hp + regenEffective * dtSecondes);

    const zone = zoneDeJoueur(p);

    for (const touche of TOUCHES_SORTS) {
      const attaque = CLASSES[p.classe].attaques[touche];
      if (p.input[touche] && p.cooldowns[touche] <= 0 && p.mana >= attaque.coutMana) {
        p.mana -= attaque.coutMana;
        declencherAttaque(p, zone, touche);
      }
    }

    // Dégâts au contact pendant une charge (Dorken) — chaque monstre n'est
    // touché qu'une seule fois par charge, même s'il reste dans la zone
    // plusieurs ticks d'affilée.
    if (p.dashRestant > 0) {
      for (const m of zone.monstres) {
        if (m.morte || p.dashDejaTouches.includes(m.id)) continue;
        const cfgMonstre = MONSTRES_CONFIG[m.type];
        const hb = hitboxMonstre(m, cfgMonstre);
        if (rectanglesSeChevauchent(p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR, hb.x, hb.y, hb.largeur, hb.hauteur)) {
          infligerDegatsMonstre(zone, m, p.dashDegats, p.id);
          p.dashDejaTouches.push(m.id);
        }
      }
      if (sireHanoEstCiblable(zone)) {
        for (const entite of zone.sireHano.entites) {
          const sentinelle = "sireHano:" + entite.id;
          if (p.dashDejaTouches.includes(sentinelle)) continue;
          const hbEntite = hitboxEntiteSireHano(entite);
          if (rectanglesSeChevauchent(p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR, hbEntite.x, hbEntite.y, hbEntite.largeur, hbEntite.hauteur)) {
            infligerDegatsSireHano(zone, entite, p.dashDegats, p.id);
            p.dashDejaTouches.push(sentinelle);
          }
        }
      }
      if (dragonNoirEstCiblable(zone) && !p.dashDejaTouches.includes("dragonNoir")) {
        const dragon = zone.dragonNoir;
        if (rectanglesSeChevauchent(p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR, dragon.x, dragon.y, dragon.largeur, dragon.hauteur)) {
          infligerDegatsDragonNoir(zone, p.dashDegats, p.id);
          p.dashDejaTouches.push("dragonNoir");
        }
      }
      if (chevalierNoirEstCiblable(zone) && !p.dashDejaTouches.includes("chevalierNoir")) {
        const cn = zone.chevalierNoir;
        if (rectanglesSeChevauchent(p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR, cn.x, cn.y, cn.largeur, cn.hauteur)) {
          infligerDegatsChevalierNoir(zone, p.dashDegats, p.id);
          p.dashDejaTouches.push("chevalierNoir");
        }
      }
    } else if (p.dashDejaTouches.length > 0) {
      p.dashDejaTouches = []; // prêt pour la prochaine charge
    }
  }

  // Résolution par zone : chaque zone (Vert-Hige + chaque instance de
  // donjon active) a son propre jeu de projectiles/effets/monstres,
  // complètement isolé des autres.
  for (const zone of toutesLesZones()) {
    simulerProjectilesJoueursZone(zone, dtSecondes);
    simulerTirsMonstresZone(zone, dtSecondes);
    simulerProjectilesMonstresZone(zone, dtSecondes);
    simulerContactsMonstresZone(zone, dtSecondes);
    simulerRespawnMonstresZone(zone, dtSecondes);
    simulerEffetsZone(zone, dtSecondes);
  }
}

// Déplacement des projectiles des joueurs + collision avec les monstres et
// le boss de la zone.
function simulerProjectilesJoueursZone(zone, dtSecondes) {
  const projectiles = zone.projectiles;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.x += proj.vx * dtSecondes;
    proj.distanceParcourue += Math.abs(proj.vx * dtSecondes);

    let stoppe = false;
    for (const m of zone.monstres) {
      if (m.morte || proj.dejaTouches.includes(m.id)) continue;
      const cfgMonstre = MONSTRES_CONFIG[m.type];
      const hb = hitboxMonstre(m, cfgMonstre);
      if (cercleRectangleSeChevauchent(proj.x, proj.y, proj.rayon, hb.x, hb.y, hb.largeur, hb.hauteur)) {
        infligerDegatsMonstre(zone, m, proj.degats, proj.proprietaireId);
        proj.dejaTouches.push(m.id);
        if (!proj.transperce) {
          stoppe = true;
          break;
        }
      }
    }
    if (!stoppe && sireHanoEstCiblable(zone)) {
      for (const entite of zone.sireHano.entites) {
        const sentinelle = "sireHano:" + entite.id;
        if (proj.dejaTouches.includes(sentinelle)) continue;
        const hbEntite = hitboxEntiteSireHano(entite);
        if (cercleRectangleSeChevauchent(proj.x, proj.y, proj.rayon, hbEntite.x, hbEntite.y, hbEntite.largeur, hbEntite.hauteur)) {
          infligerDegatsSireHano(zone, entite, proj.degats, proj.proprietaireId);
          proj.dejaTouches.push(sentinelle);
          if (!proj.transperce) { stoppe = true; }
          break;
        }
      }
    }
    if (!stoppe && dragonNoirEstCiblable(zone)) {
      const dragon = zone.dragonNoir;
      const sentinelle = "dragonNoir";
      if (!proj.dejaTouches.includes(sentinelle) && cercleRectangleSeChevauchent(proj.x, proj.y, proj.rayon, dragon.x, dragon.y, dragon.largeur, dragon.hauteur)) {
        infligerDegatsDragonNoir(zone, proj.degats, proj.proprietaireId);
        proj.dejaTouches.push(sentinelle);
        if (!proj.transperce) stoppe = true;
      }
    }
    if (!stoppe && chevalierNoirEstCiblable(zone)) {
      const cn = zone.chevalierNoir;
      const sentinelle = "chevalierNoir";
      if (!proj.dejaTouches.includes(sentinelle) && cercleRectangleSeChevauchent(proj.x, proj.y, proj.rayon, cn.x, cn.y, cn.largeur, cn.hauteur)) {
        infligerDegatsChevalierNoir(zone, proj.degats, proj.proprietaireId);
        proj.dejaTouches.push(sentinelle);
        if (!proj.transperce) stoppe = true;
      }
    }

    if (stoppe || proj.distanceParcourue > proj.porteeMax || proj.x < -50 || proj.x > zone.largeur + 50) {
      projectiles.splice(i, 1);
    }
  }
}

// Tir des Tiralark (uniquement présents à Vert-Hige) : cherchent un joueur
// vivant de la MÊME zone, à peu près à leur hauteur et à portée.
function simulerTirsMonstresZone(zone, dtSecondes) {
  for (const m of zone.monstres) {
    if (m.morte) continue;
    const cfgMonstre = MONSTRES_CONFIG[m.type];
    if (cfgMonstre.comportement !== "tireur") continue;

    if (m.cooldownTir > 0) {
      m.cooldownTir = Math.max(0, m.cooldownTir - dtSecondes);
      continue;
    }

    let cible = null;
    let distanceMin = Infinity;
    for (const p of players.values()) {
      if (!p.alive || p.zone !== zone.id) continue;
      const memeHauteur = Math.abs(p.y + JOUEUR_HAUTEUR / 2 - (m.y + cfgMonstre.hauteur / 2)) < 40;
      const distance = Math.abs(p.x + JOUEUR_LARGEUR / 2 - (m.x + cfgMonstre.largeur / 2));
      if (memeHauteur && distance <= cfgMonstre.tir.porteeMax && distance < distanceMin) {
        distanceMin = distance;
        cible = p;
      }
    }

    if (cible) {
      const direction = cible.x + JOUEUR_LARGEUR / 2 < m.x + cfgMonstre.largeur / 2 ? -1 : 1;
      m.facing = direction;
      zone.projectilesMonstres.push({
        id: prochainProjectileMonstreId++,
        couleur: cfgMonstre.couleur,
        x: m.x + (direction >= 0 ? cfgMonstre.largeur : 0),
        y: m.y + cfgMonstre.hauteur / 2,
        vx: cfgMonstre.tir.vitesse * direction,
        degats: cfgMonstre.tir.degats,
        rayon: cfgMonstre.tir.rayon,
        porteeMax: cfgMonstre.tir.porteeMax,
        distanceParcourue: 0,
      });
      m.cooldownTir = cfgMonstre.tir.cooldown;
      m.attaqueAnimRestant = 0.25;
    }
  }
}

// Déplacement des projectiles de monstres (Tiralark + volées de Sire-Hano)
// et collision avec les joueurs de la même zone.
function simulerProjectilesMonstresZone(zone, dtSecondes) {
  const projectilesMonstres = zone.projectilesMonstres;
  for (let i = projectilesMonstres.length - 1; i >= 0; i--) {
    const proj = projectilesMonstres[i];
    proj.x += proj.vx * dtSecondes;
    proj.distanceParcourue += Math.abs(proj.vx * dtSecondes);

    let aTouche = false;
    for (const p of players.values()) {
      if (!p.alive || p.zone !== zone.id) continue;
      if (cercleRectangleSeChevauchent(proj.x, proj.y, proj.rayon, p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR)) {
        infligerDegatsJoueur(p, proj.degats, proj.x);
        aTouche = true;
        break;
      }
    }

    const finDeCourse = proj.distanceParcourue > proj.porteeMax;
    if ((aTouche || finDeCourse) && proj.effetImpact) {
      // Effet visuel générique d'impact (voir `effetImpact` sur les
      // projectiles du Chevalier Noir) — déclenché à l'endroit du coup, ou
      // en fin de portée si le tir n'a touché personne, plutôt que de
      // disparaître silencieusement (une boule de feu doit exploser même
      // ratée).
      zone.effets.push({
        id: prochainEffetId++,
        x: proj.x,
        y: proj.y,
        rayon: proj.rayon * 2.2,
        couleur: proj.couleur,
        effet: proj.effetImpact,
        vie: 0.45,
        vieMax: 0.45,
      });
    }

    if (aTouche || finDeCourse || proj.x < -50 || proj.x > zone.largeur + 50) {
      projectilesMonstres.splice(i, 1);
    }
  }
}

// Contact direct monstre → joueur (tous comportements confondus), limité
// aux monstres et joueurs de la même zone.
function simulerContactsMonstresZone(zone, dtSecondes) {
  for (const m of zone.monstres) {
    if (m.morte) continue;
    const cfgMonstre = MONSTRES_CONFIG[m.type];
    for (const p of players.values()) {
      if (!p.alive || p.zone !== zone.id) continue;
      if (rectanglesSeChevauchent(p.x, p.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR, m.x, m.y, cfgMonstre.largeur, cfgMonstre.hauteur)) {
        if (infligerDegatsJoueur(p, cfgMonstre.degatsContact, m.x + cfgMonstre.largeur / 2)) {
          m.attaqueAnimRestant = 0.25;
        }
      }
    }
  }
}

function simulerRespawnMonstresZone(zone, dtSecondes) {
  if (zone.type === "donjon") return; // les monstres de l'Antre ne réapparaissent JAMAIS
  for (const m of zone.monstres) {
    if (m.morte) {
      m.respawnRestant -= dtSecondes;
      if (m.respawnRestant <= 0) respawnMonstre(m);
    }
  }
}

// Extinction progressive des effets visuels (explosions d'ultime, etc.).
function simulerEffetsZone(zone, dtSecondes) {
  const effets = zone.effets;
  for (let i = effets.length - 1; i >= 0; i--) {
    effets[i].vie -= dtSecondes;
    if (effets[i].vie <= 0) effets.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// IA de Sire-Hano
// ---------------------------------------------------------------------------
// Répertoire à 3 attaques identique pour chaque entité, quelle que soit la
// phase (voir GDD §5) : mêlée agressive dès que la cible est à portée,
// volée de projectiles façon ultime du Quater, et zone au sol télégraphiée
// (délai avant dégâts, façon ultime du Krix) — le joueur doit voir le
// cercle et s'écarter. Chaque entité de la phase agit indépendamment.

function simulerSireHano(dtSecondes) {
  // Chaque instance du donjon a son propre combat, totalement indépendant
  // des autres joueurs/instances.
  for (const instance of instancesDonjon.values()) {
    const boss = instance.sireHano;

    if (boss.vaincu) {
      // Petit répit affiché ("Sire-Hano vaincu !"), puis tout le monde
      // encore présent est renvoyé automatiquement à Vert-Hige et
      // l'instance est détruite (porte retour + fin de combat).
      boss.vaincuRestant -= dtSecondes;
      if (boss.vaincuRestant <= 0) {
        for (const p of players.values()) {
          if (p.zone === instance.id) sortirDonjon(p);
        }
      }
      continue;
    }

    for (const entite of boss.entites) {
      simulerUneEntiteSireHano(instance, entite, dtSecondes);
    }
  }
}

function simulerUneEntiteSireHano(instance, entite, dtSecondes) {
  appliquerRegenBoss(entite, dtSecondes);
  if (entite.invulnerableRestant > 0) entite.invulnerableRestant = Math.max(0, entite.invulnerableRestant - dtSecondes);
  if (entite.attaqueAnimRestant > 0) entite.attaqueAnimRestant = Math.max(0, entite.attaqueAnimRestant - dtSecondes);
  for (const touche of Object.keys(entite.cooldowns)) {
    if (entite.cooldowns[touche] > 0) entite.cooldowns[touche] = Math.max(0, entite.cooldowns[touche] - dtSecondes);
  }

  // Détonation d'une zone au sol télégraphiée précédemment.
  if (entite.aoeEnAttente) {
    entite.aoeEnAttente.tempsRestant -= dtSecondes;
    if (entite.aoeEnAttente.tempsRestant <= 0) {
      const zoneAoe = entite.aoeEnAttente;
      for (const p of players.values()) {
        if (!p.alive || p.zone !== instance.id) continue;
        const distance = Math.hypot(p.x + JOUEUR_LARGEUR / 2 - zoneAoe.x, p.y + JOUEUR_HAUTEUR / 2 - zoneAoe.y);
        if (distance <= zoneAoe.rayon) infligerDegatsJoueur(p, zoneAoe.degats, zoneAoe.x);
      }
      instance.effets.push({ id: prochainEffetId++, x: zoneAoe.x, y: zoneAoe.y, rayon: zoneAoe.rayon, couleur: "#e05a3a", vie: 0.3, vieMax: 0.3 });
      entite.aoeEnAttente = null;
    }
  }

  // Cible : joueur vivant le plus proche présent dans CETTE instance.
  let cible = null;
  let distanceMin = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.zone !== instance.id) continue;
    const distance = Math.abs(p.x - entite.x);
    if (distance < distanceMin) {
      distanceMin = distance;
      cible = p;
    }
  }

  if (!cible) {
    entite.vx = 0;
    return; // arène vide : cette entité patiente sans agir
  }

  const centreBoss = entite.x + entite.largeur / 2;
  const centreCible = cible.x + JOUEUR_LARGEUR / 2;
  entite.facing = centreCible < centreBoss ? -1 : 1;
  const distanceCible = Math.abs(centreCible - centreBoss);

  // Déplacement : fonce vers la cible, s'arrête une fois à portée de mêlée.
  if (distanceCible > SIRE_HANO_ATTAQUES.melee.portee * 0.6) {
    entite.vx = SIRE_HANO_VITESSE * entite.facing;
    entite.x += entite.vx * dtSecondes;
    entite.x = Math.max(0, Math.min(instance.largeur - entite.largeur, entite.x));
  } else {
    entite.vx = 0;
  }

  // Mêlée agressive dès que la cible est à portée.
  if (entite.cooldowns.melee <= 0 && distanceCible <= SIRE_HANO_ATTAQUES.melee.portee) {
    const attaque = SIRE_HANO_ATTAQUES.melee;
    const zoneX = entite.facing >= 0 ? entite.x + entite.largeur : entite.x - attaque.portee;
    if (rectanglesSeChevauchent(zoneX, entite.y, attaque.portee, entite.hauteur, cible.x, cible.y, JOUEUR_LARGEUR, JOUEUR_HAUTEUR)) {
      infligerDegatsJoueur(cible, attaque.degats, centreBoss);
    }
    entite.cooldowns.melee = attaque.cooldown;
    entite.attaqueAnimRestant = 0.25;
  }

  // Volée de projectiles (façon ultime Quater).
  if (entite.cooldowns.volee <= 0 && distanceCible <= SIRE_HANO_ATTAQUES.volee.porteeMax) {
    const attaque = SIRE_HANO_ATTAQUES.volee;
    for (let i = 0; i < attaque.nombre; i++) {
      instance.projectilesMonstres.push({
        id: prochainProjectileMonstreId++,
        couleur: "#7a3f6b",
        x: entite.x + (entite.facing >= 0 ? entite.largeur : 0),
        y: entite.y + entite.hauteur / 2 + (i - (attaque.nombre - 1) / 2) * attaque.ecartY,
        vx: attaque.vitesse * entite.facing,
        degats: attaque.degats,
        rayon: attaque.rayon,
        porteeMax: attaque.porteeMax,
        distanceParcourue: 0,
      });
    }
    entite.cooldowns.volee = attaque.cooldown;
    entite.attaqueAnimRestant = 0.25;
  }

  // Zone au sol télégraphiée sous la cible actuelle (façon ultime Krix) —
  // un court délai avant les dégâts pour laisser le temps de s'écarter.
  if (entite.cooldowns.aoe <= 0 && !entite.aoeEnAttente) {
    const attaque = SIRE_HANO_ATTAQUES.aoe;
    entite.aoeEnAttente = {
      x: centreCible,
      y: cible.y + JOUEUR_HAUTEUR / 2,
      rayon: attaque.rayon,
      degats: attaque.degats,
      tempsRestant: attaque.telegraphe,
      telegrapheMax: attaque.telegraphe,
    };
    entite.cooldowns.aoe = attaque.cooldown;
  }
}

// Fait disparaître le butin resté trop longtemps au sol sans être ramassé
// (DUREE_VIE_OBJET_AU_SOL), zone par zone — une seule passe par tick, pas
// par joueur (contrairement à ramasserObjets, appelée dans la boucle des
// joueurs).
function simulerObjetsAuSol(dtSecondes) {
  for (const zone of toutesLesZones()) {
    if (!zone.objetsAuSol || zone.objetsAuSol.length === 0) continue;
    for (const objet of zone.objetsAuSol) objet.dureeVieRestante -= dtSecondes;
    zone.objetsAuSol = zone.objetsAuSol.filter((objet) => objet.dureeVieRestante > 0);
  }
}

setInterval(() => {
  const dt = TICK_MS / 1000;
  simulerPhysique(dt);
  simulerMonstres(dt);
  simulerCombat(dt);
  simulerSireHano(dt);
  simulerDragonNoir(dt);
  simulerChevalierNoir(dt);
  simulerObjetsAuSol(dt);
  diffuserEtat();
}, TICK_MS);

// ---------------------------------------------------------------------------
// Diffusion de l'état à tous les clients
// ---------------------------------------------------------------------------

// Construit l'état à envoyer à UN joueur donné : uniquement ce qui se
// trouve dans SA zone actuelle (Vert-Hige ou son instance de donjon) — les
// autres joueurs, monstres, projectiles et le combat de boss d'une autre
// instance lui restent invisibles.
// Classement (tableau des scores) : tri unique par tick dans diffuserEtat
// (pas par joueur — le classement est le même pour tout le monde, inutile
// de le retrier pour chacun), niveau d'abord puis XP courante en départage.
// Renvoie à la fois le top 10 affiché ET une table id → rang (1-based) sur
// la liste COMPLÈTE des joueurs connectés, pour que chacun puisse voir son
// propre rang même hors du top 10 (voir monRang plus bas).
function calculerClassement() {
  const tries = Array.from(players.values()).sort((a, b) => b.niveau - a.niveau || b.xp - a.xp);
  const rangParId = new Map(tries.map((j, i) => [j.id, i + 1]));
  const top10 = tries.slice(0, 10).map((j) => ({ id: j.id, pseudo: j.pseudo, niveau: j.niveau, classe: j.classe, couleur: j.couleur, titre: j.titreActif || null }));
  return { top10, rangParId };
}

function construireEtatPourJoueur(p, classement) {
  const zone = zoneDeJoueur(p);
  const boss = zone.sireHano;
  const dragon = zone.dragonNoir;
  const chevalierNoir = zone.chevalierNoir;

  return {
    type: "state",
    world: { width: zone.largeur, height: zone.hauteur },
    platforms: zone.plateformes,
    // Tableau des scores (voir calculerClassement ci-dessus) — identique
    // pour tout le monde ; seul monRang varie (rang du destinataire, même
    // hors du top 10 affiché — un joueur classé 47e doit voir "47e", pas
    // rien du tout).
    classement: classement.top10,
    monRang: classement.rangParId.get(p.id) || null,
    // Inventaire PERSONNEL : jamais envoyé pour les autres joueurs, seulement
    // le sien. `loot` ne porte qu'un id + type — le client déclenche son
    // petit toast uniquement quand cet id change (évite les soucis
    // d'horloge serveur/client sur un timestamp d'expiration).
    inventaire: p.inventaire,
    or: p.or || 0,
    gemmes: p.gemmes || 0,
    loot: p.dernierLoot && Date.now() < p.dernierLoot.expire
      ? { id: p.dernierLoot.id, type: p.dernierLoot.type, bundle: p.dernierLoot.bundle || null, legendaire: !!p.dernierLoot.legendaire }
      : null,
    // Toast "NIVEAU X !" (même mécanique que loot ci-dessus) — voir gainerXp.
    monteeDeNiveau: p.derniereMonteeDeNiveau && Date.now() < p.derniereMonteeDeNiveau.expire
      ? { niveau: p.derniereMonteeDeNiveau.niveau }
      : null,
    // Toast "HAUT FAIT DÉBLOQUÉ" (même mécanique que loot/montée de niveau)
    // — voir verifierHautsFaits.
    hautFait: p.dernierHautFait && Date.now() < p.dernierHautFait.expire
      ? { nom: p.dernierHautFait.nom, titre: p.dernierHautFait.titre }
      : null,
    // Toast "Connexion quotidienne" (même mécanique) — voir
    // verifierRecompenseConnexion. serieConnexion, lui, n'est PAS un toast
    // : c'est un compteur permanent affiché en petit dans le HUD (voir
    // côté client), donc toujours envoyé, pas seulement à la connexion.
    recompenseConnexion: p.dernierRecompenseConnexion && Date.now() < p.dernierRecompenseConnexion.expire
      ? { serie: p.dernierRecompenseConnexion.serie, jourCycle: p.dernierRecompenseConnexion.jourCycle, or: p.dernierRecompenseConnexion.or, xp: p.dernierRecompenseConnexion.xp }
      : null,
    serieConnexion: (p.connexionQuotidienne && p.connexionQuotidienne.serie) || 0,
    // Liste complète des hauts faits (débloqués ou non) avec la progression
    // actuelle du joueur sur chacun — le panneau dédié affiche tout, y
    // compris les hauts faits pas encore débloqués (grisés, avec barre de
    // progression), pour donner un objectif à viser.
    hautsFaits: HAUTS_FAITS.map((hf) => ({
      id: hf.id,
      nom: hf.nom,
      titre: hf.titre,
      description: hf.description,
      cible: hf.cible,
      progression: Math.min(hf.cible, valeurStatHautFait(p, hf.stat)),
      debloque: (p.hautsFaitsDebloques || []).includes(hf.id),
    })),
    // Quêtes journalières (voir assurerQuetesDuJour) — uniquement pertinent
    // pour soi-même, mais envoyé pour tout le monde par simplicité comme le
    // reste de `perso` juste en dessous.
    quetes: p.quetes ? p.quetes.liste : [],
    // Zone actuelle (nom/blurb affichés en HUD) + réseau de téléporteurs
    // (toujours la même liste statique, voir DESTINATIONS_TELEPORTEUR) +
    // PNJ de la zone (uniquement peuplé au village pour l'instant, voir
    // genererZoneVillage) + lianes à grimper (voir simulerPhysique).
    zoneActuelle: { id: zone.id, nom: zone.nom || "Vert-Hige", type: zone.type },
    destinations: DESTINATIONS_TELEPORTEUR,
    pnjs: (zone.pnjs || []).map((n) => ({ id: n.id, nom: n.nom, type: n.type, x: n.x, y: n.y, dialogue: n.dialogue, boutique: n.boutique || null })),
    lianes: zone.lianes || [],
    // Fiche de personnage : niveau/XP/équipement + statistiques dérivées
    // déjà calculées côté serveur (le client n'a qu'à les afficher). Envoyé
    // pour tout le monde par simplicité, mais seul le client concerné (soi)
    // l'utilise réellement — voir mettreAJourFichePersonnage.
    perso: {
      niveau: p.niveau,
      xp: Math.floor(p.xp),
      xpRequis: xpRequisPourNiveau(p.niveau),
      equipement: p.equipement,
      attributs: statsEquipement(p),
      multiplicateurDegats: multiplicateurDegats(p),
      vitesse: Math.round(vitesseEffective(p)),
      reductionCooldownPct: reductionCooldown(p),
      pointsDisponibles: p.pointsDisponibles || 0,
      statsAlouees: p.statsAlouees,
      titreActif: p.titreActif || null,
    },
    players: Array.from(players.values())
      .filter((autre) => autre.zone === p.zone)
      .map((autre) => ({
        id: autre.id,
        pseudo: autre.pseudo,
        classe: autre.classe,
        couleur: autre.couleur,
        niveau: autre.niveau,
        titre: autre.titreActif || null,
        apparence: autre.apparence,
        x: autre.x,
        y: autre.y,
        facing: autre.facing,
        onGround: autre.onGround,
        accroupi: !!autre.accroupi,
        hp: Math.round(autre.hp),
        hpMax: autre.hpMax,
        mana: Math.round(autre.mana),
        manaMax: autre.manaMax,
        alive: autre.alive,
        invulnerable: autre.invulnerableRestant > 0,
        cooldowns: autre.cooldowns,
        enMouvement: Math.abs(autre.vx) > 1,
        attaque: autre.attaqueAnimRestant > 0,
      })),
    monsters: zone.monstres.map((m) => {
      const cfg = MONSTRES_CONFIG[m.type];
      return {
        id: m.id,
        type: m.type,
        label: cfg.label,
        couleur: cfg.couleur,
        base: cfg.base || m.type, // sprite à réutiliser côté client (troubalourd/fisselo/tiralark)
        teinte: cfg.teinte || null, // filtre CSS de distinction visuelle pour les monstres de région
        largeur: cfg.largeur,
        hauteur: cfg.hauteur,
        x: m.x,
        y: m.y,
        facing: cfg.comportement === "tireur" ? m.facing : m.vx >= 0 ? 1 : -1,
        hp: m.hp,
        hpMax: m.hpMax,
        morte: m.morte,
        enMouvement: Math.abs(m.vx) > 1,
        attaque: m.attaqueAnimRestant > 0,
      };
    }),
    projectilesMonstres: zone.projectilesMonstres.map((proj) => ({
      id: proj.id,
      couleur: proj.couleur,
      effet: proj.effet || null,
      x: proj.x,
      y: proj.y,
      rayon: proj.rayon,
    })),
    effets: zone.effets.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      rayon: e.rayon,
      couleur: e.couleur,
      effet: e.effet || "impact",
      opacite: Math.max(0, e.vie / e.vieMax),
    })),
    projectiles: zone.projectiles.map((proj) => ({
      id: proj.id,
      couleur: proj.couleur,
      effet: proj.effet || "orbe",
      x: proj.x,
      y: proj.y,
      vx: proj.vx,
      rayon: proj.rayon,
    })),
    // Butin posé au sol dans la zone actuelle du joueur (voir
    // ramasserObjets/essayerDropArme) : juste de quoi le dessiner et
    // afficher son nom au survol côté client, pas de logique de ramassage
    // côté client (tout est validé serveur, sur `input.f`).
    objetsAuSol: (zone.objetsAuSol || []).map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y })),
    donjon: {
      porteX: PORTE_DONJON_X,
      fragments: donjon.fragments,
      fragmentsRequis: donjon.fragmentsRequis,
      ouvert: donjon.ouvert,
      dernierPassageTs: donjon.dernierPassageTs,
      dansDonjon: zone.type === "donjon",
    },
    // Salle du Trône (Crêtes d'Ambre) : même porte visuellement que l'Antre
    // du Sire-Hano (voir dessinerSalleTroneAmbre côté client) mais entrée
    // payante — pas de fragments, juste `prix` comparé à `or` ci-dessus.
    // `porteX` n'a de sens que quand `zoneActuelle.id === "cretes-ambre"`.
    salleTroneAmbre: {
      porteX: PORTE_TRONE_AMBRE_X,
      prix: PRIX_ENTREE_TRONE_AMBRE,
      dansSalle: zone.type === "salle-trone",
      trone: zoneTroneAmbre.trone,
    },
    boss: boss
      ? {
          invoque: boss.invoque,
          mobsRequis: TYPES_MOBS_DONJON.length,
          mobsTues: boss.typesTues.size,
          actif: boss.invoque && !boss.vaincu,
          vaincu: boss.vaincu,
          vaincuRestant: boss.vaincu ? Math.max(0, Math.round(boss.vaincuRestant)) : 0,
          nom: PHASES_SIRE_HANO[boss.phaseIndex].nom,
          phaseIndex: boss.phaseIndex,
          phasesTotal: PHASES_SIRE_HANO.length,
          entites: boss.entites.map((e) => ({
            id: e.id,
            x: e.x,
            y: e.y,
            largeur: e.largeur,
            hauteur: e.hauteur,
            facing: e.facing,
            hp: e.hp,
            hpMax: e.hpMax,
            invulnerable: e.invulnerableRestant > 0,
            enMouvement: Math.abs(e.vx) > 1,
            attaque: e.attaqueAnimRestant > 0,
            aoeEnAttente: e.aoeEnAttente
              ? {
                  x: e.aoeEnAttente.x,
                  y: e.aoeEnAttente.y,
                  rayon: e.aoeEnAttente.rayon,
                  progression: 1 - e.aoeEnAttente.tempsRestant / e.aoeEnAttente.telegrapheMax,
                }
              : null,
          })),
        }
      : null, // pas de boss à Vert-Hige
    // Dragon Noir : boss du monde de Couronne d'Orage (voir simulerDragonNoir
    // plus haut) — même forme que `boss` ci-dessus pour réutiliser le même
    // rendu de barre de vie/jauge de télégraphe côté client, mais une seule
    // entité (pas de tableau `entites`) et un `respawnRestant` puisqu'il n'y
    // a pas de porte à re-franchir pour retenter le combat.
    dragon: dragon
      ? {
          phase: dragon.phase,
          formeHumaine: !!dragon.formeHumaine,
          vaincu: dragon.vaincu,
          vaincuRestant: dragon.vaincu ? Math.max(0, Math.round(dragon.vaincuRestant)) : 0,
          respawnRestant: Math.max(0, Math.round(dragon.respawnRestant)),
          x: dragon.x,
          y: dragon.y,
          largeur: dragon.largeur,
          hauteur: dragon.hauteur,
          facing: dragon.facing,
          hp: dragon.hp,
          hpMax: dragon.hpMax,
          invulnerable: dragon.invulnerableRestant > 0,
          enMouvement: Math.abs(dragon.vx) > 1,
          attaque: dragon.attaqueAnimRestant > 0,
          aoeEnAttente: dragon.aoeEnAttente
            ? {
                x: dragon.aoeEnAttente.x,
                y: dragon.aoeEnAttente.y,
                rayon: dragon.aoeEnAttente.rayon,
                progression: 1 - dragon.aoeEnAttente.tempsRestant / dragon.aoeEnAttente.telegrapheMax,
              }
            : null,
        }
      : null, // pas de Dragon Noir en dehors de Couronne d'Orage
    // Chevalier Noir : boss de la Salle du Trône (voir simulerChevalierNoir
    // plus haut) — même forme que `dragon` ci-dessus (une seule phase, pas de
    // formeHumaine), avec un `aoeEnAttente.colonne` en plus pour que le
    // client sache dessiner une bande verticale grandissante plutôt qu'un
    // cercle télégraphié.
    chevalierNoir: chevalierNoir
      ? {
          vaincu: chevalierNoir.vaincu,
          vaincuRestant: chevalierNoir.vaincu ? Math.max(0, Math.round(chevalierNoir.vaincuRestant)) : 0,
          respawnRestant: Math.max(0, Math.round(chevalierNoir.respawnRestant)),
          x: chevalierNoir.x,
          y: chevalierNoir.y,
          largeur: chevalierNoir.largeur,
          hauteur: chevalierNoir.hauteur,
          facing: chevalierNoir.facing,
          hp: chevalierNoir.hp,
          hpMax: chevalierNoir.hpMax,
          invulnerable: chevalierNoir.invulnerableRestant > 0,
          enMouvement: Math.abs(chevalierNoir.vx) > 1,
          attaque: chevalierNoir.attaqueAnimRestant > 0,
          attaqueType: chevalierNoir.attaqueType || null,
          touche: chevalierNoir.toucheRestant > 0,
          aoeEnAttente: chevalierNoir.aoeEnAttente
            ? {
                x: chevalierNoir.aoeEnAttente.x,
                demiLargeur: chevalierNoir.aoeEnAttente.demiLargeur,
                colonne: !!chevalierNoir.aoeEnAttente.colonne,
                progression: 1 - chevalierNoir.aoeEnAttente.tempsRestant / chevalierNoir.aoeEnAttente.telegrapheMax,
              }
            : null,
        }
      : null, // pas de Chevalier Noir en dehors de la Salle du Trône
  };
}

function diffuserEtat() {
  const classement = calculerClassement(); // un seul tri pour tout le monde, voir plus haut
  for (const [id, p] of players) {
    const ws = clients.get(id);
    if (!ws || ws.readyState !== ws.OPEN) continue;
    ws.send(JSON.stringify(construireEtatPourJoueur(p, classement)));
  }
}

// Diffusion immédiate d'un message ponctuel (chat, emote) à tout le monde,
// sans attendre le prochain tick de la boucle physique — ça reste léger
// (quelques octets), donc pas besoin de le faire transiter par diffuserEtat().
function diffuserATous(objet) {
  const payload = JSON.stringify(objet);
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// ---------------------------------------------------------------------------
// Connexions WebSocket
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Persistance légère (fichier JSON, pas de base de données — inutile pour
// ce prototype et évite une dépendance externe à installer). Le client
// envoie un jeton aléatoire généré une seule fois et gardé dans son
// localStorage (voir jetonJoueur côté client) ; on s'en sert de clé pour
// retrouver la MÊME progression d'une connexion à l'autre, y compris après
// une coupure réseau ou un redémarrage serveur — seule la position/l'état
// de combat en cours repart à neuf, comme un vrai "logout".
// ---------------------------------------------------------------------------
const CHEMIN_COMPTES = path.join(__dirname, "data", "comptes.json");
let comptes = {};

// Un compte (jeton) peut désormais posséder PLUSIEURS personnages (voir
// "Sélection de personnage" plus bas) — chacun avec sa propre progression,
// dans `comptes[jeton].personnages` (tableau, un id par personnage). Les
// sauvegardes antérieures à cette fonctionnalité stockaient directement la
// progression du personnage unique à la racine de `comptes[jeton]` : migrées
// ici à la volée en un compte à un seul personnage, pour ne perdre la
// progression de personne au premier démarrage avec ce nouveau format.
function migrerComptesVersMultiPersonnages() {
  for (const jeton of Object.keys(comptes)) {
    const compte = comptes[jeton];
    if (compte && !Array.isArray(compte.personnages)) {
      comptes[jeton] = { personnages: [{ id: "p1", ...compte }] };
    }
  }
}

function chargerComptes() {
  try {
    comptes = JSON.parse(fs.readFileSync(CHEMIN_COMPTES, "utf8"));
  } catch {
    comptes = {}; // premier lancement, fichier absent ou corrompu : on repart d'un stockage vide
  }
  migrerComptesVersMultiPersonnages();
}
chargerComptes();

const MAX_PERSONNAGES_PAR_COMPTE = 3;

// Résumé public d'un personnage (utilisé par l'écran de sélection, jamais la
// progression complète) — voir la route GET /api/personnages plus bas.
function resumePersonnage(p) {
  return { id: p.id, pseudo: p.pseudo, classe: p.classe, niveau: p.niveau || 1 };
}

let sauvegardeEnAttente = false;
function sauvegarderComptes() {
  // Débounce simple : plusieurs appels rapprochés (plusieurs joueurs qui
  // montent de niveau à la même seconde, par exemple) ne déclenchent qu'une
  // seule écriture disque à la fin de la boucle d'événements courante.
  if (sauvegardeEnAttente) return;
  sauvegardeEnAttente = true;
  setImmediate(() => {
    sauvegardeEnAttente = false;
    try {
      fs.mkdirSync(path.dirname(CHEMIN_COMPTES), { recursive: true });
      fs.writeFileSync(CHEMIN_COMPTES, JSON.stringify(comptes));
    } catch (err) {
      console.error("Échec de sauvegarde des comptes :", err.message);
    }
  });
}

// Ce qui est sauvegardé/restauré : la progression seulement (niveau, XP,
// or, équipement/inventaire, points de caractéristiques, pseudo, classe).
// Tout le reste (position, PV/Mana courants, zone, cooldowns...) repart à
// neuf à chaque connexion, exactement comme aujourd'hui sans persistance.
function extraireProgression(p) {
  return {
    pseudo: p.pseudo,
    classe: p.classe,
    niveau: p.niveau,
    xp: p.xp,
    or: p.or,
    gemmes: p.gemmes,
    inventaire: p.inventaire,
    equipement: p.equipement,
    pointsDisponibles: p.pointsDisponibles,
    statsAlouees: p.statsAlouees,
    quetes: p.quetes,
    statsVie: p.statsVie,
    hautsFaitsDebloques: p.hautsFaitsDebloques,
    titreActif: p.titreActif,
    connexionQuotidienne: p.connexionQuotidienne,
    apparence: p.apparence,
  };
}

// Écrit la progression de `joueur` dans le slot `joueur._personnageId` du
// compte `jeton` (ajouté au tableau s'il n'existait pas encore — cas d'un
// personnage tout juste créé) — remplace l'ancien `comptes[jeton] =
// extraireProgression(joueur)`, qui écrasait tout le compte au lieu d'un
// seul personnage.
function sauvegarderPersonnage(jeton, joueur) {
  if (!jeton || !joueur._personnageId) return;
  if (!comptes[jeton] || !Array.isArray(comptes[jeton].personnages)) comptes[jeton] = { personnages: [] };
  const liste = comptes[jeton].personnages;
  const progression = { id: joueur._personnageId, ...extraireProgression(joueur) };
  const index = liste.findIndex((p) => p.id === joueur._personnageId);
  if (index >= 0) liste[index] = progression; else liste.push(progression);
}

function appliquerProgression(p, sauvegarde) {
  if (!sauvegarde) return;
  if (sauvegarde.pseudo) p.pseudo = String(sauvegarde.pseudo).slice(0, 20);
  if (sauvegarde.classe && CLASSES[sauvegarde.classe]) {
    p.classe = sauvegarde.classe;
    p.couleur = CLASSES[p.classe].couleur;
  }
  p.niveau = sauvegarde.niveau || 1;
  p.xp = sauvegarde.xp || 0;
  p.or = sauvegarde.or || 0;
  p.gemmes = sauvegarde.gemmes || 0;
  if (sauvegarde.inventaire) Object.assign(p.inventaire, sauvegarde.inventaire);
  if (sauvegarde.equipement) Object.assign(p.equipement, sauvegarde.equipement);
  p.pointsDisponibles = sauvegarde.pointsDisponibles || 0;
  if (sauvegarde.statsAlouees) Object.assign(p.statsAlouees, sauvegarde.statsAlouees);
  // Quêtes : restaurées telles quelles — assurerQuetesDuJour (appelée juste
  // après, à la connexion) se chargera de les régénérer si la date a changé
  // depuis la dernière session.
  if (sauvegarde.quetes && sauvegarde.quetes.date && Array.isArray(sauvegarde.quetes.liste)) {
    p.quetes = sauvegarde.quetes;
  }
  // Hauts faits (voir HAUTS_FAITS/verifierHautsFaits) — absent des
  // sauvegardes antérieures à cette fonctionnalité, d'où les valeurs par
  // défaut (déjà posées par creerJoueur) conservées via Object.assign
  // plutôt qu'un remplacement complet.
  if (sauvegarde.statsVie) Object.assign(p.statsVie, sauvegarde.statsVie);
  if (Array.isArray(sauvegarde.hautsFaitsDebloques)) p.hautsFaitsDebloques = sauvegarde.hautsFaitsDebloques;
  if (sauvegarde.titreActif) p.titreActif = String(sauvegarde.titreActif).slice(0, 40);
  // Apparence — absente des sauvegardes antérieures à cette fonctionnalité,
  // d'où les valeurs par défaut déjà posées par creerJoueur conservées
  // champ par champ (jamais de remplacement en bloc) si la sauvegarde ne
  // contient rien, ou contient une valeur hors palette (même garde-fou que
  // le message "personnaliser").
  if (sauvegarde.apparence) {
    if (PALETTE_CHEVEUX.includes(sauvegarde.apparence.couleurCheveux)) p.apparence.couleurCheveux = sauvegarde.apparence.couleurCheveux;
    if (PALETTE_YEUX.includes(sauvegarde.apparence.couleurYeux)) p.apparence.couleurYeux = sauvegarde.apparence.couleurYeux;
    if (PALETTE_VETEMENTS.includes(sauvegarde.apparence.couleurVetements)) p.apparence.couleurVetements = sauvegarde.apparence.couleurVetements;
  }
  // Série de connexion quotidienne — restaurée telle quelle ;
  // verifierRecompenseConnexion (appelée juste après, à la connexion)
  // décide si CETTE connexion déclenche une nouvelle récompense ou non.
  if (sauvegarde.connexionQuotidienne && typeof sauvegarde.connexionQuotidienne.serie === "number") {
    Object.assign(p.connexionQuotidienne, sauvegarde.connexionQuotidienne);
  }
  recalculerStatsEquipement(p); // recalcule hpMax/manaMax à partir de la progression restaurée
  p.hp = p.hpMax;
  p.mana = p.manaMax;
}

const joueursParJeton = new Map(); // jeton → joueur, pour la sauvegarde périodique ci-dessous

// Sauvegarde de tout le monde à intervalle régulier, en plus de la
// sauvegarde immédiate à la déconnexion (voir ws.on("close") plus bas) —
// couvre le cas d'un serveur qui redémarre/plante pendant qu'on joue.
setInterval(() => {
  for (const [jeton, joueur] of joueursParJeton) {
    assurerQuetesDuJour(joueur); // régénère les quêtes du jour si minuit est passé pendant la session
    sauvegarderPersonnage(jeton, joueur);
  }
  if (joueursParJeton.size > 0) sauvegarderComptes();
}, 30000);

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  const joueur = creerJoueur();
  // Point de spawn : sur le sol, position X aléatoire raisonnable.
  joueur.x = 60 + Math.random() * 300;
  joueur.y = 600 - JOUEUR_HAUTEUR;
  joueur.invulnerableRestant = 1.0; // petit répit à la connexion

  // Jeton de progression persistante (voir la section "Persistance"
  // ci-dessus) — envoyé par le client en query string, avec soit
  // `personnageId` (reprendre un personnage existant de ce compte, voir
  // l'écran de sélection côté client) soit `nouveauPersonnage=1` (+`classe`,
  // pour en créer un). Sans jeton valable, ou sans correspondance/demande de
  // création valide, le joueur reste temporaire comme avant, simplement non
  // sauvegardé — voir le `jeton = null` de la branche `else` plus bas.
  let jeton = null;
  let personnageId = null;
  let nouveauPersonnage = false;
  let classeChoisie = null;
  try {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    jeton = params.get("jeton");
    personnageId = params.get("personnageId");
    nouveauPersonnage = params.get("nouveauPersonnage") === "1";
    classeChoisie = params.get("classe");
  } catch {
    jeton = null;
  }
  if (jeton) {
    // Un même jeton ne doit jamais piloter deux personnages en même temps
    // (double onglet, reconnexion rapide avant que l'ancien socket ne se
    // soit fermé...) : sans ce garde-fou, les deux sessions restent
    // jouables en parallèle (progression dupliquée) et celle qui se ferme
    // en premier écrase la sauvegarde de l'autre avec des données
    // obsolètes en la retirant de joueursParJeton — l'autosave périodique
    // ne la retrouve alors plus. On coupe donc l'éventuelle ancienne
    // session avant de continuer : le nouvel onglet "gagne".
    const ancienJoueur = joueursParJeton.get(jeton);
    if (ancienJoueur) {
      // Empêche le handler "close" de l'ancien socket (déclenché de façon
      // asynchrone par le .close() ci-dessous) d'écraser plus tard la
      // sauvegarde avec cette progression déjà obsolète — on vient de la
      // sauvegarder nous-mêmes ci-dessous, et la nouvelle session va
      // continuer à faire évoluer ce personnage à partir de maintenant.
      ancienJoueur._sessionRemplacee = true;
      const ancienWs = clients.get(ancienJoueur.id);
      if (ancienWs && ancienWs.readyState === ancienWs.OPEN) {
        try {
          ancienWs.send(JSON.stringify({ type: "sessionRemplacee" }));
        } catch {}
        ancienWs.close();
      }
      const ancienneInstance = instancesDonjon.get(ancienJoueur.zone);
      if (ancienneInstance) {
        ancienneInstance.joueurs.delete(ancienJoueur.id);
        if (ancienneInstance.joueurs.size === 0) instancesDonjon.delete(ancienneInstance.id);
      }
      sauvegarderPersonnage(jeton, ancienJoueur);
      sauvegarderComptes();
      players.delete(ancienJoueur.id);
      clients.delete(ancienJoueur.id);
      joueursParJeton.delete(jeton);
    }

    const personnages = (comptes[jeton] && comptes[jeton].personnages) || [];
    const existant = personnageId ? personnages.find((pers) => pers.id === personnageId) : null;

    if (existant) {
      // Personnage existant : uniquement sa progression sauvegardée, jamais
      // de classe reçue du client ici — demande explicite : plus question de
      // changer de classe en se reconnectant (l'écran de sélection ne permet
      // que de choisir QUEL personnage rejouer, chacun garde sa classe).
      appliquerProgression(joueur, existant);
      joueur._personnageId = existant.id;
    } else if (nouveauPersonnage && personnages.length < MAX_PERSONNAGES_PAR_COMPTE) {
      // Tout nouveau personnage pour ce compte (classe obligatoire, imposée
      // côté client par validerFormulaireAccueil).
      joueur._personnageId = `perso${Date.now()}${Math.floor(Math.random() * 1000)}`;
      if (classeChoisie && CLASSES[classeChoisie]) {
        joueur.classe = classeChoisie;
        joueur.couleur = CLASSES[classeChoisie].couleur;
      }
      joueur.pseudo = `${CLASSES[joueur.classe].label} ${joueur.id}`;
      recalculerStatsEquipement(joueur);
      joueur.hp = joueur.hpMax;
      joueur.mana = joueur.manaMax;
      sauvegarderPersonnage(jeton, joueur); // visible immédiatement dans GET /api/personnages
      sauvegarderComptes();
    } else {
      // `personnageId` introuvable et aucune création valide demandée (ou
      // compte déjà au maximum de personnages) : jeton ignoré plutôt que de
      // planter la connexion — le joueur reste temporaire, non sauvegardé.
      jeton = null;
    }
  }
  if (jeton) {
    // Récompense de connexion quotidienne : seulement pour un personnage
    // identifié par un jeton persistant — un joueur sans jeton n'est jamais
    // le "même" joueur d'une connexion à l'autre (rien ne le relie),
    // donc rien à faire ici sous peine de distribuer la récompense en
    // boucle à chaque rechargement de page.
    verifierRecompenseConnexion(joueur);
    joueursParJeton.set(jeton, joueur);
  }
  assurerQuetesDuJour(joueur); // tire les 3 quêtes du jour (ou reprend celles déjà sauvegardées si toujours valables)

  players.set(joueur.id, joueur);
  clients.set(joueur.id, ws);

  // `personnageId` (null pour un joueur temporaire, sans jeton valable) :
  // le client s'en sert pour reconnecter automatiquement (perte réseau...)
  // sur CE personnage plutôt que de renvoyer un `nouveauPersonnage=1` qui en
  // recréerait un autre à chaque coupure — voir connecter() côté client.
  ws.send(JSON.stringify({ type: "welcome", selfId: joueur.id, classes: CLASSES, personnageId: joueur._personnageId || null }));

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === "input") {
      joueur.input.left = !!message.left;
      joueur.input.right = !!message.right;
      joueur.input.jump = !!message.jump;
      joueur.input.bas = !!message.bas; // flèche du bas : accroupissement
      joueur.input.a = !!message.a;
      joueur.input.z = !!message.z;
      joueur.input.e = !!message.e;
      joueur.input.r = !!message.r;
      joueur.input.f = !!message.f; // ramasser le butin au sol à proximité
    } else if (message.type === "rename") {
      const nom = String(message.name || "").trim().slice(0, 20);
      if (nom) joueur.pseudo = nom;
    } else if (message.type === "personnaliser") {
      // Écran de création (et réglages en jeu) : chaque champ n'est
      // appliqué QUE s'il correspond exactement à une valeur des palettes
      // fermées ci-dessus — voir le commentaire sur PALETTE_CHEVEUX.
      if (PALETTE_CHEVEUX.includes(message.couleurCheveux)) joueur.apparence.couleurCheveux = message.couleurCheveux;
      if (PALETTE_YEUX.includes(message.couleurYeux)) joueur.apparence.couleurYeux = message.couleurYeux;
      if (PALETTE_VETEMENTS.includes(message.couleurVetements)) joueur.apparence.couleurVetements = message.couleurVetements;
    } else if (message.type === "chat") {
      const texte = String(message.texte || "").trim().slice(0, 80);
      if (texte) {
        diffuserATous({ type: "chat", id: joueur.id, texte });
      }
    } else if (message.type === "quitterDonjon") {
      // Icône de porte du HUD (à tout moment) OU bouton rouge "Quitter le
      // donjon" de l'écran de défaite (joueur mort) — dans les deux cas on
      // ne quitte que si on est bien dans une instance du donjon.
      if (zoneDeJoueur(joueur).type === "donjon") sortirDonjon(joueur);
    } else if (message.type === "reessayerDonjon") {
      // Bouton vert "Réessayer" de l'écran de défaite : uniquement valable
      // pour un joueur mort, dans le donjon.
      if (!joueur.alive && zoneDeJoueur(joueur).type === "donjon") reessayerDonjon(joueur);
    } else if (message.type === "quitterSalleTroneAmbre") {
      // Icône de porte du HUD, depuis la Salle du Trône de Crêtes d'Ambre.
      if (zoneDeJoueur(joueur).type === "salle-trone") sortirSalleTroneAmbre(joueur);
    } else if (message.type === "equiper") {
      // Fiche de personnage : équiper/retirer un objet dans l'une des 7
      // catégories d'équipement (arme, armure, casque, jambières, anneau,
      // bottes, bracelet — voir STATS_PAR_CATEGORIE). `item` est une clé
      // valide pour cette catégorie (ou null pour retirer) — on vérifie
      // qu'elle correspond bien et que le joueur la possède réellement
      // avant d'appliquer.
      const categorie = Object.prototype.hasOwnProperty.call(STATS_PAR_CATEGORIE, message.categorie) ? message.categorie : null;
      if (categorie) {
        const item = message.item ? String(message.item) : null;
        const clesValides = Object.keys(STATS_PAR_CATEGORIE[categorie]);
        if (item === null || (clesValides.includes(item) && (joueur.inventaire[item] || 0) > 0)) {
          joueur.equipement[categorie] = item;
          recalculerStatsEquipement(joueur);
          verifierHautsFaits(joueur); // haut fait "Éclat Légendaire" si l'objet équipé est légendaire
        }
      }
    } else if (message.type === "definirTitre") {
      // Panneau des hauts faits : choisir, parmi les titres déjà débloqués,
      // celui affiché sous le pseudo (dans le monde, au tableau des joueurs
      // et dans le chat) — ou aucun (null) pour ne rien afficher.
      const titre = message.titre ? String(message.titre).slice(0, 40) : null;
      const debloques = joueur.hautsFaitsDebloques || [];
      const titresDebloques = HAUTS_FAITS.filter((hf) => debloques.includes(hf.id)).map((hf) => hf.titre);
      if (titre === null || titresDebloques.includes(titre)) {
        joueur.titreActif = titre;
      }
    } else if (message.type === "assignerPoint") {
      // Fiche de personnage : dépense d'un point de caractéristique
      // disponible (+5 par niveau, voir gainerXp) sur l'un des 4
      // attributs classiques. Ignoré silencieusement si l'attribut est
      // invalide ou s'il ne reste aucun point à dépenser.
      const attribut = ["force", "agilite", "intelligence", "vitalite"].includes(message.attribut) ? message.attribut : null;
      if (attribut && (joueur.pointsDisponibles || 0) > 0) {
        joueur.pointsDisponibles -= 1;
        joueur.statsAlouees[attribut] = (joueur.statsAlouees[attribut] || 0) + 1;
        recalculerStatsEquipement(joueur);
      }
    } else if (message.type === "teleporter") {
      // Onglet téléporteur (haut droit de l'écran) : voyage instantané vers
      // n'importe quelle destination de DESTINATIONS_TELEPORTEUR, depuis
      // n'importe où SAUF l'Antre du Sire-Hano (pas d'évasion en pleine
      // instance de boss par ce biais — il faut sortir par l'icône de porte
      // dédiée, qui remet aussi la clé à zéro).
      const destination = String(message.destination || "");
      const estValide = destination === ZONE_VERTHIGE || ZONES_PERSISTANTES.has(destination);
      const zoneCourante = zoneDeJoueur(joueur).type;
      const infosDestination = DESTINATIONS_TELEPORTEUR.find((d) => d.id === destination);
      const niveauSuffisant = !infosDestination || (joueur.niveau || 1) >= infosDestination.niveauRequis;
      if (estValide && zoneCourante !== "donjon" && zoneCourante !== "salle-trone" && joueur.alive && niveauSuffisant) {
        teleporterVers(joueur, destination);
      }
    } else if (message.type === "acheter") {
      // Boutique du vendeur du village (voir genererZoneVillage) : validé
      // entièrement côté serveur — le client ne fait qu'afficher l'offre.
      const zone = zoneDeJoueur(joueur);
      if (zone.type === "village" && zone.pnjs) {
        const vendeur = zone.pnjs.find((n) => n.type === "vendeur");
        const offre = vendeur && vendeur.boutique.find((o) => o.item === message.item);
        if (offre && (joueur.or || 0) >= offre.prix) {
          joueur.or -= offre.prix;
          joueur.inventaire[offre.item] = (joueur.inventaire[offre.item] || 0) + 1;
        }
      }
    } else if (message.type === "acheter_gemme") {
      // Boutique à gemmes : accessible partout, pas besoin d'un PNJ — voir
      // BOUTIQUE_GEMMES. Même principe de validation entièrement serveur.
      // La monnaie ("gemmes" par défaut, "or" pour potionNiveau) et l'effet
      // (ajout à l'inventaire, ou niveaux directement) dépendent de l'offre.
      const offre = BOUTIQUE_GEMMES.find((o) => o.item === message.item);
      if (offre) {
        const monnaie = offre.monnaie === "or" ? "or" : "gemmes";
        if ((joueur[monnaie] || 0) >= offre.prix) {
          joueur[monnaie] -= offre.prix;
          if (offre.niveaux) {
            ajouterNiveaux(joueur, offre.niveaux);
          } else {
            joueur.inventaire[offre.item] = (joueur.inventaire[offre.item] || 0) + 1;
          }
        }
      }
    } else if (message.type === "quete_reclamer") {
      // Panneau de quêtes journalières : réclame la récompense d'une quête
      // terminée (progression >= cible) et pas déjà réclamée. Entièrement
      // validé côté serveur — le client n'affiche que ce qui lui est envoyé.
      assurerQuetesDuJour(joueur);
      const id = String(message.id || "");
      const quete = joueur.quetes && joueur.quetes.liste.find((q) => q.id === id);
      if (quete && !quete.reclamee && quete.progression >= quete.cible) {
        quete.reclamee = true;
        joueur.or = (joueur.or || 0) + quete.or;
        if (quete.xp > 0) gainerXp(joueur, quete.xp);
        joueur.statsVie.questesReclamees++;
        verifierHautsFaits(joueur);
      }
    }
  });

  ws.on("close", () => {
    const instance = instancesDonjon.get(joueur.zone);
    if (instance) {
      instance.joueurs.delete(joueur.id);
      if (instance.joueurs.size === 0) instancesDonjon.delete(instance.id);
    }
    if (jeton && !joueur._sessionRemplacee) {
      // Sauvegarde immédiate à la déconnexion (en plus de la sauvegarde
      // périodique) : pas besoin d'attendre jusqu'à 30s pour que la
      // progression de fin de session soit bien sur disque.
      // (Si _sessionRemplacee est vrai, une session plus récente pour ce
      // même jeton a déjà pris le relais — voir plus haut — et cette
      // sauvegarde ici écraserait sa progression avec des données
      // obsolètes : on ne touche alors ni comptes[jeton] ni
      // joueursParJeton, déjà gérés par la nouvelle session.)
      sauvegarderPersonnage(jeton, joueur);
      sauvegarderComptes();
      joueursParJeton.delete(jeton);
    }
    players.delete(joueur.id);
    clients.delete(joueur.id);
  });
});

// ---------------------------------------------------------------------------
// Serveur HTTP statique pour le client
// ---------------------------------------------------------------------------

const TYPES_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  // Écran de sélection de personnage (voir client, préparerEcranAccueil) :
  // liste des personnages d'un compte AVANT d'ouvrir le WebSocket de jeu,
  // pour savoir quel écran d'accueil afficher (sélection vs création). Pas
  // besoin d'un vrai routeur pour cette unique route.
  if (req.method === "GET" && req.url.startsWith("/api/personnages")) {
    const jeton = new URL(req.url, `http://${req.headers.host}`).searchParams.get("jeton");
    const personnages = (jeton && comptes[jeton] && comptes[jeton].personnages) || [];
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ personnages: personnages.map(resumePersonnage), max: MAX_PERSONNAGES_PAR_COMPTE }));
    return;
  }

  let chemin = req.url === "/" ? "/index.html" : req.url;
  chemin = path.join(CLIENT_DIR, path.normalize(chemin).replace(/^(\.\.[/\\])+/, ""));

  fs.readFile(chemin, (err, contenu) => {
    if (err) {
      res.writeHead(404);
      res.end("Fichier non trouvé");
      return;
    }
    const ext = path.extname(chemin);
    res.writeHead(200, { "Content-Type": TYPES_MIME[ext] || "application/octet-stream" });
    res.end(contenu);
  });
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur prêt : http://localhost:${PORT}`);
});
