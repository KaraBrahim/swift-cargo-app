import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';

const EMPTY = { name: '', phone: '', city: '', notes: '' };
const ACCENT = 'var(--c-people)';

export default function FournisseursPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const list = useApi(`/fournisseurs${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.id) await api(`/fournisseurs/${form.id}`, { method: 'PUT', body: form });
      else await api('/fournisseurs', { method: 'POST', body: form });
      toast.success('Fournisseur enregistré.');
      setForm(null);
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    try {
      await api(`/fournisseurs/${id}/active`, { method: 'POST', body: { active: false } });
      toast.success('Fournisseur retiré.');
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (list.loading) return <Spinner />;
  if (list.error) return <div className="alert alert-error">{list.error}</div>;
  const rows = list.data.fournisseurs;

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="fournisseur" accent={ACCENT} title="Fournisseurs" subtitle="Répertoire des fournisseurs et leurs comptes.">
        <button className="btn btn-gold" onClick={() => setForm(form ? null : { ...EMPTY })}>
          <IconEl name={form ? 'edit' : 'plus'} />{form ? 'Fermer' : 'Nouveau fournisseur'}
        </button>
      </PageHeader>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          <label className="field field-grow"><span>Nom</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Téléphone</span>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field"><span>Ville</span>
            <input value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.name.trim()}>{form.id ? 'Modifier' : 'Créer'}</button>
        </form>
      )}

      <div className="filter-bar">
        <label className="field" style={{ minWidth: 260 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un fournisseur…" />
        </label>
      </div>

      <div className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fournisseur</th><th>Téléphone</th><th>Ville</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => navigate(`/fournisseurs/${f.id}`)}>
                    <td>
                      <span className="cell-main">
                        <span className="avatar">{initialsOf(f.name)}</span>
                        <span className="gold">{f.name}</span>
                      </span>
                    </td>
                    <td>{f.phone || '—'}</td>
                    <td>{f.city || '—'}</td>
                    <td className="muted">{f.notes || '—'}</td>
                    <td className="right nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setForm({ id: f.id, name: f.name, phone: f.phone || '', city: f.city || '', notes: f.notes || '' }); }}>Modifier</button>{' '}
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); remove(f.id); }}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="fournisseur" title="Aucun fournisseur"
            sub="Ajoutez votre premier fournisseur pour commencer à créer des bons fournisseurs." />
        )}
      </div>
    </div>
  );
}
