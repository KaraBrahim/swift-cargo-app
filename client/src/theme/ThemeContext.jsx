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
  {
    id: 'clair-dore',
    name: 'Clair Doré',
    hint: 'Ivoire et or',
    mode: 'light',
    palette: 'sober',
    swatch: ['#ffffff', '#eceef3', '#d0aa50', '#7f6118'],
  },
  {
    id: 'clair-prisme',
    name: 'Clair Prisme',
    hint: 'Clair et violet',
    mode: 'light',
    palette: 'vivid',
    swatch: ['#ffffff', '#6a45e0', '#2f62c9', '#0f8497'],
  },
  {
    id: 'nuit-doree',
    name: 'Nuit Dorée',
    hint: 'Noir et or',
    mode: 'dark',
    palette: 'sober',
    swatch: ['#07070a', '#1e1f27', '#d8b45f', '#f1da97'],
  },
  {
    id: 'nuit-prisme',
    name: 'Nuit Prisme',
    hint: 'Noir et violet',
    mode: 'dark',
    palette: 'vivid',
    swatch: ['#07070a', '#7c5cf0', '#22b07d', '#ef9c3d'],
  },
];

export const DEFAULT_THEME = 'nuit-doree';

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

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
