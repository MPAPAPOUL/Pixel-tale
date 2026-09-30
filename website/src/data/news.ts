import type { Lang } from "../i18n";

export interface Post {
  slug: string;
  date: string;
  image: string;
  text: Record<Lang, { title: string; excerpt: string; body: string[] }>;
}

export const posts: Post[] = [
  {
    slug: "criques-pirates",
    date: "2026-09-30",
    image: "enemy-capitaine-sabrenoir.png",
    text: {
      fr: {
        title: "Deux nouvelles criques pirates",
        excerpt: "La Crique des Corsaires (niveau 15) et la redoutable Crique des Naufrageurs (niveau 100) rejoignent le réseau de téléporteurs.",
        body: [
          "Deux nouvelles régions arrivent dans Les Royaumes Brisés. La Crique des Corsaires, au niveau 15, accueille des Hommes-Calmars, des Pirates Zombies et un Capitaine Corsaire d'élite.",
          "Tout en haut de la progression, la Crique des Naufrageurs (niveau 100) est la région la plus dangereuse du jeu, gardée par le Capitaine Sabrenoir.",
          "Chaque région dispose de son propre décor en parallaxe, pour un voyage plus immersif.",
        ],
      },
      en: {
        title: "Two new pirate coves",
        excerpt: "The Corsair Cove (level 15) and the fearsome Wreckers' Cove (level 100) join the teleporter network.",
        body: [
          "Two new regions arrive in The Broken Realms. The Corsair Cove, at level 15, hosts Squid Men, Zombie Pirates and an elite Corsair Captain.",
          "At the very top of the progression, the Wreckers' Cove (level 100) is the most dangerous region in the game, guarded by Captain Sabrenoir.",
          "Every region now has its own parallax scenery, for a more immersive journey.",
        ],
      },
      es: {
        title: "Dos nuevas calas piratas",
        excerpt: "La Cala de los Corsarios (nivel 15) y la temible Cala de los Naufragadores (nivel 100) se unen a la red de teletransportes.",
        body: [
          "Dos nuevas regiones llegan a Los Reinos Rotos. La Cala de los Corsarios, de nivel 15, alberga Hombres Calamar, Piratas Zombi y un Capitán Corsario de élite.",
          "En lo más alto de la progresión, la Cala de los Naufragadores (nivel 100) es la región más peligrosa del juego, custodiada por el Capitán Sabrenoir.",
          "Cada región tiene ahora su propio decorado con paralaje, para un viaje más inmersivo.",
        ],
      },
    },
  },
  {
    slug: "sorts-de-zone-animes",
    date: "2026-09-29",
    image: "hero-krix.png",
    text: {
      fr: {
        title: "Des sorts de zone enfin animés",
        excerpt: "Cri de guerre nucléaire, explosions arcaniques colorées, météore du Dragon Noir : fini les ronds rouges.",
        body: [
          "Les sorts de zone ont une vraie identité visuelle. Le Cri de guerre du Dorken déclenche un champignon atomique, l'Explosion arcanique du Krix existe en trois variantes colorées.",
          "Chez les boss, l'avertissement d'une attaque de zone est désormais un noyau d'énergie qui gonfle avant l'impact, à la place de l'ancien cercle rouge.",
          "Les animations des boss ont aussi été retravaillées : taille stable d'une pose à l'autre et pieds bien posés au sol.",
        ],
      },
      en: {
        title: "Area spells are finally animated",
        excerpt: "Nuclear War Cry, colorful arcane explosions, the Black Dragon's meteor: no more red circles.",
        body: [
          "Area spells now have a real visual identity. The Dorken's War Cry unleashes an atomic mushroom cloud, and the Krix's Arcane Explosion comes in three colorful variants.",
          "For bosses, the warning of an area attack is now an energy core that swells before impact, replacing the old red circle.",
          "Boss animations were also reworked: stable size from one pose to the next and feet properly planted on the ground.",
        ],
      },
      es: {
        title: "Los hechizos de zona, por fin animados",
        excerpt: "Grito de guerra nuclear, explosiones arcanas de colores, meteoro del Dragón Negro: se acabaron los círculos rojos.",
        body: [
          "Los hechizos de zona tienen ahora una verdadera identidad visual. El Grito de guerra del Dorken desata un hongo atómico y la Explosión arcana del Krix existe en tres variantes de colores.",
          "En los jefes, el aviso de un ataque de zona es ahora un núcleo de energía que crece antes del impacto, en lugar del antiguo círculo rojo.",
          "También se han rehecho las animaciones de los jefes: tamaño estable entre poses y pies bien apoyados en el suelo.",
        ],
      },
    },
  },
  {
    slug: "plus-accessible",
    date: "2026-09-28",
    image: "hero-dorken.png",
    text: {
      fr: {
        title: "Un jeu plus accessible",
        excerpt: "Berge-Rhak dès le niveau 1, régénération doublée et premiers niveaux plus rapides.",
        body: [
          "Estenoise-les-Brumes et Berge-Rhak sont ouverts dès le niveau 1, et chaque région suivante demande trois niveaux de moins qu'avant.",
          "La régénération de vie est doublée, les dégâts subis sont réduits de 20 %, et les dix premiers niveaux demandent moins d'expérience.",
          "En contrepartie, les monstres et les boss ont deux fois plus de points de vie : les combats sont plus longs, mais plus justes.",
        ],
      },
      en: {
        title: "A more accessible game",
        excerpt: "Berge-Rhak from level 1, doubled regeneration and faster early levels.",
        body: [
          "Estenoise-les-Brumes and Berge-Rhak are open from level 1, and each following region needs three fewer levels than before.",
          "Health regeneration is doubled, damage taken is reduced by 20%, and the first ten levels need less experience.",
          "In return, monsters and bosses have twice as many hit points: fights are longer, but fairer.",
        ],
      },
      es: {
        title: "Un juego más accesible",
        excerpt: "Berge-Rhak desde el nivel 1, regeneración doble y primeros niveles más rápidos.",
        body: [
          "Estenoise-les-Brumes y Berge-Rhak están abiertos desde el nivel 1, y cada región siguiente pide tres niveles menos que antes.",
          "La regeneración de vida se duplica, el daño recibido se reduce un 20 % y los diez primeros niveles requieren menos experiencia.",
          "A cambio, los monstruos y los jefes tienen el doble de puntos de vida: los combates son más largos, pero más justos.",
        ],
      },
    },
  },
];

export function formatDate(date: string, lang: Lang) {
  return new Date(date + "T12:00:00Z").toLocaleDateString(lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
