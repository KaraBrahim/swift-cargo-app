import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, Money, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { RoleBadges } from '../components/RolePicker.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { defaultCurrencyFor, leadCurrencyFor, sortByImportance } from '../lib/offices.js';
import AmountInput from '../components/AmountInput.jsx';

const OFFICE_LABEL = { china: 'Bureau Chine', algeria: 'Bureau Algérie' };

export default function CaissesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { admin } = useAuth();
  // Reshaping the tills themselves is a super-admin act.
  const isSuper = admin?.role === 'superadmin';
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const transfers = useApi('/office-transfers');
  const debts = useApi('/accounts/debts');
  const [debtTab, setDebtTab] = useState('toPay');
  // Le compte ne distingue plus fournisseur et passager — une même personne
  // peut être les deux — donc on filtre sur le SENS de l'argent, qui reste vrai.
  const [payFilter, setPayFilter] = useState('');
  const payments = useApi('/accounts/payments');

  const [form, setForm] = useState({ fromCaisseId: '', toCaisseId: '', currency: 'DZD', amount: '', note: '' });
  // Set when a confirmation fails for lack of funds — carries the numbers the
  // dialog needs so the person deciding sees them, not just "insufficient".
  const [shortfall, setShortfall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState(null); // null=closed; { id?, label }
  const [editTransfer, setEditTransfer] = useState(null);
  const [confirmTransfer, setConfirmTransfer] = useState(null); // { mode:'delete'|'unreceive', t }
  const [editPayment, setEditPayment] = useState(null);
  const [confirmPayment, setConfirmPayment] = useState(null);

  // Transfer corrections all touch caisse balances, so they share one runner.
  const runTransfer = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      setConfirmTransfer(null);
      setEditTransfer(null);
      setEditPayment(null);
      setConfirmPayment(null);
      caisses.reload();
      transfers.reload();
      debts.reload();
      payments.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const saveWallet = async (e) => {
    e.preventDefault();
    if (!wallet.label.trim()) return;
    try {
      if (wallet.id) await api(`/caisses/${wallet.id}`, { method: 'PUT', body: { label: wallet.label } });
      else await api('/caisses', { method: 'POST', body: { label: wallet.label } });
      toast.success('Caisse enregistrée.');
      setWallet(null);
      caisses.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const removeWallet = async (id) => {
    try {
      await api(`/caisses/${id}/active`, { method: 'POST', body: { active: false } });
      toast.success('Caisse retirée.');
      caisses.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (caisses.loading || currencies.loading) return <Spinner />;
  if (caisses.error) return <div className="alert alert-error">{caisses.error}</div>;

  const curList = currencies.data?.currencies ?? [];
  const offices = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');

  const reload = () => { caisses.reload(); transfers.reload(); debts.reload(); payments.reload(); };

  const send = async (e) => {
    e.preventDefault();
    if (!form.fromCaisseId || !form.toCaisseId || !(Number(form.amount) > 0)) return;
    setBusy(true);
    try {
      await api('/office-transfers', {
        method: 'POST',
        body: { ...form, fromCaisseId: Number(form.fromCaisseId), toCaisseId: Number(form.toCaisseId) },
      });
      toast.success('Transfert créé. Il attend la confirmation du bureau destinataire.');
      setForm({ fromCaisseId: '', toCaisseId: '', currency: 'DZD', amount: '', note: '' });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Confirming is what moves the money — both caisses at once. If the sending
  // caisse has been emptied in the meantime the server refuses and tells us by
  // how much; that is a decision for a person, so it becomes a dialog rather
  // than a red toast.
  const receive = async (t, force = false) => {
    setBusy(true);
    try {
      await api(`/office-transfers/${t.id}/receive`, { method: 'POST', body: force ? { force: true } : {} });
      toast.success(force ? 'Réception confirmée — caisse d’origine en négatif.' : 'Réception confirmée.');
      setShortfall(null);
      reload();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_FUNDS') {
        setShortfall({ transfer: t, ...err.details });
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  // Awaiting confirmation — surfaced at the top of the page, and the same rows
  // the Transferts table lists below.
  const pending = (transfers.data?.transfers ?? []).filter((t) => t.status === 'envoye');

  const cancelPending = (t) =>
    runTransfer(async () => {
      await api(`/office-transfers/${t.id}`, { method: 'DELETE' });
      setShortfall(null);
    }, 'Transfert annulé.');

  return (
    <div>
      <div className="page-head">
        <h1>Caisses</h1>
        <p className="muted">Deux caisses de bureau · le DZD est la devise de référence.</p>
      </div>

      <div className="caisse-list">
        {(caisses.data?.caisses ?? []).map((c) => (
          <Link key={c.id} to={`/caisses/${c.id}`} className="caisse-card">
            <div className="caisse-head">
              <span className="caisse-label">{c.label}</span>
              <span className="badge badge-gold">{OFFICE_LABEL[c.office] || c.kind}</span>
            </div>
            <div className="bal-grid">
              {sortByImportance(curList.map((x) => x.code), c.office).map((code) => (
                <div key={code} className={`bal-cell ${code === leadCurrencyFor(c.office) ? 'bal-own' : ''}`}>
                  <span className="bal-code">{code}</span>
                  <Money className="bal-val" value={c.balances?.[code] ?? '0'} />
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {/* A transfer waiting to be confirmed is the only thing on this page that
          asks something of you right now, and the table it lives in is five
          panels down. So it also appears here, directly under the caisses, with
          the button that settles it. */}
      {pending.length > 0 && (
        <div className="pending-strip">
          <div className="pending-title">
            <IconEl name="swap" />
            {pending.length === 1 ? '1 transfert à confirmer' : `${pending.length} transferts à confirmer`}
          </div>
          {pending.map((t) => (
            <div className="pending-row" key={t.id}>
              <span className="gold">{t.reference}</span>
              <span className="muted">{OFFICE_LABEL[t.from_office]} → {OFFICE_LABEL[t.to_office]}</span>
              <strong>{formatMoney(t.amount, t.currency_code)}</strong>
              <button className="btn btn-sm btn-gold" disabled={busy} onClick={() => receive(t)}>
                Confirmer la réception
              </button>
            </div>
          ))}
          <p className="muted pending-hint">
            Rien n’a encore bougé : les deux caisses changeront à la confirmation.
          </p>
        </div>
      )}

      {/* ── What is still owed, both directions ── */}
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 className="panel-title">Dettes en cours</h2>
          <div className="seg">
            {[['toPay', 'À payer'], ['toCollect', 'À encaisser']].map(([k, label]) => (
              <button key={k} type="button" className={debtTab === k ? 'active' : ''} onClick={() => setDebtTab(k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="money-head">
          <span className={`money-dir ${debtTab === 'toPay' ? 'out' : 'in'}`}>
            {debtTab === 'toPay' ? 'Sortie à venir' : 'Entrée à venir'}
          </span>
          <span>
            {debtTab === 'toPay'
              ? <>Ce que vous <strong>devez encore</strong> — principalement aux passagers pour les services rendus.</>
              : <>Ce qu’on vous <strong>doit encore</strong> — principalement les fournisseurs pour le transport.</>}
          </span>
          <span className="debt-total">
            {Object.entries(debts.data?.totals?.[debtTab] ?? {}).map(([cur, v]) => (
              <strong key={cur} className={debtTab === 'toPay' ? 'pos' : 'neg'}>{formatMoney(v, cur)}</strong>
            ))}
            {!Object.keys(debts.data?.totals?.[debtTab] ?? {}).length && <strong className="muted">0,00</strong>}
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Personne</th><th>Type</th><th>Téléphone</th><th>Dernier mouvement</th><th className="right">Montant</th><th className="right">Action</th></tr></thead>
            <tbody>
              {(debts.data?.[debtTab] ?? []).map((d) => (
                <tr key={`${d.person_type}-${d.person_id}-${d.currency_code}`} className="clickable"
                  onClick={() => navigate(`/personnes/${d.person_id}`)}>
                  <td><span className="gold">{d.person_name}</span></td>
                  <td className="nowrap"><RoleBadges person={d} /></td>
                  <td className="muted">{d.phone || '—'}</td>
                  <td className="muted">{d.last_activity ? new Date(d.last_activity).toLocaleDateString('fr-FR') : '—'}</td>
                  <td className={`right ${debtTab === 'toPay' ? 'pos' : 'neg'}`}>
                    {formatMoney(Math.abs(Number(d.balance)), d.currency_code)}
                  </td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm"
                      onClick={() => navigate(`/personnes/${d.person_id}`)}>
                      {debtTab === 'toPay' ? 'Payer' : 'Encaisser'}
                    </button>
                  </td>
                </tr>
              ))}
              {!(debts.data?.[debtTab] ?? []).length && (
                <tr><td colSpan="6" className="muted pad">
                  {debtTab === 'toPay' ? 'Vous ne devez rien à personne.' : 'Personne ne vous doit rien.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Everything already settled in cash ── */}
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 className="panel-title">Paiements effectués</h2>
          <div className="seg">
            {[['', 'Tous'], ['fee_payment', 'Encaissés'], ['passager_payment', 'Payés']].map(([k, label]) => (
              <button key={k || 'all'} type="button" className={payFilter === k ? 'active' : ''} onClick={() => setPayFilter(k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="money-head money-stats">
          <span className="money-stat">
            <span className="money-dir in">Encaissé</span>
            {Object.entries(payments.data?.totals?.collected ?? {}).map(([cur, v]) => (
              <strong key={cur} className="pos">{formatMoney(v, cur)}</strong>
            ))}
            {!Object.keys(payments.data?.totals?.collected ?? {}).length && <strong className="muted">0,00 DZD</strong>}
          </span>
          <span className="money-stat">
            <span className="money-dir out">Payé</span>
            {Object.entries(payments.data?.totals?.paid ?? {}).map(([cur, v]) => (
              <strong key={cur} className="neg">{formatMoney(v, cur)}</strong>
            ))}
            {!Object.keys(payments.data?.totals?.paid ?? {}).length && <strong className="muted">0,00 DZD</strong>}
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Sens</th><th>Personne</th><th>Caisse</th><th>Bon</th><th>Par</th><th className="right">Montant</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {(payments.data?.payments ?? []).filter((p) => !payFilter || p.type === payFilter).map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                  <td><span className={`money-dir ${p.type === 'fee_payment' ? 'in' : 'out'}`}>{p.type === 'fee_payment' ? 'Encaissé' : 'Payé'}</span></td>
                  <td className="clickable-cell" onClick={() => navigate(`/personnes/${p.person_id}`)}>
                    <span className="gold">{p.person_name}</span>
                  </td>
                  <td className="muted">{p.caisse_label || '—'}</td>
                  <td>{p.bon_reference ? <Link to={`/bons-passager/${p.bon_id}`} className="gold">{p.bon_reference}</Link> : <span className="muted">—</span>}</td>
                  <td className="muted">{p.admin_name}</td>
                  <td className={`right ${p.type === 'fee_payment' ? 'pos' : 'neg'}`}>
                    {p.type === 'fee_payment' ? '+' : '−'}{formatMoney(Math.abs(Number(p.amount)), p.currency_code)}
                  </td>
                  <td className="right nowrap">
                    <button className="icon-btn" title="Corriger le montant" aria-label="Corriger"
                      disabled={busy} onClick={() => setEditPayment({ id: p.id, amount: String(Math.abs(Number(p.amount))), note: p.note || '', currency: p.currency_code, person: p.person_name })}>
                      <IconEl name="edit" />
                    </button>
                    <button className="icon-btn danger" title="Annuler ce paiement" aria-label="Annuler"
                      disabled={busy} onClick={() => setConfirmPayment(p)}>
                      <IconEl name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
              {!(payments.data?.payments ?? []).length && <tr><td colSpan="8" className="muted pad">Aucun paiement enregistré.</td></tr>}
            </tbody>
          </table>
        </div>
        {editPayment && (
          <form
            className="op-form"
            style={{ marginTop: 12, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
            onSubmit={(e) => {
              e.preventDefault();
              runTransfer(
                () => api(`/payments/${editPayment.id}`, { method: 'PATCH', body: { amount: editPayment.amount, note: editPayment.note || undefined } }),
                'Paiement corrigé.'
              );
            }}
          >
            <div className="field field-grow"><span>Corriger le paiement — {editPayment.person}</span>
              <span className="muted">La caisse et le compte de la personne sont réajustés ensemble.</span></div>
            <label className="field"><span>Montant ({editPayment.currency})</span>
              <AmountInput autoFocus value={editPayment.amount}
                onChange={(v) => setEditPayment({ ...editPayment, amount: v })} /></label>
            <label className="field field-grow"><span>Note</span>
              <input value={editPayment.note} onChange={(e) => setEditPayment({ ...editPayment, note: e.target.value })} /></label>
            <button className="btn btn-gold" disabled={busy || !(Number(editPayment.amount) > 0)}>Enregistrer</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditPayment(null)}><IconEl name="close" />Annuler</button>
          </form>
        )}
        <p className="muted line-hint">
          Corriger ou annuler un paiement met à jour la caisse <strong>et</strong> le compte de la personne, où qu’il ait été saisi.
        </p>
      </div>

      {/* ── Manage wallets (caisses) — superadmin only ── */}
      {isSuper && (
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 className="panel-title">Gérer les caisses</h2>
          <button className="btn btn-gold" onClick={() => setWallet(wallet ? null : { label: '' })}>
            <IconEl name={wallet ? 'close' : 'plus'} />{wallet ? 'Fermer' : 'Nouvelle caisse'}
          </button>
        </div>
        {wallet && (
          <form className="op-form" onSubmit={saveWallet} style={{ marginBottom: 14 }}>
            <label className="field field-grow"><span>{wallet.id ? 'Renommer la caisse' : 'Nom de la nouvelle caisse'}</span>
              <input autoFocus value={wallet.label} onChange={(e) => setWallet({ ...wallet, label: e.target.value })} placeholder="ex. Caisse Chine 2" /></label>
            <button className="btn btn-gold" disabled={!wallet.label.trim()}>{wallet.id ? 'Modifier' : 'Créer'}</button>
          </form>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nom</th><th>Bureau</th><th></th></tr></thead>
            <tbody>
              {(caisses.data?.caisses ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>{OFFICE_LABEL[c.office] || '—'}</td>
                  <td className="right nowrap">
                    <button className="btn btn-ghost btn-sm" onClick={() => setWallet({ id: c.id, label: c.label })}>Renommer</button>{' '}
                    <button className="btn btn-ghost btn-sm" onClick={() => removeWallet(c.id)}>Retirer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* ── Cash transfers between caisses — the only kind there is ── */}
      <div className="panel" style={{ marginTop: 24 }}>
        <h2 className="panel-title">Transferts</h2>
        <div className="money-head">
          <span className="money-dir out">En attente de confirmation</span>
          <span>
            L’envoi ne déplace <strong>aucun argent</strong> : il annonce le transfert. Les deux caisses ne
            bougent qu’à la <strong>confirmation de la réception</strong>, et elles bougent ensemble.
          </span>
        </div>
        <p className="muted line-hint">
          Tant qu’un transfert n’est pas confirmé, il peut être corrigé ou annulé sans conséquence — rien n’a
          encore bougé. Une fois confirmé, il faut d’abord annuler la réception.
        </p>

        <form className="op-form" onSubmit={send}>
          <label className="field"><span>Depuis la caisse</span>
            <select
              value={form.fromCaisseId}
              onChange={(e) => {
                // Pre-select the currency this desk works in — still changeable.
                const src = offices.find((c) => String(c.id) === e.target.value);
                setForm({ ...form, fromCaisseId: e.target.value, currency: defaultCurrencyFor(src?.office) });
              }}
            >
              <option value="">— choisir —</option>
              {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
          <label className="field"><span>Vers la caisse</span>
            <select value={form.toCaisseId} onChange={(e) => setForm({ ...form, toCaisseId: e.target.value })}>
              <option value="">— choisir —</option>
              {offices.filter((c) => String(c.id) !== String(form.fromCaisseId)).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select></label>
          <label className="field"><span>Devise</span>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {curList.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select></label>
          <label className="field"><span>Montant</span>
            <AmountInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} placeholder="0.00" /></label>
          <label className="field field-grow"><span>Note</span>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.fromCaisseId || !form.toCaisseId || !(Number(form.amount) > 0)}>Envoyer</button>
        </form>

        {editTransfer && (
          <form
            className="op-form panel-accent"
            style={{ marginTop: 14, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
            onSubmit={(e) => {
              e.preventDefault();
              runTransfer(
                () => api(`/office-transfers/${editTransfer.id}`, { method: 'PATCH', body: { amount: editTransfer.amount, note: editTransfer.note || undefined } }),
                'Transfert corrigé.'
              );
            }}
          >
            <div className="field field-grow"><span>Corriger {editTransfer.reference}</span>
              <span className="muted">Rien n’a encore bougé : seul le montant annoncé change.</span></div>
            <label className="field"><span>Montant</span>
              <AmountInput autoFocus value={editTransfer.amount}
                onChange={(v) => setEditTransfer({ ...editTransfer, amount: v })} /></label>
            <label className="field field-grow"><span>Note</span>
              <input value={editTransfer.note} onChange={(e) => setEditTransfer({ ...editTransfer, note: e.target.value })} /></label>
            <button className="btn btn-gold" disabled={busy || !(Number(editTransfer.amount) > 0)}>Enregistrer</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditTransfer(null)}><IconEl name="close" />Annuler</button>
          </form>
        )}

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="table">
            <thead><tr><th>Référence</th><th>Trajet</th><th className="right">Montant</th><th>Statut</th><th>Envoyé / reçu par</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {(transfers.data?.transfers ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="gold">{t.reference}</td>
                  <td>{OFFICE_LABEL[t.from_office]} → {OFFICE_LABEL[t.to_office]}</td>
                  <td className="right">{formatMoney(t.amount, t.currency_code)}</td>
                  <td><span className={`status-badge ${t.status === 'recu' ? 'st-regle' : 'st-transit'}`}>{t.status === 'recu' ? 'Reçu' : 'À confirmer'}</span></td>
                  <td className="muted">{t.status === 'recu' ? t.received_by_name : t.sent_by_name}</td>
                  <td className="right nowrap">
                    {t.status === 'envoye' ? (
                      <>
                        <button className="btn btn-sm" onClick={() => receive(t)}>Confirmer réception</button>
                        <button className="icon-btn" title="Corriger le montant" aria-label="Corriger"
                          disabled={busy} onClick={() => setEditTransfer({ id: t.id, reference: t.reference, amount: t.amount, note: t.note || '' })}>
                          <IconEl name="edit" />
                        </button>
                        <button className="icon-btn danger" title="Supprimer le transfert" aria-label="Supprimer"
                          disabled={busy} onClick={() => setConfirmTransfer({ mode: 'delete', t })}>
                          <IconEl name="trash" />
                        </button>
                      </>
                    ) : (
                      <button className="icon-btn" title="Annuler la réception (remet le transfert en route)" aria-label="Annuler la réception"
                        disabled={busy} onClick={() => setConfirmTransfer({ mode: 'unreceive', t })}>
                        <IconEl name="refresh" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!(transfers.data?.transfers ?? []).length && <tr><td colSpan="6" className="muted pad">Aucun transfert.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* The sending caisse no longer covers the amount. Neither answer is
          obviously right — the cash may really have arrived, or the transfer may
          be stale — so the numbers go in front of a person. */}
      <ConfirmDialog
        open={Boolean(shortfall)}
        tone="warn"
        title="Solde insuffisant à l’origine"
        message={shortfall
          ? `La caisse d’origine ne contient que ${formatMoney(shortfall.available, shortfall.currency)}, alors que le transfert ${shortfall.transfer.reference} est de ${formatMoney(shortfall.required, shortfall.currency)}.`
          : ''}
        bullets={[
          'Confirmer quand même : l’argent est enregistré des deux côtés et la caisse d’origine passe en négatif — le signe qu’une entrée y manque.',
          'Annuler le transfert : la ligne disparaît. Rien n’avait bougé, il n’y a rien à défaire.',
        ]}
        confirmLabel="Confirmer quand même"
        extraLabel="Annuler le transfert"
        cancelLabel="Fermer"
        busy={busy}
        onCancel={() => setShortfall(null)}
        onExtra={() => cancelPending(shortfall.transfer)}
        onConfirm={() => receive(shortfall.transfer, true)}
      />

      <ConfirmDialog
        open={Boolean(confirmPayment)}
        tone="danger"
        title="Annuler ce paiement ?"
        message={confirmPayment
          ? `${confirmPayment.type === 'fee_payment' ? 'Encaissement' : 'Paiement'} de ${formatMoney(Math.abs(Number(confirmPayment.amount)), confirmPayment.currency_code)} — ${confirmPayment.person_name}.`
          : ''}
        bullets={[
          confirmPayment?.caisse_label ? `Retiré de la caisse « ${confirmPayment.caisse_label} ».` : 'Retiré de la caisse.',
          'Le compte de la personne redevient débiteur / créditeur du même montant.',
        ]}
        confirmLabel="Annuler le paiement"
        busy={busy}
        onCancel={() => setConfirmPayment(null)}
        onConfirm={() => runTransfer(() => api(`/payments/${confirmPayment.id}`, { method: 'DELETE' }), 'Paiement annulé.')}
      />

      <ConfirmDialog
        open={confirmTransfer?.mode === 'delete'}
        tone="danger"
        title={`Supprimer le transfert ${confirmTransfer?.t?.reference} ?`}
        message="L’argent est remis dans la caisse d’origine et le transfert disparaît."
        bullets={['Possible uniquement tant que le bureau destinataire n’a pas confirmé la réception.']}
        confirmLabel="Supprimer"
        busy={busy}
        onCancel={() => setConfirmTransfer(null)}
        onConfirm={() => runTransfer(
          () => api(`/office-transfers/${confirmTransfer.t.id}`, { method: 'DELETE' }),
          'Transfert supprimé.'
        )}
      />

      <ConfirmDialog
        open={confirmTransfer?.mode === 'unreceive'}
        tone="danger"
        title={`Annuler la réception de ${confirmTransfer?.t?.reference} ?`}
        message="L’entrée enregistrée par le bureau destinataire est retirée et le transfert repasse « en route »."
        bullets={['À faire avant de pouvoir corriger ou supprimer un transfert déjà reçu.']}
        confirmLabel="Annuler la réception"
        busy={busy}
        onCancel={() => setConfirmTransfer(null)}
        onConfirm={() => runTransfer(
          () => api(`/office-transfers/${confirmTransfer.t.id}/unreceive`, { method: 'POST', body: {} }),
          'Réception annulée.'
        )}
      />
    </div>
  );
}
