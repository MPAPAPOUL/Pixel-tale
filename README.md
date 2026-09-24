# Vert-Hige — prototype web (Les Royaumes Brisés)

Platformer multijoueur en temps réel (gravité, saut, plateformes), jouable
dans le navigateur, avec un serveur Node.js qui tourne en local sur ta
machine. Même principe que le tout premier prototype : le serveur est
l'unique autorité sur la physique et les positions, les clients n'envoient
que leurs touches pressées.

## Installation

```bash
cd royaumes-brises-web
npm install
npm start
```

Ouvre ensuite **http://localhost:3000** dans ton navigateur. Ouvre plusieurs
onglets pour simuler plusieurs joueurs.

## Contrôles

- **← / →** : se déplacer (flèches uniquement — plus de touches lettres
  pour le déplacement, afin d'éviter tout conflit avec les touches de
  sorts, quelle que soit la classe ou la disposition clavier)
- **Espace** ou **↑** : sauter
- **A / Z / E** : les 3 sorts de base de ta classe (les touches du coin
  haut-gauche d'un clavier AZERTY — capturées par position physique, donc
  au même endroit même sur un clavier QWERTY)
- **R** : l'ultime (gros dégâts, long temps de recharge)
- **Clic** sur le terrain : lance le sort de la touche A

## Ce qui est déjà là

- Physique de plateforme server-side (gravité, saut, atterrissage) et une
  caméra qui suit le joueur sur un monde de 3160×640 (Vert-Hige + l'arène du
  donjon).
- 3 classes, chacune avec **3 sorts + 1 ultime**, une silhouette visuelle
  distincte, et un **pool de mana** qui se régénère en continu (chaque
  sort a un coût — impossible de spammer sans compter sur les PM autant
  que sur le temps de recharge) :
  - **Dorken** (casque + bouclier, 60 PM, régén. 8/s) : Coup d'épée (8 PM),
    Frappe lourde (18 PM), Charge (20 PM, fonce en avant et inflige des
    dégâts au contact), Cri de guerre (ultime, 45 PM, dégâts en zone)
  - **Quater** (capuche + arc dans le dos, 80 PM, régén. 10/s) : Tir rapide
    (6 PM), Tir puissant (16 PM), Tir perçant (20 PM, traverse plusieurs
    cibles), Volée de flèches (ultime, 40 PM, 5 projectiles d'un coup)
  - **Krix** (robe + chapeau pointu, 100 PM, régén. 12/s) : Griffe arcane
    (8 PM), Éclair (16 PM), Boule de feu (26 PM), Explosion arcanique
    (ultime, 45 PM, dégâts en zone à distance)
  - Une barre de sorts sous l'écran affiche les 4 actions, leur coût en
    mana, et se grise quand le mana manque.
  - Barres de PV **et de mana** affichées au-dessus de chaque personnage,
    et dans la liste des joueurs à droite.
- 6 monstres, deux de chaque espèce (Troubalourd, Fisselo, Tiralark), avec
  des comportements différents (patrouille lente, mouvement erratique,
  tir à distance). Tous meurent, réapparaissent après un délai, et
  infligent des dégâts au contact.
- PV, K.O. et réapparition côté joueur (3 secondes, PV et mana au maximum).
- Rendu cartoon (ciel dégradé, nuages, plateformes "herbe + terre",
  effets visuels sur les ultimes, clignotement pendant l'invulnérabilité).
- Renommage de pseudo.
- **Vrais sprites dessinés et animés** pour les 3 classes et les 3
  monstres de base (voir section dédiée ci-dessous), avec idle / marche /
  attaque, et retournement automatique selon la direction du regard.
- **Le donjon de Sire-Hano et sa clé de groupe** (voir section dédiée
  ci-dessous) : porte verrouillée, fragments de clé qui droppent sur les
  monstres de base, boss en 3 vies avec mêlée + volée + zone télégraphiée,
  et un cycle victoire → réinitialisation pour pouvoir retenter.
- **Une ambiance et des fonctionnalités sociales inspirées de MapleStory 2**
  (voir section dédiée ci-dessous) : ciel pastel avec d'autres îles
  flottantes au loin et rayons de soleil, interface arrondie façon
  "bonbon", chat de zone et emotes rapides avec bulles au-dessus des
  personnages.

## Sprites & animations

Les silhouettes vectorielles ont été remplacées par de vrais sprites
pixel-art (libres de droit) pour :

- **Joueurs** : Dorken, Quater, Krix — chacun avec une pose idle, une
  marche (2 poses en alternance pour Dorken/Krix, idle↔marche pour
  Quater), une pose d'attaque (Quater alterne 2 poses d'attaque pour un
  effet "tir à l'arc" plus vivant), et une pose K.O. Le corps K.O. de Krix
  n'existait pas dans la planche originale (aucune pose "à terre") : il
  est généré en tournant sa pose idle à 90°, en attendant une vraie pose
  si tu retrouves/commandes une planche plus complète.
- **Monstres** : Troubalourd, Fisselo, Tiralark — idle, marche, attaque
  (pas de pose K.O. : comme avant, un monstre à 0 PV disparaît simplement
  jusqu'à sa réapparition).
- **Sire-Hano** : planche dédiée (idle, marche ×2, attaque), voir la
  section "Le donjon de Sire-Hano" ci-dessous.

Détails techniques utiles si tu veux retoucher ou ajouter des sprites :

- Fichiers dans `client/sprites/<classe-ou-monstre>/<pose>.png`, fond
  transparent.
- Tous les dessins sources font face à **droite** : le client retourne
  automatiquement l'image (`ctx.scale(-1,1)`) quand le personnage regarde
  vers la gauche (`facing === -1`). Si tu ajoutes un sprite qui fait face à
  droite par défaut, il faudra inverser cette règle pour ce personnage.
- Le serveur envoie deux nouveaux champs par joueur/monstre dans l'état
  réseau : `enMouvement` (vitesse horizontale non nulle) et `attaque`
  (une fenêtre courte de ~0,22s après le déclenchement d'un sort, ou
  ~0,25s après un tir/contact monstre) — c'est ce qui pilote le choix de
  pose côté client (`poseJoueur` / `poseMonstre` dans `index.html`).
- Tant qu'une image n'a pas fini de charger, le client retombe sur
  l'ancienne silhouette vectorielle (`dessinerCorpsClasse` /
  `dessinerCorpsMonstreSecours`) — pas de flash invisible à la connexion.

## Le donjon de Sire-Hano

Pas d'instance séparée : le monde s'étend simplement au-delà de
Vert-Hige (x = 2400 → 3160) pour former l'arène du donjon, verrouillée par
une porte magique infranchissable tant que la clé n'est pas réunie.

- **Clé de groupe** : chaque Fisselo, Troubalourd ou Tiralark tué a 50 % de
  chance de faire tomber un fragment de clé. Il en faut **3** pour ouvrir
  la porte. Comme il n'y a pas encore de système de groupe/équipe formel
  (question encore ouverte dans le GDD), les fragments sont un pot commun
  partagé par **tout le serveur** — cohérent avec l'esprit "jouer ensemble"
  du choix d'une clé de groupe plutôt qu'individuelle. Un panneau dans la
  barre latérale et une porte visible dans le monde affichent la
  progression (X / 3 fragments).
- **Sire-Hano** : un démon-guerrier avec sa propre planche de sprites
  dédiée (idle, 2 poses de marche, attaque à l'épée enchaînée), plutôt
  qu'un sprite réutilisé d'une des classes jouables.
- **3 phases, avec scission en plusieurs répliques** : Sire-Hano ne
  reprend pas simplement vie avec moins de PV — il se **scinde en
  davantage d'entités distinctes**, chacune plus petite, à chaque phase :
  - **Phase 1** : l'original, seul (480 PV, taille normale).
  - **Phase 2** : une fois vaincu, il se divise en **2 répliques**
    simultanées (120 PV chacune, ~80 % de sa taille), qui apparaissent à
    des positions différentes de l'arène.
  - **Phase 3** : une fois les 2 répliques de la phase 2 vaincues, il se
    scinde encore en **4 petites répliques** (30 PV chacune, ~62 % de sa
    taille), réparties dans toute l'arène.
  - Chaque entité, quelle que soit la phase, garde le même répertoire de 3
    attaques, et agit de façon indépendante (sa propre cible, son propre
    déplacement, ses propres cooldowns) — c'est le nombre d'adversaires
    simultanés à gérer qui augmente, pas leur intelligence individuelle :
    - **Mêlée** agressive dès qu'un joueur est à portée (16 dégâts, ~1,3s
      de recharge)
    - **Volée** de 3 projectiles façon ultime du Quater (11 dégâts
      chacun, ~3,4s de recharge)
    - **Zone au sol télégraphiée** façon ultime du Krix : un cercle
      d'avertissement apparaît ~0,9s avant les dégâts (32, rayon 95) — le
      temps de s'écarter si on regarde l'écran. Plusieurs répliques
      peuvent télégraphier une zone en même temps dès la phase 2.
  - Une légère teinte (assombri pour la phase 1, violet puis spectral
    pour les phases suivantes) reste appliquée sur le sprite pour bien
    distinguer les phases d'un coup d'œil, en plus du nom affiché
    au-dessus de chaque entité.
- **Victoire** : une fois la dernière réplique de la phase 3 vaincue, le
  combat se termine, et **tout se réinitialise après 90 secondes** (clé
  remise à zéro, porte reverrouillée, un Sire-Hano tout neuf réapparaît en
  phase 1) — pour permettre une nouvelle tentative plutôt que de rester
  bloqué sur un boss déjà mort.

## Ambiance & social façon MapleStory 2

Première étape du chantier "inspiré de MapleStory 2" (celle choisie en
priorité : ambiance + social) :

- **Ciel** : dégradé pastel façon île céleste (rose → violet → bleu), un
  soleil doux avec des rayons qui tournent lentement, et plusieurs petites
  **îles flottantes au loin** (chacune avec sa touffe d'arbres et son
  petit nuage-support) qui défilent en légère parallaxe par rapport à la
  caméra — pour rappeler que Vert-Hige n'est qu'une île parmi d'autres
  au-dessus des nuages, sans distraire du gameplay au premier plan.
- **Interface** : panneaux arrondis à bordure épaisse "façon bonbon"
  (dégradé crème, contour violet), boutons en pilule dégradés dorés,
  cadre du jeu et barre de sorts assortis. Palette globale repensée en
  pastel plutôt qu'en sombre/neutre.
- **Chat de zone** : un panneau "Discussion" dans la barre latérale (champ
  de texte + bouton Envoyer, historique des 40 derniers messages,
  Entrée pour envoyer) diffuse instantanément à tout le monde connecté,
  sans attendre le prochain tick de la boucle physique.
- **Emotes rapides** : 8 emojis cliquables sous le chat (👋 😂 😭 ❤️ 😮 👍
  💀 🎉), envoyés en un clic.
- **Bulles au-dessus des personnages** : un message de chat affiche une
  bulle "façon BD" avec petite pointe, qui s'efface en fondu après ~4,5s ;
  une emote affiche juste le symbole, plus grand, pendant ~2,2s. Les deux
  se remplacent l'une l'autre si le joueur enchaîne.
- Techniquement : le serveur diffuse `{type:"chat", id, texte}` et
  `{type:"emote", id, emote}` à la connexion `ws.on("message")` (nouveaux
  cas à côté de `"input"` et `"rename"`), avec une liste blanche
  d'emotes autorisées côté serveur. Le champ de texte du chat (et celui du
  renommage) coupe la capture clavier globale le temps de la saisie, pour
  qu'écrire "z", "e", "r" ou "a" dans un message ne déclenche pas un sort.

Prochaines étapes du chantier MapleStory 2 (pas encore commencées) :
profondeur des classes (arbres de compétences), et contenu de fin de jeu /
progression — après la fondation XP/niveaux/objets.

## Ce qui n'est PAS encore là (prochaines étapes naturelles)

- Combat **entre joueurs** (PvP) — pour l'instant on ne peut attaquer que
  les monstres et le boss.
- Un vrai système de groupe/équipe (la clé du donjon est pour l'instant un
  pot commun partagé par tout le serveur, faute de mieux).
- Équipement, loot, expérience/niveaux — vaincre Sire-Hano ne donne rien
  d'autre que le plaisir de l'avoir vaincu, pour l'instant.

## Un point à tester en particulier

Le tir des Tiralark (monstres à distance) n'a pas pu être testé en
conditions réelles de mon côté (mon environnement ne peut pas simuler un
vrai déplacement de joueur jusqu'à leur portée). La logique a été relue
attentivement mais si tu vois un comportement bizarre en te faisant tirer
dessus par un Tiralark, dis-le moi.

## Une note sur le placement des plateformes

Les écarts entre plateformes sont calculés pour la physique actuelle
(saut ≈ 110px de haut, ≈ 160px de large en vol), mais à ajuster au
playtest : si un saut semble trop juste ou trop facile, retouche soit les
coordonnées dans `PLATEFORMES` (server.js), soit les constantes `GRAVITE` /
`VITESSE_SAUT`.

## Comment c'est construit

- `server/server.js` — état du jeu, boucle physique à 30 ticks/seconde,
  WebSocket. Lis les commentaires, ils expliquent chaque choix.
- `client/index.html` — rendu Canvas + capture clavier + connexion
  WebSocket.
