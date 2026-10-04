// Résume les statistiques anonymes (server/data/stats.json) :
//   node tools/stats.js        (depuis /opt/Pixel-tale sur le VPS)
const fs = require("fs");
const path = require("path");
let d = {};
try { d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "server", "data", "stats.json"), "utf8")); } catch { console.log("Aucune statistique pour l'instant."); process.exit(0); }
const jours = Object.keys(d).sort().slice(-14);
console.log("Jour        visites (mobile)  lancements  jeu rapide  min. de jeu  conversion");
for (const j of jours) {
  const x = d[j];
  const conv = x.visites ? Math.round((x.lancements / x.visites) * 100) + " %" : "-";
  console.log(`${j}  ${String(x.visites).padStart(7)} (${String(x.visitesMobile).padStart(4)})  ${String(x.lancements).padStart(9)}  ${String(x.rapides).padStart(10)}  ${String(x.minutesJeu).padStart(11)}  ${conv}`);
}
const ref = {};
for (const j of jours) for (const [k, v] of Object.entries(d[j].referents || {})) ref[k] = (ref[k] || 0) + v;
console.log("\nProvenance (14 derniers jours) :", Object.entries(ref).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(", ") || "(direct)");
const t = jours.reduce((a, j) => ({ v: a.v + d[j].visites, l: a.l + d[j].lancements, m: a.m + d[j].minutesJeu }), { v: 0, l: 0, m: 0 });
console.log(`Total : ${t.v} visites, ${t.l} parties lancées, ${t.l ? (t.m / t.l).toFixed(1) : 0} min de jeu par partie en moyenne.`);
