import { useState } from 'react';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, formatQty, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { printDocument } from '../components/printDocument.js';
import DateRangePicker, { defaultRange } from '../components/DateRangePicker.jsx';
import { formatRangeFr } from '../lib/format.js';
import { exportCsv } from '../lib/csv.js';
import { useDraft } from '../lib/draft.js';

const ACCENT = 'var(--c-order)';
const CUR = 'DZD';

// Six rapports, un seul contrôle de dates. Ce qui change d'un onglet à l'autre,
// c'est la question posée — jamais la période, qui reste celle qu'on a choisie
// une fois en haut de l'écran.
const REPORTS = [
  { key: 'money', label: 'Argent', icon: 'coins' },
  { key: 'orders', label: 'Bénéfice', icon: 'order' },
  { key: 'people', label: 'Personnes', icon: 'users' },
  { key: 'goods', label: 'Marchandises', icon: 'box' },
  { key: 'financial', label: 'Synthèse', icon: 'chart' },
  { key: 'losses', label: 'Manquants', icon: 'alert' },
];

// Un bon porte trois dates. Demander « septembre » sans dire laquelle, c'est
// répondre à une question qu'on n'a pas posée.
const DATE_BY = [
  { key: 'creation', label: 'Création' },
  { key: 'arrivee', label: 'Arrivée' },
  { key: 'reglement', label: 'Règlement' },
];
const HAS_DATE_SWITCH = new Set(['orders', 'goods', 'losses']);

const TX_TYPE = {
  deposit: 'Dépôt', withdrawal: 'Retrait', conversion: 'Conversion', transfer: 'Transfert',
  adjustment: 'Ajustement', order_fee: 'Frais encaissés', passager_payment: 'Paiement passager',
  charge: 'Charge',
};
const STATUS = { cree: 'Créé', en_transit: 'En transit', arrive: 'Arrivé', regle: 'Réglé' };
const REASON = {
  reception: 'Réception', depart: 'Départ', arrivee: 'Arrivée',
  livraison: 'Livraison', inventaire: 'Inventaire', ajustement: 'Ajustement',
};
const OFFICE = { china: 'Chine', algeria: 'Algérie' };

function Kpi({ label, value, unit, tone }) {
  return (
    <div className="pk">
      <div className={`pk-val ${tone || ''}`}>{value} {unit && <span className="fin-cur">{unit}</span>}</div>
      <div className="pk-label">{label}</div>
    </div>
  );
}

function Panel({ title, children, sub }) {
  return (
    <div className="panel">
      <h2 className="panel-title">{title}</h2>
      {sub && <p className="muted" style={{ marginTop: -6, fontSize: '0.78rem' }}>{sub}</p>}
      {children}
    </div>
  );
}

function Table({ head, children, empty, cols }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head}</tr></thead>
        <tbody>
          {children}
          {empty && <tr><td colSpan={cols} className="muted pad">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function RapportsPage() {
  // La plage survit à un F5 et à un aller-retour vers un autre onglet — c'est
  // le même sessionStorage que le panier des bons (lib/draft.js).
  //
  // Pas l'URL, bien qu'elle serait plus partageable : chaque onglet de
  // l'application rend sa page via `<Routes location={tab.path}>`, et
  // normalizePath() coupe la query. Une plage écrite dans l'adresse ne
  // reviendrait donc jamais jusqu'ici.
  const [view, setView] = useDraft('sc.rapports', {
    ...defaultRange(), report: 'money', dateBy: 'creation',
  });
  const range = { from: view.from, to: view.to };
  const report = REPORTS.some((r) => r.key === view.report) ? view.report : 'money';
  const dateBy = DATE_BY.some((d) => d.key === view.dateBy) ? view.dateBy : 'creation';
  const patch = (next) => setView((v) => ({ ...v, ...next }));

  const qs = new URLSearchParams({ from: range.from, to: range.to });
  if (report !== 'goods' && report !== 'losses') qs.set('currency', CUR);
  if (HAS_DATE_SWITCH.has(report)) qs.set('dateBy', dateBy);
  const { data: raw, loading, error } = useApi(`/reports/${report}?${qs}`);
  // En changeant d'onglet, useApi garde volontairement les données précédentes
  // le temps que les nouvelles arrivent — c'est ce qui évite un écran blanc à
  // chaque frappe dans une recherche. Ici cela signifiait rendre les totaux
  // « argent » avec le gabarit « bénéfice », et la page plantait. Le serveur
  // renvoie donc le nom du rapport, et on n'affiche que ce qui correspond.
  const data = raw?.report === report ? raw : null;

  const reportLabel = REPORTS.find((r) => r.key === report)?.label ?? '';
  const said = formatRangeFr(range.from, range.to);
  const [csvBusy, setCsv] = useState(false);

  // Chaque rapport dit lui-même comment il s'exporte : la table qu'on voit à
  // l'écran est celle qui part dans le fichier, pas une autre.
  const CSV = {
    money: () => [
      [{ key: 'label', label: 'Caisse' }, { key: 'ouverture', label: 'Ouverture' },
        { key: 'entrees', label: 'Entrées' }, { key: 'sorties', label: 'Sorties' },
        { key: 'cloture', label: 'Clôture' }, { key: 'mouvements', label: 'Mouvements' }],
      data.caisses,
    ],
    orders: () => [
      [{ key: 'reference', label: 'Bon fournisseur' }, { key: 'fournisseur_name', label: 'Fournisseur' },
        { key: 'bons', label: 'Bons' }, { key: 'facture', label: 'Facturé' },
        { key: 'commission', label: 'Commission' }, { key: 'paye_passagers', label: 'Payé passagers' },
        { key: 'pertes', label: 'Pertes' }, { key: 'marge', label: 'Marge' }],
      data.rows,
    ],
    people: () => [
      [{ key: 'name', label: 'Personne' }, { key: 'phone', label: 'Téléphone' },
        { key: 'facture', label: 'Facturé' }, { key: 'encaisse', label: 'Encaissé' },
        { key: 'du_transport', label: 'Dû transport' }, { key: 'paye', label: 'Payé' },
        { key: 'manquants', label: 'Manquants' }, { key: 'solde_actuel', label: 'Solde actuel' }],
      data.rows,
    ],
    goods: () => [
      [{ key: 'designation', label: 'Marchandise' }, { key: 'lignes', label: 'Lignes' },
        { key: 'quantite', label: 'Quantité' }, { key: 'poids', label: 'Poids (kg)' },
        { key: 'cbm', label: 'CBM' }, { key: 'valeur', label: 'Valeur' }],
      data.articles,
    ],
    financial: () => [
      [{ key: 'type', label: 'Type', map: (r) => TX_TYPE[r.type] ?? r.type },
        { key: 'entrees', label: 'Entrées' }, { key: 'depenses', label: 'Dépenses' },
        { key: 'n', label: 'Nombre' }],
      data.parType,
    ],
    losses: () => [
      [{ key: 'reference', label: 'Bon' }, { key: 'fournisseur_name', label: 'Fournisseur' },
        { key: 'passager_name', label: 'Passager' }, { key: 'designation', label: 'Marchandise' },
        { key: 'manquant', label: 'Manquant' }, { key: 'unit', label: 'Unité' },
        { key: 'loss_value', label: 'Valeur' }, { key: 'transport_currency', label: 'Devise' },
        { key: 'responsible', label: 'Responsable' }],
      data.lines,
    ],
  };

  const doCsv = () => {
    setCsv(true);
    try {
      const [columns, rows] = CSV[report]();
      exportCsv(report, range.from, range.to, columns, rows ?? []);
    } finally { setCsv(false); }
  };

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="report" accent={ACCENT} title="Rapports"
        subtitle="Chiffres dérivés directement des journaux — jamais saisis à la main.">
        <button className="btn" onClick={doCsv} disabled={!data || csvBusy}>
          <IconEl name="arrowOut" /> CSV
        </button>
        <button className="btn" disabled={!data}
          onClick={() => printDocument('rapport-print', `${reportLabel} — ${said}`)}>
          <IconEl name="print" /> Imprimer
        </button>
      </PageHeader>

      <DateRangePicker
        value={range}
        onChange={(r) => patch({ from: r.from, to: r.to })}
        tzLabel={data?.tzLabel}
      />

      <div className="filter-bar">
        {REPORTS.map((r) => (
          <button key={r.key} className={report === r.key ? 'chip active' : 'chip'}
            onClick={() => patch({ report: r.key })}>
            <IconEl name={r.icon} />{r.label}
          </button>
        ))}
      </div>

      {HAS_DATE_SWITCH.has(report) && (
        <div className="filter-bar dateby-bar">
          <span className="muted">Dater par</span>
          <div className="seg">
            {DATE_BY.map((d) => (
              <button key={d.key} className={dateBy === d.key ? 'active' : ''}
                onClick={() => patch({ dateBy: d.key })}>{d.label}</button>
            ))}
          </div>
        </div>
      )}

      {(loading || (!data && !error)) && <Spinner />}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <div id="rapport-print">
          <div className="print-only print-head">
            <h2>{reportLabel}</h2>
            <div className="muted">
              {said} · {data.tzLabel} · édité le {new Date().toLocaleString('fr-FR')}
            </div>
          </div>

          {/* ── Argent ── */}
          {report === 'money' && (
            <>
              <Panel title={`Caisses — ${said}`}
                sub="Ouverture + entrées − sorties = clôture. Chaque ligne se vérifie d’elle-même.">
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="Ouverture" value={formatMoney(data.totaux.ouverture)} unit={CUR} />
                  <Kpi label="Entrées" value={formatMoney(data.totaux.entrees)} unit={CUR} tone="pos" />
                  <Kpi label="Sorties" value={formatMoney(data.totaux.sorties)} unit={CUR} tone="neg" />
                  <Kpi label="Clôture" value={formatMoney(data.totaux.cloture)} unit={CUR} />
                </div>
                <Table cols={6}
                  head={<><th>Caisse</th><th className="right">Ouverture</th><th className="right">Entrées</th><th className="right">Sorties</th><th className="right">Clôture</th><th className="right">Mvts</th></>}
                  empty={!data.caisses.length && 'Aucune caisse.'}>
                  {data.caisses.map((c) => (
                    <tr key={c.id}>
                      <td>{c.label} {c.office && <span className="muted">· {OFFICE[c.office]}</span>}</td>
                      <td className="right">{formatMoney(c.ouverture)}</td>
                      <td className="right pos">{formatMoney(c.entrees)}</td>
                      <td className="right neg">{formatMoney(c.sorties)}</td>
                      <td className="right"><strong>{formatMoney(c.cloture)}</strong></td>
                      <td className="right">{c.mouvements}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>

              <Panel title="Charges de la société"
                sub="Les dépenses de fonctionnement — elles n’avaient aucun rapport jusqu’ici.">
                <Table cols={3} head={<><th>Catégorie</th><th className="right">Nombre</th><th className="right">Total</th></>}
                  empty={!data.charges.length && 'Aucune charge sur la période.'}>
                  {data.charges.map((c) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td className="right">{c.n}</td>
                      <td className="right neg">{formatMoney(c.total, CUR)}</td>
                    </tr>
                  ))}
                  {data.charges.length > 0 && (
                    <tr><td><strong>Total</strong></td><td /><td className="right neg"><strong>{formatMoney(data.chargesTotal, CUR)}</strong></td></tr>
                  )}
                </Table>
              </Panel>

              <Panel title="Conversions"
                sub="Changer une devise ne fait pas entrer d’argent : ces lignes ne se totalisent pas avec les entrées.">
                <Table cols={5} head={<><th>Date</th><th>Caisse</th><th>De</th><th>Vers</th><th className="right">Taux effectif</th></>}
                  empty={!data.conversions.length && 'Aucune conversion sur la période.'}>
                  {data.conversions.map((c) => (
                    <tr key={c.id}>
                      <td>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                      <td>{c.caisse_label}</td>
                      <td className="neg">{formatMoney(c.from_amount, c.from_currency)}</td>
                      <td className="pos">{formatMoney(c.to_amount, c.to_currency)}</td>
                      <td className="right muted">{c.effective_rate}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>

              <Panel title="Transferts entre bureaux">
                <Table cols={5} head={<><th>Référence</th><th>De</th><th>Vers</th><th className="right">Montant</th><th>État</th></>}
                  empty={!data.transferts.length && 'Aucun transfert sur la période.'}>
                  {data.transferts.map((t) => (
                    <tr key={t.id}>
                      <td className="gold">{t.reference}</td>
                      <td>{OFFICE[t.from_office] ?? t.from_office}</td>
                      <td>{OFFICE[t.to_office] ?? t.to_office}</td>
                      <td className="right">{formatMoney(t.amount, t.currency_code)}</td>
                      <td>
                        <span className={`status-badge ${t.status === 'recu' ? 'st-regle' : 'st-transit'}`}>
                          {t.status === 'recu' ? 'Reçu' : 'En route'}
                        </span>
                        {t.forced && <span className="muted"> · forcé</span>}
                      </td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          )}

          {/* ── Bénéfice ── */}
          {report === 'orders' && (
            <Panel title={`Bénéfice par bon fournisseur — ${said}`}>
              <div className="profile-kpis" style={{ marginTop: 0 }}>
                <Kpi label="Facturé" value={formatMoney(data.totals.facture)} unit={CUR} />
                <Kpi label="Commission" value={formatMoney(data.totals.commission)} unit={CUR} tone="pos" />
                <Kpi label="Payé aux passagers" value={formatMoney(data.totals.paye_passagers)} unit={CUR} />
                <Kpi label="Pertes" value={formatMoney(data.totals.pertes)} unit={CUR} tone="neg" />
                <Kpi label="Marge" value={formatMoney(data.totals.marge)} unit={CUR} tone="pos" />
              </div>
              <Table cols={8}
                head={<><th>Bon fournisseur</th><th>Fournisseur</th><th className="right">Bons</th><th className="right">Facturé</th><th className="right">Commission</th><th className="right">Passagers</th><th className="right">Pertes</th><th className="right">Marge</th></>}
                empty={!data.rows.length && 'Aucun bon fournisseur sur cette période.'}>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="gold">{r.reference}</td>
                    <td>{r.fournisseur_name}</td>
                    <td className="right">{r.bons}</td>
                    <td className="right">{formatMoney(r.facture)}</td>
                    <td className="right pos">{formatMoney(r.commission)}</td>
                    <td className="right">{formatMoney(r.paye_passagers)}</td>
                    <td className="right neg">{formatMoney(r.pertes)}</td>
                    <td className="right pos">{formatMoney(r.marge)}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}

          {/* ── Personnes ── */}
          {report === 'people' && (
            <Panel title={`Personnes — ${said}`}
              sub="Ce qui s’est passé sur la période. Le solde actuel, lui, est d’aujourd’hui.">
              <div className="profile-kpis" style={{ marginTop: 0 }}>
                <Kpi label="Facturé" value={formatMoney(data.totals.facture)} unit={CUR} />
                <Kpi label="Encaissé" value={formatMoney(data.totals.encaisse)} unit={CUR} tone="pos" />
                <Kpi label="Dû aux passagers" value={formatMoney(data.totals.du_transport)} unit={CUR} />
                <Kpi label="Payé" value={formatMoney(data.totals.paye)} unit={CUR} />
                <Kpi label="Manquants" value={formatMoney(data.totals.manquants)} unit={CUR} tone="neg" />
              </div>
              <Table cols={7}
                head={<><th>Personne</th><th className="right">Facturé</th><th className="right">Encaissé</th><th className="right">Dû transport</th><th className="right">Payé</th><th className="right">Manquants</th><th className="right">Solde actuel</th></>}
                empty={!data.rows.length && 'Aucun mouvement de compte sur cette période.'}>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="right">{formatMoney(r.facture)}</td>
                    <td className="right pos">{formatMoney(r.encaisse)}</td>
                    <td className="right">{formatMoney(r.du_transport)}</td>
                    <td className="right">{formatMoney(r.paye)}</td>
                    <td className="right neg">{formatMoney(r.manquants)}</td>
                    <td className={`right ${Number(r.solde_actuel) < 0 ? 'neg' : 'pos'}`}>
                      {formatMoney(r.solde_actuel)}
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}

          {/* ── Marchandises ── */}
          {report === 'goods' && (
            <>
              <Panel title={`Bons — ${said}`}>
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="En transit maintenant" value={data.enTransit?.bons ?? 0} />
                  <Kpi label="Poids en route" value={formatQty(data.enTransit?.poids)} unit="kg" />
                  <Kpi label="Volume en route" value={formatQty(data.enTransit?.cbm)} unit="m³" />
                </div>
                <Table cols={3} head={<><th>Statut</th><th>Type</th><th className="right">Nombre</th></>}
                  empty={!data.parStatut.length && 'Aucun bon sur cette période.'}>
                  {data.parStatut.map((s, i) => (
                    <tr key={i}>
                      <td>{STATUS[s.status] ?? s.status}</td>
                      <td>{s.est_passager ? 'Bon passager' : 'Bon fournisseur'}</td>
                      <td className="right">{s.n}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>

              <Panel title="Marchandises reçues" sub="Ce que les bons fournisseurs ont fait entrer, par article.">
                <Table cols={6}
                  head={<><th>Marchandise</th><th className="right">Lignes</th><th className="right">Quantité</th><th className="right">Poids</th><th className="right">CBM</th><th className="right">Valeur</th></>}
                  empty={!data.articles.length && 'Aucune marchandise sur cette période.'}>
                  {data.articles.map((a, i) => (
                    <tr key={i}>
                      <td>{a.designation}</td>
                      <td className="right">{a.lignes}</td>
                      <td className="right">{formatQty(a.quantite)}</td>
                      <td className="right">{formatQty(a.poids)}</td>
                      <td className="right">{formatQty(a.cbm)}</td>
                      <td className="right">{formatMoney(a.valeur)}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>

              <Panel title="Mouvements de stock" sub="Le journal du stock — il n’avait jamais eu de rapport.">
                <Table cols={5}
                  head={<><th>Bureau</th><th>Motif</th><th className="right">Nombre</th><th className="right">Quantité</th><th className="right">Poids</th></>}
                  empty={!data.mouvements.length && 'Aucun mouvement de stock sur cette période.'}>
                  {data.mouvements.map((m, i) => (
                    <tr key={i}>
                      <td>{OFFICE[m.office] ?? m.office}</td>
                      <td>{REASON[m.reason] ?? m.reason}</td>
                      <td className="right">{m.n}</td>
                      <td className={`right ${Number(m.quantite) < 0 ? 'neg' : 'pos'}`}>{formatQty(m.quantite)}</td>
                      <td className={`right ${Number(m.poids) < 0 ? 'neg' : 'pos'}`}>{formatQty(m.poids)}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          )}

          {/* ── Synthèse ── */}
          {report === 'financial' && (
            <>
              <Panel title={`Synthèse — ${said}`}
                sub="Entrées et dépenses excluent conversions et transferts : ce sont des mouvements internes. Le détail ci-dessous suit exactement le même filtre, donc ses lignes totalisent l’entête.">
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="Entrées" value={formatMoney(data.entrees)} unit={CUR} tone="pos" />
                  <Kpi label="Dépenses" value={formatMoney(data.depenses)} unit={CUR} tone="neg" />
                  <Kpi label="Net" value={formatMoney(data.net)} unit={CUR} />
                  <Kpi label="Mouvements" value={data.mouvements} />
                </div>
              </Panel>

              <Panel title="Créances et dettes"
                sub="Un état d’aujourd’hui, pas un flux de la période : ce qui reste dû, quelle que soit la plage regardée.">
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  <Kpi label="À recevoir" value={formatMoney(data.creances)} unit={CUR} />
                  <Kpi label="À payer" value={formatMoney(data.dettes)} unit={CUR} />
                </div>
              </Panel>

              <Panel title="Détail par type de mouvement">
                <Table cols={4} head={<><th>Type</th><th className="right">Entrées</th><th className="right">Dépenses</th><th className="right">Nombre</th></>}
                  empty={!data.parType.length && 'Aucun mouvement sur la période.'}>
                  {data.parType.map((t) => (
                    <tr key={t.type}>
                      <td>{TX_TYPE[t.type] ?? t.type}</td>
                      <td className="right pos">{formatMoney(t.entrees)}</td>
                      <td className="right neg">{formatMoney(t.depenses)}</td>
                      <td className="right">{t.n}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </>
          )}

          {/* ── Manquants ── */}
          {report === 'losses' && (
            <>
              <Panel title={`Manquants — ${said}`}>
                <div className="profile-kpis" style={{ marginTop: 0 }}>
                  {Object.entries(data.parDevise ?? {}).map(([code, total]) => (
                    <Kpi key={code} label={`Total ${code}`} value={formatMoney(total)} unit={code} tone="neg" />
                  ))}
                  <Kpi label="Lignes concernées" value={data.lines.length} />
                </div>
                <Table cols={3} head={<><th>Responsable</th><th className="right">Lignes</th><th className="right">Total</th></>}
                  empty={!data.byResponsible.length && 'Aucun manquant enregistré.'}>
                  {data.byResponsible.map((r) => (
                    <tr key={r.responsable}>
                      <td>{r.responsable}</td>
                      <td className="right">{r.lignes}</td>
                      <td className="right neg">{formatMoney(r.total)}</td>
                    </tr>
                  ))}
                </Table>
              </Panel>

              {data.lines.length > 0 && (
                <Panel title="Détail">
                  <Table cols={7}
                    head={<><th>Bon</th><th>Fournisseur</th><th>Passager</th><th>Marchandise</th><th className="right">Manquant</th><th className="right">Valeur</th><th>Responsable</th></>}>
                    {data.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="gold">{l.reference}</td>
                        <td>{l.fournisseur_name}</td>
                        <td>{l.passager_name || '—'}</td>
                        <td>{l.designation}</td>
                        <td className="right">{formatQty(l.manquant)} {l.unit}</td>
                        <td className="right neg">{formatMoney(l.loss_value, l.transport_currency)}</td>
                        <td>{l.responsible || '—'}</td>
                      </tr>
                    ))}
                  </Table>
                </Panel>
              )}

              {!data.lines.length && (
                <EmptyState icon="check" title="Aucun manquant"
                  sub={`Rien à signaler ${said}.`} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
