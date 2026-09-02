// One article in full: where it physically sits, how it got there, and which
// bons reference it. The page states up front whether it can be deleted, so the
// user learns the rule before hitting a refusal.
import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { BON_STATUS } from '../components/bonStatus.js';

const ACCENT = 'var(--c-stock)';
const OFFICE = { china: 'Chine', algeria: 'Algérie' };
const REASON = {
  reception: 'Réception fournisseur', depart: 'Départ vers l’Algérie',
  arrivee: 'Arrivée en Algérie', inventaire: 'Inventaire', ajustement: 'Ajustement',
};
// Only hand-made corrections may be undone here; the rest belong to a bon.
const MANUAL = ['inventaire', 'ajustement'];
const q3 = (v) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const signed = (v) => (Number(v) > 0 ? `+${q3(v)}` : q3(v));

export default function ArticleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/stock/items/${id}/detail`);
  const cats = useApi('/stock/categories');
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMove, setConfirmMove] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;
  const it = data.item;

  const save = (e) => {
    e.preventDefault();
    return run(async () => {
      await api(`/stock/items/${id}`, {
        method: 'PUT',
        body: { name: edit.name.trim(), category_id: edit.category_id || null, notes: edit.notes || undefined },
      });
      setEdit(null);
    }, 'Article modifié.');
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/stock/items/${id}`, { method: 'DELETE' });
      toast.success('Article supprimé.');
      navigate('/articles');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div style={{ '--accent': ACCENT }}>
      <div className="page-head">
        <div>
          <Link to="/articles" className="btn-back"><IconEl name="chevronLeft" />Retour aux articles</Link>
          <div className="page-title-row">
            <div className="page-ico"><IconEl name="box" /></div>
            <div>
              <h1>{it.name}</h1>
              <p className="muted">{it.category_name || 'Sans catégorie'}</p>
            </div>
          </div>
        </div>
        <div className="page-actions">
          {Number(it.totals.quantity) > 0 || Number(it.totals.weight_kg) > 0 || Number(it.totals.cbm) > 0
            ? <span className="status-badge st-arrive" style={{ alignSelf: 'center' }}>En stock</span>
            : <span className="status-badge st-cree" style={{ alignSelf: 'center' }}>Enregistré, hors stock</span>}
          {!it.active && <span className="status-badge st-transit" style={{ alignSelf: 'center' }}>Inactif</span>}
          <button className="btn" onClick={() => setEdit(edit ? null : { name: it.name, category_id: it.category_id || '', notes: it.notes || '' })}>
            <IconEl name={edit ? 'close' : 'edit'} />{edit ? 'Annuler' : 'Modifier'}
          </button>
          <button className="btn" disabled={busy}
            onClick={() => run(() => api(`/stock/items/${id}/active`, { method: 'POST', body: { active: !it.active } }),
              it.active ? 'Article désactivé.' : 'Article réactivé.')}>
            <IconEl name={it.active ? 'close' : 'check'} />{it.active ? 'Désactiver' : 'Réactiver'}
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <IconEl name="trash" />Supprimer
          </button>
        </div>
      </div>

      {edit && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          <label className="field field-grow"><span>Nom</span>
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Catégorie</span>
            <select value={edit.category_id || ''} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
              <option value="">— aucune —</option>
              {(cats.data?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !edit.name.trim()}>Enregistrer</button>
        </form>
      )}

      {/* ── Where it is ── */}
      <div className="kpi-row">
        {['china', 'algeria'].map((office) => {
          const lvl = it.levels.find((l) => l.office === office) || { quantity: 0, weight_kg: 0, cbm: 0 };
          const empty = !Number(lvl.quantity) && !Number(lvl.weight_kg) && !Number(lvl.cbm);
          return (
            <div key={office} className="kpi-card kpi-static">
              <div className="kpi-ico"><IconEl name="stock" /></div>
              <div>
                <div className={`kpi-val ${Number(lvl.quantity) < 0 ? 'neg' : ''}`}>{q3(lvl.quantity)}</div>
                <div className="kpi-label">Bureau {OFFICE[office]}</div>
                <div className="kpi-sub">
                  {empty ? 'Rien à cet emplacement' : `${q3(lvl.weight_kg)} kg · ${q3(lvl.cbm)} m³`}
                </div>
              </div>
            </div>
          );
        })}
        <div className="kpi-card kpi-static">
          <div className="kpi-ico"><IconEl name="bon" /></div>
          <div>
            <div className="kpi-val">{it.bons.length}</div>
            <div className="kpi-label">Bons utilisant cet article</div>
            <div className="kpi-sub">{it.deletable ? 'Suppression possible' : 'Suppression bloquée'}</div>
          </div>
        </div>
      </div>

      {it.notes && (
        <div className="panel"><h2 className="panel-title">Notes</h2><p className="muted" style={{ margin: 0 }}>{it.notes}</p></div>
      )}

      {/* ── Bons referencing it ── */}
      <div className="panel">
        <h2 className="panel-title">Bons ({it.bons.length})</h2>
        {it.bons.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Référence</th><th>Type</th><th>Fournisseur / Passager</th><th>Statut</th><th className="right">Quantité</th><th className="right">Prix unitaire</th></tr></thead>
              <tbody>
                {it.bons.map((b) => (
                  <tr key={b.line_id} className="clickable"
                    onClick={() => navigate(b.order_id ? `/bons-fournisseur/${b.order_id}` : `/bons-passager/${b.bon_id}`)}>
                    <td><span className="gold">{b.reference}</span></td>
                    <td>{b.order_id ? 'Fournisseur' : 'Passager'}</td>
                    <td>{b.order_id ? b.fournisseur_name : (b.passager_name || '—')}</td>
                    <td><span className={`status-badge ${BON_STATUS[b.status]?.cls || ''}`}>{BON_STATUS[b.status]?.label || b.status}</span></td>
                    <td className="right">
                      {q3(b.measure === 'poids' ? b.weight_kg : b.measure === 'cbm' ? b.cbm : b.quantity)}{' '}
                      {b.measure === 'poids' ? 'kg' : b.measure === 'cbm' ? 'm³' : b.unit}
                    </td>
                    <td className="right">{formatMoney(b.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="bon" title="Aucun bon" sub="Cet article n’a encore été transporté sur aucun bon." />}
      </div>

      {/* ── Movement history ── */}
      <div className="panel">
        <h2 className="panel-title">Mouvements de stock ({it.movements.length})</h2>
        <p className="muted line-hint">Seuls les mouvements manuels (inventaire, ajustement) peuvent être annulés ici ; les autres appartiennent à un bon.</p>
        {it.movements.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Motif</th><th>Bureau</th><th className="right">Qté</th><th className="right">Poids</th><th className="right">CBM</th><th>Origine</th><th>Par</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {it.movements.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString('fr-FR')}</td>
                    <td>{REASON[m.reason] || m.reason}</td>
                    <td>{OFFICE[m.office]}</td>
                    <td className={`right ${Number(m.quantity_delta) < 0 ? 'neg' : 'pos'}`}>{signed(m.quantity_delta)}</td>
                    <td className="right">{signed(m.weight_delta)}</td>
                    <td className="right">{signed(m.cbm_delta)}</td>
                    <td className="gold">{m.bon_reference || m.order_reference || '—'}</td>
                    <td className="muted">{m.admin_name || '—'}</td>
                    <td className="right">
                      <button className="icon-btn danger" disabled={busy || !MANUAL.includes(m.reason)}
                        title={MANUAL.includes(m.reason) ? 'Annuler ce mouvement' : 'Mouvement issu d’un bon — à annuler depuis le bon'}
                        aria-label="Annuler le mouvement"
                        onClick={() => setConfirmMove(m)}>
                        <IconEl name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="swap" title="Aucun mouvement" sub="Rien n’est encore entré ni sorti pour cet article." />}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={`Supprimer « ${it.name} » ?`}
        message="L’article quitte définitivement le catalogue."
        bullets={it.deletable
          ? ['Aucun bon ne l’utilise et aucun bureau n’en détient : la suppression est possible.']
          : [
            `Utilisé sur ${it.bons.length} ligne(s) de bon.`,
            'Stock restant à un bureau.',
            'La suppression sera refusée — désactivez-le à la place.',
          ]}
        confirmLabel="Supprimer"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />

      <ConfirmDialog
        open={Boolean(confirmMove)}
        tone="danger"
        title="Annuler ce mouvement ?"
        message="Un mouvement inverse est appliqué immédiatement, ce qui remet la quantité du bureau à son état antérieur."
        confirmLabel="Annuler le mouvement"
        busy={busy}
        onCancel={() => setConfirmMove(null)}
        onConfirm={() => run(async () => {
          await api(`/stock/movements/${confirmMove.id}`, { method: 'DELETE' });
          setConfirmMove(null);
        }, 'Mouvement annulé.')}
      />
    </div>
  );
}
