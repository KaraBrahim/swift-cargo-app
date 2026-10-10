// « Faut-il être au bureau ce jour-là ? » — la carte du tableau de bord.
//
// Aujourd'hui et demain, en trois chiffres : combien de passagers atterrissent
// (et viendront déposer ou retirer des marchandises), combien de fournisseurs
// passent prendre la leur, combien de départs. Les retards sur la date promise
// sont dits en rouge. Un clic ouvre l'agenda complet, ou la pièce concernée.
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { IconEl } from './icons.jsx';
import { formatDateFr, todayIso } from '../lib/format.js';

const MAX = 4;

function Day({ title, day, today, go }) {
  const { arrivals, pickups, departures, items } = day;
  const rows = [
    ...items.arrivals.map((r) => ({ key: `a${r.id}`, label: r.passager_name || r.reference, sub: r.airport || 'arrivée', to: `/bons-passager/${r.id}` })),
    ...items.pickups.map((r) => ({ key: `p${r.id}`, label: r.fournisseur_name, sub: 'retrait', to: `/bons-fournisseur/${r.id}` })),
  ];
  return (
    <div className={`presence-day ${today ? 'is-today' : ''}`}>
      <div className="presence-head">
        <h3>{title}</h3>
        <span className="muted">{formatDateFr(day.date, { year: false })}</span>
      </div>
      <div className="presence-nums">
        <div className="presence-num arr"><strong>{arrivals}</strong><span>{arrivals > 1 ? 'arrivées' : 'arrivée'}</span></div>
        <div className="presence-num pick"><strong>{pickups}</strong><span>{pickups > 1 ? 'retraits' : 'retrait'}</span></div>
        <div className="presence-num"><strong>{departures}</strong><span>{departures > 1 ? 'départs' : 'départ'}</span></div>
      </div>
      {rows.length === 0
        ? <p className="muted presence-list">Personne n’est attendu.</p>
        : (
          <div className="presence-list">
            {rows.slice(0, MAX).map((r) => (
              <button key={r.key} type="button" onClick={() => go(r.to)}><span>{r.label}</span><span className="muted">{r.sub}</span></button>
            ))}
            {rows.length > MAX && <span className="muted">+ {rows.length - MAX} autre(s)</span>}
          </div>
        )}
    </div>
  );
}

export function PresenceCard() {
  const navigate = useNavigate();
  const { data } = useApi(`/agenda/summary?today=${todayIso()}`);
  if (!data) return null;
  const late = data.overdue ?? [];
  return (
    <div className="panel presence-panel">
      <div className="panel-head">
        <h2 className="panel-title"><IconEl name="calendar" /> Présence au bureau</h2>
        <Link to="/agenda" className="back-link">Ouvrir l’agenda</Link>
      </div>
      <div className="presence-grid">
        <Day title="Aujourd’hui" day={data.today} today go={navigate} />
        <Day title="Demain" day={data.tomorrow} go={navigate} />
      </div>
      {late.length > 0 && (
        <div className="presence-list presence-late" style={{ marginTop: 10 }}>
          <strong><IconEl name="alert" /> {late.length} passager(s) en retard sur la date promise</strong>
          {late.slice(0, 3).map((r) => (
            <button key={r.id} type="button" onClick={() => navigate(`/bons-passager/${r.id}`)}>
              <span>{r.passager_name || r.reference}{r.airport ? ` · ${r.airport}` : ''}</span>
              <span>{r.days_overdue} j</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
