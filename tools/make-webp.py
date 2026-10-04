#!/usr/bin/env python3
"""Génère un équivalent .webp à côté de chaque .png du client (allègement du
chargement, surtout sur mobile). Le serveur sert automatiquement X.webp à la
place de X.png aux navigateurs qui l'acceptent (voir server.js, serveur
statique). Fonds : WebP avec perte (q=80) ; sprites : WebP sans perte (pixel
art intact). Un .webp n'est conservé que s'il est nettement plus petit.
Usage : python3 tools/make-webp.py   (relancer après l'ajout d'images)"""
import os
from PIL import Image

RACINE = os.path.join(os.path.dirname(__file__), "..", "client")
total_png = total_webp = 0
for dossier, _, fichiers in os.walk(RACINE):
    for nom in fichiers:
        if not nom.endswith(".png"):
            continue
        chemin = os.path.join(dossier, nom)
        cible = chemin[:-4] + ".webp"
        taille_png = os.path.getsize(chemin)
        if taille_png < 4096:  # trop petit pour que ça vaille le coup
            continue
        im = Image.open(chemin)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA")
        fond = "assets/backgrounds" in chemin.replace(os.sep, "/")
        if fond:
            im.save(cible, "WEBP", quality=80, method=6)
        else:
            im.save(cible, "WEBP", lossless=True, method=6)
        taille_webp = os.path.getsize(cible)
        if taille_webp > taille_png * 0.85:
            os.remove(cible)
            continue
        total_png += taille_png
        total_webp += taille_webp
print(f"PNG converties : {total_png/1048576:.1f} Mo -> WebP : {total_webp/1048576:.1f} Mo")
