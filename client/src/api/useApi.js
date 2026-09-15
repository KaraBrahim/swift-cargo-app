import { useState, useEffect, useCallback, useRef } from 'react';
import { api, onMutation, onClearCache } from './client.js';
import { errorMessage } from '../components/ui.jsx';

// ── Le cache ─────────────────────────────────────────────────────────
// Le serveur est loin (en ligne) : chaque page qui attendait sa réponse avant
// d'afficher quoi que ce soit paraissait lente. On garde la dernière réponse de
// chaque adresse et on l'affiche TOUT DE SUITE, puis on redemande au serveur en
// arrière-plan et on remplace. La page est là en un instant, et juste une
// seconde plus tard.
//
// Toute écriture (POST/PUT/PATCH/DELETE, voir client.js) fait redemander leurs
// données à toutes les pages ouvertes : ce que vous venez de changer n'est
// jamais affiché depuis une copie d'avant.
//
// Le cache survit au rechargement de l'application (localStorage, borné) —
// c'est ce qui rend la réouverture instantanée aussi.
const CACHE_KEY = 'sc_cache_v1';
const MAX_ENTRIES = 150;
const memory = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'))) memory.set(k, v);
} catch { /* rien en cache */ }

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch { /* quota ou mode privé : on garde seulement la mémoire */ }
  }, 300);
}
const remember = (path, data) => { memory.delete(path); memory.set(path, data); persist(); };
function clearApiCache() { memory.clear(); try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } }
onClearCache(clearApiCache);

// Les hooks montés, pour les rafraîchir après une écriture.
const live = new Set();
onMutation(() => { for (const reload of live) reload(); });

// Small GET hook with loading/error/reload. Pass a falsy path to skip.
//
//   • `loading` is only true when there is nothing on screen yet — ni cache ni
//     réponse précédente. A refetch keeps the previous rows visible.
//   • Answers that arrive out of order are dropped: the newest request wins.
export function useApi(path) {
  const [data, setData] = useState(() => (path && memory.has(path) ? memory.get(path) : null));
  const [loading, setLoading] = useState(Boolean(path) && !memory.has(path));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const shown = useRef(Boolean(path) && memory.has(path));
  const base = useRef(null);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    const here = path.split('?')[0];
    if (base.current !== null && base.current !== here) {
      // Autre ressource : servir son cache si on l'a, sinon repartir de zéro.
      if (memory.has(path)) { setData(memory.get(path)); shown.current = true; }
      else { shown.current = false; setData(null); }
    } else if (memory.has(path) && !shown.current) {
      setData(memory.get(path)); shown.current = true;
    }
    base.current = here;
    setError(null);
    setLoading(!shown.current);
    setRefreshing(true);
    try {
      const next = await api(path);
      if (mine !== seq.current) return;
      shown.current = true;
      remember(path, next);
      setData(next);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorMessage(e));
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [path]);

  useEffect(() => {
    reload();
    live.add(reload);
    return () => { live.delete(reload); };
  }, [reload]);

  return { data, loading, refreshing, error, reload };
}

// A value that settles instead of following every keystroke.
export function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}
