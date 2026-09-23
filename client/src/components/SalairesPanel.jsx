// Les salaires — l'onglet « Salaires » des charges.
//
// Un salarié, un bouton : « Payer ». Le montant s'ouvre sur ce qui reste à
// verser ce mois-ci et se corrige ; verser en deux fois, c'est payer deux fois.
//
// Il y avait ici trois boutons — Mois, Acompte, Libre — qui obligeaient à
// classer un versement avant de pouvoir taper un chiffre. Un acompte n'est
// qu'un versement partiel du mois : la distinction n'apprenait rien à personne
// et se payait à chaque paie.
import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { EmptyState, formatMoney, errorMessage, useToast, Spinner } from './ui.jsx';
import { IconEl } from './icons.jsx';
import AmountInput from './AmountInput.jsx';
import { EntityPicker } from './EntityPicker.jsx';
import { useIdempotent } from '../lib/useIdempotent.js';
import { defaultCurrencyFor } from '../lib/offices.js';

const monthLabel = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const dt = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');

export function SalairesPanel({ offices, currencies }) {
  const toast = useToast();
  const idem = useIdempotent();
  const list = useApi('/employees');
  const [form, setForm] = useState(null);   // fiche salarié (nouveau / modification)
  const [pay, setPay] = useState(null);     // versement en cours
  const [history, setHistory] = useState(null);
  const payments = useApi(history ? `/employees/${history}/payments` : null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setForm(null); setPay(null); list.reload(); if (history) payments.reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (list.loading) return <Spinner />;
  const { employees = [], period } = list.data ?? {};
  const totalPaid = employees.reduce((s, e) => s + Number(e.paid_this_month), 0);
  const totalLeft = employees.reduce((s, e) => s + Number(e.remaining), 0);
  const cur0 = employees[0]?.currency_code || 'DZD';
  const caisseSub = (c, cur) => `${formatMoney(c.balances?.[cur] ?? 0, cur)} disponible`;

  const openPay = (e) => setPay({
    id: e.id, name: e.name, currency: e.currency_code,
    // Le cas ordinaire : solder le mois. Tout le reste est une correction du
    // chiffre, pas un autre mode à choisir.
    amount: Number(e.remaining) > 0 ? e.remaining : e.base,
    caisseId: e.caisse_id || offices[0]?.id || '', note: '',
  });

  const saveEmployee = (ev) => {
    ev.preventDefault();
    const body = {
      name: form.name.trim(), poste: form.poste || undefined, salary: form.salary || '0',
      currency: form.currency, caisseId: form.caisseId ? Number(form.caisseId) : undefined, note: form.note || undefined,
    };
    run(() => (form.id ? api(`/employees/${form.id}`, { method: 'PATCH', body }) : api('/employees', { method: 'POST', body })),
      form.id ? 'Salarié modifié.' : 'Salarié ajouté.');
  };

  const submitPay = (ev) => {
    ev.preventDefault();
    run(() => idem((key) => api(`/employees/${pay.id}/pay`, {
      method: 'POST', idem: key,
      body: { amount: pay.amount, caisseId: Number(pay.caisseId), note: pay.note || undefined },
    })), `${formatMoney(pay.amount, pay.currency)} versés à ${pay.name}.`);
  };

  return (
    <>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {monthLabel(period)} · {employees.length} salarié(s) · versé {formatMoney(totalPaid, cur0)}
          {totalLeft > 0 && <> · reste <strong className="gold">{formatMoney(totalLeft, cur0)}</strong></>}
        </span>
        <button className="btn btn-gold" onClick={() => { setPay(null); setForm(form ? null : { name: '', poste: '', salary: '', currency: defaultCurrencyFor(offices[0]?.office), caisseId: offices[0]?.id ?? '', note: '' }); }}>
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouveau salarié'}
        </button>
      </div>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={saveEmployee}>
          <label className="field field-grow"><span>Nom</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Poste</span>
            <input value={form.poste || ''} onChange={(e) => setForm({ ...form, poste: e.target.value })} /></label>
          <label className="field"><span>Salaire mensuel</span>
            <AmountInput value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} /></label>
          <label className="field"><span>Devise</span>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {(currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select></label>
          <label className="field"><span>Caisse habituelle</span>
            <select value={form.caisseId} onChange={(e) => setForm({ ...form, caisseId: e.target.value })}>
              <option value="">— choisie au moment de payer —</option>
              {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
          <label className="field field-grow"><span>Note</span>
            <input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.name.trim()}>{form.id ? 'Enregistrer' : 'Ajouter'}</button>
          {form.id && (
            <button type="button" className="btn btn-danger" disabled={busy}
              onClick={() => run(() => api(`/employees/${form.id}`, { method: 'PATCH', body: { active: false } }), 'Salarié désactivé.')}>
              Désactiver
            </button>
          )}
        </form>
      )}

      {pay && (
        <form className="panel panel-accent op-form" onSubmit={submitPay}>
          <div className="field field-grow"><span>Verser à {pay.name}</span>
            <span className="muted">Le montant s’ouvre sur ce qui reste ce mois-ci. Corrigez-le pour verser moins, ou plus.</span></div>
          <label className="field"><span>Montant ({pay.currency})</span>
            <AmountInput autoFocus value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></label>
          <div className="field field-grow"><span>Caisse qui paie</span>
            <EntityPicker
              icon="caisse" value={pay.caisseId} onChange={(v) => setPay({ ...pay, caisseId: v })}
              options={offices} labelOf={(c) => c.label} subOf={(c) => caisseSub(c, pay.currency)}
              searchOf={(c) => c.label} placeholder="Choisir la caisse" emptyText="Aucune caisse de bureau."
            /></div>
          <label className="field field-grow"><span>Note</span>
            <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="prime, rattrapage…" /></label>
          <button className="btn btn-gold" disabled={busy || !pay.caisseId || !(Number(pay.amount) > 0)}>
            <IconEl name="arrowOut" />Verser {formatMoney(Number(pay.amount || 0), pay.currency)}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPay(null)}>Annuler</button>
        </form>
      )}

      {employees.length ? (
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Salarié</th><th className="right">Salaire</th><th className="right">Versé ce mois</th>
                <th className="right">Reste</th><th>Dernier versement</th><th className="right">Actions</th>
              </tr></thead>
              <tbody>
                {employees.map((e) => {
                  const left = Number(e.remaining);
                  return (
                    <tr key={e.id}>
                      <td><strong>{e.name}</strong>{e.poste && <div className="muted" style={{ fontSize: '0.74rem' }}>{e.poste}</div>}</td>
                      <td className="right">{formatMoney(e.base, e.currency_code)}</td>
                      <td className="right">{formatMoney(e.paid_this_month, e.currency_code)}</td>
                      <td className={`right ${left > 0 ? 'gold' : 'muted'}`}>
                        {left > 0 ? formatMoney(left, e.currency_code) : 'à jour'}
                      </td>
                      <td>{e.last_paid_at
                        ? <>{formatMoney(e.last_paid_amount, e.currency_code)} <span className="muted">· {dt(e.last_paid_at)}</span></>
                        : <span className="muted">—</span>}</td>
                      <td className="right nowrap">
                        <button className="btn btn-sm btn-gold" onClick={() => { setForm(null); openPay(e); }}>
                          <IconEl name="arrowOut" />Payer
                        </button>{' '}
                        <button className="icon-btn" title="Versements" onClick={() => setHistory(history === e.id ? null : e.id)}>
                          <IconEl name="audit" />
                        </button>
                        <button className="icon-btn" title="Modifier"
                          onClick={() => { setPay(null); setForm({ id: e.id, name: e.name, poste: e.poste || '', salary: e.salary, currency: e.currency_code, caisseId: e.caisse_id || '', note: e.note || '' }); }}>
                          <IconEl name="edit" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState icon="users" title="Aucun salarié" sub="Ajoutez les personnes que l’entreprise paie chaque mois." />
      )}

      {history && (
        <div className="panel">
          <h2 className="panel-title">Versements — {employees.find((e) => e.id === history)?.name}</h2>
          {payments.loading ? <Spinner /> : (payments.data?.payments ?? []).length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Mois</th><th>Caisse</th><th>Par</th><th>Note</th><th className="right">Montant</th></tr></thead>
              <tbody>{payments.data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td><td>{p.period}</td>
                  <td>{p.caisse_label}</td><td>{p.admin_name}</td><td className="muted">{p.note || '—'}</td>
                  <td className="right">{formatMoney(p.amount, p.currency_code)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted">Aucun versement.</p>}
        </div>
      )}
    </>
  );
}
