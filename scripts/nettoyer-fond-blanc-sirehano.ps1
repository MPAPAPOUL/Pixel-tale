# Retire les residus blancs opaques (fond mal detoure a l'export) sous le
# sprite de Sire-Hano, visibles sur idle/walk1/walk2/attack.png : des pixels
# quasi-blancs avec alpha plein, distincts de la palette du personnage
# (armure noire, flamme cyan, jupe marron) -> peuvent etre retires sans
# risque en cle de chrominance sur le blanc.
Add-Type -AssemblyName System.Drawing

function Nettoyer-FondBlanc {
    param([string]$Chemin, [int]$Seuil = 160)
    $bmp = [System.Drawing.Bitmap]::FromFile($Chemin)
    $modifie = 0
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $p = $bmp.GetPixel($x, $y)
            if ($p.A -gt 0 -and $p.R -ge $Seuil -and $p.G -ge $Seuil -and $p.B -ge $Seuil) {
                $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $p.R, $p.G, $p.B))
                $modifie++
            }
        }
    }
    $tmp = $Chemin + ".tmp.png"
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Move-Item -Force $tmp $Chemin
    Write-Host "$Chemin : $modifie pixels rendus transparents"
}

$dossier = Join-Path $PSScriptRoot "..\client\sprites\sirehano"
foreach ($fichier in @("idle.png", "walk1.png", "walk2.png", "attack.png")) {
    Nettoyer-FondBlanc -Chemin (Join-Path $dossier $fichier)
}
