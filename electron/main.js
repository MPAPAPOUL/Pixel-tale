// Point d'entrée de l'app desktop (Electron) — démarre le même serveur de
// jeu que `npm start` (server/server.js, en local sur cette machine), puis
// ouvre une fenêtre native qui charge le client dessus. Aucune différence de
// gameplay avec la version web : c'est le même code, juste empaqueté en
// .exe pour ne plus avoir à ouvrir un terminal + un navigateur.
const { app, BrowserWindow } = require("electron");
const path = require("path");

// process.env.PORT n'est pas défini en desktop (pas d'hébergeur imposant un
// port) : server.js retombe sur 3000, on s'aligne dessus ici.
const PORT = process.env.PORT || 3000;

function demarrerServeurEmbarque() {
  try {
    // Exécute server/server.js tel quel (il appelle déjà server.listen() à
    // son chargement) — même fichier que la version web, aucune duplication
    // de logique serveur à maintenir.
    require(path.join(__dirname, "..", "server", "server.js"));
  } catch (err) {
    // EADDRINUSE : un serveur tourne déjà sur ce port (ex: `npm start`
    // lancé à côté) — on se contente de s'y connecter au lieu de planter,
    // plutôt qu'un crash pour une situation somme toute anodine en local.
    console.error("Impossible de démarrer le serveur embarqué :", err.message);
  }
}

function creerFenetre() {
  const fenetre = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    autoHideMenuBar: true, // pas besoin de la barre de menus Electron par défaut pour un jeu
    backgroundColor: "#1a1120", // évite un flash blanc pendant le chargement (fond sombre du jeu)
  });
  // Le serveur vient d'être démarré (voir demarrerServeurEmbarque) : son
  // port peut ne pas encore accepter de connexions au moment précis de ce
  // premier chargement (juste après server.listen(), avant l'événement
  // "listening"). Plutôt qu'une condition de course, on retente en cas
  // d'échec de chargement, jusqu'à ce que le serveur réponde.
  let tentativesRestantes = 20;
  function chargerAvecRetentative() {
    fenetre.loadURL(`http://localhost:${PORT}`).catch(() => {
      if (tentativesRestantes-- > 0) setTimeout(chargerAvecRetentative, 250);
    });
  }
  chargerAvecRetentative();
}

app.whenReady().then(() => {
  demarrerServeurEmbarque();
  creerFenetre();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
