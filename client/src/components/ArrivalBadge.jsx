// Le retard d'un voyage, d'un coup d'œil : rouge tant que le bon est en retard sur
// la date promise, ambre une fois arrivé avec du retard, discret s'il est à l'heure.
// Les jours viennent du serveur (days_overdue, days_late) : on ne les recalcule pas ici.
import { formatDateFr } from '../lib/format.js';

export function ArrivalBadge({ bon }) {
  const overdue = Number(bon.days_overdue) || 0;
  const late = Number(bon.days_late) || 0;
  if (overdue > 0) return <span className="late-badge bad" title="La date promise est dépassée">{overdue} j de retard</span>;
  if (bon.arrival_actual_on && late > 0) return <span className="late-badge warn" title="Arrivé après la date promise">arrivé +{late} j</span>;
  if (bon.arrival_actual_on && bon.arrival_promised_on) return <span className="late-badge ok">à l’heure</span>;
  return null;
}

// La date promise et son badge, pour une cellule de liste.
export function ArrivalCell({ bon }) {
  if (!bon.arrival_promised_on) return <span className="muted">—</span>;
  return (
    <span className="cell-stack">
      <span>{formatDateFr(bon.arrival_promised_on, { year: false })}</span>
      <ArrivalBadge bon={bon} />
    </span>
  );
}
