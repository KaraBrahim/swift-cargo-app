import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';

const EMPTY = { type: 'regular', full_name: '', phone: '', notes: '' };
const TYPE_LABEL = { regular: 'Régulier', auto: 'Auto-entrepreneur' };
const ACCENT = 'var(--c-stock)';

export default function PassagersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const qs = [search && `search=${encodeURIComponent(search)}`, typeFilter && `type=${typeFilter}`].filter(Boolean).join('&');
  const list = useApi(`/passagers${qs ? `?${qs}` : ''}`);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.id) await api(`/passagers/${form.id}`, { method: 'PUT', body: form });
      else await api('/passagers', { method: 'POST', body: form });
      toast.success('Passager enregistré.');
      setForm(null);
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    try {
      await api(`/passagers/${id}/active`, { method: 'POST', body: { active: false } });
      toast.success('Passager retiré.');
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (list.loading) return <Spinner />;
  if (list.error) return <div className="alert alert-error">{list.error}</div>;
  const rows = list.data.passagers;

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="passager" accent={ACCENT} title="Passagers" subtitle="Répertoire des passagers, leurs bons et leurs comptes.">
        <button className="btn btn-gold" onClick={() => setForm(form ? null : { ...EMPTY })}>
          <IconEl name={form ? 'edit' : 'plus'} />{form ? 'Fermer' : 'Nouveau passager'}
        </button>
      </PageHeader>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          <label className="field"><span>Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="regular">Régulier</option>
              <option value="auto">Auto-entrepreneur</option>
            </select></label>
          <label className="field field-grow"><span>Nom complet</span>
            <input autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label className="field"><span>Téléphone</span>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="btn btn-gold" disabled={busy || !form.full_name.trim()}>{form.id ? 'Modifier' : 'Créer'}</button>
        </form>
      )}

      <div className="filter-bar">
        <label className="field" style={{ minWidth: 240 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un passager…" />
        </label>
        <button className={!typeFilter ? 'chip active' : 'chip'} onClick={() => setTypeFilter('')}>Tous</button>
        <button className={typeFilter === 'regular' ? 'chip active' : 'chip'} onClick={() => setTypeFilter('regular')}>Réguliers</button>
        <button className={typeFilter === 'auto' ? 'chip active' : 'chip'} onClick={() => setTypeFilter('auto')}>Auto-entrepreneurs</button>
      </div>

      <div className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Passager</th><th>Type</th><th>Téléphone</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/passagers/${p.id}`)}>
                    <td>
                      <span className="cell-main">
                        <span className="avatar">{initialsOf(p.full_name)}</span>
                        <span className="gold">{p.full_name}</span>
                      </span>
                    </td>
                    <td><span className="type-badge">{TYPE_LABEL[p.type]}</span></td>
                    <td>{p.phone || '—'}</td>
                    <td className="muted">{p.notes || '—'}</td>
                    <td className="right nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setForm({ id: p.id, type: p.type, full_name: p.full_name, phone: p.phone || '', notes: p.notes || '' }); }}>Modifier</button>{' '}
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); remove(p.id); }}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="passager" title="Aucun passager"
            sub="Ajoutez un passager pour pouvoir lui affecter des bons de transport." />
        )}
      </div>
    </div>
  );
}
