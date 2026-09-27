# Sire-Hano "leviterait" au-dessus du sol : chaque pose (idle/walk1/walk2/
# attack) a une marge transparente differente sous les pieds (jusqu'a 38px
# pour attack.png), or dessinerSprite (client) ancre le BAS du canvas PNG au
# bas de la hitbox -> un canvas plus haut que le personnage reel cree un
# ecart visible entre les pieds et le sol, variable selon la pose (donc en
# plus un leger "rebond" en changeant de pose).
#
# Fix : recadre chaque image pour que sa derniere ligne de pixels opaques
# colle exactement au bord bas du canvas (marge bas = 0 pour toutes), puis
# rembourre en HAUT (jamais en bas, pour ne pas recreer l'ecart) jusqu'a une
# hauteur commune -> meme echelle de rendu pour toutes les poses, feet
# toujours exactement au bord bas.
Add-Type -AssemblyName System.Drawing

function Obtenir-DerniereLigneOpaque {
    param([System.Drawing.Bitmap]$Bmp)
    for ($y = $Bmp.Height - 1; $y -ge 0; $y--) {
        for ($x = 0; $x -lt $Bmp.Width; $x++) {
            if ($Bmp.GetPixel($x, $y).A -gt 0) { return $y }
        }
    }
    return $Bmp.Height - 1
}

$dossier = Join-Path $PSScriptRoot "..\client\sprites\sirehano"
$fichiers = @("idle.png", "walk1.png", "walk2.png", "attack.png")

# Passe 1 : mesurer la hauteur "utile" (0..dernierePixelOpaque+1) de chaque
# fichier, pour connaitre la hauteur commune finale (le max des 4).
$hauteurs = @{}
foreach ($f in $fichiers) {
    $chemin = Join-Path $dossier $f
    $bmp = [System.Drawing.Bitmap]::FromFile($chemin)
    $hauteurs[$f] = (Obtenir-DerniereLigneOpaque -Bmp $bmp) + 1
    $bmp.Dispose()
}
$hauteurCommune = ($hauteurs.Values | Measure-Object -Maximum).Maximum
Write-Host "Hauteur utile par fichier : $($hauteurs | Out-String)Hauteur commune retenue : $hauteurCommune"

# Passe 2 : recadre chaque fichier a sa propre hauteur utile (retire la marge
# transparente sous les pieds), puis rembourre en haut jusqu'a la hauteur
# commune -> feet toujours au bord bas, meme echelle de rendu pour toutes.
foreach ($f in $fichiers) {
    $chemin = Join-Path $dossier $f
    $original = [System.Drawing.Bitmap]::FromFile($chemin)
    $largeur = $original.Width
    $hauteurUtile = $hauteurs[$f]
    $rembourrageHaut = $hauteurCommune - $hauteurUtile

    $resultat = New-Object System.Drawing.Bitmap $largeur, $hauteurCommune
    $g = [System.Drawing.Graphics]::FromImage($resultat)
    $g.Clear([System.Drawing.Color]::Transparent)
    # Copie les lignes utiles (0..hauteurUtile-1) de l'original, decalees de
    # $rembourrageHaut vers le bas -> le contenu se retrouve collé au bord
    # bas du nouveau canvas, avec du vide transparent au-dessus si besoin.
    $rectSource = New-Object System.Drawing.Rectangle 0, 0, $largeur, $hauteurUtile
    $rectDest = New-Object System.Drawing.Rectangle 0, $rembourrageHaut, $largeur, $hauteurUtile
    $g.DrawImage($original, $rectDest, $rectSource, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $original.Dispose()

    $tmp = $chemin + ".tmp.png"
    $resultat.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $resultat.Dispose()
    Move-Item -Force $tmp $chemin
    Write-Host "$f : $largeur x $hauteurCommune (rembourrage haut : $rembourrageHaut px)"
}
