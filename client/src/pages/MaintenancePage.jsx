// Maintenance des données — super-admin uniquement.
//
// Tout ce qui détruit demande le mot SUPPRIMER, écrit à la main : un clic de
// trop ne doit jamais suffire. Les dépendances entre domaines se cochent toutes
// seules et se voient — on sait exactement ce qui part avant de confirmer.
import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';

const ACCENT = 'var(--c-alert)';
const WORD = 'SUPPRIMER';

export default function MaintenancePage() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/maintenance/overview');
  const [picked, setPicked] = useState(new Set());
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');

  if (loading) return <Spinner />;
  if (error) return <div className="panel"><div className="alert alert-error">{error}</div></div>;
  const domains = data?.domains ?? [];

  // Cocher un domaine coche ce dont il dépend ; décocher un domaine décoche
  // ceux qui dépendent de lui. La sélection reste toujours cohérente.
  const toggle = (key) => {
    const next = new Set(picked);
    const d = domains.find((x) => x.key === key);
    if (next.has(key)) {
      next.delete(key);
      domains.filter((x) => x.requires.includes(key)).forEach((x) => next.delete(x.key));
    } else {
      next.add(key);
      d.requires.forEach((r) => next.add(r));
    }
    setPicked(next);
  };

  const run = async (label, fn, ok) => {
    setBusy(label);
    try {
      const res = await fn();
      toast.success(typeof ok === 'function' ? ok(res) : ok);
      setPicked(new Set()); setConfirm('');
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(''); }
  };

  const purge = () => run('purge',
    () => api('/maintenance/purge', { method: 'POST', body: { domains: [...picked], confirm } }),
    (r) => `Supprimé : ${r.purged.map((k) => domains.find((d) => d.key === k)?.label).join(', ')}.`);

  const reset = () => run('reset',
    () => api('/maintenance/reset', { method: 'POST', body: { confirm } }),
    'Base remise à zéro. Seuls le super-admin, les devises et les caisses restent.');

  const recompute = () => run('recompute',
    () => api('/maintenance/recompute', { method: 'POST' }),
    (r) => `Recalculé : ${r.caisses} soldes de caisse, ${r.orders} commandes.`);

  const revoke = () => run('revoke',
    () => api('/maintenance/revoke-sessions', { method: 'POST' }),
    (r) => `${r.revoked} session(s) fermée(s).`);

  const backup = () => run('backup', async () => {
    const d = await api('/maintenance/backup');
    const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `swift-cargo-${d.exported_at.slice(0, 10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
    return d;
  }, 'Sauvegarde téléchargée.');

  const armed = confirm.trim() === WORD;
  const total = domains.reduce((n, d) => n + d.rows, 0);

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="alert" accent={ACCENT} title="Maintenance" subtitle={`Base de ${data.size} · ${total} lignes · ${data.sessions} session(s) ouverte(s).`} />

      {/* ── Sans danger ── */}
      <div className="panel">
        <h2 className="panel-title">Entretien</h2>
        <div className="dt-actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn" disabled={!!busy} onClick={backup}><IconEl name="download" />Télécharger une sauvegarde (JSON)</button>
          <button className="btn" disabled={!!busy} onClick={recompute}><IconEl name="swap" />Recalculer soldes et statuts</button>
          <button className="btn" disabled={!!busy} onClick={revoke}><IconEl name="users" />Déconnecter tout le monde</button>
        </div>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          La sauvegarde contient toutes les données sauf les sessions et les mots de passe. Le recalcul repart des
          écritures ; il ne change rien si tout est déjà juste.
        </p>
      </div>

      {/* ── Suppression par domaine ── */}
      <div className="panel panel-accent">
        <h2 className="panel-title">Supprimer des données</h2>
        <div className="theme-grid theme-grid-wide" style={{ marginBottom: 14 }}>
          {domains.map((d) => (
            <button key={d.key} type="button" className={`theme-card ${picked.has(d.key) ? 'active' : ''}`} onClick={() => toggle(d.key)} aria-pressed={picked.has(d.key)}>
              <span className="theme-name">{picked.has(d.key) ? '☑' : '☐'} {d.label} <span className="muted">· {d.rows}</span></span>
              <span className="theme-hint">{d.hint}</span>
              {d.requires.length > 0 && (
                <span className="theme-hint">Entraîne : {d.requires.map((r) => domains.find((x) => x.key === r)?.label).join(', ')}</span>
              )}
            </button>
          ))}
        </div>

        <div className="wz-money">
          <label className="field wz-amount"><span>Écrivez {WORD} pour confirmer</span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={WORD} autoComplete="off" /></label>
          <button className="btn btn-danger-solid" disabled={!!busy || !armed || picked.size === 0} onClick={purge}>
            <IconEl name="trash" />Supprimer la sélection ({picked.size})
          </button>
          <button className="btn btn-danger" disabled={!!busy || !armed} onClick={reset}>
            <IconEl name="alert" />Tout remettre à zéro
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 10 }}>
          « Tout remettre à zéro » efface tous les domaines puis recrée la base telle qu’au premier démarrage :
          le super-admin, les devises, les deux caisses de bureau à zéro. Irréversible — téléchargez une sauvegarde avant.
        </p>
      </div>
    </div>
  );
}
