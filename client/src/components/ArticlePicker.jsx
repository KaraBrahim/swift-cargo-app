// Designation field with intelligent article autocomplete. Typing fuzzy-ranks the
// stock catalogue (VS Code-style subsequence); picking a match reuses that article,
// and if nothing matches you can create a new one — which is added to the line and
// to the catalogue (reusable next time). Category is optional at creation.
import { useState, useMemo, useRef, useEffect } from 'react';
import { IconEl } from './icons.jsx';
import { useDismiss } from './SettingsMenu.jsx';
import { fuzzyRank, hasExact } from '../lib/fuzzy.js';

export function ArticlePicker({ line, items = [], categories = [], onPatch, autoFocus = false, allowCreate = true }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useDismiss(open, () => setOpen(false));
  const inputRef = useRef(null);

  const query = line.designation || '';
  const matches = useMemo(() => fuzzyRank(query, items, (i) => i.name, 6), [query, items]);
  const canCreate = allowCreate && query.trim().length >= 1 && !hasExact(query, items, (i) => i.name);
  const rows = canCreate ? matches.length + 1 : matches.length; // +1 for the "create" row

  useEffect(() => { setCursor(0); }, [query]);

  const pick = (it) => {
    onPatch({ designation: it.name, itemId: it.id, createItem: false, categoryId: '' });
    setOpen(false);
  };
  const create = () => {
    onPatch({ createItem: true, itemId: null });
    setOpen(false);
  };
  const onType = (v) => {
    onPatch({ designation: v, itemId: null, createItem: false });
    setOpen(true);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor < matches.length) pick(matches[cursor]);
      else if (canCreate) create();
    }
  };

  return (
    <div className="article-field" ref={ref}>
      <div className="article-input">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          placeholder="Article / désignation…"
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {line.itemId && <span className="article-tag" title="Article existant réutilisé"><IconEl name="check" /></span>}
        {line.createItem && !line.itemId && <span className="article-tag new" title="Nouvel article">+</span>}
      </div>

      {open && (matches.length > 0 || canCreate) && (
        <div className="article-menu" role="listbox">
          {matches.map((it, i) => (
            <button
              type="button"
              key={it.id}
              className={`article-opt ${i === cursor ? 'active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(it)}
            >
              <span className="article-opt-name">{it.name}</span>
              {it.category_name && <span className="article-opt-cat">{it.category_name}</span>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className={`article-opt article-create ${cursor === matches.length ? 'active' : ''}`}
              onMouseEnter={() => setCursor(matches.length)}
              onClick={create}
            >
              <IconEl name="plus" />
              <span>Créer l’article «&nbsp;{query.trim()}&nbsp;»</span>
            </button>
          )}
        </div>
      )}

      {/* Optional category when creating a brand-new article. */}
      {line.createItem && !line.itemId && (
        <select
          className="article-cat"
          value={line.categoryId || ''}
          onChange={(e) => onPatch({ categoryId: e.target.value })}
          title="Catégorie (optionnel)"
        >
          <option value="">Catégorie (optionnel)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  );
}
