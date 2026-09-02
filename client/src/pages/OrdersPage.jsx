import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { ORDER_STATUS } from '../components/orderStatus.js';
import { IconEl } from '../components/icons.jsx';
import { LineEditor, emptyLine, lineValid, lineTotal } from '../components/LineEditor.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';

// A bon fournisseur records the goods received from a fournisseur. It is NOT tied
// to a passager — assigning goods to a passager happens when creating a bon
// passager (or from the stock). It carries the transport fee the fournisseur owes.
export default function OrdersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const orders = useApi(`/orders${status ? `?status=${status}` : ''}`);
  const fournisseurs = useApi('/fournisseurs');
  const currencies = useApi('/currencies');
  const stockItems = useApi('/stock/items');
  const cats = useApi('/stock/categories');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/orders/${confirmDelete.id}`, { method: 'DELETE' });
      toast.success(`Bon fournisseur ${confirmDelete.reference} supprimé.`);
      setConfirmDelete(null);
      orders.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const [form, setForm] = useState({
    fournisseurId: '', notes: '', transportCurrency: 'DZD', discount: '0', lines: [emptyLine()],
  });

  const setLine = (li, next) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === li ? next : l)) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (li) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== li) }));

  const total = form.lines.reduce((s, l) => s + lineTotal(l), 0);
  const valid = form.fournisseurId && form.lines.length > 0 && form.lines.every(lineValid);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      // One goods list, no passager — sent as a single child bon under the hood.
      const payload = {
        fournisseurId: form.fournisseurId,
        notes: form.notes,
        bons: [{ transportCurrency: form.transportCurrency, discount: form.discount, lines: form.lines }],
      };
      const { order } = await api('/orders', { method: 'POST', body: payload });
      toast.success(`Bon fournisseur ${order.reference} créé.`);
      navigate(`/bons-fournisseur/${order.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (orders.loading || fournisseurs.loading) return <Spinner />;
  const curList = currencies.data?.currencies ?? [];

  return (
    <div>
      <div className="page-head">
        <div style={{ '--accent': 'var(--c-order)' }}>
          <div className="page-title-row">
            <div className="page-ico"><IconEl name="order" /></div>
            <h1>Bons fournisseurs</h1>
          </div>
          <p className="muted">Marchandises reçues d’un fournisseur. L’affectation à un passager se fait dans les bons passagers.</p>
        </div>
        <button className="btn btn-gold" onClick={() => setOpen(!open)}>{open ? 'Fermer' : 'Nouveau bon fournisseur'}</button>
      </div>

      {open && (
        <form className="panel" onSubmit={submit}>
          <div className="op-form">
            <label className="field field-grow"><span>Fournisseur</span>
              <select value={form.fournisseurId} onChange={(e) => setForm({ ...form, fournisseurId: e.target.value })}>
                <option value="">— choisir —</option>
                {(fournisseurs.data?.fournisseurs ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select></label>
            <label className="field"><span>Devise des frais</span>
              <select value={form.transportCurrency} onChange={(e) => setForm({ ...form, transportCurrency: e.target.value })}>
                {curList.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select></label>
            <label className="field"><span>Remise</span>
              <input inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value.replace(',', '.') })} /></label>
            <label className="field field-grow"><span>Notes</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>

          <div className="lines-head">
            <span>Marchandises reçues</span>
            <button type="button" className="btn btn-ghost" onClick={addLine}>+ Ligne</button>
          </div>
          <p className="muted line-hint">
            Le prix saisi est le <strong>prix de vente facturé au fournisseur</strong>. Le total est sa dette ; la remise la réduit.
          </p>
          {form.lines.map((l, li) => (
            <LineEditor
              key={li}
              line={l}
              items={stockItems.data?.items ?? []}
              categories={cats.data?.categories ?? []}
              onPatch={(nl) => setLine(li, nl)}
              onRemove={() => removeLine(li)}
              removable={form.lines.length > 1}
              autoFocus={li === form.lines.length - 1}
            />
          ))}

          <div className="form-total">
            <span>À facturer au fournisseur{Number(form.discount) > 0 ? ' (après remise)' : ''}</span>
            <strong>{formatMoney(Math.max(total - Number(form.discount || 0), 0), form.transportCurrency)}</strong>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-gold" disabled={busy || !valid}>{busy ? '…' : 'Créer le bon fournisseur'}</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <button className={!status ? 'chip active' : 'chip'} onClick={() => setStatus('')}>Tous</button>
        {Object.entries(ORDER_STATUS).map(([k, v]) => (
          <button key={k} className={status === k ? 'chip active' : 'chip'} onClick={() => setStatus(k)}>{v.label}</button>
        ))}
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Référence</th><th>Fournisseur</th><th className="right">Lots</th><th>Statut</th><th className="right">Facturé</th><th>Date</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {orders.data.orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                  <td><span className="gold">{o.reference}</span></td>
                  <td>{o.fournisseur_name}</td>
                  <td className="right">{o.bon_count}</td>
                  <td><span className={`status-badge ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span></td>
                  <td className="right">{formatMoney(o.total_fee)}</td>
                  <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="Ouvrir" aria-label="Ouvrir" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                      <IconEl name="search" />
                    </button>
                    <button className="icon-btn" title="Modifier" aria-label="Modifier" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                      <IconEl name="edit" />
                    </button>
                    <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer" disabled={busy} onClick={() => setConfirmDelete(o)}>
                      <IconEl name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
              {!orders.data.orders.length && <tr><td colSpan="7" className="muted pad">Aucun bon fournisseur.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        tone="danger"
        title={`Supprimer le bon fournisseur ${confirmDelete?.reference} ?`}
        message="La réception en Chine et la facturation du fournisseur seront annulées, puis le bon supprimé."
        bullets={['Refusé si un passager transporte déjà ces marchandises.']}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    </div>
  );
}
