# Site vitrine — Les Royaumes Brisés

Site statique (une seule page HTML, aucun serveur/build nécessaire) qui
présente le jeu et propose son téléchargement. Ce site est indépendant du
jeu lui-même (`client/` + `server/`) : **le jeu n'est pas jouable depuis ce
site**, il n'y a qu'une page d'information + un bouton de téléchargement.

## Fichiers

```
website/
├── index.html          la page entière (HTML + CSS inline, sans dépendance)
├── CNAME               domaine personnalisé pour GitHub Pages (pixelfe.fr)
└── assets/img/         portraits de classes, boss et monstres (extraits de client/sprites/)
```

Aucune étape de build : `index.html` peut être ouvert tel quel dans un
navigateur, ou déposé tel quel sur n'importe quel hébergement statique.

## Déployer sur pixelfe.fr (GitHub Pages, déjà configuré)

Le dépôt contient déjà tout ce qu'il faut : un workflow GitHub Actions
(`.github/workflows/deploy-pages.yml`) qui publie automatiquement le
contenu de `website/` sur GitHub Pages à chaque `git push` sur `main`, et
un fichier `website/CNAME` qui associe le domaine `pixelfe.fr`. Il ne
reste que deux réglages, un côté GitHub, un côté IONOS :

### 1. Activer GitHub Pages (une seule fois)

1. Sur GitHub, dans ce dépôt → **Settings → Pages**.
2. Sous **Build and deployment → Source**, choisis **GitHub Actions**
   (pas "Deploy from a branch").
3. Merge cette branche sur `main` (ou attends que ce soit fait) : le
   workflow se déclenche automatiquement et publie le site.
4. Toujours dans **Settings → Pages**, dans **Custom domain**, vérifie
   que `pixelfe.fr` est bien renseigné (il devrait l'être automatiquement
   grâce au fichier `CNAME`) puis clique **Save**.
5. Attends que GitHub valide le domaine (case "DNS check successful"),
   ce qui nécessite l'étape IONOS ci-dessous. Une fois validé, coche
   **Enforce HTTPS** pour servir le site en `https://`.

### 2. Pointer pixelfe.fr vers GitHub Pages (chez IONOS)

Dans **IONOS → Domaines & SSL → pixelfe.fr → DNS**, ajoute ces
enregistrements (édite ceux qui existent déjà pour `@` ou `www` si le
domaine en a, plutôt que d'en créer en double) :

| Type  | Nom / Hôte | Valeur                     |
|-------|------------|-----------------------------|
| A     | @          | 185.199.108.153             |
| A     | @          | 185.199.109.153             |
| A     | @          | 185.199.110.153             |
| A     | @          | 185.199.111.153             |
| CNAME | www        | mpapapoul.github.io.        |

(`@` désigne le domaine racine `pixelfe.fr` lui-même dans l'interface
IONOS.) La propagation DNS peut prendre de quelques minutes à 24-48h —
tant qu'elle n'est pas terminée, `pixelfe.fr` peut continuer à afficher
la page de parking IONOS.

Une fois ces deux étapes faites, `https://pixelfe.fr` sert directement
`website/index.html`, et se met à jour tout seul à chaque `git push` sur
`main` qui touche `website/`.

## Autres façons de déployer sur IONOS

Ce qu'il faut dépend de la formule achetée en plus du nom de domaine :

### 1. Tu as un hébergement web IONOS (mutualisé, Deploy Now, etc.)

1. Dans le tableau de bord IONOS, ouvre le **gestionnaire de fichiers**
   (ou connecte-toi en FTP/SFTP avec les identifiants fournis par IONOS).
2. Dépose **tout le contenu du dossier `website/`** (le fichier
   `index.html` et le dossier `assets/`) à la racine de l'espace web
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

Le texte, les liens et les images sont directement dans `index.html`
(pas de CMS). Pour changer une image de personnage/monstre, remplace le
fichier correspondant dans `assets/img/` (mêmes dimensions pas
nécessaires, les images sont redimensionnées en CSS).

Le bouton "Télécharger le .zip" pointe vers l'archive GitHub du dépôt
(`.../archive/refs/heads/main.zip`) : il se met donc à jour tout seul à
chaque `git push` sur `main`, aucune action à refaire ici.
