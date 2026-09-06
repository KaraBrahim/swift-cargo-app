import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { BON_STATUS, STATUS_ORDER } from '../components/bonStatus.js';
import { IconEl } from '../components/icons.jsx';
import { PrintButton } from '../components/PrintButton.jsx';
import { bonDocBody } from '../components/printDocument.js';
import { bonTicket } from '../components/printTicket.js';
import { LineEditor, emptyLine, lineValid, lineTotal } from '../components/LineEditor.jsx';
import { GoodsPicker, pickedValid, pickedTotal, pickedToLine } from '../components/GoodsPicker.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import AmountInput from '../components/AmountInput.jsx';
import { formatQty } from '../lib/format.js';

const NEXT_LABEL = { cree: 'Marquer « En transit »', en_transit: 'Marquer « Arrivé »' };
const q3 = (v) => formatQty(v);

// Convert a stored bon line back into the editable line shape. A bon passager
// line keeps its link to the bon fournisseur line it draws from.
const toEditLine = (l) => {
  const measure = l.measure || (Number(l.weight_kg) > 0 ? 'poids' : Number(l.cbm) > 0 ? 'cbm' : 'quantite');
  const value = String(measure === 'poids' ? l.weight_kg : measure === 'cbm' ? l.cbm : l.quantity);
  const base = { designation: l.designation, measure, value, unit: l.unit || 'pièce', unitPrice: String(l.unit_price ?? ''), note: l.note || '' };
  if (l.source_line_id) {
    return {
      ...base, sourceLineId: l.source_line_id, remaining: Number(value),
      salePrice: Number(l.source_unit_price ?? 0), sourceLabel: l.source_order_reference || '',
    };
  }
  return { ...base, itemId: l.item_id || null, createItem: false, categoryId: '' };
};

// The single measure a line is quantified by (measure column; falls back to
// whichever value is non-zero for pre-migration rows).
const measureOf = (l) => l.measure || (Number(l.weight_kg) > 0 ? 'poids' : Number(l.cbm) > 0 ? 'cbm' : 'quantite');
const qtyNum = (l) => Number(measureOf(l) === 'poids' ? l.weight_kg : measureOf(l) === 'cbm' ? l.cbm : l.quantity);
const unitLabel = (l) => (measureOf(l) === 'poids' ? 'kg' : measureOf(l) === 'cbm' ? 'm³' : l.unit || 'u');
const declared = (l) => {
  const m = measureOf(l);
  if (m === 'poids') return `${q3(l.weight_kg)} kg`;
  if (m === 'cbm') return `${q3(l.cbm)} m³`;
  return `${q3(l.quantity)} ${l.unit || ''}`.trim();
};

export default function BonDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/bons/${id}`);
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const categories = useApi('/stock/categories');
  const passagers = useApi('/people?role=passager');
  const catalogue = useApi('/stock/items');
  const chinaStock = useApi('/stock/levels?office=china');
  // Goods this bon could draw from — its own current allocation stays available.
  // Pas de filtre par fournisseur : un bon passager peut reprendre des lots
  // d'ailleurs. `forBonId` fait compter ce qu'il tient déjà comme disponible
  // pour lui — sinon modifier un bon montrerait sa propre marchandise comme prise.
  const allocatable = useApi(data?.bon && data.bon.order_id == null ? `/bons/allocatable?forBonId=${id}` : null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState({});
  const [payment, setPayment] = useState('');
  const [payMode, setPayMode] = useState('auto'); // 'auto' = prix × livré, 'manual' = prix du service saisi
  const [feeForm, setFeeForm] = useState({ caisseId: '', amount: '' });
  const [payForm, setPayForm] = useState({ caisseId: '', amount: '' });
  const [edit, setEdit] = useState(null); // full edit while « Créé »
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPayment, setConfirmPayment] = useState(null);
  const [editPayment, setEditPayment] = useState(null);
  const [confirmJump, setConfirmJump] = useState(null); // target stage awaiting confirmation

  // L'onglet porte le nom de la fiche, pas celui de sa section : « BP-…-00003 »
  // se retrouve dans une barre d'onglets, « Bons passagers · fiche » non.
  useTabTitle(data?.bon?.reference);
  const bon = data?.bon;

  useEffect(() => {
    if (bon) {
      const init = {};
      for (const l of bon.lines) {
        const miss = l.received_quantity != null ? Math.max(qtyNum(l) - Number(l.received_quantity), 0) : 0;
        init[l.id] = { missing: String(miss), responsible: l.responsible ?? '' };
      }
      setRec(init);
      // The two cash forms open on what is STILL owed, not on the original
      // total: paying twice on a partly-settled bon is the mistake worth
      // designing out. A passager entry is stored negated in the ledger, hence
      // the absolute value.
      const paidOf = (type) =>
        (bon.payments ?? [])
          .filter((p) => p.type === type)
          .reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);
      const due = (total, type) => Math.max(Number(total ?? 0) - paidOf(type), 0).toFixed(2);
      setFeeForm((f) => ({ ...f, amount: due(bon.transport_fee, 'fee_payment') }));
      setPayForm((f) => ({ ...f, amount: due(bon.passager_payment, 'passager_payment') }));
    }
  }, [bon]);

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const advance = () => act(() => api(`/bons/${id}/advance`, { method: 'POST', body: {} }), 'Statut mis à jour.');
  // Clickable stepper: jump to any stage. Backward asks for confirmation (via a
  // styled dialog) because it reverses stock movements and any money posted.
  const doJump = (target) =>
    act(() => api(`/bons/${id}/status`, { method: 'POST', body: { target } }).then(() => { chinaStock.reload(); catalogue.reload(); }), 'Statut mis à jour.');
  const jumpStatus = (target) => {
    if (target === bon.status) return;
    const backward = STATUS_ORDER.indexOf(target) < STATUS_ORDER.indexOf(bon.status);
    if (backward) { setConfirmJump(target); return; }
    doJump(target);
  };
  // Deleting rewinds the bon to « Créé » first (server-side), so stock and money
  // are unwound through the same tested path before the rows go.
  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/bons/${id}`, { method: 'DELETE' });
      toast.success(`Bon ${bon.reference} supprimé.`);
      navigate('/bons-passager');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const reconcile = () =>
    act(() =>
      api(`/bons/${id}/reconcile`, {
        method: 'POST',
        body: { lines: bon.lines.map((l) => ({ lineId: l.id, missing: rec[l.id]?.missing || '0', responsible: rec[l.id]?.responsible })) },
      }), 'Réconciliation enregistrée.');
  const settle = () =>
    act(() => api(`/bons/${id}/settle`, { method: 'POST', body: { passagerPayment: payment || undefined } }), 'Bon réglé.');
  const collectFee = () =>
    act(() => api(`/bons/${id}/collect-fee`, { method: 'POST', body: { caisseId: Number(feeForm.caisseId), amount: feeForm.amount } }), 'Frais encaissés.');
  const payPassager = () =>
    act(() => api(`/bons/${id}/pay-passager`, { method: 'POST', body: { caisseId: Number(payForm.caisseId), amount: payForm.amount } }), 'Passager payé.');

  // Full edit — only while « Créé ». A bon fournisseur line (order_id set) picks
  // from the whole catalogue and may create new articles; a bon passager line
  // picks only from what is in the China stock.
  const isFournisseurBon = bon.order_id != null;
  // Ce que le bon porte déjà, remis dans la forme du panier : la quantité
  // encore disponible vient de /bons/allocatable, qui compte la sienne comme
  // libre pour lui. L'index est construit à l'ouverture du formulaire, pas au
  // rendu : `editSources` est déclaré plus bas.
  const toPickedLine = (l, _i, _all, index) => {
    const e = toEditLine(l);
    const src = index.get(String(l.source_line_id));
    return {
      ...e,
      sourceLineId: l.source_line_id,
      remaining: src ? Number(src.remaining) : Number(e.value),
      salePrice: Number(l.source_unit_price ?? src?.sale_price ?? 0),
      fournisseurId: src?.fournisseur_id ?? null,
      fournisseurName: src?.fournisseur_name || '—',
      sourceLabel: l.source_order_reference || src?.order_reference || '',
    };
  };
  const openEdit = () => {
    const index = new Map((allocatable.data?.lines ?? []).map((o) => [String(o.line_id), o]));
    setEdit({
      transportCurrency: bon.transport_currency,
      passagerId: bon.passager_id ? String(bon.passager_id) : '',
      lines: bon.lines.map((l, i, all) => (isFournisseurBon ? toEditLine(l) : toPickedLine(l, i, all, index))),
    });
  };
  const setEditLine = (i, next) => setEdit((e) => ({ ...e, lines: e.lines.map((l, idx) => (idx === i ? next : l)) }));
  const addEditLine = () => setEdit((e) => ({ ...e, lines: [...e.lines, emptyLine()] }));
  const removeEditLine = (i) => setEdit((e) => ({ ...e, lines: e.lines.filter((_, idx) => idx !== i) }));
  const editValid = edit && edit.lines.length > 0 && edit.lines.every(isFournisseurBon ? lineValid : pickedValid);
  const editItems = catalogue.data?.items ?? [];
  const editSources = allocatable.data?.lines ?? [];
  const editTotal = edit ? edit.lines.reduce((s, l) => s + (isFournisseurBon ? lineTotal(l) : pickedTotal(l)), 0) : 0;
  const saveEdit = () =>
    act(async () => {
      await api(`/bons/${id}`, {
        method: 'PATCH',
        body: {
          transportCurrency: edit.transportCurrency,
          ...(isFournisseurBon ? {} : { passagerId: edit.passagerId || null }),
          lines: isFournisseurBon ? edit.lines : edit.lines.map(pickedToLine),
        },
      });
      setEdit(null);
      catalogue.reload();
      chinaStock.reload();
    }, 'Bon modifié.');

  const offices = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');
  const stepIndex = STATUS_ORDER.indexOf(bon.status);
  const reconciling = bon.status === 'arrive';
  const recMissingTotal = bon.lines.reduce((s, l) => s + Number(l.unit_price) * Number(rec[l.id]?.missing || 0), 0);
  const recDeliveredTotal = Math.max(Number(bon.transport_fee) - recMissingTotal, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{bon.reference}</h1>
          {bon.order_reference && (
            <Link to={`/bons-fournisseur/${bon.order_id}`} className="btn-related">
              <IconEl name="order" />Bon fournisseur {bon.order_reference}
            </Link>
          )}
        </div>
        <div className="page-actions">
          <span className={`status-badge ${BON_STATUS[bon.status].cls}`} style={{ alignSelf: 'center' }}>{BON_STATUS[bon.status].label}</span>
          {bon.status === 'cree' && (
            <button className="btn" onClick={() => (edit ? setEdit(null) : openEdit())}>
              <IconEl name={edit ? 'close' : 'edit'} />{edit ? 'Annuler' : 'Modifier'}
            </button>
          )}
          <PrintButton
            title={bon.reference}
            docTitle="Bon passager"
            subtitle={bon.reference}
            a4={() => bonDocBody(bon)}
            ticket={(societe) => bonTicket(bon, societe)}
            direct={`/print/bon/${bon.id}`}
          />
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <IconEl name="trash" />Supprimer
          </button>
        </div>
      </div>

      <div className="stepper stepper-click">
        {STATUS_ORDER.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`step ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}
            onClick={() => jumpStatus(s)}
            disabled={busy || s === bon.status}
            title={s === bon.status ? undefined : `Aller à « ${BON_STATUS[s].label} »`}
          >
            <span className="step-dot" />
            <span className="step-label">{BON_STATUS[s].label}</span>
          </button>
        ))}
      </div>

      <div className="info-grid panel">
        {/* Un bon fournisseur appartient à quelqu'un ; un bon passager porte la
            marchandise d'autant de fournisseurs que de lots, déduits de ses
            lignes — les nommer tous, ou n'en désigner aucun à tort. */}
        <div>
          <span className="info-k">{isFournisseurBon || (bon.fournisseurs?.length ?? 0) < 2 ? 'Fournisseur' : 'Fournisseurs'}</span>
          <span>
            {isFournisseurBon
              ? `${bon.fournisseur_name}${bon.fournisseur_phone ? ` · ${bon.fournisseur_phone}` : ''}`
              : (bon.fournisseurs ?? []).map((f) => f.name).join(', ') || '—'}
          </span>
        </div>
        <div><span className="info-k">Passager</span><span>{bon.passager_name || '—'}{bon.passager_phone ? ` · ${bon.passager_phone}` : ''}</span></div>
        <div><span className="info-k">Frais de transport</span><span>{formatMoney(bon.transport_fee, bon.transport_currency)}</span></div>
        <div><span className="info-k">Manquants (valeur)</span><span className={Number(bon.loss_total) > 0 ? 'neg' : ''}>{formatMoney(bon.loss_total, bon.transport_currency)}</span></div>
        {bon.passager_payment != null && <div><span className="info-k">Paiement passager</span><span className="gold">{formatMoney(bon.passager_payment, bon.transport_currency)}</span></div>}
        <div><span className="info-k">Créé par</span><span>{bon.created_by_name} · {new Date(bon.created_at).toLocaleString('fr-FR')}</span></div>
      </div>

      {NEXT_LABEL[bon.status] && (
        <div className="panel action-panel">
          <button className="btn btn-gold" disabled={busy} onClick={advance}>{NEXT_LABEL[bon.status]}</button>
        </div>
      )}

      {edit && (
        <div className="panel" style={{ '--accent': 'var(--c-bon)' }}>
          <h2 className="panel-title">Modifier le bon</h2>
          <div className="op-form">
            {!isFournisseurBon && (
              <label className="field"><span>Passager</span>
                <select value={edit.passagerId} onChange={(e) => setEdit({ ...edit, passagerId: e.target.value })}>
                  <option value="">— aucun —</option>
                  {(passagers.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
            )}
            <label className="field"><span>Devise transport</span>
              <select value={edit.transportCurrency} onChange={(e) => setEdit({ ...edit, transportCurrency: e.target.value })}>
                {(currencies.data?.currencies ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select></label>
          </div>

          {isFournisseurBon ? (
            <>
              <div className="lines-head">
                <span>Marchandises reçues</span>
                <button type="button" className="btn btn-ghost" onClick={addEditLine}>+ Ligne</button>
              </div>
              <p className="muted line-hint">Prix de vente facturé au fournisseur × quantité.</p>
              {edit.lines.map((l, i) => (
                <LineEditor
                  key={i}
                  line={l}
                  items={editItems}
                  categories={categories.data?.categories ?? []}
                  onPatch={(nl) => setEditLine(i, nl)}
                  onRemove={() => removeEditLine(i)}
                  removable={edit.lines.length > 1}
                  autoFocus={i === edit.lines.length - 1}
                  allowCreate
                />
              ))}
              <div className="form-total">
                <span>À facturer au fournisseur</span>
                <strong>{formatMoney(editTotal, edit.transportCurrency)}</strong>
              </div>
            </>
          ) : (
            <GoodsPicker
              options={editSources}
              picked={edit.lines}
              currency={edit.transportCurrency}
              loading={allocatable.loading}
              onChange={(lines) => setEdit((e) => ({ ...e, lines }))}
            />
          )}
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-gold" disabled={busy || !editValid} onClick={saveEdit}>{busy ? '…' : 'Enregistrer les modifications'}</button>{' '}
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEdit(null)}><IconEl name="close" />Annuler</button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="panel-title">Marchandises</h2>
        {reconciling ? (
          <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
            Saisissez la quantité <strong>manquante</strong> (non livrée au bureau) par ligne. Le montant livré = prix de revient × (quantité − manquant).
          </p>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th className="right">Prix de revient</th>
                <th className="right">Quantité</th>
                {reconciling ? (
                  <><th className="right">Manquant</th><th className="right">Livré</th><th className="right">Montant</th><th>Responsable</th></>
                ) : (
                  <><th className="right">Manquant</th><th className="right">Montant</th></>
                )}
              </tr>
            </thead>
            <tbody>
              {bon.lines.map((l) => {
                const q = qtyNum(l);
                const up = Number(l.unit_price);
                if (reconciling) {
                  const miss = Number(rec[l.id]?.missing || 0);
                  const delivered = Math.max(q - miss, 0);
                  const over = miss > q;
                  return (
                    <tr key={l.id}>
                      <td>{l.designation}</td>
                      <td className="right">{formatMoney(up, bon.transport_currency)} <span className="muted">/ {unitLabel(l)}</span></td>
                      <td className="right">{declared(l)}</td>
                      <td className="right">
                        <AmountInput decimals={3} className={`mini-input ${over ? 'input-error' : ''}`}
                          value={rec[l.id]?.missing ?? ''}
                          onChange={(v) => setRec({ ...rec, [l.id]: { ...rec[l.id], missing: v } })} />
                      </td>
                      <td className="right">{q3(delivered)} {unitLabel(l)}</td>
                      <td className="right gold">{formatMoney(delivered * up, bon.transport_currency)}</td>
                      <td><input className="mini-input" value={rec[l.id]?.responsible ?? ''}
                        onChange={(e) => setRec({ ...rec, [l.id]: { ...rec[l.id], responsible: e.target.value } })} placeholder="passager…" /></td>
                    </tr>
                  );
                }
                const missDone = l.received_quantity != null ? Math.max(q - Number(l.received_quantity), 0) : 0;
                return (
                  <tr key={l.id}>
                    <td>{l.designation}</td>
                    <td className="right">{formatMoney(up, bon.transport_currency)} <span className="muted">/ {unitLabel(l)}</span></td>
                    <td className="right">{declared(l)}</td>
                    <td className={`right ${missDone > 0 ? 'neg' : ''}`}>{missDone > 0 ? `${q3(missDone)} ${unitLabel(l)}` : '—'}</td>
                    <td className="right">{formatMoney(up * (l.received_quantity != null ? Number(l.received_quantity) : q), bon.transport_currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td colSpan={reconciling ? 5 : 4} className="right">Total {reconciling ? 'à payer (livré)' : bon.status === 'regle' ? 'payé' : 'commandé'}</td>
                <td className="right gold"><strong>{formatMoney(reconciling ? recDeliveredTotal : (bon.status === 'regle' ? bon.passager_payment ?? 0 : bon.transport_fee), bon.transport_currency)}</strong></td>
                {reconciling && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {reconciling && (
          <div className="reconcile-actions">
            <div className="recon-sum">
              <span>Commandé <strong>{formatMoney(bon.transport_fee, bon.transport_currency)}</strong></span>
              <span>Manquants <strong className={recMissingTotal > 0 ? 'neg' : ''}>{formatMoney(recMissingTotal, bon.transport_currency)}</strong></span>
              <span>Dû au passager <strong className="gold">{formatMoney(payMode === 'manual' && payment !== '' ? Number(payment || 0) : recDeliveredTotal, bon.transport_currency)}</strong></span>
            </div>

            <div className="op-form" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={reconcile}>Enregistrer les manquants</button>
            </div>

            {/* How the passager's due is fixed: derived from the missing units, or
                typed by hand when the service was agreed at another price. */}
            <div className="lines-head" style={{ marginTop: 18 }}><span>Montant dû au passager</span></div>
            <div className="seg" style={{ marginBottom: 10 }}>
              <button type="button" className={payMode === 'auto' ? 'active' : ''}
                onClick={() => { setPayMode('auto'); setPayment(''); }}>Calculé (prix × livré)</button>
              <button type="button" className={payMode === 'manual' ? 'active' : ''}
                onClick={() => { setPayMode('manual'); setPayment(String(recDeliveredTotal.toFixed(2))); }}>Prix du service manuel</button>
            </div>

            {payMode === 'auto' ? (
              <p className="muted line-hint">
                {formatMoney(bon.transport_fee, bon.transport_currency)} commandé − {formatMoney(recMissingTotal, bon.transport_currency)} de manquants
                = <strong className="gold">{formatMoney(recDeliveredTotal, bon.transport_currency)}</strong>.
                Enregistrez d’abord les manquants pour que ce calcul soit à jour.
              </p>
            ) : (
              <p className="muted line-hint">
                Le montant saisi remplace le calcul — utile quand le prix du service a été convenu autrement (forfait, geste commercial, pénalité).
              </p>
            )}

            <div className="op-form">
              {payMode === 'manual' && (
                <label className="field"><span>Prix du service ({bon.transport_currency})</span>
                  <AmountInput autoFocus value={payment}
                    onChange={(v) => setPayment(v)}
                    placeholder={formatMoney(recDeliveredTotal)} /></label>
              )}
              <button className="btn btn-gold" disabled={busy || (payMode === 'manual' && !(Number(payment) >= 0))} onClick={settle}>
                Régler et payer le passager
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Argent</h2>

        {/* Money already moved for this bon — and the only place to undo it. */}
        {bon.payments?.length > 0 && (
          <div className="money-block" style={{ marginBottom: 18 }}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Opération</th><th>Personne</th><th>Caisse</th><th className="right">Montant</th><th className="right">Actions</th></tr></thead>
                <tbody>
                  {bon.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                      <td>
                        <span className={`money-dir ${p.type === 'fee_payment' ? 'in' : 'out'}`}>
                          {p.type === 'fee_payment' ? 'Encaissé' : 'Payé'}
                        </span>
                      </td>
                      <td>{p.person_name}</td>
                      <td className="muted">{p.caisse_label || '—'}</td>
                      <td className="right">{formatMoney(p.amount, p.currency_code)}</td>
                      <td className="right nowrap">
                        <button className="icon-btn" title="Corriger le montant" aria-label="Corriger ce paiement"
                          disabled={busy} onClick={() => setEditPayment({ id: p.id, amount: String(Math.abs(Number(p.amount))), note: p.note || '', currency: p.currency_code })}>
                          <IconEl name="edit" />
                        </button>
                        <button className="icon-btn danger" title="Annuler ce paiement" aria-label="Annuler ce paiement"
                          disabled={busy} onClick={() => setConfirmPayment(p)}>
                          <IconEl name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editPayment && (
              <form
                className="op-form"
                style={{ marginTop: 12, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await api(`/payments/${editPayment.id}`, { method: 'PATCH', body: { amount: editPayment.amount, note: editPayment.note || undefined } });
                    setEditPayment(null);
                  }, 'Paiement corrigé.');
                }}
              >
                <div className="field field-grow"><span>Corriger le paiement</span>
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
              Corriger ou annuler un paiement met à jour la caisse <strong>et</strong> le compte de la personne.
              L’annulation est aussi ce qu’il faut faire avant de pouvoir revenir en arrière ou supprimer ce bon.
            </p>
          </div>
        )}

        {isFournisseurBon ? (
          <div className="money-block">
            <div className="money-head">
              <span className="money-dir in">Entrée de caisse</span>
              <span>Le <strong>fournisseur {bon.fournisseur_name}</strong> vous règle le transport de ses marchandises.</span>
            </div>
            <div className="op-form">
              <label className="field"><span>Caisse qui reçoit l’argent</span>
                <select value={feeForm.caisseId} onChange={(e) => setFeeForm({ ...feeForm, caisseId: e.target.value })}>
                  <option value="">— choisir —</option>
                  {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select></label>
              <label className="field"><span>Montant reçu du fournisseur</span>
                <AmountInput value={feeForm.amount} onChange={(v) => setFeeForm({ ...feeForm, amount: v })} /></label>
              <button className="btn btn-gold" disabled={busy || !feeForm.caisseId || !(Number(feeForm.amount) > 0)} onClick={collectFee}>Encaisser</button>
            </div>
            <p className="muted line-hint">
              Le montant restant dû est déjà inscrit. Baissez-le pour un encaissement partiel :
              le reste demeure une dette, réglable depuis la fiche du fournisseur.
            </p>
          </div>
        ) : (
          <div className="money-block">
            <div className="money-head">
              <span className="money-dir out">Sortie de caisse</span>
              <span>Vous payez le <strong>passager {bon.passager_name || '—'}</strong> pour le service rendu.</span>
            </div>
            {bon.status === 'regle' && bon.passager_id ? (
              <>
                <div className="op-form">
                  <label className="field"><span>Caisse qui paie</span>
                    <select value={payForm.caisseId} onChange={(e) => setPayForm({ ...payForm, caisseId: e.target.value })}>
                      <option value="">— choisir —</option>
                      {offices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select></label>
                  <label className="field"><span>Montant versé au passager</span>
                    <AmountInput value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} /></label>
                  <button className="btn btn-gold" disabled={busy || !payForm.caisseId || !(Number(payForm.amount) > 0)} onClick={payPassager}>Payer le passager</button>
                </div>
                <p className="muted line-hint">Le montant restant dû est déjà inscrit. Baissez-le pour un paiement partiel.</p>
              </>
            ) : (
              <p className="muted line-hint">
                Le montant dû au passager est fixé au règlement du bon (étape « Réglé »), une fois les manquants connus.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Historique</h2>
        <ul className="timeline">
          {bon.history.map((h) => (
            <li key={h.id}>
              <span className={`status-badge ${BON_STATUS[h.status]?.cls || ''}`}>{BON_STATUS[h.status]?.label || h.status}</span>
              <span className="muted">{new Date(h.created_at).toLocaleString('fr-FR')} · {h.admin_name}</span>
              {h.note && <span className="tl-note">{h.note}</span>}
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={!!confirmJump}
        tone="danger"
        title={confirmJump ? `Revenir à « ${BON_STATUS[confirmJump].label} » ?` : ''}
        message="Ce retour en arrière annulera automatiquement les opérations postérieures :"
        bullets={[
          'Mouvements de stock (retour en Chine / sortie d’Algérie)',
          'Paiements et écritures déjà enregistrés',
          'Réconciliation des manquants',
        ]}
        confirmLabel="Revenir en arrière"
        busy={busy}
        onCancel={() => setConfirmJump(null)}
        onConfirm={() => { const t = confirmJump; setConfirmJump(null); doJump(t); }}
      />

      <ConfirmDialog
        open={Boolean(confirmPayment)}
        tone="danger"
        title="Annuler ce paiement ?"
        message={confirmPayment
          ? `${confirmPayment.type === 'fee_payment' ? 'Encaissement' : 'Paiement'} de ${formatMoney(confirmPayment.amount, confirmPayment.currency_code)} — ${confirmPayment.person_name}.`
          : ''}
        bullets={[
          confirmPayment?.caisse_label ? `Retiré de la caisse « ${confirmPayment.caisse_label} ».` : 'Retiré de la caisse.',
          'Le compte de la personne redevient débiteur / créditeur du même montant.',
        ]}
        confirmLabel="Annuler le paiement"
        busy={busy}
        onCancel={() => setConfirmPayment(null)}
        onConfirm={() => act(async () => {
          await api(`/bons/${id}/payments/${confirmPayment.id}`, { method: 'DELETE' });
          setConfirmPayment(null);
        }, 'Paiement annulé.')}
      />

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={`Supprimer le bon ${bon.reference} ?`}
        message="Le bon est d’abord ramené à « Créé », ce qui annule tout ce qui en découle, puis supprimé définitivement :"
        bullets={[
          'Mouvements de stock liés à ce bon',
          'Sommes dues au passager et avoirs du fournisseur',
          isFournisseurBon ? 'Réception en Chine et facturation du fournisseur' : 'Marchandises rendues au bon fournisseur d’origine',
          'Refusé si de l’argent est déjà passé en caisse pour ce bon.',
        ]}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
