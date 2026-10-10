// Le journal : ce qui est arrivé, dans l'ordre. Le même composant sert au bon
// fournisseur (une section par ligne de marchandise, avec l'état APRÈS chaque
// événement) et au bon passager (une seule frise, son voyage).
import { useMemo } from 'react';
import { IconEl } from './icons.jsx';
import { describeEvent, describeBonEvent, dayOf, timeOf } from '../lib/journalText.js';
import { formatDateFr, formatQty } from '../lib/format.js';

const AFTER = [
  ['china', 'En Chine', 'muted'], ['transit', 'En route', 'gold'], ['office', 'À Alger', 'blue'],
  ['delivered', 'Remis', 'green'], ['missing', 'Manquant', 'red'],
];

function Event({ e, describe, withAfter }) {
  const d = describe(e);
  return (
    <li className={`jr-event jr-${d.tone}`}>
      <span className="jr-dot"><IconEl name={d.icon} /></span>
      <div className="jr-body">
        <div className="jr-when">
          {dayOf(e) ? formatDateFr(dayOf(e)) : '—'}
          <span className="muted"> · {timeOf(e)}</span>
        </div>
        <div className="jr-title">{d.title}</div>
        {d.detail && <div className="jr-detail muted">{d.detail}</div>}
        {withAfter && e.after && (
          <div className="jr-after" aria-label="État après cet événement">
            {AFTER.filter(([key]) => Number(e.after[key]) > 0 || key === 'china' || key === 'office').map(([key, label, tone]) => (
              <span key={key} className={`jr-chip jr-chip-${tone}`}>{label} <strong>{formatQty(e.after[key])}</strong></span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// events : le journal de l'API · mode : 'order' (par ligne) ou 'bon' (frise unique)
export function Journal({ events = [], mode = 'order' }) {
  const groups = useMemo(() => {
    if (mode !== 'order') return [];
    const by = new Map();
    for (const e of events) {
      if (!by.has(e.line_id)) by.set(e.line_id, { id: e.line_id, designation: e.designation, unit: e.unit, events: [] });
      by.get(e.line_id).events.push(e);
    }
    return [...by.values()];
  }, [events, mode]);

  if (!events.length) return <p className="muted">Rien à raconter pour l’instant.</p>;

  if (mode === 'bon') {
    return <ol className="jr">{events.map((e, i) => <Event key={i} e={e} describe={describeBonEvent} />)}</ol>;
  }
  return (
    <div className="jr-lines">
      {groups.map((g, i) => (
        <details key={g.id} className="jr-line" open={groups.length === 1 || i === 0}>
          <summary>
            <strong>{g.designation}</strong>
            <span className="muted">{g.events.length} événement{g.events.length > 1 ? 's' : ''}</span>
          </summary>
          <ol className="jr">{g.events.map((e, k) => <Event key={k} e={e} describe={describeEvent} withAfter />)}</ol>
        </details>
      ))}
    </div>
  );
}
