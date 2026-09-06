// Article categories — a small reference list, fully editable. A category in use
// by any article cannot be deleted; deactivate it instead so it stops appearing
// in pickers without breaking the articles that carry it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader, EmptyState, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';

const ACCENT = 'var(--c-stock)';

export default function CategoriesPage() {
  const toast = useToast();
  const cats = useApi('/stock/categories?includeInactive=true');
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      cats.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    return run(async () => {
      await api('/stock/categories', { method: 'POST', body: { name: name.trim() } });
      setName('');
    }, 'Catégorie ajoutée.');
  };

  const saveEdit = (e) => {
    e.preventDefault();
    return run(async () => {
      await api(`/stock/categories/${edit.id}`, { method: 'PUT', body: { name: edit.name.trim(), active: edit.active } });
      setEdit(null);
    }, 'Catégorie modifiée.');
  };

  const toggle = (c) =>
    run(() => api(`/stock/categories/${c.id}`, { method: 'PUT', body: { name: c.name, active: !c.active } }),
      c.active ? 'Catégorie désactivée.' : 'Catégorie réactivée.');

  const doDelete = () =>
    run(async () => {
      await api(`/stock/categories/${confirm.id}`, { method: 'DELETE' });
      setConfirm(null);
    }, 'Catégorie supprimée.');

  if (cats.loading) return <Spinner />;
  const list = cats.data?.categories ?? [];

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="tag" accent={ACCENT} title="Catégories"
        subtitle="Classement des articles. Une catégorie utilisée ne peut pas être supprimée, seulement désactivée."
      >
        <Link to="/articles" className="btn"><IconEl name="box" />Articles</Link>
      </PageHeader>

      <form className="panel op-form" onSubmit={add}>
        <label className="field field-grow"><span>Nouvelle catégorie</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Électronique" /></label>
        <button className="btn btn-gold" disabled={busy || !name.trim()}><IconEl name="plus" />Ajouter</button>
      </form>

      {edit && (
        <form className="panel panel-accent op-form" onSubmit={saveEdit}>
          <label className="field field-grow"><span>Renommer la catégorie</span>
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !edit.name.trim()}>Enregistrer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}><IconEl name="close" />Annuler</button>
        </form>
      )}

      <div className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Catégorie</th><th className="right">Articles</th><th>État</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'row-muted'}>
                    <td>{c.name}</td>
                    <td className="right">{c.item_count}</td>
                    <td>
                      {c.active
                        ? <span className="status-badge st-arrive">Active</span>
                        : <span className="status-badge st-transit">Inactive</span>}
                    </td>
                    <td className="right nowrap">
                      <button className="icon-btn" title="Renommer" aria-label="Renommer"
                        onClick={() => setEdit({ id: c.id, name: c.name, active: c.active })}>
                        <IconEl name="edit" />
                      </button>
                      <button className="icon-btn" title={c.active ? 'Désactiver' : 'Réactiver'} aria-label="Activer/Désactiver"
                        disabled={busy} onClick={() => toggle(c)}>
                        <IconEl name={c.active ? 'close' : 'check'} />
                      </button>
                      <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer"
                        disabled={busy || Number(c.item_count) > 0} onClick={() => setConfirm(c)}>
                        <IconEl name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="tag" title="Aucune catégorie" sub="Ajoutez-en une pour classer vos articles." />}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`Supprimer « ${confirm?.name} » ?`}
        message="La catégorie disparaît définitivement."
        confirmLabel="Supprimer"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
