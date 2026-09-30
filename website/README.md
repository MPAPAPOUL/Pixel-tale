# Site vitrine — Pixelfe / Les Royaumes Brisés

Site multi-pages construit avec [Astro](https://astro.build) (pages statiques,
aucun serveur), en 3 langues : français (`/fr/`), anglais (`/en/`), espagnol
(`/es/`). Il est indépendant du jeu (`client/` + `server/`), qui reste sur
`jeu.pixelfe.fr`.

## Structure

```
website/
├── public/              fichiers servis tels quels (CNAME, assets/img/…)
├── src/
│   ├── i18n/            textes par langue (fr.ts est la référence, en.ts/es.ts suivent)
│   ├── data/            bestiaire.json (données des monstres), news.ts (actualités)
│   ├── layouts/Base.astro   en-tête, menu, sélecteur de langue, pied de page
│   ├── components/      cartes de classes, bestiaire, bandeau de don
│   ├── pages/[lang]/    une page par section (jeu, univers, medias, actualites,
│   │                    classement, studio, soutenir, confidentialite, mentions)
│   └── styles/          global.css (charte) + extra.css (pages, classement…)
└── astro.config.mjs
```

## Travailler en local

```
cd website
npm install
npm run dev        # http://localhost:4321
npm run build      # génère website/dist
```

## Ajouter du contenu

- **Une actualité** : ajoute un objet dans `src/data/news.ts` (titre, résumé et
  texte dans les 3 langues) ; les pages et la liste se créent toutes seules.
- **Un texte** : modifie-le dans `src/i18n/fr.ts`, puis dans `en.ts` et `es.ts`.
- **Un monstre** : ajoute-le dans `src/data/bestiaire.json` avec son image dans
  `public/assets/img/`.

## Classement

La page `/classement/` lit `https://jeu.pixelfe.fr/api/classement` (route
publique du serveur de jeu : uniquement pseudo, classe, niveau et titre). Elle
n'affiche des données qu'une fois le serveur du jeu redéployé avec cette route.

## Dons

Le bouton « Soutenir » renvoie vers `https://ko-fi.com/pixelfe` (constante
`KOFI_URL` dans `src/i18n/index.ts`).

## Déploiement (GitHub Pages, pixelfe.fr)

Le workflow `.github/workflows/deploy-pages.yml` construit le site
(`npm ci && npm run build`) puis publie `website/dist` à chaque push sur `main`
qui touche `website/`. Le domaine est défini par `public/CNAME`.
