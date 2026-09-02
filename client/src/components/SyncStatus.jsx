import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

const SITE_LABEL = { cloud: 'Cloud · Hub', china: 'Bureau Chine', algeria: 'Bureau Algérie' };

// Small chip in the sidebar: which node this is, online/offline, pending count.
export function SyncStatus() {
  const [status, setStatus] = useState(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api('/sync/status');
        if (alive) { setStatus(s); setOnline(true); }
      } catch {
        if (alive) setOnline(false);
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!status) return null;
  const sub = status.isHub ? 'Hub central' : online ? 'Synchronisé' : 'Hors ligne';

  return (
    <div className={`sync-chip ${online ? 'on' : 'off'}`} title={online ? 'Connecté' : 'Hors ligne — les données restent locales'}>
      <span className="sync-dot" />
      <div className="sync-info">
        <div className="sync-site">{SITE_LABEL[status.site] || status.site}</div>
        <div className="sync-sub">{sub}{status.pending > 0 ? ` · ${status.pending} en attente` : ''}</div>
      </div>
    </div>
  );
}

// Presence for the sidebar avatar dot (Messenger-style): 'on' | 'off' | 'hub'.
// Same 10s poll of /sync/status, but reduced to a single indicator.
export function useSyncPresence() {
  const [state, setState] = useState('on');
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api('/sync/status');
        if (!alive) return;
        setPending(s.pending || 0);
        setState(s.isHub ? 'hub' : (s.online === false ? 'off' : 'on'));
      } catch {
        if (alive) setState('off');
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { state, pending };
}
