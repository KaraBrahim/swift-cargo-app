import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi, useDebounced } from '../api/useApi.js';
import { useIsSuper } from '../auth/AuthContext.jsx';
import { Spinner, errorMessage, useToast, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { RolePicker, RoleBadges, emptyPerson, personToForm, personBody, personValid } from '../components/RolePicker.jsx';

const ACCENT = 'var(--c-people)';

// Fournisseurs and passagers are one répertoire seen from two sides: this page
// lists the people who supply goods, /passagers lists those who carry them, and
// someone who does both is in both lists — with one fiche and one balance.
export default function FournisseursPage() {
  const toast = useToast();
  const isSuper = useIsSuper();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // The box follows your typing; the request waits for you to stop.
  const query = useDebounced(search);
  const list = useApi(`/people?role=fournisseur${query ? `&search=${encodeURIComponent(query)}` : ''}`);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = personBody(form);
      if (form.id) await api(`/people/${form.id}`, { method: 'PUT', body });
      else await api('/people', { method: 'POST', body });
      toast.success('Fiche enregistrée.');
      setForm(null);
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    try {
      await api(`/people/${id}/active`, { method: 'POST', body: { active: false } });
      toast.success('Fiche retirée.');
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  if (list.loading || !list.data) return <Spinner />;
  if (list.error) return <div className="alert alert-error">{list.error}</div>;
  const rows = list.data.people;

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="fournisseur" accent={ACCENT} title="Fournisseurs" subtitle="Répertoire des fournisseurs et leurs comptes.">
        <button className="btn btn-gold" onClick={() => setForm(form ? null : emptyPerson({ isFournisseur: true }))}>
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouveau fournisseur'}
        </button>
      </PageHeader>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          <label className="field field-grow"><span>Nom</span>
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Téléphone</span>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <RolePicker value={form} onChange={setForm} />
          <button className="btn btn-gold" disabled={busy || !personValid(form)}>{form.id ? 'Modifier' : 'Créer'}</button>
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
              <thead><tr><th>Fournisseur</th><th>Téléphone</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="clickable" onClick={() => navigate(`/personnes/${f.id}`)}>
                    <td>
                      <span className="cell-main">
                        <span className="avatar">{initialsOf(f.name)}</span>
                        <span className="gold">{f.name}</span>
                        {/* Only the OTHER role is worth saying here. */}
                        <RoleBadges person={f} hide="fournisseur" />
                      </span>
                    </td>
                    <td>{f.phone || '—'}</td>
                    <td className="muted">{f.notes || '—'}</td>
                    <td className="right nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setForm(personToForm(f)); }}>Modifier</button>{' '}
                      {/* Retirer une fiche est un geste de super-administrateur :
                          un clic, aucune confirmation, et la personne disparaît de
                          toutes les listes. Voir useIsSuper. */}
                      {isSuper && (
                        <button className="btn btn-ghost btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); remove(f.id); }}>Retirer</button>
                      )}
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
