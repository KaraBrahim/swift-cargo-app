// Top bar: sidebar toggle, global search, notifications bell, settings gear,
// user menu. The bell shows what OTHER admins have done (derived from the audit
// log via /api/notifications), so a cashier sees a colleague's activity — at
// either office, once it syncs — without asking.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconEl, initialsOf } from './icons.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { SettingsMenu, useDismiss } from './SettingsMenu.jsx';
import { SHORTCUT_LABEL } from './CommandPalette.jsx';
import { activityLine, entityHref } from './activityLabels.js';
import { relativeTime } from './SyncCard.jsx';
import { ConnectionChip } from './ConnectionBanner.jsx';
import NavArrows from './NavArrows.jsx';

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useDismiss(open, () => setOpen(false));
  const navigate = useNavigate();

  const refreshCount = useCallback(async () => {
    try {
      const { unread: n } = await api('/notifications/count');
      setUnread(n);
    } catch {
      /* offline — leave the last known count */
    }
  }, []);

  // Poll the badge like the sync chip does; light payload, low frequency.
  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 20000);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Opening loads the feed and marks everything seen (clears the badge).
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        const { notifications } = await api('/notifications?limit=20');
        setItems(notifications);
        await api('/notifications/seen', { method: 'POST' });
        setUnread(0);
      } catch {
        /* ignore — the popover just shows what it has */
      }
    }
  };

  return (
    <div className="pop-wrap" ref={ref}>
      <button
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={toggle}
        title="Notifications"
        aria-label={`Notifications (${unread})`}
      >
        <IconEl name="bell" />
        {unread > 0 && <span className="badge-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="pop pop-alerts" role="dialog" aria-label="Notifications">
          <div className="pop-head">
            <span>Notifications</span>
            <button className="pop-x" onClick={() => setOpen(false)} aria-label="Fermer">
              <IconEl name="close" />
            </button>
          </div>
          <div className="pop-list">
            {items.map((n) => {
              const { label, icon, sub } = activityLine(n);
              return (
                <button
                  key={n.id}
                  className={`notif-row ${n.unread ? 'unread' : ''}`}
                  onClick={() => { setOpen(false); navigate(entityHref(n)); }}
                >
                  <span className="notif-ico"><IconEl name={icon} /></span>
                  <span className="notif-body">
                    <span className="notif-label">{label}</span>
                    {/* D'abord DE QUOI il s'agit, ensuite qui l'a fait : dix
                        lignes « Fiche créée » ne se distinguent que par là. */}
                    <span className="notif-meta">
                      {[sub, n.admin_name && `par ${n.admin_name}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="notif-time">{relativeTime(n.created_at)}</span>
                </button>
              );
            })}
            {!items.length && (
              <div className="pop-empty">
                <IconEl name="check" />
                <span>Aucune activité d'un autre utilisateur.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const { admin, logout } = useAuth();

  return (
    <div className="pop-wrap" ref={ref}>
      <button className={`user-btn ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="avatar">{initialsOf(admin?.full_name)}</span>
        <span className="user-btn-id">
          <span className="user-btn-name">{admin?.full_name}</span>
          <span className="user-btn-role">{admin?.role === 'superadmin' ? 'Super Admin' : 'Administrateur'}</span>
        </span>
        <IconEl name="chevronDown" className="user-btn-caret" />
      </button>

      {open && (
        <div className="pop pop-user" role="menu">
          <div className="pop-user-head">
            <span className="avatar avatar-md">{initialsOf(admin?.full_name)}</span>
            <div>
              <div className="pop-user-name">{admin?.full_name}</div>
              <div className="pop-user-sub">
                {admin?.username}
                {admin?.office ? ` · Bureau ${admin.office === 'china' ? 'Chine' : 'Algérie'}` : ''}
              </div>
            </div>
          </div>
          <button className="pop-item danger" onClick={logout} role="menuitem">
            <IconEl name="logout" />
            <span>Déconnexion</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onToggleSidebar, onOpenSearch }) {
  return (
    <header className="topbar">
      <button className="icon-btn topbar-burger" onClick={onToggleSidebar} title="Menu" aria-label="Menu">
        <IconEl name="menu" />
      </button>

      {/* Back / forward sit with the other navigation, at the head of the bar —
          the same place every browser puts them. */}
      <NavArrows />

      <button className="search-trigger" onClick={onOpenSearch}>
        <IconEl name="search" />
        <span>Rechercher un bon, passager, fournisseur…</span>
        <kbd>{SHORTCUT_LABEL}</kbd>
      </button>

      <div className="topbar-actions">
        {/* Only rendered while the connection is down — a permanent reminder
            that the app is working blind, wherever you are in it. */}
        <ConnectionChip />
        <NotificationsBell />
        <SettingsMenu compact />
        <UserMenu />
      </div>
    </header>
  );
}
