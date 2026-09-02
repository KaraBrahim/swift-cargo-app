// ⌘K / Ctrl-K search overlay. Debounced, keyboard-navigable, and backed by the
// real /search fan-out.
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { IconEl } from './icons.jsx';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
export const SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';

export function CommandPalette({ open, onClose }) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);

  // Flatten for keyboard navigation.
  const flat = useMemo(
    () => groups.flatMap((g) => g.results.map((r) => ({ ...r, group: g.label }))),
    [groups]
  );

  useEffect(() => {
    if (open) {
      setQ('');
      setGroups([]);
      setCursor(0);
      // Autofocus after the overlay paints.
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api(`/search?q=${encodeURIComponent(term)}`);
        if (!cancelled) {
          setGroups(res.groups ?? []);
          setCursor(0);
        }
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(flat.length - 1, 0)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && flat[cursor]) {
        e.preventDefault();
        navigate(flat[cursor].href);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, flat, cursor, navigate, onClose]);

  if (!open) return null;

  let index = -1;
  return (
    <div className="cmd-backdrop" onMouseDown={onClose}>
      <div className="cmd" role="dialog" aria-label="Recherche" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input">
          <IconEl name="search" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un bon, un passager, un fournisseur, un article…"
          />
          <kbd>Échap</kbd>
        </div>

        <div className="cmd-results">
          {q.trim().length < 2 && <div className="cmd-hint">Tapez au moins deux caractères.</div>}
          {q.trim().length >= 2 && loading && <div className="cmd-hint">Recherche…</div>}
          {q.trim().length >= 2 && !loading && !flat.length && (
            <div className="cmd-hint">Aucun résultat pour « {q.trim()} ».</div>
          )}

          {groups.map((g) => (
            <div key={g.key} className="cmd-group">
              <div className="cmd-group-label">{g.label}</div>
              {g.results.map((r) => {
                index += 1;
                const active = index === cursor;
                const at = index;
                return (
                  <button
                    key={`${g.key}-${r.id}`}
                    className={`cmd-row ${active ? 'active' : ''}`}
                    onMouseEnter={() => setCursor(at)}
                    onClick={() => {
                      navigate(r.href);
                      onClose();
                    }}
                  >
                    <span className="cmd-ico"><IconEl name={g.icon} /></span>
                    <span className="cmd-title">{r.title}</span>
                    {r.sub && <span className="cmd-sub">{r.sub}</span>}
                    <IconEl name="chevronRight" className="cmd-go" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
