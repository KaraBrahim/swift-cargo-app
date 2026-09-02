import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { BON_STATUS } from '../components/bonStatus.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { defaultCurrencyFor } from '../lib/offices.js';

const ENTRY_LABEL = {
  transport_fee: 'Frais de transport (dû)',
  fee_payment: 'Paiement du fournisseur',
  passager_due: 'Dû au passager',
  passager_payment: 'Paiement au passager',
  adjustment: 'Ajustement',
};
const TYPE_LABEL = { regular: 'Régulier', auto: 'Auto-entrepreneur' };

// balance > 0 → we owe them (payable). < 0 → they owe us (receivable).
function balanceState(type, value) {
  const n = Number(value);
  if (n === 0) return { text: 'Soldé', cls: 'muted' };
  if (type === 'fournisseur') return n < 0 ? { text: 'À recevoir', cls: 'neg' } : { text: 'Avoir', cls: 'pos' };
  return n > 0 ? { text: 'À payer', cls: 'pos' } : { text: 'Trop-perçu', cls: 'neg' };
}

export default function ProfilePage({ type }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isFournisseur = type === 'fournisseur';
  const base = isFournisseur ? 'fournisseurs' : 'passagers';
  const accent = isFournisseur ? 'var(--c-people)' : 'var(--c-stock)';

  const account = useApi(`/${base}/${id}/account`);
  const bons = useApi(`/bons?${isFournisseur ? 'fournisseurId' : 'passagerId'}=${id}&limit=200`);
  const orders = useApi(isFournisseur ? `/orders?fournisseurId=${id}&limit=200` : null);

  const [tab, setTab] = useState('apercu');
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const [pay, setPay] = useState({ caisseId: '', amount: '', note: '', currency: 'DZD' });
  const allPayments = useApi(`/accounts/payments?personType=${type}`);
  const [editPay, setEditPay] = useState(null);
  const [confirmPay, setConfirmPay] = useState(null);
  const [txForm, setTxForm] = useState(null);

  // Correcting a payment touches both the caisse and this account.
  const runPay = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      setEditPay(null);
      setConfirmPay(null);
      account.reload();
      allPayments.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (account.loading) return <Spinner />;
  if (account.error) return <div className="alert alert-error">{account.error}</div>;

  const { person, balances, entries } = account.data.account;
  const bonList = bons.data?.bons ?? [];
  const orderList = orders.data?.orders ?? [];

  const officeCaisses = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');
  const personPayments = (allPayments.data?.payments ?? []).filter((p) => String(p.person_id) === String(id));
  const dzd = balances.find((b) => b.currency_code === 'DZD')?.balance ?? '0';
  const state = balanceState(type, dzd);
  const totalFees = bonList.reduce((s, b) => s + Number(b.transport_fee || 0), 0);
  const activeBons = bonList.filter((b) => b.status !== 'regle').length;

  const openEdit = () => setEdit(isFournisseur
    ? { name: person.name, phone: person.phone || '', city: person.city || '', notes: person.notes || '' }
    : { full_name: person.name, type: person.type || 'regular', phone: person.phone || '', notes: person.notes || '' });

  // Settle the running balance directly from the profile: a fournisseur pays
  // down their debt (cash in), or we pay a passager what we owe (cash out).
  const submitPayment = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/${base}/${id}/payment`, {
        method: 'POST',
        body: { caisseId: Number(pay.caisseId), amount: pay.amount, currency: pay.currency, note: pay.note || undefined },
      });
      toast.success(isFournisseur ? 'Encaissement enregistré.' : 'Paiement enregistré.');
      setPay({ caisseId: '', amount: '', note: '', currency: 'DZD' });
      account.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/${base}/${id}`, { method: 'PUT', body: edit });
      toast.success('Profil mis à jour.');
      setEdit(null);
      account.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ '--accent': accent }}>
      <div className="page-head page-head-bar">
        <Link to={`/${base}`} className="btn-back">
          <IconEl name="chevronLeft" />Retour aux {isFournisseur ? 'fournisseurs' : 'passagers'}
        </Link>
        <span className="page-head-name">{person.name}</span>
      </div>

      {/* ── Hero ── */}
      <div className="profile-hero">
        <div className="avatar avatar-lg">{initialsOf(person.name)}</div>

        <div className="profile-id">
          <div className="profile-name">{person.name}</div>
          <div style={{ marginTop: 7 }}>
            <span className="badge badge-gold">{isFournisseur ? 'Fournisseur' : TYPE_LABEL[person.type] || 'Passager'}</span>
          </div>
          <div className="profile-meta">
            {person.phone && <span className="profile-meta-item"><IconEl name="phone" />{person.phone}</span>}
            {isFournisseur && person.city && <span className="profile-meta-item"><IconEl name="pin" />{person.city}</span>}
            {person.created_at && <span className="profile-meta-item"><IconEl name="calendar" />Depuis le {new Date(person.created_at).toLocaleDateString('fr-FR')}</span>}
            {person.notes && <span className="profile-meta-item"><IconEl name="note" />{person.notes}</span>}
          </div>
        </div>

        <div className="profile-actions">
          <button className="btn" onClick={() => (edit ? setEdit(null) : openEdit())}>
            <IconEl name="edit" />{edit ? 'Fermer' : 'Modifier'}
          </button>
        </div>

        <div className="profile-kpis">
          <div className="pk">
            <div className={`pk-val ${state.cls}`}>{formatMoney(Math.abs(Number(dzd)))} DZD</div>
            <div className="pk-label">Solde · {state.text}</div>
          </div>
          <div className="pk">
            <div className="pk-val">{bonList.length}</div>
            <div className="pk-label">Bons passagers au total</div>
          </div>
          <div className="pk">
            <div className="pk-val">{activeBons}</div>
            <div className="pk-label">Bons passagers en cours</div>
          </div>
          <div className="pk">
            <div className="pk-val">{formatMoney(totalFees)}</div>
            <div className="pk-label">Volume frais (DZD)</div>
          </div>
        </div>
      </div>

      {edit && (
        <form className="panel op-form" onSubmit={save}>
          {isFournisseur ? (
            <>
              <label className="field field-grow"><span>Nom</span>
                <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="field"><span>Téléphone</span>
                <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
              <label className="field"><span>Ville</span>
                <input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></label>
            </>
          ) : (
            <>
              <label className="field field-grow"><span>Nom complet</span>
                <input autoFocus value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></label>
              <label className="field"><span>Type</span>
                <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                  <option value="regular">Régulier</option>
                  <option value="auto">Auto-entrepreneur</option>
                </select></label>
              <label className="field"><span>Téléphone</span>
                <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
            </>
          )}
          <label className="field field-grow"><span>Notes</span>
            <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy}>Enregistrer</button>
        </form>
      )}

      {/* ── Tabs ── */}
      <div className="filter-bar">
        <div className="segmented">
          {[['apercu', 'Aperçu'], ['releve', 'Relevé'], ['bons', `Bons passagers (${bonList.length})`],
            ...(isFournisseur ? [['ordres', `Bons fournisseurs (${orderList.length})`]] : [])].map(([k, label]) => (
            <button key={k} className={tab === k ? 'seg-btn active' : 'seg-btn'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'apercu' && (
        <>
          <div className="balances-row">
            {balances.length === 0 && <div className="muted">Aucun mouvement.</div>}
            {balances.map((b) => {
              const st = balanceState(type, b.balance);
              return (
                <div key={b.currency_code} className={`balance-card ${b.currency_code === 'DZD' ? 'balance-primary balance-own' : ''}`}>
                  <div className="balance-code">{b.currency_code}</div>
                  <div className="balance-amount">{formatMoney(Math.abs(Number(b.balance)))}</div>
                  <div className={`balance-name ${st.cls}`}>{st.text}</div>
                </div>
              );
            })}
          </div>
          <div className="panel">
            <h2 className="panel-title">{isFournisseur ? 'Encaisser une dette' : 'Payer le passager'}</h2>
            <div className="money-head">
              <span className={`money-dir ${isFournisseur ? 'in' : 'out'}`}>{isFournisseur ? 'Entrée de caisse' : 'Sortie de caisse'}</span>
              <span>
                {Number(dzd) === 0
                  ? 'Ce compte est soldé.'
                  : isFournisseur
                    ? <>Ce fournisseur doit <strong className="neg">{formatMoney(Math.abs(Number(dzd)))} DZD</strong>.</>
                    : <>Vous devez <strong className="pos">{formatMoney(Math.abs(Number(dzd)))} DZD</strong> à ce passager.</>}
              </span>
            </div>
            <form className="op-form" onSubmit={submitPayment}>
              <label className="field"><span>{isFournisseur ? 'Caisse qui reçoit' : 'Caisse qui paie'}</span>
                <select
                  value={pay.caisseId}
                  onChange={(e) => {
                    const src = officeCaisses.find((c) => String(c.id) === e.target.value);
                    setPay({ ...pay, caisseId: e.target.value, currency: defaultCurrencyFor(src?.office) });
                  }}
                >
                  <option value="">— choisir —</option>
                  {officeCaisses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select></label>
              <label className="field"><span>Devise</span>
                <select value={pay.currency} onChange={(e) => setPay({ ...pay, currency: e.target.value })}>
                  {(currencies.data?.currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select></label>
              <label className="field"><span>Montant</span>
                <input inputMode="decimal" value={pay.amount} placeholder={formatMoney(Math.abs(Number(dzd)))}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(',', '.') })} /></label>
              <label className="field field-grow"><span>Note</span>
                <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="acompte, règlement partiel…" /></label>
              <button className="btn btn-gold" disabled={busy || !pay.caisseId || !(Number(pay.amount) > 0)}>
                {busy ? '…' : isFournisseur ? 'Encaisser' : 'Payer'}
              </button>
            </form>
            <p className="muted line-hint">
              Un montant partiel est accepté : le solde restant demeure {isFournisseur ? 'dû par le fournisseur' : 'dû au passager'}.
            </p>

            {/* Anything that is not a plain settlement: an advance, a refund, a
                bonus — in either direction, with or without touching a caisse. */}
            <div className="lines-head" style={{ marginTop: 18 }}>
              <span>Autre opération</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTxForm(txForm ? null : { direction: 'out', type: 'avance', amount: '', caisseId: '', note: '' })}>
                {txForm ? 'Fermer' : '+ Opération libre'}
              </button>
            </div>
            {txForm && (
              <form className="op-form" onSubmit={(e) => {
                e.preventDefault();
                runPay(() => api('/person-transactions', { method: 'POST', body: {
                  personType: type, personId: Number(id), direction: txForm.direction,
                  amount: txForm.amount, type: txForm.type,
                  caisseId: txForm.caisseId || undefined, note: txForm.note || undefined,
                } }), 'Opération enregistrée.');
                setTxForm(null);
              }}>
                <label className="field"><span>Sens</span>
                  <select value={txForm.direction} onChange={(e) => setTxForm({ ...txForm, direction: e.target.value })}>
                    <option value="out">Nous versons à cette personne</option>
                    <option value="in">Cette personne nous verse</option>
                  </select></label>
                <label className="field"><span>Nature</span>
                  <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value })}>
                    <option value="avance">Avance</option>
                    <option value="remboursement">Remboursement</option>
                    <option value="salaire">Salaire</option>
                    <option value="prime">Prime</option>
                    <option value="adjustment">Correction</option>
                    <option value="autre">Autre</option>
                  </select></label>
                <label className="field"><span>Montant</span>
                  <input inputMode="decimal" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value.replace(',', '.') })} /></label>
                <label className="field"><span>Caisse (optionnel)</span>
                  <select value={txForm.caisseId} onChange={(e) => setTxForm({ ...txForm, caisseId: e.target.value })}>
                    <option value="">— écriture seule, sans mouvement d’argent —</option>
                    {(caisses.data?.caisses ?? []).filter((c) => c.kind === 'office').map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select></label>
                <label className="field field-grow"><span>Note</span>
                  <input value={txForm.note} onChange={(e) => setTxForm({ ...txForm, note: e.target.value })} /></label>
                <button className="btn btn-gold" disabled={busy || !(Number(txForm.amount) > 0)}>Enregistrer</button>
              </form>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Paiements ({personPayments.length})</h2>
            {personPayments.length ? (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Sens</th><th>Caisse</th><th>Bon</th><th>Par</th><th className="right">Montant</th><th className="right">Actions</th></tr></thead>
                    <tbody>
                      {personPayments.map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                          <td><span className={`money-dir ${p.type === 'fee_payment' ? 'in' : 'out'}`}>{p.type === 'fee_payment' ? 'Encaissé' : 'Payé'}</span></td>
                          <td className="muted">{p.caisse_label || '—'}</td>
                          <td>{p.bon_reference ? <Link to={`/bons-passager/${p.bon_id}`} className="gold">{p.bon_reference}</Link> : <span className="muted">—</span>}</td>
                          <td className="muted">{p.admin_name}</td>
                          <td className={`right ${p.type === 'fee_payment' ? 'pos' : 'neg'}`}>
                            {formatMoney(Math.abs(Number(p.amount)))} {p.currency_code}
                          </td>
                          <td className="right nowrap">
                            <button className="icon-btn" title="Corriger le montant" aria-label="Corriger" disabled={busy}
                              onClick={() => setEditPay({ id: p.id, amount: String(Math.abs(Number(p.amount))), note: p.note || '', currency: p.currency_code })}>
                              <IconEl name="edit" />
                            </button>
                            <button className="icon-btn danger" title="Annuler ce paiement" aria-label="Annuler" disabled={busy}
                              onClick={() => setConfirmPay(p)}>
                              <IconEl name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {editPay && (
                  <form className="op-form" style={{ marginTop: 12, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      runPay(() => api(`/payments/${editPay.id}`, { method: 'PATCH', body: { amount: editPay.amount, note: editPay.note || undefined } }), 'Paiement corrigé.');
                    }}>
                    <div className="field field-grow"><span>Corriger le paiement</span>
                      <span className="muted">La caisse et ce compte sont réajustés ensemble.</span></div>
                    <label className="field"><span>Montant ({editPay.currency})</span>
                      <input autoFocus inputMode="decimal" value={editPay.amount}
                        onChange={(e) => setEditPay({ ...editPay, amount: e.target.value.replace(',', '.') })} /></label>
                    <label className="field field-grow"><span>Note</span>
                      <input value={editPay.note} onChange={(e) => setEditPay({ ...editPay, note: e.target.value })} /></label>
                    <button className="btn btn-gold" disabled={busy || !(Number(editPay.amount) > 0)}>Enregistrer</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditPay(null)}>Annuler</button>
                  </form>
                )}
              </>
            ) : <p className="muted pad" style={{ margin: 0 }}>Aucun paiement enregistré pour ce profil.</p>}
          </div>

          <div className="panel panel-accent">
            <h2 className="panel-title">Activité récente</h2>
            {entries.length ? (
              <ul className="timeline">
                {entries.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <span className="type-badge">{ENTRY_LABEL[e.type] || e.type}</span>
                    <span className={Number(e.amount) >= 0 ? 'pos' : 'neg'}>
                      {Number(e.amount) >= 0 ? '+' : '−'}{formatMoney(Math.abs(Number(e.amount)))} {e.currency_code}
                    </span>
                    <span className="muted">{new Date(e.created_at).toLocaleString('fr-FR')} · {e.admin_name}</span>
                    {(e.order_reference || e.bon_reference) && <span className="gold">{e.order_reference || e.bon_reference}</span>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon="trend" title="Aucune activité" sub="Les opérations liées à ce profil apparaîtront ici." />}
          </div>
        </>
      )}

      {tab === 'releve' && (
        <div className="panel">
          <h2 className="panel-title">Relevé de compte</h2>
          {entries.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Opération</th><th>Réf.</th><th className="right">Montant</th><th className="right">Solde</th><th>Par</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                      <td>{ENTRY_LABEL[e.type] || e.type}</td>
                      <td className="gold">{e.order_reference || e.bon_reference || '—'}</td>
                      <td className={`right ${Number(e.amount) >= 0 ? 'pos' : 'neg'}`}>
                        {Number(e.amount) >= 0 ? '+' : '−'}{formatMoney(Math.abs(Number(e.amount)))} {e.currency_code}
                      </td>
                      <td className="right">{formatMoney(e.balance_after)} {e.currency_code}</td>
                      <td>{e.admin_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Relevé vide" sub="Aucun mouvement financier pour ce profil." />}
        </div>
      )}

      {tab === 'bons' && (
        <div className="panel">
          <h2 className="panel-title">Bons passagers</h2>
          {bonList.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Référence</th><th>{isFournisseur ? 'Passager' : 'Fournisseur'}</th><th>Statut</th><th className="right">Frais</th><th className="right">Perte</th><th>Date</th></tr></thead>
                <tbody>
                  {bonList.map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                      <td><span className="gold">{b.reference}</span></td>
                      <td>{isFournisseur ? (b.passager_name || '—') : b.fournisseur_name}</td>
                      <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                      <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                      <td className={`right ${Number(b.loss_total) > 0 ? 'neg' : ''}`}>{formatMoney(b.loss_total)}</td>
                      <td>{new Date(b.created_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon="bon" title="Aucun bon passager" sub="Ce profil n'a encore aucun bon passager associé." />}
        </div>
      )}

      {tab === 'ordres' && (
        <div className="panel">
          <h2 className="panel-title">Bons fournisseurs</h2>
          {orderList.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Référence</th><th className="right">Bons passagers</th><th>Statut</th><th className="right">Total frais</th><th>Date</th></tr></thead>
                <tbody>
                  {orderList.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                      <td><span className="gold">{o.reference}</span></td>
                      <td className="right">{o.bon_count}</td>
                      <td>{o.status}</td>
                      <td className="right">{formatMoney(o.total_fee)}</td>
                      <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon="order" title="Aucun bon fournisseur" sub="Ce fournisseur n'a encore aucun bon fournisseur." />}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPay)}
        tone="danger"
        title="Annuler ce paiement ?"
        message={confirmPay
          ? `${confirmPay.type === 'fee_payment' ? 'Encaissement' : 'Paiement'} de ${formatMoney(Math.abs(Number(confirmPay.amount)))} ${confirmPay.currency_code}.`
          : ''}
        bullets={[
          confirmPay?.caisse_label ? `Retiré de la caisse « ${confirmPay.caisse_label} ».` : 'Retiré de la caisse.',
          isFournisseur ? 'La dette du fournisseur remonte du même montant.' : 'Ce que vous devez au passager remonte du même montant.',
        ]}
        confirmLabel="Annuler le paiement"
        busy={busy}
        onCancel={() => setConfirmPay(null)}
        onConfirm={() => runPay(() => api(`/payments/${confirmPay.id}`, { method: 'DELETE' }), 'Paiement annulé.')}
      />
    </div>
  );
}
