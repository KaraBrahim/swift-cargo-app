// Dashboard sync card. The desks run offline for stretches at a time, so a
// cashier needs to see whether their work has actually reached the hub — and how
// long it has been stuck if not.
import { useState } from 'react';
import { useApi } from '../api/useApi.js';
import { api } from '../api/client.js';
import { IconEl } from './icons.jsx';
import { useToast, errorMessage } from './ui.jsx';

const SITE_LABEL = { china: 'Bureau Chine', algeria: 'Bureau Algérie', cloud: 'Serveur central' };

export function relativeTime(iso) {
  if (!iso) return 'jamais';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

export function SyncCard() {
  const { data, reload } = useApi('/sync/status');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!data) return null;
  const { site, isHub, pending, oldestPendingAt, online, lastSyncAt, lastServerSeq } = data;
  // The hub has nothing to reach, so it is never "offline".
  const state = isHub ? 'hub' : online === false ? 'off' : online === true ? 'on' : 'idle';

  const runNow = async () => {
    setBusy(true);
    try {
      const res = await api('/sync/run', { method: 'POST' });
      toast.success(res.skipped ? 'Ce nœud est le serveur central.' : `Synchronisé : ${res.pushed} envoyé(s), ${res.pulled} reçu(s).`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel sync-card sync-${state}`}>
      <div className="panel-head">
        <h2 className="panel-title">Synchronisation</h2>
        <span className={`sync-pill sync-${state}`}>
          <span className="sync-dot" />
          {state === 'hub' ? 'Serveur central' : state === 'on' ? 'En ligne' : state === 'off' ? 'Hors ligne' : 'En attente'}
        </span>
      </div>

      {/* Two cells for what a cashier acts on; the rest is a footnote — this
          card shares a column with Bons récents and must stay short. */}
      <div className="sync-grid">
        <div className="sync-cell">
          <div className="sync-k">Site</div>
          <div className="sync-v">{SITE_LABEL[site] ?? site}</div>
        </div>
        <div className="sync-cell">
          <div className="sync-k">En attente d'envoi</div>
          <div className={`sync-v ${pending > 0 ? 'warn' : ''}`}>
            {pending}
            {pending > 0 && oldestPendingAt && (
              <span className="sync-since"> · {relativeTime(oldestPendingAt)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="sync-meta">
        Dernière synchro {isHub ? '—' : relativeTime(lastSyncAt)} · flux #{lastServerSeq}
      </div>

      {data.lastError && <div className="sync-err">Dernière erreur : {data.lastError}</div>}

      <button className="btn btn-sm btn-block" onClick={runNow} disabled={busy || isHub}>
        <IconEl name="refresh" />
        {busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
      </button>
    </div>
  );
}
