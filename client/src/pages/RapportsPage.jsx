import { useState } from 'react';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { printDocument } from '../components/printDocument.js';

const ACCENT = 'var(--c-order)';

const PERIODS = [
  { key: 'jour', label: "Aujourd'hui" },
  { key: 'semaine', label: 'Cette semaine' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'trimestre', label: 'Ce trimestre' },
  { key: 'annee', label: 'Cette année' },
];

const REPORTS = [
  { key: 'financial', label: 'Synthèse financière', icon: 'coins' },
  { key: 'orders', label: 'Rentabilité par bon fournisseur', icon: 'order' },
  { key: 'losses', label: 'Pertes et manquants', icon: 'alert' },
];

const TX_TYPE = {
  deposit: 'Dépôt', withdrawal: 'Retrait', conversion: 'Conversion', transfer: 'Transfert',
  adjustment: 'Ajustement', order_fee: 'Frais encaissés', passager_payment: 'Paiement passager',
};

function Kpi({ label, value, unit, tone }) {
  return (
    <div className="pk">
      <div className={`pk-val ${tone || ''}`}>{value} {unit && <span className="fin-cur">{unit}</span>}</div>
      <div className="pk-label">{label}</div>
    </div>
  );
}

export default function RapportsPage() {
  const [report, setReport] = useState('financial');
  const [period, setPeriod] = useState('mois');
  const currency = 'DZD';

  const path = report === 'losses'
    ? `/reports/losses?period=${period}`
    : `/reports/${report}?period=${period}&currency=${currency}`;
  const { data, loading, error } = useApi(path);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '';
  const reportLabel = REPORTS.find((r) => r.key === report)?.label ?? '';

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="report" accent={ACCENT} title="Rapports" subtitle="Chiffres dérivés directement des journaux — jamais saisis à la main.">
        <button className="btn" onClick={() => printDocument('rapport-print', `${reportLabel} — ${periodLabel}`)} disabled={!data}>
          <IconEl name="print" /> Imprimer
        </button>
      </PageHeader>

      <div className="filter-bar">
        {REPORTS.map((r) => (
          <button key={r.key} className={report === r.key ? 'chip active' : 'chip'} onClick={() => setReport(r.key)}>
            {r.label}
          </button>
        ))}
        <select className="period-select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Période">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      {loading && <Spinner />}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <div id="rapport-print">
          <div className="print-only print-head">
            <h2>{reportLabel}</h2>
            <div className="muted">{periodLabel} · {currency} · édité le {new Date().toLocaleString('fr-FR')}</div>
          </div>

          {report === 'financial' && (
            <>
              <div className="panel">
                <h2 className="panel-title">Synthèse — {periodLabel}</h2>
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="Entrées" value={formatMoney(data.entrees)} unit={currency} tone="pos" />
                  <Kpi label="Dépenses" value={formatMoney(data.depenses)} unit={currency} tone="neg" />
                  <Kpi label="Net" value={formatMoney(data.net)} unit={currency} />
                  <Kpi label="Mouvements" value={data.mouvements} />
                  <Kpi label="Créances (à recevoir)" value={formatMoney(data.creances)} unit={currency} />
                  <Kpi label="Dettes (à payer)" value={formatMoney(data.dettes)} unit={currency} />
                </div>
                <p className="muted" style={{ fontSize: '0.76rem', marginBottom: 0 }}>
                  Entrées et dépenses excluent les conversions et les transferts entre caisses : ce sont des
                  mouvements internes, les compter fausserait le total.
                </p>
              </div>

              <div className="panel">
                <h2 className="panel-title">Détail par type de mouvement</h2>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Type</th><th className="right">Entrées</th><th className="right">Dépenses</th><th className="right">Nombre</th></tr></thead>
                    <tbody>
                      {data.parType.map((t) => (
                        <tr key={t.type}>
                          <td>{TX_TYPE[t.type] ?? t.type}</td>
                          <td className="right pos">{formatMoney(t.entrees)}</td>
                          <td className="right neg">{formatMoney(t.depenses)}</td>
                          <td className="right">{t.n}</td>
                        </tr>
                      ))}
                      {!data.parType.length && <tr><td colSpan="4" className="muted pad">Aucun mouvement sur la période.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {report === 'orders' && (
            <div className="panel">
              <h2 className="panel-title">Rentabilité par bon fournisseur — {periodLabel}</h2>
              <div className="profile-kpis" style={{ marginTop: 0 }}>
                <Kpi label="Facturé" value={formatMoney(data.totals.facture)} unit={currency} />
                <Kpi label="Payé aux passagers" value={formatMoney(data.totals.paye_passagers)} unit={currency} />
                <Kpi label="Pertes" value={formatMoney(data.totals.pertes)} unit={currency} tone="neg" />
                <Kpi label="Marge" value={formatMoney(data.totals.marge)} unit={currency} tone="pos" />
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Bon fournisseur</th><th>Fournisseur</th><th className="right">Bons passagers</th><th className="right">Facturé</th><th className="right">Passagers</th><th className="right">Pertes</th><th className="right">Marge</th></tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="gold">{r.reference}</td>
                        <td>{r.fournisseur_name}</td>
                        <td className="right">{r.bons}</td>
                        <td className="right">{formatMoney(r.facture)}</td>
                        <td className="right">{formatMoney(r.paye_passagers)}</td>
                        <td className="right neg">{formatMoney(r.pertes)}</td>
                        <td className="right pos">{formatMoney(r.marge)}</td>
                      </tr>
                    ))}
                    {!data.rows.length && <tr><td colSpan="7" className="muted pad">Aucun bon fournisseur sur la période.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report === 'losses' && (
            <>
              <div className="panel">
                <h2 className="panel-title">Pertes — {periodLabel}</h2>
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="Total des pertes" value={formatMoney(data.total)} unit={currency} tone="neg" />
                  <Kpi label="Lignes concernées" value={data.lines.length} />
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Responsable</th><th className="right">Lignes</th><th className="right">Total</th></tr></thead>
                    <tbody>
                      {data.byResponsible.map((r) => (
                        <tr key={r.responsable}>
                          <td>{r.responsable}</td>
                          <td className="right">{r.lignes}</td>
                          <td className="right neg">{formatMoney(r.total)}</td>
                        </tr>
                      ))}
                      {!data.byResponsible.length && <tr><td colSpan="3" className="muted pad">Aucune perte enregistrée.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {data.lines.length > 0 && (
                <div className="panel">
                  <h2 className="panel-title">Détail</h2>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Bon</th><th>Fournisseur</th><th>Passager</th><th>Marchandise</th><th className="right">Manquant</th><th className="right">Valeur</th><th>Responsable</th></tr></thead>
                      <tbody>
                        {data.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="gold">{l.reference}</td>
                            <td>{l.fournisseur_name}</td>
                            <td>{l.passager_name || '—'}</td>
                            <td>{l.designation}</td>
                            <td className="right">{formatMoney(l.manquant)} {l.unit}</td>
                            <td className="right neg">{formatMoney(l.loss_value)} {l.transport_currency}</td>
                            <td>{l.responsible || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {report === 'losses' && !data.lines.length && (
            <EmptyState icon="check" title="Aucune perte" sub="Aucun manquant enregistré sur la période choisie." />
          )}
        </div>
      )}
    </div>
  );
}
