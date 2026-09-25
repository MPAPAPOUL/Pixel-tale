# Lance le serveur en boucle : chaque fois que le process Node se termine
# (redemarrage demande via "redeploy" dans la console, crash, etc.), il est
# relance automatiquement avec le code a jour (git pull deja fait par
# lancerRedeploiement() dans server.js avant de quitter).
#
# Usage : depuis la racine du depot,
#   powershell -ExecutionPolicy Bypass -File scripts\lancer-serveur.ps1

Set-Location (Join-Path $PSScriptRoot "..")

while ($true) {
    Write-Host "--- Demarrage du serveur ---" -ForegroundColor Cyan
    node server/server.js
    Write-Host "--- Serveur arrete (code $LASTEXITCODE), redemarrage dans 2s... ---" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}
