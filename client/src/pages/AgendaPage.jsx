// L'agenda : qui vient au bureau, quel jour, et pourquoi.
//
// Un passager atterrit à Alger le 14 : ce jour-là des gens viennent récupérer
// leur marchandise. Un fournisseur doit passer prendre la sienne le 16. Les dates
// sont l'organe central du métier ; cette page les met côte à côte. Rien n'est
// saisi ici — tout se lit sur les bons et les ordres — mais chaque ligne ouvre
// la pièce concernée.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { BON_STATUS } from '../components/bonStatus.js';
import { ORDER_STATUS } from '../components/orderStatus.js';
import { ArrivalBadge } from '../components/ArrivalBadge.jsx';
import { formatDateFr, formatQty, todayIso, addDaysIso } from '../lib/format.js';

const KINDS = [
  { key: 'arrivals', label: 'Arrivées', icon: 'plane', tone: 'gold' },
  { key: 'pickups', label: 'Retraits fournisseurs', icon: 'fournisseur', tone: 'blue' },
  { key: 'departures', label: 'Départs', icon: 'arrowOut', tone: 'muted' },
];

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const weekday = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];

function BonRow({ r, kind, onOpen }) {
  const st = BON_STATUS[r.status];
  return (
    <button type="button" className={`ag-row ag-${kind}`} onClick={onOpen}>
      <span className="ag-ico"><IconEl name={kind === 'arrivals' ? 'plane' : 'arrowOut'} /></span>
      <span className="ag-main">
        <strong>{r.passager_name || '—'}</strong>
        <span className="muted">
          {r.reference}
          {r.passager_phone ? ` · ${r.passager_phone}` : ''}
        </span>
      </span>
      <span className="ag-meta">
        {[r.airport && `${r.airport}${r.airport_wilaya ? ` (${r.airport_wilaya})` : ''}`, r.airline].filter(Boolean).join(' · ') || '—'}
      </span>
      <span className="ag-meta">
        {formatQty(r.quantity)} pièce(s) · {formatQty(r.weight_kg)} kg
        {r.fournisseurs ? <em> · {r.fournisseurs}</em> : null}
      </span>
      <span className="ag-end">
        {st && <span className={`status-badge ${st.cls}`}>{st.label}</span>}
        <ArrivalBadge bon={r} />
      </span>
    </button>
  );
}

function PickupRow({ r, onOpen }) {
  const st = ORDER_STATUS[r.status];
  return (
    <button type="button" className="ag-row ag-pickups" onClick={onOpen}>
      <span className="ag-ico"><IconEl name="fournisseur" /></span>
      <span className="ag-main">
        <strong>{r.fournisseur_name}</strong>
        <span className="muted">{r.reference}{r.fournisseur_phone ? ` · ${r.fournisseur_phone}` : ''}</span>
      </span>
      <span className="ag-meta">{r.goods || '—'}</span>
      <span className="ag-meta muted">vient prendre sa marchandise</span>
      <span className="ag-end">{st && <span className={`status-badge ${st.cls}`}>{st.label}</span>}</span>
    </button>
  );
}

export default function AgendaPage() {
  const navigate = useNavigate();
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysIso(today, 13));
  const [show, setShow] = useState({ arrivals: true, pickups: true, departures: true });
  const [quiet, setQuiet] = useState(false);

  const valid = from && to && to >= from;
  const { data, loading, error } = useApi(valid ? `/agenda?from=${from}&to=${to}&today=${today}` : null);

  const shift = (days) => { setFrom(addDaysIso(from, days)); setTo(addDaysIso(to, days)); };
  const span = valid ? Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;

  const days = useMemo(() => (data?.days ?? []).map((d) => ({
    ...d,
    total: KINDS.reduce((n, k) => n + (show[k.key] ? d[k.key].length : 0), 0),
  })), [data, show]);
  const visible = quiet ? days.filter((d) => d.total > 0) : days;

  return (
    <div>
      <PageHeader
        icon="calendar"
        title="Agenda"
        subtitle="Qui vient au bureau, quel jour : arrivées promises, retraits des fournisseurs, départs."
        accent="var(--c-bon)"
      />

      <div className="ag-tools">
        <div className="ag-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-span)} disabled={!valid}>
            <IconEl name="chevronLeft" />Avant
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFrom(today); setTo(addDaysIso(today, Math.max(span - 1, 0))); }}>
            Aujourd’hui
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(span)} disabled={!valid}>
            Après<IconEl name="chevronRight" />
          </button>
        </div>
        <label className="field"><span>Du</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>Au</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="chips">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={show[k.key] ? 'chip active' : 'chip'}
              aria-pressed={show[k.key]}
              onClick={() => setShow({ ...show, [k.key]: !show[k.key] })}
            >
              <IconEl name={k.icon} />{k.label}{data ? ` · ${data.counts[k.key]}` : ''}
            </button>
          ))}
          <button type="button" className={quiet ? 'chip active' : 'chip'} aria-pressed={quiet} onClick={() => setQuiet(!quiet)}>
            Masquer les jours vides
          </button>
        </div>
      </div>

      {!valid && <p className="neg">La fin de la période ne peut pas précéder le début.</p>}
      {error && <div className="alert alert-error">{String(error)}</div>}

      {/* Ce qui est déjà en retard ne dépend pas de la semaine regardée : on le montre toujours. */}
      {data?.overdue?.length > 0 && (
        <section className="panel ag-overdue">
          <h2 className="panel-title"><IconEl name="alert" />En retard sur la date promise <span className="muted">({data.overdue.length})</span></h2>
          {data.overdue.map((r) => (
            <BonRow key={r.id} r={r} kind="arrivals" onOpen={() => navigate(`/bons-passager/${r.id}`)} />
          ))}
        </section>
      )}

      {loading && !data ? <Spinner /> : (
        <div className="ag-days">
          {visible.map((d) => (
            <section key={d.date} className={`panel ag-day ${d.date === today ? 'is-today' : ''} ${d.total ? '' : 'is-empty'}`}>
              <header className="ag-day-head">
                <h2>
                  <span className="ag-wd">{weekday(d.date)}</span> {formatDateFr(d.date, { year: d.date.slice(0, 4) !== today.slice(0, 4) })}
                  {d.date === today && <span className="ag-today">aujourd’hui</span>}
                </h2>
                <span className="ag-counts">
                  {KINDS.filter((k) => show[k.key] && d[k.key].length).map((k) => (
                    <span key={k.key} className={`ag-count ag-${k.key}`}><IconEl name={k.icon} />{d[k.key].length}</span>
                  ))}
                </span>
              </header>
              {d.total === 0 ? (
                <p className="muted ag-none">Rien de prévu.</p>
              ) : (
                <>
                  {show.arrivals && d.arrivals.map((r) => <BonRow key={`a${r.id}`} r={r} kind="arrivals" onOpen={() => navigate(`/bons-passager/${r.id}`)} />)}
                  {show.pickups && d.pickups.map((r) => <PickupRow key={`p${r.id}`} r={r} onOpen={() => navigate(`/bons-fournisseur/${r.id}`)} />)}
                  {show.departures && d.departures.map((r) => <BonRow key={`d${r.id}`} r={r} kind="departures" onOpen={() => navigate(`/bons-passager/${r.id}`)} />)}
                </>
              )}
            </section>
          ))}
          {!visible.length && !loading && (
            <EmptyState icon="calendar" title="Rien dans cette période" sub="Aucune arrivée, aucun retrait, aucun départ n’est daté ici." />
          )}
        </div>
      )}
    </div>
  );
}
