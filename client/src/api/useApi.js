import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from './client.js';
import { errorMessage } from '../components/ui.jsx';

// Small GET hook with loading/error/reload. Pass a falsy path to skip.
//
// Two rules that matter once a path contains a search term, because then it
// changes on every keystroke:
//
//   • `loading` is only true when there is nothing on screen yet. A refetch
//     keeps the previous rows visible, so typing filters a list instead of
//     replacing the page with a spinner — which, on a page that returns early
//     on `loading`, also tore the search field out of the DOM and took the
//     cursor with it.
//   • Answers that arrive out of order are dropped. Type "ab" quickly and the
//     reply for "a" can land last; without the sequence check it would win and
//     the list would disagree with the box above it.
export function useApi(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // Counts requests: only the newest one is allowed to write state.
  const seq = useRef(0);
  const shown = useRef(false);
  const base = useRef(null);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    // Keeping what is on screen is right for a query string that narrows the
    // same list, and wrong for a different resource: moving from one passager's
    // file to another must not show the previous one's name while it loads.
    const here = path.split('?')[0];
    if (base.current !== null && base.current !== here) {
      shown.current = false;
      setData(null);
    }
    base.current = here;
    setError(null);
    setLoading(!shown.current);
    setRefreshing(true);
    try {
      const next = await api(path);
      if (mine !== seq.current) return;
      shown.current = true;
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
  }, [reload]);

  return { data, loading, refreshing, error, reload };
}

// A value that settles instead of following every keystroke: the list waits
// until you stop typing (a quarter second) rather than asking the server for
// each letter.
export function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}
