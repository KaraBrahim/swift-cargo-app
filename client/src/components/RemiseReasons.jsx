// Les motifs de remise : la liste que le patron tient lui-même, et qui alimente le
// choix au comptoir. Un motif déjà utilisé ne se supprime pas — il se désactive : il
// disparaît du choix mais reste lisible sur les fiches et dans le rapport.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { errorMessage, useToast } from './ui.jsx';
import { useIsSuper } from '../auth/AuthContext.jsx';

export function RemiseReasons() {
  const toast = useToast();
  const isSuper = useIsSuper();
  const list = useApi('/remises/reasons?includeInactive=true');
  const [label, setLabel] = useState('');
  const [edit, setEdit] = useState(null); // { id, label }
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); list.reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const reasons = list.data?.reasons ?? [];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Motifs de remise</h2>
        <Link to="/remises" className="back-link">Voir toutes les remises</Link>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: -4 }}>
        Au comptoir, une remise peut porter un motif choisi dans cette liste (facultatif). Il apparaît sur le bon, la fiche
        de la personne et dans le rapport des remises.
      </p>

      <div className="reason-list">
        {reasons.map((r) => (
          <div key={r.id} className={`reason-row ${r.active ? '' : 'off'}`}>
            {edit?.id === r.id ? (
              <form className="reason-edit" onSubmit={(e) => {
                e.preventDefault();
                run(() => api(`/remises/reasons/${r.id}`, { method: 'PATCH', body: { label: edit.label } }), 'Motif renommé.').then(() => setEdit(null));
              }}>
                <input autoFocus value={edit.label} maxLength={80} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                <button className="btn btn-gold btn-sm" disabled={busy || !edit.label.trim()}>Enregistrer</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Annuler</button>
              </form>
            ) : (
              <>
                <span className="reason-name">{r.label}{!r.active && <em className="muted"> — désactivé</em>}</span>
                <span className="muted reason-uses">{r.uses} remise{r.uses > 1 ? 's' : ''}</span>
                {isSuper && (
                  <span className="reason-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: r.id, label: r.label })}>Renommer</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => run(() => api(`/remises/reasons/${r.id}`, { method: 'PATCH', body: { active: !r.active } }), r.active ? 'Motif désactivé.' : 'Motif réactivé.')}>
                      {r.active ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
        ))}
        {!reasons.length && !list.loading && <p className="muted">Aucun motif.</p>}
      </div>

      {isSuper ? (
        <form className="op-form" style={{ marginTop: 12 }} onSubmit={(e) => {
          e.preventDefault();
          run(() => api('/remises/reasons', { method: 'POST', body: { label } }), 'Motif ajouté.').then(() => setLabel(''));
        }}>
          <label className="field field-grow"><span>Nouveau motif</span>
            <input value={label} maxLength={80} placeholder="ex. Client de longue date" onChange={(e) => setLabel(e.target.value)} /></label>
          <button className="btn btn-gold" disabled={busy || !label.trim()}>Ajouter</button>
        </form>
      ) : (
        <p className="muted line-hint">Seul le super-administrateur modifie cette liste.</p>
      )}
    </div>
  );
}
