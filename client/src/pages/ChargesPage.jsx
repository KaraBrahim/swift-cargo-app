// The company's own running costs — internet, électricité, loyer, salaires…
// These are not tied to a fournisseur or a passager: they simply leave a caisse.
// A charge can be marked recurring and stamped with a month, so the monthly
// fees can be followed period by period.
import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader, EmptyState, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { defaultCurrencyFor } from '../lib/offices.js';
import AmountInput from '../components/AmountInput.jsx';

const ACCENT = 'var(--c-caisse)';
const CATEGORIES = [
  ['internet', 'Internet'], ['electricite', 'Électricité'], ['eau', 'Eau'],
  ['loyer', 'Loyer'], ['salaire', 'Salaire'], ['transport', 'Transport'],
  ['fourniture', 'Fournitures'], ['taxe', 'Taxe'], ['entretien', 'Entretien'], ['autre', 'Autre'],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);
const thisMonth = () => new Date().toISOString().slice(0, 7);
const EMPTY = { category: 'internet', label: '', amount: '', currency: 'DZD', caisseId: '', period: thisMonth(), recurring: true, note: '' };

export default function ChargesPage() {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const charges = useApi(`/charges${filter ? `?category=${filter}` : ''}`);
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const [form, setForm] = useState(null);
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      setForm(null); setEdit(null); setConfirm(null);
      charges.reload(); caisses.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (charges.loading || caisses.loading) return <Spinner />;
  const offices = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');
  const list = charges.data?.charges ?? [];
  const totals = charges.data?.totals ?? {};
  const byCat = charges.data?.byCategory ?? {};
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="wallet" accent={ACCENT} title="Charges & abonnements"
        subtitle="Dépenses de l’entreprise elle-même : internet, électricité, loyer, salaires…"
      >
        <button
          className="btn btn-gold"
          onClick={() => setForm(form ? null : {
            ...EMPTY,
            caisseId: offices[0]?.id ?? '',
            currency: defaultCurrencyFor(offices[0]?.office),
          })}
        >
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouvelle charge'}
        </button>
      </PageHeader>

      <div className="kpi-row">
        <div className="kpi-card kpi-static">
          <div className="kpi-ico"><IconEl name="arrowOut" /></div>
          <div>
            <div className="kpi-val neg">
              {Object.entries(totals).map(([c, v]) => formatMoney(v, c)).join(' · ') || '0,00 DZD'}
            </div>
            <div className="kpi-label">Total des charges</div>
            <div className="kpi-sub">{list.length} charge(s) enregistrée(s)</div>
          </div>
        </div>
        {topCats.map(([cat, v]) => (
          <div key={cat} className="kpi-card kpi-static">
            <div className="kpi-ico"><IconEl name="tag" /></div>
            <div>
              <div className="kpi-val">{formatMoney(v)}</div>
              <div className="kpi-label">{CAT_LABEL[cat] || cat}</div>
              <div className="kpi-sub">Cumul sur la période affichée</div>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={(e) => {
          e.preventDefault();
          run(() => api('/charges', { method: 'POST', body: {
            category: form.category, label: form.label.trim(), amount: form.amount,
            currency: form.currency, caisseId: Number(form.caisseId),
            period: form.period || undefined, recurring: form.recurring, note: form.note || undefined,
          } }), 'Charge enregistrée.');
        }}>
          <div className="money-head" style={{ flexBasis: '100%' }}>
            <span className="money-dir out">Sortie de caisse</span>
            <span>L’argent quitte la caisse choisie — cette dépense n’est liée à aucun fournisseur ni passager.</span>
          </div>
          <label className="field"><span>Catégorie</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="field field-grow"><span>Libellé</span>
            <input autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex. Abonnement fibre — bureau Chine" /></label>
          <label className="field"><span>Montant</span>
            <AmountInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></label>
          <label className="field"><span>Devise</span>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {(currencies.data?.currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select></label>
          <label className="field"><span>Payée depuis</span>
            <select
              value={form.caisseId}
              onChange={(e) => {
                const src = offices.find((c) => String(c.id) === e.target.value);
                setForm({ ...form, caisseId: e.target.value, currency: defaultCurrencyFor(src?.office) });
              }}
            >
              <option value="">— choisir —</option>
              {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
          <label className="field"><span>Période (AAAA-MM)</span>
            <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-08" /></label>
          <label className="field"><span>Récurrente</span>
            <select value={form.recurring ? '1' : '0'} onChange={(e) => setForm({ ...form, recurring: e.target.value === '1' })}>
              <option value="1">Oui — mensuelle</option>
              <option value="0">Non — ponctuelle</option>
            </select></label>
          <label className="field field-grow"><span>Note</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.label.trim() || !form.caisseId || !(Number(form.amount) > 0)}>
            Enregistrer la charge
          </button>
        </form>
      )}

      <div className="filter-bar">
        <div className="seg">
          <button type="button" className={!filter ? 'active' : ''} onClick={() => setFilter('')}>Toutes</button>
          {CATEGORIES.filter(([k]) => byCat[k]).map(([k, l]) => (
            <button key={k} type="button" className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      {edit && (
        <form className="panel panel-accent op-form" onSubmit={(e) => {
          e.preventDefault();
          run(() => api(`/charges/${edit.id}`, { method: 'PATCH', body: {
            label: edit.label.trim(), amount: edit.amount, category: edit.category,
            period: edit.period || undefined, recurring: edit.recurring, note: edit.note || undefined,
          } }), 'Charge modifiée.');
        }}>
          <div className="field field-grow"><span>Modifier la charge</span>
            <span className="muted">La sortie de caisse correspondante est réajustée.</span></div>
          <label className="field"><span>Catégorie</span>
            <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <label className="field field-grow"><span>Libellé</span>
            <input autoFocus value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></label>
          <label className="field"><span>Montant ({edit.currency_code})</span>
            <AmountInput value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} /></label>
          <label className="field"><span>Période</span>
            <input value={edit.period || ''} onChange={(e) => setEdit({ ...edit, period: e.target.value })} placeholder="2026-08" /></label>
          <button className="btn btn-gold" disabled={busy || !(Number(edit.amount) > 0)}>Enregistrer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}><IconEl name="close" />Annuler</button>
        </form>
      )}

      <div className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th>Période</th><th>Caisse</th><th>Par</th><th className="right">Montant</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {list.map((ch) => (
                  <tr key={ch.id}>
                    <td>{new Date(ch.created_at).toLocaleDateString('fr-FR')}</td>
                    <td><span className="badge badge-gold">{CAT_LABEL[ch.category] || ch.category}</span></td>
                    <td>{ch.label}{ch.recurring && <span className="muted"> · mensuelle</span>}</td>
                    <td className="muted">{ch.period || '—'}</td>
                    <td className="muted">{ch.caisse_label}</td>
                    <td className="muted">{ch.admin_name}</td>
                    <td className="right neg">− {formatMoney(ch.amount, ch.currency_code)}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" title="Modifier" aria-label="Modifier" disabled={busy}
                        onClick={() => setEdit({ id: ch.id, category: ch.category, label: ch.label, amount: String(ch.amount), period: ch.period, recurring: ch.recurring, note: ch.note || '', currency_code: ch.currency_code })}>
                        <IconEl name="edit" />
                      </button>
                      <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer" disabled={busy}
                        onClick={() => setConfirm(ch)}>
                        <IconEl name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="wallet" title="Aucune charge" sub="Enregistrez vos frais récurrents (internet, électricité, loyer…) pour les suivre mois par mois." />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        tone="danger"
        title={`Supprimer « ${confirm?.label} » ?`}
        message={confirm ? `${formatMoney(confirm.amount, confirm.currency_code)} — l’argent est remis dans la caisse « ${confirm.caisse_label} ».` : ''}
        confirmLabel="Supprimer"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => api(`/charges/${confirm.id}`, { method: 'DELETE' }), 'Charge supprimée.')}
      />
    </div>
  );
}
