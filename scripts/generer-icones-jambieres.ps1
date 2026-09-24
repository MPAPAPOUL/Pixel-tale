# Regenere les icones "jambieres" (pantalon), qui affichaient par erreur des
# bottes (memes sprites que le slot "bottes") — voir le commentaire dans
# client/index.html pres de TYPES_ARMES/ICONE_DCSS. Dessin pixel-art simple
# (ceinture + deux jambes), a la meme resolution 32x32 que les autres icones
# DCSS, avec une teinte par palier coherente avec les autres emplacements
# (gris/brun T1 -> argente T4 -> dore legendaire).
Add-Type -AssemblyName System.Drawing

function New-IconePantalon {
    param(
        [string]$Chemin,
        [string]$CouleurTissu,
        [string]$CouleurOmbre,
        [string]$CouleurCeinture,
        [string]$CouleurContour = "#141414"
    )
    $bmp = New-Object System.Drawing.Bitmap 32,32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    $tissu = [System.Drawing.ColorTranslator]::FromHtml($CouleurTissu)
    $ombre = [System.Drawing.ColorTranslator]::FromHtml($CouleurOmbre)
    $ceinture = [System.Drawing.ColorTranslator]::FromHtml($CouleurCeinture)
    $contour = [System.Drawing.ColorTranslator]::FromHtml($CouleurContour)

    $brossTissu = New-Object System.Drawing.SolidBrush $tissu
    $brossOmbre = New-Object System.Drawing.SolidBrush $ombre
    $brossCeinture = New-Object System.Drawing.SolidBrush $ceinture
    $stylo = New-Object System.Drawing.Pen $contour, 1

    # Corps du pantalon : bloc plein pour la taille (y 8-15), separe en deux
    # jambes en dessous (y 15-27) avec un large espace pour l'entrejambe —
    # a cette taille (32px), un espace genereux est necessaire pour que la
    # silhouette se lise comme un pantalon plutot qu'un bloc plein.
    $corps = @(6,8, 26,8, 26,27, 19,27, 19,15, 13,15, 13,27, 6,27)
    $pts = for ($i=0; $i -lt $corps.Length; $i+=2) { New-Object System.Drawing.Point $corps[$i], $corps[$i+1] }
    $g.FillPolygon($brossTissu, $pts)
    $g.DrawPolygon($stylo, $pts)

    # Ceinture (bande du haut, par-dessus le corps).
    $g.FillRectangle($brossCeinture, 6, 8, 20, 4)
    $g.DrawRectangle($stylo, 6, 8, 19, 3)

    # Ombre sur le bord exterieur de chaque jambe (volume), sous la ceinture
    # uniquement pour ne pas empieter dessus.
    $g.FillRectangle($brossOmbre, 6, 15, 3, 12)
    $g.FillRectangle($brossOmbre, 23, 15, 3, 12)

    $g.Dispose()
    $bmp.Save($Chemin, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$dossier = "C:\Users\user3\Downloads\GitHub\Pixel-tale\client\sprites\dcss-items"

New-IconePantalon -Chemin "$dossier\jambieres-t1.png" -CouleurTissu "#8a6a4a" -CouleurOmbre "#6b4f36" -CouleurCeinture "#4a3626"
New-IconePantalon -Chemin "$dossier\jambieres-t2.png" -CouleurTissu "#6b5a52" -CouleurOmbre "#4a3f3a" -CouleurCeinture "#2e2622"
New-IconePantalon -Chemin "$dossier\jambieres-t3.png" -CouleurTissu "#4f6a82" -CouleurOmbre "#374c5f" -CouleurCeinture "#2a3a47"
New-IconePantalon -Chemin "$dossier\jambieres-t4.png" -CouleurTissu "#9aa3ad" -CouleurOmbre "#6f7680" -CouleurCeinture "#4a4f57" -CouleurContour "#1a1a1a"
New-IconePantalon -Chemin "$dossier\jambieres-legendaire.png" -CouleurTissu "#e0b84a" -CouleurOmbre "#b8912e" -CouleurCeinture "#7a5c1a" -CouleurContour "#3a2c0a"

"Icones jambieres regenerees."
