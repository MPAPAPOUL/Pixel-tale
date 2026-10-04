# Pixelfe sur Android

## Étape 1 — Appli installable (PWA) : déjà en place
Le jeu est une PWA : sur Android (Chrome), le bouton « 📲 Installer l'appli » apparaît
sur l'écran d'accueil (ou menu ⋮ → « Installer l'application »). Elle s'ouvre en plein écran,
en paysage, avec son icône, et se lance plus vite grâce au cache.

Fichiers : `client/manifest.webmanifest`, `client/sw.js`, `client/icons/`.
Prérequis : le jeu doit être servi en **HTTPS** (jeu.pixelfe.fr).

## Étape 2 — APK / AAB pour le Google Play Store (TWA)
Une « Trusted Web Activity » est une vraie appli Android qui affiche le jeu en plein écran.
Le plus simple, sans installer Android Studio :

1. Compte développeur Google Play (25 $, une seule fois) : https://play.google.com/console
2. Aller sur https://www.pwabuilder.com, saisir `https://jeu.pixelfe.fr`, cliquer
   « Package for stores » → **Android** → paramètres :
   - Package ID : `fr.pixelfe.royaumesbrises`
   - Display mode : Fullscreen, Orientation : Landscape
   - Signing key : « New » (PWABuilder génère la clé) — **télécharger et SAUVEGARDER le fichier
     de clé + le mot de passe** (indispensable pour toute mise à jour future).
3. Télécharger le ZIP : il contient l'`.aab` (pour le Play Store), un `.apk` (pour tester) et
   un fichier `assetlinks.json`.
4. Copier `assetlinks.json` dans `client/.well-known/assetlinks.json` (dépôt), pousser,
   redéployer le serveur : sans lui, l'appli affiche une barre d'adresse Chrome.
5. Test : installer l'`.apk` sur un téléphone (activer « sources inconnues »).
6. Play Console : créer l'appli, importer l'`.aab`, remplir la fiche (descriptions, captures
   d'écran paysage, icône 512×512 = `client/icons/icon-512.png`, politique de confidentialité :
   https://pixelfe.fr/fr/confidentialite), questionnaire de classification, puis publier
   (test interne/fermé d'abord ; les comptes personnels récents doivent faire un test fermé
   avec 12 testeurs pendant 14 jours avant la production).

## Rappels
- Les achats se font via Ko-fi (gemmes) : pas de facturation Google Play intégrée. Les règles du
  Play Store sur les achats numériques s'appliquent — vérifier la politique en vigueur avant de
  publier.
- Mettre à jour le jeu = redéployer le serveur ; l'appli Android (TWA) affiche toujours la
  dernière version, sans republier l'`.aab`.
