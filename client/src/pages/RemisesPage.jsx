// Les remises : tout ce qui a été accordé ou obtenu, par période, avec qui, pourquoi,
// et les totaux.
//
// Deux sens, deux couleurs, jamais confondus :
//   accordée — on a laissé tomber de l'argent qu'on nous devait (un fournisseur paie moins)
//   obtenue  — on a payé moins que ce qu'on devait (un passager, un salarié)
// Rien n'est saisi ici : une remise naît au comptoir, au moment du règlement.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader } from '../components/ui.jsx';
import { PrintButton } from '../components/PrintButton.jsx';
import { tableDocBody } from '../components/printDocument.js';
import { listTicket } from '../components/printTicket.js';
import { formatMoney, formatNumber, formatDateFr, todayIso, addDaysIso } from '../lib/format.js';
import { KIND_LABEL } from '../lib/remise.js';

const ACCENT = 'var(--c-audit)';

const monthStart = () => `${todayIso().slice(0, 8)}01`;
const PRESETS = [
  ['today', 'Aujourd’hui', () => [todayIso(), todayIso()]],
  ['7', '7 jours', () => [addDaysIso(todayIso(), -6), todayIso()]],
  ['month', 'Ce mois', () => [monthStart(), todayIso()]],
  ['30', '30 jours', () => [addDaysIso(todayIso(), -29), todayIso()]],
  ['year', 'Cette année', () => [`${todayIso().slice(0, 4)}-01-01`, todayIso()]],
];

const DIRECTION = {
  accordee: { label: 'Accordée', hint: 'on a laissé tomber', cls: 'rm-given' },
  obtenue: { label: 'Obtenue', hint: 'on a payé moins', cls: 'rm-got' },
};

const kindText = (r) => (r.kind === 'percent' && r.percent != null ? `${Number(r.percent)} %` : KIND_LABEL[r.kind] ?? 'Total convenu');

export default function RemisesPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(() => PRESETS[2][2]());
  const [direction, setDirection] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [kind, setKind] = useState('');

  const reasons = useApi('/remises/reasons?includeInactive=true');
  const qs = new URLSearchParams({ from: range[0], to: range[1] });
  if (direction) qs.set('direction', direction);
  if (reasonId !== '') qs.set('reasonId', reasonId);
  if (kind) qs.set('kind', kind);
  const report = useApi(`/remises?${qs}`);

  const pick = (key) => { setPreset(key); setRange(PRESETS.find((p) => p[0] === key)[2]()); };
  const rows = report.data?.remises ?? [];
  const totals = report.data?.totals;

  const printCols = useMemo(() => [
    { key: 'created_at', label: 'Date', format: (v) => new Date(v).toLocaleDateString('fr-FR') },
    { key: 'direction', label: 'Sens', format: (v) => DIRECTION[v].label },
    { key: 'person_name', label: 'Personne' },
    { key: 'piece', label: 'Pièce' },
    { key: 'sorte', label: 'Sorte' },
    { key: 'reason', label: 'Motif' },
    { key: 'amount', label: 'Montant', align: 'r', format: (v, r) => formatMoney(v, r.currency_code) },
  ], []);
  const printRows = rows.map((r) => ({ ...r, piece: r.order_reference || r.bon_reference || '—', sorte: kindText(r), reason: r.reason || '—', person_name: r.person_name || '—' }));

  const open = (r) => {
    if (r.order_id) navigate(`/bons-fournisseur/${r.order_id}`);
    else if (r.bon_id) navigate(`/bons-passager/${r.bon_id}`);
    else if (r.person_id) navigate(`/personnes/${r.person_id}`);
    else navigate('/charges');
  };

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="coins" accent={ACCENT} title="Remises" subtitle="Ce qui a été accordé ou obtenu au règlement : qui, combien, pourquoi.">
        <PrintButton
          title="Remises" docTitle="Remises" subtitle={`${formatDateFr(range[0])} → ${formatDateFr(range[1])}`}
          disabled={!rows.length}
          a4={() => tableDocBody({
            columns: printCols, rows: printRows,
            meta: (totals?.byCurrency ?? []).map((t) => ({ label: `${t.currency_code} accordées / obtenues`, value: `${formatMoney(t.accordee)} / ${formatMoney(t.obtenue)}` })),
          })}
          ticket={(societe) => listTicket({
            societe, docLabel: 'Remises', subtitle: `${range[0]} → ${range[1]}`,
            columns: [{ key: 'created_at', label: 'Date' }, { key: 'person_name', label: 'Personne' }, { key: 'amount', label: 'Montant' }],
            rows: printRows.map((r) => ({ created_at: new Date(r.created_at).toLocaleDateString('fr-FR'), person_name: r.person_name, amount: formatMoney(r.amount, r.currency_code) })),
            totals: (totals?.byCurrency ?? []).map((t) => ({ label: t.currency_code, value: formatMoney(t.net) })),
          })}
        />
      </PageHeader>

      {/* ── Période et filtres ── */}
      <div className="filter-bar rm-filters">
        <div className="seg" role="group" aria-label="Période">
          {PRESETS.map(([key, label]) => (
            <button key={key} type="button" className={preset === key ? 'active' : ''} onClick={() => pick(key)}>{label}</button>
          ))}
        </div>
        <label className="rm-date"><span className="muted">Du</span>
          <input type="date" value={range[0]} max={range[1]} onChange={(e) => { setPreset(''); setRange([e.target.value, range[1]]); }} /></label>
        <label className="rm-date"><span className="muted">au</span>
          <input type="date" value={range[1]} min={range[0]} onChange={(e) => { setPreset(''); setRange([range[0], e.target.value]); }} /></label>
        <div className="seg" role="group" aria-label="Sens">
          {[['', 'Toutes'], ['accordee', 'Accordées'], ['obtenue', 'Obtenues']].map(([k, label]) => (
            <button key={k || 'all'} type="button" className={direction === k ? 'active' : ''} onClick={() => setDirection(k)}>{label}</button>
          ))}
        </div>
        <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} aria-label="Motif">
          <option value="">Tous les motifs</option>
          <option value="0">Sans motif</option>
          {(reasons.data?.reasons ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}{r.active ? '' : ' (désactivé)'}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Sorte">
          <option value="">Toutes les sortes</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>

      {report.loading && !report.data ? <Spinner /> : report.error ? <div className="alert alert-error">{report.error}</div> : (
        <>
          {/* ── Totaux par devise ── */}
          <div className="rm-cards">
            {(totals?.byCurrency ?? []).map((t) => (
              <section key={t.currency_code} className="rm-card">
                <header><b>{t.currency_code}</b><span className="muted">{t.count} remise{t.count > 1 ? 's' : ''}</span></header>
                <div className="rm-card-grid">
                  <div className="rm-given"><span>Accordées</span><strong>{formatMoney(t.accordee, t.currency_code)}</strong><small>laissé tomber</small></div>
                  <div className="rm-got"><span>Obtenues</span><strong>{formatMoney(t.obtenue, t.currency_code)}</strong><small>payé en moins</small></div>
                  <div className={Number(t.net) >= 0 ? 'rm-got' : 'rm-given'}><span>Net</span><strong>{Number(t.net) > 0 ? '+' : ''}{formatMoney(t.net, t.currency_code)}</strong><small>{Number(t.net) >= 0 ? 'en votre faveur' : 'en leur faveur'}</small></div>
                </div>
              </section>
            ))}
            {!totals?.byCurrency?.length && <p className="muted pad">Aucune remise sur cette période.</p>}
          </div>

          {/* ── Où elles vont : par motif, par administrateur, par sorte ── */}
          {rows.length > 0 && (
            <div className="rm-breakdown">
              {[
                ['Par motif', totals.byReason, 'reason', (v) => v],
                ['Par administrateur', totals.byAdmin, 'admin', (v) => v],
                ['Par sorte', totals.byKind, 'kind', (v) => KIND_LABEL[v] ?? v],
              ].map(([title, list, key, nameOf]) => (
                <section key={title} className="panel rm-break">
                  <h3 className="panel-title">{title}</h3>
                  <table className="table">
                    <tbody>
                      {list.map((t) => (
                        <tr key={`${t[key]}-${t.currency_code}`}>
                          <td>{nameOf(t[key])}</td>
                          <td className="muted right">{t.count}</td>
                          <td className="right rm-given">{Number(t.accordee) > 0 ? `−${formatMoney(t.accordee, t.currency_code)}` : ''}</td>
                          <td className="right rm-got">{Number(t.obtenue) > 0 ? `+${formatMoney(t.obtenue, t.currency_code)}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}

          {/* ── Le détail ── */}
          <div className="panel">
            <h2 className="panel-title">Détail</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Sens</th><th>Personne</th><th>Pièce</th><th>Sorte</th><th>Motif</th><th>Par</th><th className="right">Montant</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.source}-${r.id}`} className="clickable" onClick={() => open(r)}>
                      <td className="nowrap">{new Date(r.created_at).toLocaleDateString('fr-FR')}</td>
                      <td><span className={`rm-badge ${DIRECTION[r.direction].cls}`} title={DIRECTION[r.direction].hint}>{DIRECTION[r.direction].label}</span></td>
                      <td>{r.person_id ? <Link to={`/personnes/${r.person_id}`} className="gold" onClick={(e) => e.stopPropagation()}>{r.person_name}</Link> : <span>{r.person_name || '—'} <em className="muted">· salaire</em></span>}</td>
                      <td className="muted">{r.order_reference || r.bon_reference || '—'}</td>
                      <td>{kindText(r)}</td>
                      <td>{r.reason || <span className="muted">—</span>}{r.note && <small className="muted rm-note"> · {r.note}</small>}</td>
                      <td className="muted">{r.admin_name}</td>
                      <td className={`right ${DIRECTION[r.direction].cls}`}><strong>{r.direction === 'accordee' ? '−' : '+'}{formatMoney(r.amount, r.currency_code)}</strong></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan="8" className="muted pad">Aucune remise ne correspond.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="muted line-hint">
              {formatNumber(rows.length, { decimals: 0 })} remise{rows.length > 1 ? 's' : ''} · une remise <strong>accordée</strong> est de l’argent
              qu’on vous devait et que vous avez laissé ; une remise <strong>obtenue</strong> est de l’argent que vous deviez et que vous n’avez pas versé.
              Le motif se règle dans Paramètres.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
