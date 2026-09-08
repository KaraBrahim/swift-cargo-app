// Ce qu'on met dans une cellule de tableau quand la donnée est une personne ou
// une liste de personnes. Une pastille d'initiales et un nom se reconnaissent
// plus vite qu'une ligne de texte, et « +2 » garde la ligne courte là où trois
// noms la feraient déborder.
import { IconEl, initialsOf } from './icons.jsx';

export function Who({ name, icon }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span className="cell-who">
      <span className="avatar avatar-xs">{initialsOf(name)}</span>
      <span>{name}</span>
      <IconEl name={icon} className="cell-who-ico" />
    </span>
  );
}

// « Ali, Karim, Sofiane » devient deux étiquettes et un « +1 » qui porte la
// liste complète en infobulle.
export function Sources({ names, max = 2 }) {
  const list = String(names || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return <span className="muted">—</span>;
  const head = list.slice(0, max);
  return (
    <span className="cell-tags">
      {head.map((n) => <span key={n} className="mini-tag">{n}</span>)}
      {list.length > head.length && (
        <span className="mini-tag more" title={list.join(', ')}>+{list.length - head.length}</span>
      )}
    </span>
  );
}
