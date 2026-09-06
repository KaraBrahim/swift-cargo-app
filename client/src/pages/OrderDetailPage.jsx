import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { ORDER_STATUS, ORDER_ORDER } from '../components/orderStatus.js';
import { BON_STATUS } from '../components/bonStatus.js';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { PrintButton } from '../components/PrintButton.jsx';
import { orderManifestBody } from '../components/printDocument.js';
import { orderTicket } from '../components/printTicket.js';
import { formatQty } from '../lib/format.js';

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [confirmJump, setConfirmJump] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // L'onglet porte le nom de la fiche, pas celui de sa section : « BP-…-00003 »
  // se retrouve dans une barre d'onglets, « Bons passagers · fiche » non.
  useTabTitle(data?.order?.reference);
  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  const o = data.order;
  const stepIndex = ORDER_ORDER.indexOf(o.status);
  const cur = o.bons?.[0]?.transport_currency || 'DZD';
  const q3 = (v) => formatQty(v);

  // Clickable stepper: move every child bon to the matching stage. Backward
  // reverses stock and money, so confirm via a styled dialog first.
  const doJump = async (target) => {
    setBusy(true);
    try {
      await api(`/orders/${id}/status`, { method: 'POST', body: { target } });
      toast.success('Statut mis à jour.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const jumpStatus = (target) => {
    if (target === o.status) return;
    const backward = ORDER_ORDER.indexOf(target) < stepIndex;
    if (backward) { setConfirmJump(target); return; }
    doJump(target);
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/orders/${id}`, { method: 'DELETE' });
      toast.success(`Bon fournisseur ${o.reference} supprimé.`);
      navigate('/bons-fournisseur');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{o.reference}</h1>
        </div>
        <div className="page-actions">
          <span className={`status-badge ${ORDER_STATUS[o.status].cls}`} style={{ alignSelf: 'center' }}>{ORDER_STATUS[o.status].label}</span>
          <PrintButton
            title={o.reference}
            docTitle="Bon fournisseur — manifeste"
            subtitle={o.reference}
            a4={() => orderManifestBody(o)}
            ticket={(societe) => orderTicket(o, societe)}
            direct={`/print/order/${o.id}`}
          />
          {o.bons[0] && (
            <Link to={`/bons-passager/${o.bons[0].id}`} className="btn"><IconEl name="edit" />Modifier les marchandises</Link>
          )}
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <IconEl name="trash" />Supprimer
          </button>
        </div>
      </div>

      <div className="stepper stepper-click">
        {ORDER_ORDER.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`step ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'current' : ''}`}
            onClick={() => jumpStatus(s)}
            disabled={busy || s === o.status}
            title={s === o.status ? undefined : `Aller à « ${ORDER_STATUS[s].label} »`}
          >
            <span className="step-dot" />
            <span className="step-label">{ORDER_STATUS[s].label}</span>
          </button>
        ))}
      </div>

      <div className="info-grid panel">
        <div><span className="info-k">Fournisseur</span>
          <span><Link to={`/fournisseurs/${o.fournisseur_id}`} className="gold">{o.fournisseur_name}</Link>{o.fournisseur_phone ? ` · ${o.fournisseur_phone}` : ''}</span></div>
        <div><span className="info-k">Trajet</span><span>Chine → Algérie</span></div>
        <div><span className="info-k">Facturé au fournisseur</span><span className="gold">{formatMoney(o.totals.billed, cur)}</span></div>
        {o.totals.discount > 0 && (
          <div><span className="info-k">Remise accordée</span><span className="pos">− {formatMoney(o.totals.discount, cur)}</span></div>
        )}
        <div><span className="info-k">Avoir manquants</span>
          <span className={o.totals.loss_total > 0 ? 'neg' : ''}>{formatMoney(o.totals.loss_total, cur)}</span></div>
        <div><span className="info-k">Créé par</span><span>{o.created_by_name} · {new Date(o.created_at).toLocaleString('fr-FR')}</span></div>
      </div>

      {/* ── The goods received, and how much a passager has taken ── */}
      <div className="panel">
        <h2 className="panel-title">Marchandises reçues</h2>
        <p className="muted line-hint">
          Prix de <strong>vente</strong> facturé au fournisseur. « Confié » = déjà pris en charge par un passager ;
          le reste attend encore en Chine.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Désignation</th><th className="right">Prix de vente</th><th className="right">Reçu</th>
                <th className="right">Confié</th><th className="right">Reste en Chine</th><th className="right">Montant</th></tr>
            </thead>
            <tbody>
              {(o.lines ?? []).map((l) => {
                const u = l.measure === 'poids' ? 'kg' : l.measure === 'cbm' ? 'm³' : l.unit || 'u';
                return (
                  <tr key={l.line_id}>
                    <td>{l.designation}</td>
                    <td className="right">{formatMoney(l.unit_price, cur)} <span className="muted">/ {u}</span></td>
                    <td className="right">{q3(l.quantity)} {u}</td>
                    <td className="right">{q3(l.allocated)} {u}</td>
                    <td className={`right ${l.remaining > 0 ? 'gold' : 'muted'}`}>{q3(l.remaining)} {u}</td>
                    <td className="right">{formatMoney(Number(l.unit_price) * Number(l.quantity), cur)}</td>
                  </tr>
                );
              })}
              {!(o.lines ?? []).length && <tr><td colSpan="6" className="muted pad">Aucune marchandise.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td colSpan="5" className="right">Total facturé{o.totals.discount > 0 ? ' (après remise)' : ''}</td>
                <td className="right gold"><strong>{formatMoney(o.totals.billed, cur)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Who is carrying it ── */}
      <div className="panel">
        <h2 className="panel-title">Passagers transportant ces marchandises ({o.carriers?.length ?? 0})</h2>
        {o.carriers?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Bon passager</th><th>Passager</th><th>Statut</th><th className="right">Coût passager</th><th className="right">Payé</th></tr></thead>
              <tbody>
                {o.carriers.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                    <td><span className="gold">{b.reference}</span></td>
                    <td>{b.passager_name || '—'}</td>
                    <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                    <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                    <td className="right">{b.passager_payment != null ? formatMoney(b.passager_payment, b.transport_currency) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="passager"
            title="Aucun passager pour l’instant"
            sub={o.totals.unallocated > 0
              ? 'Ces marchandises attendent en Chine. Créez un bon passager pour les confier à un porteur.'
              : 'Aucune marchandise à confier.'}
          >
            <Link to="/bons-passager" className="btn btn-gold"><IconEl name="plus" />Créer un bon passager</Link>
          </EmptyState>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmJump}
        tone="danger"
        title={confirmJump ? `Revenir à « ${ORDER_STATUS[confirmJump].label} » ?` : ''}
        message="Tous les bons de cet ordre reculeront à cette étape. Les opérations postérieures seront annulées :"
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
        open={confirmDelete}
        tone="danger"
        title={`Supprimer le bon fournisseur ${o.reference} ?`}
        message="Tout ce que ce bon a produit sera annulé, puis il sera supprimé définitivement :"
        bullets={[
          'La réception des marchandises en Chine',
          'La facturation et la remise du fournisseur',
          'Refusé si un passager transporte déjà ces marchandises.',
        ]}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
