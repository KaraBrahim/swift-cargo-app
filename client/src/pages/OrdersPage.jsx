// La liste des bons fournisseurs : la marchandise reçue, et ce qu'il en reste à
// confier. La création vit sur son propre écran (/bons-fournisseur/nouveau).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi, useDebounced } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { ORDER_STATUS } from '../components/orderStatus.js';
import { IconEl } from '../components/icons.jsx';
import { SearchBar } from '../components/SearchBar.jsx';
import { Who } from '../components/cells.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { useIsSuper } from '../auth/AuthContext.jsx';

export default function OrdersPage() {
  const toast = useToast();
  const isSuper = useIsSuper();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const search = useDebounced(q);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search.trim()) qs.set('search', search.trim());
  const orders = useApi(`/orders${qs.toString() ? `?${qs}` : ''}`);

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

  const rows = orders.data?.orders ?? [];

  return (
    <div>
      <div className="page-head" style={{ '--accent': 'var(--c-order)' }}>
        <div className="page-title-row">
          <div className="page-ico"><IconEl name="order" /></div>
          <h1>Bons fournisseurs</h1>
        </div>
        <button className="btn btn-gold" onClick={() => navigate('/bons-fournisseur/nouveau')}>
          <IconEl name="plus" />Nouveau bon
        </button>
      </div>

      <div className="list-tools">
        <SearchBar value={q} onChange={setQ} placeholder="Référence ou fournisseur…" />
        <div className="chips">
          <button className={!status ? 'chip active' : 'chip'} onClick={() => setStatus('')}>Tous</button>
          {Object.entries(ORDER_STATUS).map(([k, v]) => (
            <button key={k} className={status === k ? 'chip active' : 'chip'} onClick={() => setStatus(k)}>{v.label}</button>
          ))}
        </div>
      </div>

      {orders.loading && !orders.data ? <Spinner /> : (
        <div className="panel">
          {rows.length ? (
            <div className="table-wrap">
              <table className="table list-table">
                <thead>
                  <tr>
                    <th>Bon</th><th>Fournisseur</th><th>Statut</th>
                    <th className="right">Facturé</th><th className="right" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                      <td>
                        <span className="cell-stack">
                          <span className="gold">{o.reference}</span>
                          <span className="muted">{new Date(o.created_at).toLocaleDateString('fr-FR')}</span>
                        </span>
                      </td>
                      <td><Who name={o.fournisseur_name} icon="fournisseur" /></td>
                      <td><span className={`status-badge ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span></td>
                      <td className="right">{formatMoney(o.total_fee)}</td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        {/* Supprimer definitivement : reserve au super-administrateur. */}
                        {isSuper && (
                          <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer"
                            disabled={busy} onClick={() => setConfirmDelete(o)}>
                            <IconEl name="trash" />
                          </button>
                        )}
                        <IconEl name="chevronRight" className="row-go" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon="order"
              title={search || status ? 'Aucun bon ne correspond' : 'Aucun bon fournisseur'}
              sub={search || status ? 'Changez la recherche ou le filtre.' : 'Un bon fournisseur enregistre la marchandise reçue d’un fournisseur en Chine.'}
            >
              {!search && !status && (
                <button className="btn btn-gold" onClick={() => navigate('/bons-fournisseur/nouveau')}>
                  <IconEl name="plus" />Créer le premier
                </button>
              )}
            </EmptyState>
          )}
        </div>
      )}

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
