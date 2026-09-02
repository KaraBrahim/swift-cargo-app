// The font choice. Deliberately not a React context: unlike the theme it has
// no derived state and is read by exactly two screens, so a tiny module with a
// subscribe() is lighter than another provider around the whole app.
//
// The families themselves live in fonts.css — this file only names them. The
// list is one family per category (géométrique, technique, sérif, arrondie,
// étroite) so the options actually look different from one another.
// `short` is what the gear popover shows: its cards are half the width of the
// settings page's, and an ellipsised font name is a useless font name.

const STORAGE_KEY = 'sc_font';

export const FONTS = [
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    short: 'Jakarta Sans',
    hint: 'Géométrique',
    note: 'Moderne, le choix par défaut',
  },
  {
    id: 'grotesk',
    name: 'Space Grotesk',
    short: 'Space Grotesk',
    hint: 'Technique',
    note: 'Lettres anguleuses, marquées',
  },
  {
    id: 'bitter',
    name: 'Bitter',
    short: 'Bitter',
    hint: 'Sérif',
    note: "À empattements, allure d'imprimé",
  },
  {
    id: 'nunito',
    name: 'Nunito',
    short: 'Nunito',
    hint: 'Arrondie',
    note: 'Angles adoucis, ton chaleureux',
  },
  {
    id: 'barlow',
    name: 'Barlow Semi Condensed',
    short: 'Barlow étroite',
    hint: 'Étroite',
    note: 'Plus de texte par ligne',
  },
  {
    id: 'inter',
    name: 'Inter · Sora',
    short: 'Inter · Sora',
    hint: "Le duo d'origine",
    note: 'Aspect précédent de Swift Cargo',
  },
  {
    id: 'systeme',
    name: 'Système',
    short: 'Système',
    hint: 'Police du poste',
    note: 'Aucun téléchargement, marche hors ligne',
  },
];

export const DEFAULT_FONT = 'jakarta';

export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS.find((f) => f.id === DEFAULT_FONT);

// Mirrored by the boot script in index.html, which runs before first paint so
// the app never flashes the wrong family.
export function applyFont(id) {
  const f = fontById(id);
  document.documentElement.setAttribute('data-font', f.id);
  return f;
}

export function readFont() {
  try {
    return fontById(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_FONT;
  }
}

const listeners = new Set();

export function setFont(id) {
  const f = applyFont(id);
  try {
    localStorage.setItem(STORAGE_KEY, f.id);
  } catch {
    /* private mode — the choice just won't persist */
  }
  listeners.forEach((fn) => fn(f.id));
  return f.id;
}

export function subscribeFont(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
