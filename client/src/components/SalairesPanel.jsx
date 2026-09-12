// Les salariés et leurs paies — l'onglet « Salaires » des charges.
//
// Trois façons de payer : le mois (montant proposé = dernier salaire mensuel
// versé, moins les acomptes déjà pris), un acompte avant la fin du mois, ou un
// montant libre. Chaque paie est une charge « salaire » qui sort d'une caisse.
import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { EmptyState, formatMoney, errorMessage, useToast, Spinner } from './ui.jsx';
import { IconEl } from './icons.jsx';
import AmountInput from './AmountInput.jsx';
import { useIdempotent } from '../lib/useIdempotent.js';
import { defaultCurrencyFor } from '../lib/offices.js';

const KINDS = [
  { key: 'mensuel', label: 'Payer le mois', hint: 'Le salaire du mois, proposé d’après le dernier versé.' },
  { key: 'acompte', label: 'Acompte', hint: 'Une partie avant la fin du mois — déduite du mois.' },
  { key: 'libre', label: 'Montant libre', hint: 'N’importe quel montant, sans toucher aux propositions.' },
];
const KIND_LABEL = { mensuel: 'Mois', acompte: 'Acompte', libre: 'Libre' };
const monthLabel = (p) => new Date(`${p}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function SalairesPanel({ offices, currencies }) {
  const toast = useToast();
  const idem = useIdempotent();
  const list = useApi('/employees');
  const [form, setForm] = useState(null);      // nouveau / modification d'un salarié
  const [pay, setPay] = useState(null);        // { employee, kind, amount, caisseId, note }
  const [history, setHistory] = useState(null); // id du salarié dont on montre les paies
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
  const caisseSub = (c, cur) => `${formatMoney(c.balances?.[cur] ?? 0, cur)} disponible`;

  const openPay = (e, kind) => setPay({
    employee: e, kind, caisseId: e.caisse_id || offices[0]?.id || '',
    amount: kind === 'mensuel' ? e.suggested : kind === 'acompte' ? '' : e.suggested_base, note: '',
  });

  const saveEmployee = (ev) => {
    ev.preventDefault();
    const body = { name: form.name.trim(), poste: form.poste || undefined, salary: form.salary || '0', currency: form.currency, caisseId: form.caisseId ? Number(form.caisseId) : undefined, note: form.note || undefined };
    run(() => (form.id ? api(`/employees/${form.id}`, { method: 'PATCH', body }) : api('/employees', { method: 'POST', body })),
      form.id ? 'Salarié modifié.' : 'Salarié ajouté.');
  };

  const submitPay = (ev) => {
    ev.preventDefault();
    run(() => idem((key) => api(`/employees/${pay.employee.id}/pay`, {
      method: 'POST', idem: key,
      body: { amount: pay.amount, kind: pay.kind, caisseId: Number(pay.caisseId), note: pay.note || undefined },
    })), `${KIND_LABEL[pay.kind]} versé à ${pay.employee.name}.`);
  };

  return (
    <>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{monthLabel(period)} · {employees.length} salarié(s)</span>
        <button className="btn btn-gold" onClick={() => setForm(form ? null : { name: '', poste: '', salary: '', currency: defaultCurrencyFor(offices[0]?.office), caisseId: offices[0]?.id ?? '', note: '' })}>
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouveau salarié'}
        </button>
      </div>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={saveEmployee}>
          <label className="field field-grow"><span>Nom</span><input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Poste</span><input value={form.poste || ''} onChange={(e) => setForm({ ...form, poste: e.target.value })} /></label>
          <label className="field"><span>Salaire mensuel</span><AmountInput value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} /></label>
          <label className="field"><span>Devise</span>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {(currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select></label>
          <label className="field"><span>Caisse habituelle</span>
            <select value={form.caisseId} onChange={(e) => setForm({ ...form, caisseId: e.target.value })}>
              <option value="">— au moment de payer —</option>
              {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
          <label className="field field-grow"><span>Note</span><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.name.trim()}>{form.id ? 'Enregistrer' : 'Ajouter'}</button>
        </form>
      )}

      {pay && (
        <form className="panel panel-accent op-form" onSubmit={submitPay}>
          <div className="field field-grow"><span>{KINDS.find((k) => k.key === pay.kind).label} — {pay.employee.name}</span>
            <span className="muted">{KINDS.find((k) => k.key === pay.kind).hint}
              {pay.kind === 'mensuel' && Number(pay.employee.advances_this_month) > 0 && ` Base ${formatMoney(pay.employee.suggested_base, pay.employee.currency_code)} − ${formatMoney(pay.employee.advances_this_month, pay.employee.currency_code)} d’acomptes.`}
            </span></div>
          <label className="field"><span>Montant ({pay.employee.currency_code})</span><AmountInput autoFocus value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></label>
          <label className="field"><span>Caisse qui paie</span>
            <select value={pay.caisseId} onChange={(e) => setPay({ ...pay, caisseId: e.target.value })}>
              {offices.map((c) => <option key={c.id} value={c.id}>{c.label} · {caisseSub(c, pay.employee.currency_code)}</option>)}
            </select></label>
          <label className="field field-grow"><span>Note</span><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !pay.caisseId || !(Number(pay.amount) > 0)}><IconEl name="arrowOut" />Payer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setPay(null)}>Annuler</button>
        </form>
      )}

      {employees.length ? (
        <div className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Salarié</th><th className="right">Salaire</th><th className="right">Proposé ce mois</th><th className="right">Payé ce mois</th><th>Dernier versement</th><th className="right">Actions</th>
              </tr></thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className={e.active ? '' : 'muted'}>
                    <td><strong>{e.name}</strong>{e.poste && <div className="muted" style={{ fontSize: '0.74rem' }}>{e.poste}</div>}</td>
                    <td className="right">{formatMoney(e.salary, e.currency_code)}</td>
                    <td className="right gold">{e.month_paid ? <span className="muted">mois payé</span> : formatMoney(e.suggested, e.currency_code)}</td>
                    <td className="right">{formatMoney(e.paid_this_month, e.currency_code)}{Number(e.advances_this_month) > 0 && <div className="muted" style={{ fontSize: '0.72rem' }}>dont {formatMoney(e.advances_this_month, e.currency_code)} d’acomptes</div>}</td>
                    <td>{e.last_paid_at ? <>{formatMoney(e.last_paid_amount, e.currency_code)} <span className="muted">· {KIND_LABEL[e.last_paid_kind]} · {new Date(e.last_paid_at).toLocaleDateString('fr-FR')}</span></> : <span className="muted">—</span>}</td>
                    <td className="right nowrap">
                      <button className="btn btn-sm btn-gold" disabled={!e.active || e.month_paid} onClick={() => openPay(e, 'mensuel')} title="Payer le mois">Mois</button>{' '}
                      <button className="btn btn-sm" disabled={!e.active} onClick={() => openPay(e, 'acompte')} title="Acompte">Acompte</button>{' '}
                      <button className="btn btn-sm" disabled={!e.active} onClick={() => openPay(e, 'libre')} title="Montant libre">Libre</button>{' '}
                      <button className="icon-btn" title="Historique" onClick={() => setHistory(history === e.id ? null : e.id)}><IconEl name="audit" /></button>
                      <button className="icon-btn" title="Modifier" onClick={() => setForm({ id: e.id, name: e.name, poste: e.poste || '', salary: e.salary, currency: e.currency_code, caisseId: e.caisse_id || '', note: e.note || '' })}><IconEl name="edit" /></button>
                    </td>
                  </tr>
                ))}
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
              <thead><tr><th>Date</th><th>Type</th><th>Mois</th><th>Caisse</th><th>Par</th><th className="right">Montant</th></tr></thead>
              <tbody>{payments.data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td><td>{KIND_LABEL[p.kind] ?? '—'}</td><td>{p.period}</td>
                  <td>{p.caisse_label}</td><td>{p.admin_name}</td><td className="right">{formatMoney(p.amount, p.currency_code)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted">Aucun versement.</p>}
        </div>
      )}
    </>
  );
}
