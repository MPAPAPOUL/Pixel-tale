# Site vitrine — Les Royaumes Brisés

Site statique (deux pages HTML, aucun serveur/build nécessaire) qui
présente le jeu. Ce site est indépendant du jeu lui-même (`client/` +
`server/`) : **le jeu n'est pas jouable ni téléchargeable depuis ce
site**, c'est une pure vitrine (présentation + bestiaire).

## Fichiers

```
website/
├── index.html          page d'accueil (HTML + CSS inline, sans dépendance)
├── bestiaire.html       bestiaire complet (PV, dégâts, taux de drop de chaque créature)
└── assets/img/          portraits de classes, boss et monstres (extraits de client/sprites/)
```

Aucune étape de build : les fichiers `.html` peuvent être ouverts tels
quels dans un navigateur, ou déposés tels quels sur n'importe quel
hébergement statique.

## Déployer sur IONOS

Ce qu'il faut dépend de la formule achetée en plus du nom de domaine :

### 1. Tu as un hébergement web IONOS (mutualisé, Deploy Now, etc.)

1. Dans le tableau de bord IONOS, ouvre le **gestionnaire de fichiers**
   (ou connecte-toi en FTP/SFTP avec les identifiants fournis par IONOS).
2. Dépose **tout le contenu du dossier `website/`** (`index.html`,
   `bestiaire.html` et le dossier `assets/`) à la racine de l'espace web
   (souvent `/` ou `/htdocs`, selon la formule).
3. Vérifie que `index.html` est bien à la racine (pas dans un
   sous-dossier `website/`), sinon l'URL du domaine n'affichera rien par
   défaut.
4. Dans l'onglet **SSL** de l'hébergement, active le certificat gratuit
   (Let's Encrypt) si ce n'est pas déjà fait, pour que le site soit servi
   en `https://`.

### 2. Tu as seulement le nom de domaine (pas encore d'hébergement)

Un site 100% statique comme celui-ci n'a pas besoin d'un serveur Node —
n'importe quel hébergement statique gratuit fonctionne :

- **IONOS Deploy Now** (gratuit pour un site statique, s'intègre bien à un
  domaine déjà chez IONOS), ou
- GitHub Pages / Netlify / Vercel (gratuits, déploiement en glissant le
  dossier `website/` ou en connectant ce dépôt GitHub), en pointant
  ensuite le domaine IONOS dessus via un enregistrement DNS **CNAME**
  (voir la doc du service choisi pour la valeur exacte à utiliser).

### 3. Pointer le domaine (DNS)

Dans **IONOS → Domaines & SSL → [ton domaine] → DNS** :

- Si l'hébergement est chez IONOS : généralement automatique dès que le
  domaine et l'hébergement sont associés dans le même compte (IONOS
  propose souvent de le faire pendant l'achat de l'hébergement).
- Si l'hébergement est ailleurs : ajoute l'enregistrement fourni par cet
  hébergeur — un **A** (pointant vers une adresse IP) ou un **CNAME**
  (pointant vers un nom d'hôte), selon ce qu'indique sa documentation.
- La propagation DNS peut prendre de quelques minutes à 24-48h.

## Mettre à jour le contenu

Le texte, les liens et les images sont directement dans `index.html` et
`bestiaire.html` (pas de CMS). Pour changer une image de personnage/
monstre, remplace le fichier correspondant dans `assets/img/` (mêmes
dimensions pas nécessaires, les images sont redimensionnées en CSS).

Les chiffres du bestiaire (PV, dégâts, XP, taux de drop) sont recopiés
à la main depuis `server/server.js` — si l'équilibrage du jeu change
(`MONSTRES_CONFIG`, `CHANCE_DROP_*`, `BIOMES_DEFINITION`...), pense à
les mettre à jour dans `bestiaire.html` aussi, rien ne les synchronise
automatiquement.
