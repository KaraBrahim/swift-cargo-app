import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { relativeTime } from '../lib/format.js';

const EMPTY = { username: '', full_name: '', office: '', email: '', phone: '', password: '' };
const OFFICE_LABEL = { china: 'Chine', algeria: 'Algérie' };
const ACCENT = 'var(--c-people)';

export default function UtilisateursPage() {
  const toast = useToast();
  const { admin: me } = useAuth();
  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useApi(`/admins${includeInactive ? '?includeInactive=true' : ''}`);
  const [form, setForm] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        full_name: form.full_name, office: form.office || null,
        email: form.email || null, phone: form.phone || null,
      };
      if (form.id) await api(`/admins/${form.id}`, { method: 'PATCH', body });
      else await api('/admins', { method: 'POST', body: { ...body, username: form.username, password: form.password } });
      toast.success('Utilisateur enregistré.');
      setForm(null);
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const setActive = async (u, active) => {
    try {
      await api(`/admins/${u.id}/active`, { method: 'POST', body: { active } });
      toast.success(active ? 'Utilisateur réactivé.' : 'Utilisateur désactivé.');
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admins/${pwFor.id}/password`, { method: 'POST', body: { newPassword: pw } });
      toast.success(`Mot de passe réinitialisé. ${pwFor.full_name} devra se reconnecter.`);
      setPwFor(null); setPw('');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (list.loading) return <Spinner />;
  if (list.error) return <div className="alert alert-error">{list.error}</div>;
  const rows = list.data.admins;

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="users" accent={ACCENT} title="Utilisateurs"
        subtitle="Réservé au super-administrateur. Créez, modifiez ou désactivez les comptes admin ; chaque action est tracée dans le journal d'audit."
      >
        <button className="btn btn-gold" onClick={() => setForm(form ? null : { ...EMPTY })}>
          <IconEl name={form ? 'close' : 'plus'} />{form ? 'Fermer' : 'Nouvel utilisateur'}
        </button>
      </PageHeader>

      {form && (
        <form className="panel panel-accent op-form" onSubmit={save}>
          {!form.id && (
            <label className="field"><span>Identifiant</span>
              <input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="admin5" /></label>
          )}
          <label className="field field-grow"><span>Nom complet</span>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label className="field"><span>Bureau</span>
            <select value={form.office || ''} onChange={(e) => setForm({ ...form, office: e.target.value })}>
              <option value="">—</option>
              <option value="china">Chine</option>
              <option value="algeria">Algérie</option>
            </select></label>
          <label className="field"><span>E-mail</span>
            <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span>Téléphone</span>
            <input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          {!form.id && (
            <label className="field"><span>Mot de passe initial</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 caractères min." /></label>
          )}
          <button className="btn btn-gold" disabled={busy || !form.full_name.trim() || (!form.id && (!form.username.trim() || form.password.length < 8))}>
            {form.id ? 'Modifier' : 'Créer'}
          </button>
        </form>
      )}

      {pwFor && (
        <form className="panel panel-accent op-form" onSubmit={resetPassword}>
          <label className="field field-grow">
            <span>Nouveau mot de passe pour {pwFor.full_name}</span>
            <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8 caractères min." />
          </label>
          <button className="btn btn-gold" disabled={busy || pw.length < 8}>Réinitialiser</button>
          <button type="button" className="btn btn-ghost" onClick={() => { setPwFor(null); setPw(''); }}><IconEl name="close" />Annuler</button>
        </form>
      )}

      <div className="filter-bar">
        <button className={!includeInactive ? 'chip active' : 'chip'} onClick={() => setIncludeInactive(false)}>Actifs</button>
        <button className={includeInactive ? 'chip active' : 'chip'} onClick={() => setIncludeInactive(true)}>Tous</button>
      </div>

      <div className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Utilisateur</th><th>Identifiant</th><th>Rôle</th><th>Bureau</th><th>Contact</th><th>Dernière connexion</th><th>État</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="cell-main">
                        <span className="avatar">{initialsOf(u.full_name)}</span>
                        <span>{u.full_name}{u.id === me?.id && <span className="muted"> (vous)</span>}</span>
                      </span>
                    </td>
                    <td className="muted">{u.username}</td>
                    <td>
                      {u.role === 'superadmin'
                        ? <span className="badge badge-gold">Super Admin</span>
                        : <span className="badge">Admin</span>}
                    </td>
                    <td>{u.office ? OFFICE_LABEL[u.office] : '—'}</td>
                    <td className="muted">{u.email || u.phone || '—'}</td>
                    <td className="muted">{u.last_login_at ? relativeTime(u.last_login_at) : 'jamais'}</td>
                    <td>
                      <span className={`status-badge ${u.active ? 'st-regle' : 'st-cree'}`}>
                        {u.active ? 'Actif' : 'Désactivé'}
                      </span>
                    </td>
                    <td className="right nowrap">
                      <button className="btn btn-ghost btn-sm" onClick={() => setForm({
                        id: u.id, username: u.username, full_name: u.full_name,
                        office: u.office || '', email: u.email || '', phone: u.phone || '',
                      })}>Modifier</button>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => { setPwFor(u); setPw(''); }}>Mot de passe</button>{' '}
                      {u.active ? (
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          disabled={u.id === me?.id}
                          title={u.id === me?.id ? 'Vous ne pouvez pas désactiver votre propre compte.' : undefined}
                          onClick={() => setActive(u, false)}
                        >Désactiver</button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => setActive(u, true)}>Réactiver</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="users" title="Aucun utilisateur" sub="Créez un compte administrateur." />
        )}
      </div>
    </div>
  );
}
