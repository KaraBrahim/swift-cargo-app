// Un champ de texte LIBRE qui propose des suggestions — la wilaya, l'aéroport, la
// compagnie.
//
// Il remplace le <datalist> du navigateur : sa liste est dessinée par le système, en
// blanc sur gris, sans rapport avec le thème, qui s'ouvre où elle veut, déborde de la
// fenêtre et ne se filtre pas comme on s'y attend. Ici la liste suit le thème, se
// filtre à la frappe (sans tenir compte des accents), se parcourt au clavier
// (↑ ↓ Entrée Échap), s'ouvre vers le haut quand le bas manque de place, et le texte
// tapé reste valable même s'il n'est dans aucune suggestion.
//
//   options : ['Oran', …] ou [{ value: 'Oran', hint: '31' }, …]
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconEl } from './icons.jsx';
import { useDismiss } from './SettingsMenu.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';

// Sans accents ni majuscules : « bejaia » trouve Béjaïa.
const plain = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const asOption = (o) => (typeof o === 'string' ? { value: o } : o);

export function ComboInput({ value, onChange, options = [], placeholder, maxShown = 40, invalid = false, ...rest }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // la liste ne se filtre qu'une fois qu'on a tapé
  const [cursor, setCursor] = useState(0);
  const [drop, setDrop] = useState('down');
  const close = () => { setOpen(false); setTyped(false); };
  const ref = useDismiss(open, close);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const all = useMemo(() => options.map(asOption), [options]);
  const query = typed ? String(value ?? '') : '';
  const shown = useMemo(() => {
    const q = plain(query.trim());
    if (!q) return all.slice(0, maxShown);
    // D'abord les noms qui COMMENCENT par le texte, puis ceux qui le CONTIENNENT :
    // « ora » doit donner Oran, pas Ouargla. Le flou n'intervient qu'en dernier
    // recours (une faute de frappe, un mot oublié), quand rien ne contient le texte.
    const starts = all.filter((o) => plain(o.value).startsWith(q));
    const has = all.filter((o) => !starts.includes(o) && plain(o.value).includes(q));
    if (starts.length || has.length) return [...starts, ...has].slice(0, maxShown);
    return fuzzyRank(query, all, (o) => o.value, maxShown);
  }, [all, query, maxShown]);

  useEffect(() => { setCursor(0); }, [query, open]);
  // Le choix surligné reste visible quand on parcourt une longue liste au clavier.
  useEffect(() => {
    listRef.current?.querySelector('.cb-opt.cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const show = () => {
    if (open) return;
    const r = ref.current?.getBoundingClientRect();
    const below = r ? window.innerHeight - r.bottom : 999;
    setDrop(below < 260 && r && r.top > below ? 'up' : 'down');
    setOpen(true);
  };
  const choose = (o) => { onChange(o.value); close(); inputRef.current?.focus(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) show(); else setCursor((c) => Math.min(c + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && open && shown[cursor]) {
      // Entrée choisit la suggestion surlignée — et ne soumet pas le formulaire.
      e.preventDefault();
      choose(shown[cursor]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className={`cb${open ? ' open' : ''}`} ref={ref}>
      <input
        ref={inputRef}
        className={invalid ? 'input-error' : undefined}
        value={value || ''}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={show}
        onClick={show}
        onChange={(e) => { setTyped(true); show(); onChange(e.target.value); }}
        onKeyDown={onKeyDown}
        {...rest}
      />
      <button type="button" className="cb-chev" tabIndex={-1} aria-label={open ? 'Fermer la liste' : 'Ouvrir la liste'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { if (open) close(); else { show(); inputRef.current?.focus(); } }}>
        <IconEl name="chevronDown" />
      </button>

      {open && (
        <div className={`cb-pop${drop === 'up' ? ' flip' : ''}`} id={listId} role="listbox" ref={listRef}>
          {shown.map((o, i) => {
            const picked = o.value.toLowerCase() === String(value ?? '').trim().toLowerCase();
            return (
              <button
                type="button" key={o.value} role="option" aria-selected={picked}
                className={`cb-opt${i === cursor ? ' cursor' : ''}${picked ? ' picked' : ''}`}
                // mousedown + preventDefault : le champ garde le focus, sinon la liste se fermerait avant le clic.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o)}
              >
                <span className="cb-val">{o.value}</span>
                {o.hint && <span className="cb-hint">{o.hint}</span>}
                {picked && <IconEl name="check" className="cb-tick" />}
              </button>
            );
          })}
          {!shown.length && (
            <p className="cb-empty">
              {String(value ?? '').trim() ? <>Aucune suggestion : « {String(value).trim()} » sera utilisé tel quel.</> : 'Aucune suggestion.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
