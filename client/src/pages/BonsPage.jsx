// La liste des bons passagers : on cherche, on filtre, on ouvre.
//
// La création a quitté cette page pour un écran à elle (/bons-passager/nouveau) :
// un formulaire qui se déplie au-dessus d'un tableau oblige à choisir entre lire
// et saisir, et donnait deux longueurs de page selon l'humeur.

import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi, useDebounced } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { Who, Sources } from '../components/cells.jsx';
import { SearchBar } from '../components/SearchBar.jsx';
import { BON_STATUS } from '../components/bonStatus.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { useIsSuper } from '../auth/AuthContext.jsx';

export default function BonsPage() {
  const toast = useToast();
  const isSuper = useIsSuper();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [q, setQ] = useState('');
  const search = useDebounced(q);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search.trim()) qs.set('search', search.trim());
  const bons = useApi(`/bons${qs.toString() ? `?${qs}` : ''}`);

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/bons/${confirmDelete.id}`, { method: 'DELETE' });
      toast.success(`Bon ${confirmDelete.reference} supprimé.`);
      setConfirmDelete(null);
      bons.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const rows = bons.data?.bons ?? [];

  return (
    <div>
      <div className="page-head" style={{ '--accent': 'var(--c-bon)' }}>
        <div className="page-title-row">
          <div className="page-ico"><IconEl name="bon" /></div>
          <h1>Bons passagers</h1>
        </div>
        <button className="btn btn-gold" onClick={() => navigate('/bons-passager/nouveau')}>
          <IconEl name="plus" />Nouveau bon
        </button>
      </div>

      <div className="list-tools">
        <SearchBar value={q} onChange={setQ} placeholder="Référence ou passager…" />
        <div className="chips">
          <button className={!status ? 'chip active' : 'chip'} onClick={() => setStatus('')}>Tous</button>
          {Object.entries(BON_STATUS).map(([k, v]) => (
            <button key={k} className={status === k ? 'chip active' : 'chip'} onClick={() => setStatus(k)}>{v.label}</button>
          ))}
        </div>
      </div>

      {bons.loading && !bons.data ? <Spinner /> : (
        <div className="panel">
          {rows.length ? (
            <div className="table-wrap">
              <table className="table list-table">
                <thead>
                  <tr>
                    <th>Bon</th><th>Passager</th><th>Fournisseurs</th><th>Statut</th>
                    <th className="right">À payer</th><th className="right" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                      <td>
                        <span className="cell-stack">
                          <span className="gold">{b.reference}</span>
                          <span className="muted">{new Date(b.created_at).toLocaleDateString('fr-FR')}</span>
                        </span>
                      </td>
                      <td><Who name={b.passager_name} icon="passager" /></td>
                      <td><Sources names={b.fournisseur_name} /></td>
                      <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                      <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        {/* Supprimer definitivement : reserve au super-administrateur. */}
                        {isSuper && (
                          <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer"
                            disabled={busy} onClick={() => setConfirmDelete(b)}>
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
              icon="bon"
              title={search || status ? 'Aucun bon ne correspond' : 'Aucun bon passager'}
              sub={search || status ? 'Changez la recherche ou le filtre.' : 'Un bon passager confie à un porteur la marchandise arrivée des fournisseurs.'}
            >
              {!search && !status && (
                <button className="btn btn-gold" onClick={() => navigate('/bons-passager/nouveau')}>
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
        title={`Supprimer le bon ${confirmDelete?.reference} ?`}
        message="Le bon est ramené à « Créé » — ce qui annule stock et écritures — puis supprimé définitivement."
        bullets={['Les marchandises retournent au bon fournisseur d’origine.', 'Refusé si de l’argent est déjà passé en caisse.']}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDelete}
      />
    </div>
  );
}
