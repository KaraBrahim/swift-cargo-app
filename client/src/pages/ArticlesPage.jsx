// The article CATALOGUE — every registered article, with no quantities. Stock
// levels live on the Stock page; this is the reference list you curate. An
// article that no bon has ever used and that no office holds can be deleted
// outright; otherwise it is deactivated so past bons keep their designation.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader, EmptyState, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';

const ACCENT = 'var(--c-stock)';
const EMPTY = { category_id: '', name: '', notes: '' };

export default function ArticlesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const items = useApi('/stock/items?includeInactive=true');
  const cats = useApi('/stock/categories?includeInactive=true');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      items.reload();
      cats.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const save = (e) => {
    e.preventDefault();
    const body = { name: form.name.trim(), category_id: form.category_id || null, notes: form.notes || undefined };
    return run(async () => {
      if (form.id) await api(`/stock/items/${form.id}`, { method: 'PUT', body });
      else await api('/stock/items', { method: 'POST', body });
      setForm(null);
    }, 'Article enregistré.');
  };

  const toggleActive = (it) =>
    run(() => api(`/stock/items/${it.id}/active`, { method: 'POST', body: { active: !it.active } }),
      it.active ? 'Article désactivé.' : 'Article réactivé.');

  const doDelete = () =>
    run(async () => {
      await api(`/stock/items/${confirm.id}`, { method: 'DELETE' });
      setConfirm(null);
    }, 'Article supprimé.');

  if (items.loading || cats.loading) return <Spinner />;
  const catList = cats.data?.categories ?? [];
  const all = items.data?.items ?? [];
  const rows = fuzzyRank(search, all, (i) => `${i.name} ${i.category_name || ''}`, 500);

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="box" accent={ACCENT} title="Articles"
        subtitle="Catalogue de référence — sans quantités. Les quantités par bureau se règlent dans Stock."
        back={<Link to="/stock" className="btn-back"><IconEl name="chevronLeft" />Retour au stock</Link>}
      >
        <Link to="/categories" className="btn"><IconEl name="tag" />Catégories</Link>
        <button className="btn btn-gold" onClick={() => setForm(form ? null : { ...EMPTY })}>
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouvel article'}
        </button>
      </PageHeader>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          <label className="field field-grow"><span>Nom de l’article</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Catégorie</span>
            <select value={form.category_id || ''} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">— aucune —</option>
              {catList.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.name.trim()}>{form.id ? 'Enregistrer' : 'Créer'}</button>
        </form>
      )}

      <div className="filter-bar">
        <label className="field" style={{ minWidth: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un article…" />
        </label>
        <span className="muted">{rows.length} / {all.length} article(s)</span>
      </div>

      <div className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Article</th><th>Catégorie</th><th>État</th><th>Notes</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id} className={`clickable ${it.active ? '' : 'row-muted'}`} onClick={() => navigate(`/articles/${it.id}`)}>
                    <td><span className="gold">{it.name}</span></td>
                    <td>{it.category_name || '—'}</td>
                    <td>
                      {Number(it.stock_total) > 0
                        ? <span className="status-badge st-arrive">En stock</span>
                        : <span className="status-badge st-cree">Enregistré</span>}
                      {!it.active && <span className="status-badge st-transit" style={{ marginLeft: 6 }}>Inactif</span>}
                    </td>
                    <td className="muted">{it.notes || '—'}</td>
                    <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" title="Voir la fiche" aria-label="Voir" onClick={() => navigate(`/articles/${it.id}`)}>
                        <IconEl name="search" />
                      </button>
                      <button className="icon-btn" title="Modifier" aria-label="Modifier"
                        onClick={() => setForm({ id: it.id, name: it.name, category_id: it.category_id || '', notes: it.notes || '' })}>
                        <IconEl name="edit" />
                      </button>
                      <button className="icon-btn" title={it.active ? 'Désactiver' : 'Réactiver'} aria-label="Activer/Désactiver"
                        disabled={busy} onClick={() => toggleActive(it)}>
                        <IconEl name={it.active ? 'close' : 'check'} />
                      </button>
                      <button className="icon-btn danger" title="Supprimer" aria-label="Supprimer"
                        disabled={busy} onClick={() => setConfirm(it)}>
                        <IconEl name="trash" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon="box" title="Aucun article" sub="Créez un article pour le réutiliser dans les bons." />}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={`Supprimer « ${confirm?.name} » ?`}
        message="L’article disparaît définitivement du catalogue."
        bullets={[
          'Refusé s’il figure déjà sur un bon ou s’il reste du stock.',
          'Dans ce cas, désactivez-le : il quitte les listes sans toucher à l’historique.',
        ]}
        confirmLabel="Supprimer"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
