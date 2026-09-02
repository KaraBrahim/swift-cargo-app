import { useApi } from '../api/useApi.js';
import { Spinner } from '../components/ui.jsx';

const ACTION_LABELS = {
  'auth.login': 'Connexion',
  'auth.logout': 'Déconnexion',
  'auth.change_password': 'Changement de mot de passe',
  'rate.set': 'Taux défini',
  'caisse.deposit': 'Dépôt',
  'caisse.withdraw': 'Retrait',
  'caisse.convert': 'Conversion',
  'caisse.transfer': 'Transfert',
};

export default function AuditPage() {
  const audit = useApi('/audit?limit=200');
  if (audit.loading) return <Spinner />;
  if (audit.error) return <div className="alert alert-error">{audit.error}</div>;

  const rows = audit.data.entries;

  return (
    <div>
      <div className="page-head">
        <h1>Journal d'audit</h1>
        <p className="muted">Qui a fait quoi, et quand.</p>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Action</th><th>Par</th><th>Détails</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                  <td><span className="type-badge">{ACTION_LABELS[e.action] || e.action}</span></td>
                  <td>{e.admin_name || '—'}</td>
                  <td className="details-cell">{e.details ? <code>{JSON.stringify(e.details)}</code> : '—'}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="4" className="muted pad">Aucune entrée.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
