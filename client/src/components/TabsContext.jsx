import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pathMeta, normalizePath } from '../lib/pathMeta.js';

// Des onglets, comme ceux d'un navigateur.
//
// Un onglet = une page ouverte ET son travail en cours. Toutes les pages
// ouvertes restent montées ; seule celle de l'onglet actif est affichée. C'est
// ce qui permet de remplir un bon, d'aller vérifier un stock dans un autre
// onglet, puis de revenir sur le formulaire tel qu'on l'a laissé — la moitié
// d'un bon saisi ne se perd pas parce qu'on a eu besoin de regarder ailleurs.
//
// L'adresse du navigateur est celle de l'onglet ACTIF : suivre un lien change
// la page de l'onglet où l'on se trouve, exactement comme dans un navigateur.
//
// Chaque onglet a sa propre histoire, donc les flèches ← → reculent dans
// l'onglet où l'on est et pas dans celui d'à côté.

// Dix, parce qu'au-delà on ne retrouve plus un onglet à sa forme et qu'il
// faudrait les faire défiler pour les lire.
export const MAX_TABS = 10;
// Vingt pas en arrière par onglet : personne ne remonte plus loin, et garder
// tout ne ferait qu'allonger une liste que personne ne lit.
const HISTORY_LIMIT = 20;
// sessionStorage et non localStorage : les onglets survivent à un F5 — on ne
// perd pas six pages ouvertes pour avoir rechargé — mais pas à la fermeture de
// la fenêtre. Ce qu'on faisait hier ne regarde pas la session d'aujourd'hui.
const STORE_KEY = 'sc_tabs';

const TabsContext = createContext(null);
// Quel onglet contient la page qui pose la question. Chaque volet fournit le
// sien, ce qui permet a deux onglets ouverts sur la meme adresse de porter des
// titres differents — deux bons passagers ne sont pas le meme bon.
const TabPaneContext = createContext(null);
export const TabPaneProvider = TabPaneContext.Provider;

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs() hors de <TabsProvider>');
  return ctx;
}

let seq = 0;
const newId = () => `t${Date.now().toString(36)}-${(seq++).toString(36)}`;

function makeTab(rawPath) {
  const path = normalizePath(rawPath);
  const { title, icon } = pathMeta(path);
  return { id: newId(), path, title, icon, history: [path], hIndex: 0 };
}

// Ce qui est relu au chargement. L'adresse affichée par le navigateur gagne
// toujours : c'est celle que la personne voit dans sa barre d'adresse.
function restore(currentPath) {
  const fresh = { tabs: [makeTab(currentPath)], activeId: null };
  fresh.activeId = fresh.tabs[0].id;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (!saved?.tabs?.length) return fresh;
    const tabs = saved.tabs.slice(0, MAX_TABS).map((t) => ({ ...makeTab(t.path), title: t.title || undefined }))
      .map((t, i) => ({ ...t, title: saved.tabs[i].title || t.title }));
    const wanted = normalizePath(currentPath);
    const onWanted = tabs.find((t) => t.path === wanted);
    if (onWanted) return { tabs, activeId: onWanted.id };
    // Rechargée sur une adresse qu'aucun onglet ne tenait : elle devient
    // l'onglet actif plutôt que de disparaître sous les onglets restaurés.
    if (tabs.length >= MAX_TABS) tabs.pop();
    const extra = makeTab(wanted);
    return { tabs: [...tabs, extra], activeId: extra.id };
  } catch {
    return fresh;
  }
}

export function TabsProvider({ children, onRefused }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(() => restore(location.pathname));
  const stateRef = useRef(state);
  stateRef.current = state;
  // Où en était chaque onglet dans sa page. Sans cela, revenir sur un onglet
  // remet la fenêtre là où on avait laissé l'AUTRE : une fiche courte affichée
  // à 500 pixels de haut, c'est-à-dire un écran vide.
  const scrollY = useRef({});

  // Naviguer (un lien du menu, une ligne de tableau) change la page de l'onglet
  // actif et pousse un pas dans SON histoire.
  useEffect(() => {
    const path = normalizePath(location.pathname);
    const s = stateRef.current;
    const active = s.tabs.find((t) => t.id === s.activeId);
    // Rien à faire quand l'adresse est déjà celle de l'onglet actif : c'est le
    // cas quand on vient de changer d'onglet, et il ne faut alors surtout pas
    // remonter la page — l'onglet doit retrouver l'endroit où on l'a laissé.
    if (!active || active.path === path) return;
    const meta = pathMeta(path);
    const cut = active.history.slice(0, active.hIndex + 1);
    const history = [...cut, path].slice(-HISTORY_LIMIT);
    const next = { ...active, path, ...meta, history, hIndex: history.length - 1 };
    setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === active.id ? next : t)) }));
    // Nouvelle page dans cet onglet : on la lit depuis le début.
    scrollY.current[active.id] = 0;
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Retrouver un onglet, c'est le retrouver où on l'a laissé. En layout effect :
  // le navigateur ne doit pas peindre la page au mauvais endroit avant de la
  // replacer.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollY.current[state.activeId] ?? 0);
  }, [state.activeId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({
        activeId: state.activeId,
        tabs: state.tabs.map((t) => ({ path: t.path, title: t.title })),
      }));
    } catch { /* navigation privée, quota : les onglets vivent alors le temps de la page */ }
  }, [state]);

  const activate = useCallback((id) => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === id);
    if (!t || id === s.activeId) return;
    scrollY.current[s.activeId] = window.scrollY;
    setState((prev) => ({ ...prev, activeId: id }));
    navigate(t.path);
  }, [navigate]);

  // `background: true` ouvre sans quitter la page courante (ctrl+clic).
  //
  // Un nouvel onglet est toujours créé, même si la page est déjà ouverte
  // ailleurs : c'est ce que fait un navigateur, et c'est utile — deux fois la
  // même liste filtrée différemment, ou deux fiches côte à côte. Sans cela le
  // bouton « + » ne ferait rien quand on est déjà sur le tableau de bord.
  const open = useCallback((rawPath, { background = false } = {}) => {
    const path = normalizePath(rawPath);
    const s = stateRef.current;
    if (s.tabs.length >= MAX_TABS) {
      onRefused?.(`Maximum ${MAX_TABS} onglets. Fermez-en un pour en ouvrir un autre.`);
      return null;
    }
    const tab = makeTab(path);
    if (!background) scrollY.current[s.activeId] = window.scrollY;
    setState((prev) => ({ tabs: [...prev.tabs, tab], activeId: background ? prev.activeId : tab.id }));
    if (!background) navigate(tab.path);
    return tab.id;
  }, [navigate, onRefused]);

  const close = useCallback((id) => {
    const s = stateRef.current;
    const i = s.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    // Fermer le dernier ne laisse pas l'application sans page : il repart au
    // tableau de bord, comme un navigateur qui garde un onglet vide.
    if (s.tabs.length === 1) {
      const tab = makeTab('/');
      setState({ tabs: [tab], activeId: tab.id });
      navigate('/');
      return;
    }
    const rest = s.tabs.filter((t) => t.id !== id);
    if (id !== s.activeId) {
      setState((prev) => ({ ...prev, tabs: prev.tabs.filter((t) => t.id !== id) }));
      return;
    }
    // Celui de droite prend la place, sinon celui de gauche — le geste habituel.
    const neighbour = rest[Math.min(i, rest.length - 1)];
    setState({ tabs: rest, activeId: neighbour.id });
    navigate(neighbour.path);
  }, [navigate]);

  // Une fiche connaît son nom mieux que son adresse : « BP-HUB-00003 » plutôt
  // que « Bons passagers · fiche ». Voir useTabTitle().
  const setTitle = useCallback((id, title) => {
    if (!id || !title) return;
    setState((s) => {
      const target = s.tabs.find((t) => t.id === id);
      if (!target || target.title === title) return s;
      return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) };
    });
  }, []);

  // Les flèches ← → : elles reculent dans l'histoire de l'onglet actif.
  const go = useCallback((delta) => {
    const s = stateRef.current;
    const active = s.tabs.find((t) => t.id === s.activeId);
    if (!active) return;
    const i = active.hIndex + delta;
    const path = active.history[i];
    if (path == null) return;
    const meta = pathMeta(path);
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === active.id ? { ...t, path, ...meta, hIndex: i } : t)),
    }));
    scrollY.current[active.id] = 0;
    window.scrollTo(0, 0);
    navigate(path);
  }, [navigate]);

  const value = useMemo(() => {
    const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
    return {
      tabs: state.tabs,
      activeId: state.activeId,
      active,
      canGoBack: Boolean(active && active.history[active.hIndex - 1]),
      canGoForward: Boolean(active && active.history[active.hIndex + 1]),
      backPath: active?.history[active.hIndex - 1] ?? null,
      forwardPath: active?.history[active.hIndex + 1] ?? null,
      full: state.tabs.length >= MAX_TABS,
      open, close, activate, setTitle, go,
    };
  }, [state, open, close, activate, setTitle, go]);

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

// Une page qui sait de quoi elle parle donne son nom à son onglet.
export function useTabTitle(title) {
  const id = useContext(TabPaneContext);
  const { setTitle } = useTabs();
  useEffect(() => { setTitle(id, title); }, [id, title, setTitle]);
}
