// Ce qu'on vous doit, ce que vous devez : les deux chiffres qui comptent le plus.
//
// En tête du tableau de bord et des caisses, jamais caché derrière un onglet : on
// n'a pas à aller le chercher. Chaque devise a son total (un total de dinars et de
// yuans ne veut rien dire), chaque dette nomme la personne et ouvre sa fiche.
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { IconEl } from './icons.jsx';
import { formatMoney } from '../lib/format.js';

const MAX = 4;

function Card({ kind, rows, totals }) {
  const navigate = useNavigate();
  const out = kind === 'toPay';
  const entries = Object.entries(totals ?? {});
  const people = new Set(rows.map((r) => r.person_id)).size;
  return (
    <section className={`debt-card ${out ? 'out' : 'in'}`}>
      <header>
        <span className="debt-card-ico"><IconEl name={out ? 'arrowOut' : 'arrowIn'} /></span>
        <div>
          <h3>{out ? 'Vous devez' : 'On vous doit'}</h3>
          <p className="muted">{out ? 'Sorties d’argent à venir : passagers, salaires…' : 'Entrées d’argent attendues : fournisseurs…'}</p>
        </div>
      </header>

      {entries.length ? (
        <div className="debt-card-totals">
          {entries.map(([cur, v]) => <strong key={cur}>{formatMoney(v, cur)}</strong>)}
        </div>
      ) : (
        <div className="debt-card-totals"><strong className="muted">0.00</strong></div>
      )}
      <p className="muted debt-card-count">
        {rows.length
          ? `${people} personne${people > 1 ? 's' : ''} · ${rows.length} dette${rows.length > 1 ? 's' : ''} ouverte${rows.length > 1 ? 's' : ''}`
          : out ? 'Vous ne devez rien à personne.' : 'Personne ne vous doit rien.'}
      </p>

      {rows.slice(0, MAX).map((r) => (
        <button
          key={`${r.person_id}-${r.currency_code}`}
          type="button"
          className="debt-row"
          onClick={() => navigate(`/personnes/${r.person_id}`)}
        >
          <span>{r.person_name}</span>
          <strong>{formatMoney(Math.abs(Number(r.balance)), r.currency_code)}</strong>
        </button>
      ))}
      {rows.length > MAX && <p className="muted debt-card-more">+ {rows.length - MAX} autre{rows.length - MAX > 1 ? 's' : ''}</p>}
    </section>
  );
}

export function DebtSummary({ linkToList = true }) {
  const { data } = useApi('/accounts/debts');
  if (!data) return null;
  return (
    <div className="debt-summary">
      <div className="debt-cards">
        <Card kind="toCollect" rows={data.toCollect ?? []} totals={data.totals?.toCollect} />
        <Card kind="toPay" rows={data.toPay ?? []} totals={data.totals?.toPay} />
      </div>
      {linkToList && (
        <Link to="/caisses#dettes" className="back-link debt-all">Toutes les dettes, avec leurs actions</Link>
      )}
    </div>
  );
}
