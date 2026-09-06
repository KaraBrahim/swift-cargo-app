import { useEffect, useRef, useState } from 'react';
import { NETWORK_MESSAGES } from '../api/client.js';
import { IconEl } from './icons.jsx';

// Which picture says it. A crossed-out wifi is read at a glance; a sentence has
// to be read at all, and the top bar is not the place for reading.
const ICON = { OFFLINE: 'wifiOff', SERVER_DOWN: 'net', TIMEOUT: 'net' };

// Losing the connection is not a per-operation problem: without a permanent
// indicator you learn about it one failed click at a time, and each click looks
// like a different bug. Two things watch the same signal — a banner that
// announces the change, and a chip that stays for as long as it lasts.
export function useConnection() {
  const [code, setCode] = useState(navigator.onLine === false ? 'OFFLINE' : null);

  useEffect(() => {
    const down = (e) => setCode(e.detail?.code ?? 'SERVER_DOWN');
    const up = () => setCode(null);
    const offline = () => setCode('OFFLINE');
    window.addEventListener('sc-net-down', down);
    window.addEventListener('sc-net-up', up);
    window.addEventListener('offline', offline);
    window.addEventListener('online', up);
    return () => {
      window.removeEventListener('sc-net-down', down);
      window.removeEventListener('sc-net-up', up);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', up);
    };
  }, []);

  return code;
}

// The chip: an icon, nothing written. It is permanent, and it is the reason the
// banner is allowed to be dismissed at all — clicking it brings the sentence
// back for anyone who wants it. Shaped like the bell and the gear beside it, so
// it reads as part of the top bar rather than as an alert dropped into it.
export function ConnectionChip() {
  const code = useConnection();
  if (!code) return null;
  return (
    <button
      type="button"
      className="icon-btn net-chip"
      title={NETWORK_MESSAGES[code]}
      aria-label={NETWORK_MESSAGES[code]}
      onClick={() => window.dispatchEvent(new CustomEvent('sc-net-show'))}
    >
      <IconEl name={ICON[code] ?? 'net'} />
    </button>
  );
}

export default function ConnectionBanner() {
  const code = useConnection();
  // 'issue' while it lasts, 'restored' for the moment it comes back, then gone.
  const [view, setView] = useState(null);
  const [leaving, setLeaving] = useState(false);
  // Dismissing hides THIS incident, not every future one — otherwise a single
  // click would silence the app for the rest of the session.
  const dismissed = useRef(null);

  useEffect(() => {
    if (code) {
      if (dismissed.current === code) return undefined;
      setLeaving(false);
      setView({ kind: 'issue', code });
      return undefined;
    }
    dismissed.current = null;
    // Only announce the recovery to someone who saw the problem.
    setView((v) => (v?.kind === 'issue' ? { kind: 'restored' } : null));
    return undefined;
  }, [code]);

  // The recovery message is the one thing that does leave on its own: it says
  // "it works again", which stops being news a few seconds later.
  useEffect(() => {
    if (view?.kind !== 'restored') return undefined;
    const hide = setTimeout(() => setLeaving(true), 3200);
    const drop = setTimeout(() => setView(null), 3500);
    return () => { clearTimeout(hide); clearTimeout(drop); };
  }, [view]);

  useEffect(() => {
    const show = () => { dismissed.current = null; setLeaving(false); if (code) setView({ kind: 'issue', code }); };
    window.addEventListener('sc-net-show', show);
    return () => window.removeEventListener('sc-net-show', show);
  }, [code]);

  if (!view) return null;

  const restored = view.kind === 'restored';
  const close = () => {
    dismissed.current = view.code ?? null;
    setLeaving(true);
    setTimeout(() => setView(null), 220);
  };

  return (
    <div className={`net-banner ${restored ? 'ok' : 'bad'} ${leaving ? 'leaving' : ''}`} role="status">
      <span className="net-banner-ico"><IconEl name={restored ? 'wifi' : (ICON[view.code] ?? 'net')} /></span>
      <span className="net-banner-text">
        {restored ? 'Connexion rétablie.' : NETWORK_MESSAGES[view.code]}
      </span>
      <button type="button" className="net-banner-x" onClick={close} title="Fermer" aria-label="Fermer">
        <IconEl name="close" />
      </button>
    </div>
  );
}
