import fr from "./fr";
import en from "./en";
import es from "./es";

export const langs = ["fr", "en", "es"] as const;
export type Lang = (typeof langs)[number];
export const defaultLang: Lang = "fr";
export const langNames: Record<Lang, string> = { fr: "Français", en: "English", es: "Español" };
export const htmlLang: Record<Lang, string> = { fr: "fr", en: "en", es: "es" };
export const ogLocale: Record<Lang, string> = { fr: "fr_FR", en: "en_US", es: "es_ES" };

const dictionaries = { fr, en, es };
export function getUi(lang: Lang) {
  return dictionaries[lang];
}

// Chemin d'une page dans une langue : localePath("en", "jeu") -> "/en/jeu/"
export function localePath(lang: Lang, page = "") {
  const clean = page.replace(/^\/+|\/+$/g, "");
  return clean ? `/${lang}/${clean}/` : `/${lang}/`;
}

export function langPaths() {
  return langs.map((lang) => ({ params: { lang } }));
}

export const KOFI_URL = "https://ko-fi.com/pixelfe";
export const GAME_URL = "https://jeu.pixelfe.fr";
export const API_URL = "https://jeu.pixelfe.fr";
