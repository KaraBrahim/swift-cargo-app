import { useState } from 'react';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, PageHeader } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
// Une seule liste de libellés pour toute l'application : le journal, la cloche
// et le fil du tableau de bord disaient la même chose de trois façons, et une
// nouvelle action n'était traduite que dans celle qu'on avait pensé à mettre à
// jour — c'est ainsi que « person.create » a fini affiché tel quel.
import { activityLine } from '../components/activityLabels.js';

const ACCENT = 'var(--c-audit)';

// The domain half of `<domain>.<verb>` is the category. Server-side these map to
// the same prefixes — see CATEGORIES in audit.routes.js.
const CATEGORIES = [
  { key: '', label: 'Tout', domains: null },
  { key: 'connexion', label: 'Connexions', domains: ['auth'] },
  { key: 'caisse', label: 'Caisse', domains: ['caisse', 'person', 'payment'] },
  { key: 'bons', label: 'Bons', domains: ['bon', 'order'] },
  { key: 'transferts', label: 'Transferts', domains: ['transfer'] },
  { key: 'stock', label: 'Stock', domains: ['stock'] },
  { key: 'charges', label: 'Charges', domains: ['charge'] },
  { key: 'taux', label: 'Taux', domains: ['rate'] },
  { key: 'repertoire', label: 'Répertoire', domains: ['fournisseur', 'passager'] },
  { key: 'utilisateurs', label: 'Utilisateurs', domains: ['admin'] },
  { key: 'systeme', label: 'Système', domains: ['settings', 'print'] },
];

const STATUS = { cree: 'Créé', en_transit: 'En transit', arrive: 'Arrivé', regle: 'Réglé' };
const OFFICE = { china: 'Chine', algeria: 'Algérie' };

// Anything that removes or fails is worth spotting at a glance in a log that is
// mostly routine.
const toneOf = (action) =>
  /\.delete$|_failed$|\.cancel$|unreceive|\.forced$/.test(action) ? 'bad'
    : /\.create$|^auth\.login$|\.receive$|\.settle$/.test(action) ? 'good'
      : /update|correct|set_active|reset|\.set$/.test(action) ? 'warn' : '';

const money = (d) => (d.amount != null ? formatMoney(d.amount) + (d.currency ? ' ' + d.currency : '') : null);

// Turn the recorded payload into the sentence a person would have written.
// Falls back to nothing rather than to JSON: a wall of braces in the main
// column helps nobody, and an unreadable detail is worse than an empty one.
function describe(e) {
  const d = e.details;
  if (!d || typeof d !== 'object') return '';
  const bits = [];

  if (d.reference) bits.push(d.reference);
  if (d.name || d.full_name || d.label) bits.push(d.name || d.full_name || d.label);
  if (d.username) bits.push(`« ${d.username} »`);

  // A change of state reads as "before → after", whatever it is.
  if (d.from != null && d.to != null) {
    const f = STATUS[d.from] ?? (isNaN(d.from) ? d.from : formatMoney(d.from));
    const t = STATUS[d.to] ?? (isNaN(d.to) ? d.to : formatMoney(d.to));
    bits.push(`${f} → ${t}`);
  } else if (d.to != null && STATUS[d.to]) {
    bits.push(`vers ${STATUS[d.to]}`);
  }

  const amt = money(d);
  if (amt) bits.push(amt);
  if (d.dzd_per_unit) bits.push(`${formatMoney(d.dzd_per_unit)} DZD / unité`);
  if (d.passager_payment != null) bits.push(`payé ${formatMoney(d.passager_payment)}`);
  if (d.loss_total != null && Number(d.loss_total) > 0) bits.push(`manquants ${formatMoney(d.loss_total)}`);

  if (d.office) bits.push(OFFICE[d.office] || d.office);
  if (d.category) bits.push(d.category);
  if (d.type && !d.amount) bits.push(d.type);
  if (d.bons) bits.push(`${d.bons} bon${d.bons > 1 ? 's' : ''}`);
  if (d.active != null) bits.push(d.active ? 'activé' : 'désactivé');
  if (d.mode) bits.push(`${d.mode}${d.largeur ? ` · ${d.largeur} mm` : ''}${d.cible ? ` · ${d.cible}` : ''}`);
  if (d.reason) bits.push(d.reason);

  return bits.join(' · ');
}

export default function AuditPage() {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const qs = new URLSearchParams({ limit: '200' });
  if (category) qs.set('category', category);
  if (query) qs.set('search', query);
  const audit = useApi(`/audit?${qs}`);

  const counts = audit.data?.counts ?? [];
  const countFor = (domains) =>
    domains === null
      ? counts.reduce((a, c) => a + c.n, 0)
      : counts.filter((c) => domains.includes(c.domain)).reduce((a, c) => a + c.n, 0);

  const rows = audit.data?.entries ?? [];

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="audit"
        accent={ACCENT}
        title="Journal d'activité"
        subtitle="Qui a fait quoi, et quand."
      />

      <div className="audit-filters">
        <div className="seg audit-cats">
          {CATEGORIES.map((c) => {
            const n = countFor(c.domains);
            return (
              <button
                key={c.key}
                className={category === c.key ? 'active' : ''}
                onClick={() => setCategory(c.key)}
                disabled={n === 0 && c.key !== ''}
              >
                {c.label}
                {n > 0 && <span className="audit-count">{n}</span>}
              </button>
            );
          })}
        </div>

        <form
          className="audit-search"
          onSubmit={(ev) => { ev.preventDefault(); setQuery(search.trim()); }}
        >
          <IconEl name="search" />
          <input
            value={search}
            placeholder="Rechercher une référence, une personne…"
            onChange={(ev) => setSearch(ev.target.value)}
          />
          {query && (
            <button type="button" className="audit-clear" onClick={() => { setSearch(''); setQuery(''); }}>
              Effacer
            </button>
          )}
        </form>
      </div>

      <div className="panel">
        {audit.loading ? <Spinner /> : audit.error ? (
          <div className="alert alert-error">{audit.error}</div>
        ) : !rows.length ? (
          <p className="muted pad">Aucune activité pour ce filtre.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Quand</th><th>Action</th><th>Par</th><th>Détail</th></tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const summary = describe(e);
                  return (
                    <tr key={e.id}>
                      <td className="nowrap">{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                      <td>
                        <span className={`type-badge ${toneOf(e.action)}`}>
                          {activityLine(e).label}
                        </span>
                      </td>
                      <td>{e.admin_name || '—'}</td>
                      <td className="audit-summary">{summary || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
