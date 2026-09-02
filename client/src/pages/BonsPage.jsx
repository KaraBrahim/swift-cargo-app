import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { BON_STATUS } from '../components/bonStatus.js';
import { SourceLineEditor, emptySourceLine, sourceLineValid, sourceLineTotal, sourceLineMargin } from '../components/SourceLineEditor.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';

export default function BonsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const bons = useApi(`/bons${status ? `?status=${status}` : ''}`);
  const fournisseurs = useApi('/fournisseurs');
  const passagers = useApi('/passagers');
  const currencies = useApi('/currencies');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ fournisseurId: '', passagerId: '', transportCurrency: 'DZD', notes: '', lines: [emptySourceLine()] });

  // A bon passager carries goods that a specific fournisseur handed over, so the
  // choices are the still-unallocated lines of that fournisseur's bons.
  const allocatable = useApi(form.fournisseurId ? `/bons/allocatable?fournisseurId=${form.fournisseurId}` : null);

  const setLine = (i, next) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? next : l)) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptySourceLine()] }));
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const total = form.lines.reduce((s, l) => s + sourceLineTotal(l), 0);
  const margin = form.lines.reduce((s, l) => s + sourceLineMargin(l), 0);
  const canSubmit = form.fournisseurId && form.lines.length > 0 && form.lines.every(sourceLineValid);

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

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { bon } = await api('/bons', { method: 'POST', body: form });
      toast.success(`Bon passager ${bon.reference} créé.`);
      navigate(`/bons-passager/${bon.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (bons.loading || fournisseurs.loading) return <Spinner />;
  const curList = currencies.data?.currencies ?? [];
  const allocatableList = allocatable.data?.lines ?? [];

  return (
    <div>
      <div className="page-head" style={{ '--accent': 'var(--c-bon)' }}>
        <div className="page-title-row">
          <div className="page-ico"><IconEl name="bon" /></div>
          <h1>Bons passagers</h1>
        </div>
        <button className="btn btn-gold" onClick={() => setOpen(!open)}>{open ? 'Fermer' : 'Nouveau bon passager'}</button>
      </div>

      {open && (
        <form className="panel" onSubmit={submit}>
          <div className="op-form">
            <label className="field"><span>Fournisseur</span>
              <select
                value={form.fournisseurId}
                onChange={(e) => setForm({ ...form, fournisseurId: e.target.value, lines: [emptySourceLine()] })}
              >
                <option value="">— choisir —</option>
                {(fournisseurs.data?.fournisseurs ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select></label>
            <label className="field"><span>Passager</span>
              <select value={form.passagerId} onChange={(e) => setForm({ ...form, passagerId: e.target.value })}>
                <option value="">— aucun —</option>
                {(passagers.data?.passagers ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select></label>
            <label className="field"><span>Devise transport</span>
              <select value={form.transportCurrency} onChange={(e) => setForm({ ...form, transportCurrency: e.target.value })}>
                {curList.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select></label>
          </div>

          <div className="lines-head">
            <span>Marchandises confiées au passager</span>
            <button type="button" className="btn btn-ghost" disabled={!form.fournisseurId} onClick={addLine}>+ Ligne</button>
          </div>
          <p className="muted line-hint">
            Chaque ligne prend tout ou partie d’un bon fournisseur — un même bon passager peut puiser dans plusieurs bons.
            Le prix saisi est le <strong>prix de revient payé au passager</strong> ; la marge est l’écart avec le prix de vente du fournisseur.
          </p>

          {!form.fournisseurId ? (
            <p className="muted line-hint">Choisissez d’abord un fournisseur pour voir ses marchandises disponibles.</p>
          ) : allocatableList.length === 0 && !allocatable.loading ? (
            <p className="muted line-hint">Aucune marchandise disponible : tous les bons de ce fournisseur sont déjà confiés.</p>
          ) : (
            form.lines.map((l, i) => (
              <SourceLineEditor
                key={i}
                line={l}
                options={allocatableList}
                currency={form.transportCurrency}
                onPatch={(nl) => setLine(i, nl)}
                onRemove={() => removeLine(i)}
                removable={form.lines.length > 1}
                autoFocus={i === form.lines.length - 1}
              />
            ))
          )}

          <div className="form-total">
            <span>À payer au passager</span>
            <strong>{formatMoney(total, form.transportCurrency)}</strong>
          </div>
          <div className="form-total form-total-sub">
            <span>Marge estimée (vente fournisseur − coût passager)</span>
            <strong className={margin < 0 ? 'neg' : 'pos'}>{formatMoney(margin, form.transportCurrency)}</strong>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-gold" disabled={busy || !canSubmit}>{busy ? '…' : 'Créer le bon passager'}</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <button className={!status ? 'chip active' : 'chip'} onClick={() => setStatus('')}>Tous</button>
        {Object.entries(BON_STATUS).map(([k, v]) => (
          <button key={k} className={status === k ? 'chip active' : 'chip'} onClick={() => setStatus(k)}>{v.label}</button>
        ))}
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Référence</th><th>Fournisseur</th><th>Passager</th><th>Statut</th><th className="right">À payer</th><th>Date</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {bons.data.bons.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                  <td><span className="gold">{b.reference}</span></td>
                  <td>{b.fournisseur_name}</td>
                  <td>{b.passager_name || '—'}</td>
                  <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                  <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                  <td>{new Date(b.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="Ouvrir" aria-label="Ouvrir" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                      <IconEl name="search" />
                    </button>
                    <button className="icon-btn" title={b.status === 'cree' ? 'Modifier' : 'Modifiable seulement au statut « Créé »'} aria-label="Modifier"
                      disabled={b.status !== 'cree'} onClick={() => navigate(`/bons-passager/${b.id}`)}>
                      <IconEl name="edit" />
                    </button>
                    <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer" disabled={busy} onClick={() => setConfirmDelete(b)}>
                      <IconEl name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
              {!bons.data.bons.length && <tr><td colSpan="7" className="muted pad">Aucun bon passager.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

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
