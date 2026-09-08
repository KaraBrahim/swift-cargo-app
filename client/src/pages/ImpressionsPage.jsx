import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { EntityPicker, OptionChips } from '../components/EntityPicker.jsx';
import { Spinner, errorMessage, useToast, PageHeader, formatMoney } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import {
  openPrintWindow, bonDocBody, caisseStatementBody, personStatementBody,
  orderManifestBody, tableDocBody,
} from '../components/printDocument.js';
import { openTicketWindow, bonTicket, orderTicket, listTicket } from '../components/printTicket.js';
import { qrDataUrl } from '../lib/useQr.js';
import DateRangePicker, { defaultRange } from '../components/DateRangePicker.jsx';

const ACCENT = 'var(--c-bon)';


const FORMATS = [
  { key: 'a4', label: 'A4 / PDF' },
  { key: '80', label: 'Ticket 80 mm' },
  { key: '58', label: 'Ticket 58 mm' },
];

const dt = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '');
const d10 = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');

// Every printable document in one table.
//   list      — endpoint providing the chooser options (null = no target needed)
//   options   — maps that payload to { id, label }
//   load      — fetches what the builders need
//   a4/ticket — the two renderings
const DOCS = {
  bon: {
    label: 'Bon passager', icon: 'bon', group: 'Pièces',
    hint: 'Marchandise, manquants et signatures.',
    list: '/bons?limit=300',
    options: (d) => (d.bons ?? []).map((b) => ({ id: b.id, label: `${b.reference} — ${b.fournisseur_name}` })),
    load: (id) => api(`/bons/${id}`).then((r) => r.bon),
    title: (b) => b.reference,
    docTitle: 'Bon passager',
    scan: (b) => ['bon', b.uuid],
    a4: bonDocBody,
    ticket: bonTicket,
  },
  ordre: {
    label: 'Bon fournisseur', icon: 'order', group: 'Pièces',
    hint: 'Manifeste : tous les bons passagers d’un fournisseur.',
    list: '/orders?limit=300',
    options: (d) => (d.orders ?? []).map((o) => ({ id: o.id, label: `${o.reference} — ${o.fournisseur_name}` })),
    load: (id) => api(`/orders/${id}`).then((r) => r.order),
    title: (o) => o.reference,
    docTitle: 'Bon fournisseur — manifeste',
    scan: (o) => ['order', o.uuid],
    a4: orderManifestBody,
    ticket: orderTicket,
  },
  caisse: {
    label: 'Relevé de caisse', icon: 'caisse', group: 'Finance',
    hint: 'Mouvements d’une caisse avec solde progressif.',
    list: '/caisses',
    options: (d) => (d.caisses ?? []).map((c) => ({ id: c.id, label: c.label })),
    period: true,
    load: (id, { range }) => api(`/reports/caisse/${id}?from=${range.from}&to=${range.to}&currency=DZD`),
    title: (d) => `Relevé ${d.caisse.label}`,
    docTitle: 'Relevé de caisse',
    a4: caisseStatementBody,
    ticket: (d, societe) => listTicket({
      societe, docLabel: 'Relevé de caisse', subtitle: d.caisse.label,
      columns: [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'montant', label: 'Montant' }],
      rows: (d.entries ?? []).map((e) => ({
        date: dt(e.created_at), type: e.type,
        montant: `${e.direction === 'in' ? '+' : '−'}${formatMoney(e.amount)}`,
      })),
      totals: [
        { label: 'ENTRÉES', value: formatMoney(d.entrees) },
        { label: 'SORTIES', value: formatMoney(d.depenses) },
        { label: 'SOLDE', value: formatMoney(d.soldeCloture) },
      ],
    }),
  },
  compte: {
    label: 'Relevé de compte', icon: 'passager', group: 'Finance',
    hint: 'Compte d’une personne — fournisseur, passager, ou les deux.',
    person: true,
    // Un seul compte par personne : plus de type à choisir avant le nom.
    list: (role) => `/people${role ? `?role=${role}` : ''}`,
    options: (d) => (d.people ?? []).map((p) => ({ id: p.id, label: p.name })),
    load: (id) => api(`/reports/person/personne/${id}?currency=DZD`),
    title: (d) => `Relevé ${d.person.name}`,
    docTitle: 'Relevé de compte',
    scan: (d) => ['person', d.person.uuid],
    a4: personStatementBody,
    ticket: (d, societe) => listTicket({
      societe, docLabel: 'Relevé de compte', subtitle: d.person.name,
      columns: [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'montant', label: 'Montant' }],
      rows: (d.entries ?? []).map((e) => ({ date: dt(e.created_at), type: e.type, montant: formatMoney(e.amount) })),
      totals: [{ label: 'SOLDE', value: formatMoney(d.solde) }],
    }),
  },
};

// Documents that are simply "a list of things" all share one shape, so they are
// generated rather than written out four more times.
const LISTS = {
  'liste-bons': {
    label: 'Liste des bons passagers', icon: 'bon', group: 'Listes', endpoint: '/bons?limit=500',
    pick: (d) => d.bons ?? [],
    columns: [
      { key: 'reference', label: 'Référence' },
      { key: 'fournisseur_name', label: 'Fournisseur' },
      { key: 'passager_name', label: 'Passager' },
      { key: 'status', label: 'Statut' },
      { key: 'transport_fee', label: 'Frais', align: 'r', format: (v) => formatMoney(v) },
      { key: 'created_at', label: 'Date', format: d10 },
    ],
    totals: (rows) => [{ label: 'TOTAL FRAIS', value: formatMoney(rows.reduce((s, r) => s + Number(r.transport_fee || 0), 0)) }],
  },
  'liste-ordres': {
    label: 'Liste des bons fournisseurs', icon: 'order', group: 'Listes', endpoint: '/orders?limit=500',
    pick: (d) => d.orders ?? [],
    columns: [
      { key: 'reference', label: 'Référence' },
      { key: 'fournisseur_name', label: 'Fournisseur' },
      { key: 'bon_count', label: 'Bons', align: 'r' },
      { key: 'status', label: 'Statut' },
      { key: 'total_fee', label: 'Total frais', align: 'r', format: (v) => formatMoney(v) },
      { key: 'created_at', label: 'Date', format: d10 },
    ],
  },
  'liste-articles': {
    label: 'Inventaire articles', icon: 'stock', group: 'Listes', endpoint: '/stock/items',
    pick: (d) => d.items ?? [],
    columns: [
      { key: 'name', label: 'Article' },
      { key: 'category_name', label: 'Catégorie' },
      { key: 'quantity', label: 'Quantité', align: 'r' },
      { key: 'unit', label: 'Unité' },
    ],
  },
  'liste-transferts': {
    label: 'Transferts inter-bureaux', icon: 'swap', group: 'Listes', endpoint: '/office-transfers',
    pick: (d) => d.transfers ?? [],
    columns: [
      { key: 'reference', label: 'Référence' },
      { key: 'from_office', label: 'De' },
      { key: 'to_office', label: 'Vers' },
      { key: 'amount', label: 'Montant', align: 'r', format: (v, r) => formatMoney(v, r.currency_code) },
      { key: 'status', label: 'Statut' },
      { key: 'sent_at', label: 'Envoyé le', format: d10 },
    ],
  },
  'liste-charges': {
    label: 'Charges / dépenses', icon: 'wallet', group: 'Listes', endpoint: '/charges',
    pick: (d) => d.charges ?? [],
    columns: [
      { key: 'label', label: 'Libellé' },
      { key: 'category', label: 'Catégorie' },
      { key: 'amount', label: 'Montant', align: 'r', format: (v, r) => formatMoney(v, r.currency_code) },
      { key: 'created_at', label: 'Date', format: d10 },
    ],
    totals: (rows) => [{ label: 'TOTAL', value: formatMoney(rows.reduce((s, r) => s + Number(r.amount || 0), 0)) }],
  },
  'liste-fournisseurs': {
    label: 'Répertoire fournisseurs', icon: 'fournisseur', group: 'Listes', endpoint: '/people?role=fournisseur',
    pick: (d) => d.people ?? [],
    columns: [
      { key: 'name', label: 'Nom' }, { key: 'phone', label: 'Téléphone' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  'liste-passagers': {
    label: 'Répertoire passagers', icon: 'passager', group: 'Listes', endpoint: '/people?role=passager',
    pick: (d) => d.people ?? [],
    columns: [
      { key: 'name', label: 'Nom' }, { key: 'passager_type', label: 'Type' },
      { key: 'phone', label: 'Téléphone' }, { key: 'notes', label: 'Notes' },
    ],
  },
  'liste-audit': {
    label: 'Journal d’audit', icon: 'audit', group: 'Listes', endpoint: '/audit?limit=300',
    pick: (d) => d.entries ?? [],
    columns: [
      { key: 'created_at', label: 'Date', format: dt },
      { key: 'action', label: 'Action' },
      { key: 'admin_name', label: 'Par' },
      { key: 'entity', label: 'Objet' },
    ],
  },
};

export default function ImpressionsPage() {
  const toast = useToast();
  const [doc, setDoc] = useState('bon');
  const [target, setTarget] = useState('');
  const [personType, setPersonType] = useState('');
  const [range, setRange] = useState(defaultRange);
  const [format, setFormat] = useState('a4');
  const [busy, setBusy] = useState(false);

  const settings = useApi('/settings');
  const societe = settings.data?.settings?.societe;

  const spec = DOCS[doc];
  const listSpec = LISTS[doc];
  const listUrl = spec ? (typeof spec.list === 'function' ? spec.list(personType) : spec.list) : null;
  const chooser = useApi(listUrl);

  const options = spec && chooser.data ? spec.options(chooser.data) : [];
  const needsTarget = Boolean(spec);

  const generate = async () => {
    if (needsTarget && !target) return;
    setBusy(true);
    try {
      let ok;
      if (spec) {
        const data = await spec.load(target, { range, personType });
        // Le code scannable, produit avant le document : les constructeurs sont
        // synchrones et reçoivent l'image toute faite.
        const qr = spec.scan ? await qrDataUrl(...spec.scan(data)) : null;
        ok = format === 'a4'
          ? openPrintWindow({
              title: spec.title(data), societe, docTitle: spec.docTitle,
              subtitle: spec.title(data), body: spec.a4(data, qr),
            })
          : openTicketWindow({ title: spec.title(data), mm: Number(format), body: spec.ticket(data, societe, qr) });
      } else {
        const payload = await api(listSpec.endpoint);
        const rows = listSpec.pick(payload);
        const totals = listSpec.totals ? listSpec.totals(rows) : [];
        ok = format === 'a4'
          ? openPrintWindow({
              title: listSpec.label, societe, docTitle: listSpec.label,
              subtitle: `${rows.length} ligne(s)`,
              body: tableDocBody({ columns: listSpec.columns, rows, totals }),
            })
          : openTicketWindow({
              title: listSpec.label, mm: Number(format),
              body: listTicket({
                societe, docLabel: listSpec.label, subtitle: `${rows.length} ligne(s)`,
                // The roll is narrow: print the first few columns, formatted.
                columns: listSpec.columns.slice(0, 4).map((c) => ({ key: c.key, label: c.label })),
                rows: rows.map((r) => Object.fromEntries(
                  listSpec.columns.slice(0, 4).map((c) => [c.key, c.format ? c.format(r[c.key], r) : r[c.key]])
                )),
                totals,
              }),
            });
      }
      if (!ok) toast.error('Fenêtre d’impression bloquée. Autorisez les pop-ups pour ce site.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const all = [
    ...Object.entries(DOCS).map(([key, v]) => ({ key, ...v })),
    ...Object.entries(LISTS).map(([key, v]) => ({ key, ...v })),
  ];
  const groups = ['Pièces', 'Finance', 'Listes'];

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="print" accent={ACCENT} title="Impressions"
        subtitle="Tout document en A4 (« Enregistrer au format PDF ») ou sur rouleau thermique 80 / 58 mm."
      />

      <div className="panel">
        <h2 className="panel-title">1. Choisir un document</h2>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 14 }}>
            <div className="pop-section-title">{g}</div>
            <div className="doc-grid">
              {all.filter((d) => d.group === g).map((d) => (
                <button
                  key={d.key}
                  className={`doc-card ${doc === d.key ? 'active' : ''}`}
                  onClick={() => { setDoc(d.key); setTarget(''); }}
                >
                  <span className="doc-ico"><IconEl name={d.icon} /></span>
                  <span className="doc-name">{d.label}</span>
                  {d.hint && <span className="doc-hint">{d.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="panel-title">2. {needsTarget ? 'Choisir la cible et le format' : 'Choisir le format'}</h2>
        <div className="op-form">
          {spec?.person && (
            <div className="field"><span>Filtrer par rôle</span>
              <OptionChips
                ariaLabel="Filtrer par rôle"
                value={personType}
                onChange={(v) => { setPersonType(v); setTarget(''); }}
                options={[
                  { value: '', label: 'Toutes' },
                  { value: 'fournisseur', label: 'Fournisseurs', icon: 'fournisseur' },
                  { value: 'passager', label: 'Passagers', icon: 'passager' },
                ]}
              /></div>
          )}

          {needsTarget && (
            <div className="field field-grow">
              <span>{spec.label}</span>
              <EntityPicker
                icon={spec.person ? 'users' : 'bon'}
                value={target}
                onChange={setTarget}
                options={options}
                loading={chooser.loading}
                labelOf={(o) => o.label}
                searchOf={(o) => o.label}
                placeholder={`Chercher — ${spec.label.toLowerCase()}`}
                emptyText="Rien ne correspond."
              />
            </div>
          )}

          {spec?.period && (
            <div className="field field-grow"><span>Période</span>
              <DateRangePicker value={range} onChange={setRange} />
            </div>
          )}

          <label className="field"><span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select></label>

          <button className="btn btn-gold" onClick={generate} disabled={busy || (needsTarget && !target)}>
            <IconEl name="print" />{busy ? 'Préparation…' : 'Imprimer'}
          </button>
        </div>

        {needsTarget && !chooser.loading && !options.length && (
          <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
            Rien à imprimer pour ce type de document pour le moment.
          </p>
        )}
      </div>

      {settings.loading && <Spinner label="Chargement de l’identité société…" />}
    </div>
  );
}
