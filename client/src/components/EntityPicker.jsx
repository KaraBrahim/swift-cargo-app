// Choisir quelqu'un — ou quelque chose — en le cherchant.
//
// Remplace les <select> partout où la liste porte des noms : un menu déroulant
// natif ne se cherche pas, n'affiche qu'une ligne de texte nu, et oblige à
// reconnaître un nom au milieu de trente. Ici on tape trois lettres, on voit une
// pastille d'initiales, le nom, le téléphone et le rôle, et on clique.
//
// Le composant ne connaît rien du métier : on lui donne des options et des
// fonctions pour en tirer un libellé, un sous-titre et des étiquettes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconEl, initialsOf } from './icons.jsx';
import { useDismiss } from './SettingsMenu.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';

const idOf = (o) => String(o.id);

export function EntityPicker({
  value,
  onChange,
  options = [],
  loading = false,
  icon = 'users',
  placeholder = 'Choisir…',
  searchPlaceholder = 'Taper pour chercher…',
  labelOf = (o) => o.name,
  subOf = () => null,
  tagsOf = () => [],
  keyOf = idOf,
  searchOf = null,
  clearable = true,
  disabled = false,
  size = '',              // '' | 'lg'
  emptyText = 'Aucun résultat.',
  onCreate = null,        // (query) => void — proposé quand rien ne correspond
  createLabel = 'Créer',
  invalid = false,
}) {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState('down');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const ref = useDismiss(open, () => setOpen(false));
  const inputRef = useRef(null);

  // La liste s'ouvre vers le haut quand le bas de la fenetre est trop proche :
  // en bas d'une page, une liste qui descend est une liste qu'on ne voit pas.
  const toggle = () => {
    if (disabled) return;
    if (!open) {
      const r = ref.current?.getBoundingClientRect();
      const below = r ? window.innerHeight - r.bottom : 999;
      setDrop(below < 260 && r && r.top > below ? 'up' : 'down');
    }
    setOpen((v) => !v);
  };

  const selected = useMemo(
    () => options.find((o) => keyOf(o) === String(value ?? '')) || null,
    [options, value, keyOf]
  );

  const key = searchOf || ((o) => `${labelOf(o)} ${subOf(o) || ''}`);
  const matches = useMemo(() => fuzzyRank(query, options, key, 50), [query, options, key]);
  const canCreate = Boolean(onCreate) && query.trim().length >= 2;
  const rows = matches.length + (canCreate ? 1 : 0);

  useEffect(() => { setCursor(0); }, [query, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const choose = (o) => { onChange(keyOf(o)); setOpen(false); setQuery(''); };
  const clear = (e) => { e.stopPropagation(); onChange(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursor < matches.length) choose(matches[cursor]);
      else if (canCreate) { onCreate(query.trim()); setOpen(false); }
    }
  };

  return (
    <div className={`ep${size === 'lg' ? ' ep-lg' : ''}${open ? ' up' : ''}`} ref={ref}>
      <button
        type="button"
        className={`ep-trigger${open ? ' open' : ''}${selected ? ' has' : ''}${invalid ? ' invalid' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ep-badge">
          {selected ? initialsOf(labelOf(selected)) : <IconEl name={icon} />}
        </span>
        <span className="ep-text">
          <span className="ep-label">{selected ? labelOf(selected) : placeholder}</span>
          {selected && subOf(selected) && <span className="ep-sub">{subOf(selected)}</span>}
        </span>
        {selected && tagsOf(selected).map((t) => <span key={t} className="ep-tag">{t}</span>)}
        {selected && clearable && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            className="ep-clear"
            aria-label="Effacer le choix"
            onClick={clear}
          >
            <IconEl name="close" />
          </span>
        )}
        <IconEl name="chevronDown" className="ep-chev" />
      </button>

      {open && (
        <div className={drop === 'up' ? 'ep-pop flip' : 'ep-pop'} role="dialog">
          <div className="ep-search">
            <IconEl name="search" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
            />
            {query && (
              <button type="button" className="ep-x" onClick={() => setQuery('')} aria-label="Effacer">
                <IconEl name="close" />
              </button>
            )}
          </div>

          <div className="ep-list" role="listbox">
            {loading && <p className="ep-empty">Chargement…</p>}
            {!loading && !matches.length && !canCreate && <p className="ep-empty">{emptyText}</p>}

            {matches.map((o, i) => {
              const k = keyOf(o);
              const sub = subOf(o);
              const picked = k === String(value ?? '');
              return (
                <button
                  type="button"
                  key={k}
                  role="option"
                  aria-selected={picked}
                  className={`ep-opt${i === cursor ? ' cursor' : ''}${picked ? ' picked' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(o)}
                >
                  <span className="ep-badge">{initialsOf(labelOf(o))}</span>
                  <span className="ep-text">
                    <span className="ep-label">{labelOf(o)}</span>
                    {sub && <span className="ep-sub">{sub}</span>}
                  </span>
                  {tagsOf(o).map((t) => <span key={t} className="ep-tag">{t}</span>)}
                  {picked && <IconEl name="check" className="ep-tick" />}
                </button>
              );
            })}

            {canCreate && (
              <button
                type="button"
                className={`ep-opt ep-new${cursor === matches.length ? ' cursor' : ''}`}
                onMouseEnter={() => setCursor(matches.length)}
                onClick={() => { onCreate(query.trim()); setOpen(false); }}
              >
                <span className="ep-badge"><IconEl name="plus" /></span>
                <span className="ep-text"><span className="ep-label">{createLabel} « {query.trim()} »</span></span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Un choix court — devise, mesure, type — se montre en entier : trois pastilles
// valent mieux qu'un menu qu'il faut ouvrir pour savoir ce qu'il contient.
export function OptionChips({ value, onChange, options, ariaLabel }) {
  return (
    <div className="opt-chips" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={String(o.value) === String(value)}
          className={String(o.value) === String(value) ? 'opt-chip on' : 'opt-chip'}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <IconEl name={o.icon} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// Les quelques personnes qu'on choisit le plus souvent, en accès direct : un
// clic au lieu d'une recherche, pour le cas courant.
export function QuickPeople({ people = [], value, onChange, max = 6, icon = 'users' }) {
  const shown = people.slice(0, max);
  if (!shown.length) return null;
  return (
    <div className="qp">
      {shown.map((p) => {
        const on = String(p.id) === String(value);
        return (
          <button
            type="button"
            key={p.id}
            className={on ? 'qp-card on' : 'qp-card'}
            onClick={() => onChange(String(p.id))}
          >
            <span className="qp-badge">{initialsOf(p.name)}</span>
            <span className="qp-name">{p.name}</span>
            <IconEl name={on ? 'check' : icon} className="qp-ico" />
          </button>
        );
      })}
    </div>
  );
}
