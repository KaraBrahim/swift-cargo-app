// Theme state. Two orthogonal switches (mode × palette) are exposed to the user
// as four named themes. The choice is written onto <html> as data attributes —
// tokens.css does the rest — and persisted so a desk keeps its look.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'sc_theme';
// The section headings in the sidebar (OPÉRATIONS, RÉPERTOIRE…). Kept here with
// the theme because it is the same kind of setting: how this desk looks, not
// what the business does — so it lives in the browser, not on the server.
const GROUPS_KEY = 'sc_nav_groups';

export const THEMES = [
  { id: 'clair-dore', name: 'Clair Doré', hint: 'Ivoire et or', mode: 'light', palette: 'sober' },
  { id: 'clair-prisme', name: 'Clair Prisme', hint: 'Clair et violet', mode: 'light', palette: 'vivid' },
  { id: 'nuit-doree', name: 'Nuit Dorée', hint: 'Noir et or', mode: 'dark', palette: 'sober' },
  { id: 'nuit-prisme', name: 'Nuit Prisme', hint: 'Noir et violet', mode: 'dark', palette: 'vivid' },
];

// Les quatre couleurs de l'aperçu : le fond, le panneau, l'accent, l'accent
// profond. Ce sont des NOMS de jetons et non des valeurs — c'est tout l'objet
// de ce qui suit.
const SWATCH_TOKENS = ['--bg', '--surface-2', '--brand', '--brand-deep'];

export const DEFAULT_THEME = 'nuit-doree';

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

// Les couleurs réelles d'un thème, lues dans tokens.css.
//
// Elles étaient recopiées à la main ici, et elles avaient dérivé : « Clair
// Doré » annonçait #ffffff pour un fond qui vaut #f4f5f8, « Nuit Dorée »
// annonçait #1e1f27 pour un panneau qui vaut #16171d. L'aperçu montrait donc
// d'autres couleurs que le thème qu'il promettait.
//
// On les demande donc à la feuille de style. Les jetons sont définis sur
// `:root[data-mode][data-palette]`, et un thème qu'on veut montrer n'est pas
// celui qui est actif : on pose ses attributs sur <html>, on lit, on remet
// ceux d'avant. Tout tient dans la même tâche JavaScript, et le navigateur ne
// peint qu'à la fin d'une tâche — l'état intermédiaire n'atteint jamais
// l'écran, donc rien ne clignote.
export function readThemeVars(id, tokens) {
  const t = themeById(id);
  const root = document.documentElement;
  const previous = { mode: root.getAttribute('data-mode'), palette: root.getAttribute('data-palette') };

  root.setAttribute('data-mode', t.mode);
  root.setAttribute('data-palette', t.palette);
  const style = getComputedStyle(root);
  const values = tokens.map((token) => style.getPropertyValue(token).trim());

  for (const [key, value] of Object.entries(previous)) {
    if (value === null) root.removeAttribute(`data-${key}`);
    else root.setAttribute(`data-${key}`, value);
  }
  return values;
}

export const readSwatch = (id) => readThemeVars(id, SWATCH_TOKENS);

// L'aperçu des quatre thèmes, prêt à afficher. Les jetons ne changent pas en
// cours de route : une lecture par montage suffit.
export const readAllSwatches = () =>
  Object.fromEntries(THEMES.map((t) => [t.id, readSwatch(t.id)]));

// Applied both here and by the inline boot script in index.html (which runs
// before first paint, so the app never flashes the wrong theme).
export function applyTheme(id) {
  const t = themeById(id);
  const root = document.documentElement;
  root.setAttribute('data-mode', t.mode);
  root.setAttribute('data-palette', t.palette);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.mode === 'dark' ? '#07070a' : '#f4f5f8');
  return t;
}

const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    try {
      return themeById(localStorage.getItem(STORAGE_KEY)).id;
    } catch {
      return DEFAULT_THEME;
    }
  });

  useEffect(() => {
    applyTheme(themeId);
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      /* private mode — the theme just won't persist */
    }
  }, [themeId]);

  const [navGroups, setNavGroupsState] = useState(() => {
    try {
      return localStorage.getItem(GROUPS_KEY) !== '0';
    } catch {
      return true;
    }
  });

  const setNavGroups = useCallback((on) => {
    setNavGroupsState(on);
    try {
      localStorage.setItem(GROUPS_KEY, on ? '1' : '0');
    } catch {
      /* private mode — the preference just won't persist */
    }
  }, []);

  const setTheme = useCallback((id) => setThemeId(themeById(id).id), []);

  return (
    <ThemeContext.Provider
      value={{ themeId, theme: themeById(themeId), themes: THEMES, setTheme, navGroups, setNavGroups }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
