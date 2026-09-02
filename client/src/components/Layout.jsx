import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconEl, initialsOf } from './icons.jsx';
import { useSyncPresence } from './SyncStatus.jsx';
import { TopBar } from './TopBar.jsx';
import { CommandPalette } from './CommandPalette.jsx';

// Both a fournisseur and a passager receive a physical "bon": the fournisseur's
// bon (the shipment) groups the passagers' bons (one per carrier).
const NAV = [
  { group: 'Aperçu', items: [{ to: '/', end: true, label: 'Tableau de bord', icon: 'dashboard' }] },
  {
    group: 'Opérations',
    items: [
      { to: '/bons-fournisseur', label: 'Bons fournisseurs', icon: 'order' },
      { to: '/bons-passager', label: 'Bons passagers', icon: 'bon' },
      { to: '/stock', label: 'Stock', icon: 'stock' },
      { to: '/articles', label: 'Articles', icon: 'box' },
      { to: '/categories', label: 'Catégories', icon: 'tag' },
      { to: '/caisses', label: 'Caisse & Finance', icon: 'caisse' },
      { to: '/charges', label: 'Charges', icon: 'wallet' },
    ],
  },
  {
    group: 'Répertoire',
    items: [
      { to: '/passagers', label: 'Passagers', icon: 'passager' },
      { to: '/fournisseurs', label: 'Fournisseurs', icon: 'fournisseur' },
    ],
  },
  {
    group: 'Analyse',
    items: [
      { to: '/rapports', label: 'Rapports', icon: 'report' },
      { to: '/impressions', label: 'Impressions', icon: 'print' },
    ],
  },
  {
    group: 'Système',
    items: [
      { to: '/taux', label: 'Taux de change', icon: 'taux' },
      { to: '/utilisateurs', label: 'Utilisateurs', icon: 'users' },
      { to: '/audit', label: "Journal d'audit", icon: 'audit' },
    ],
  },
];

const COLLAPSE_KEY = 'sc_sidebar_collapsed';

const PRESENCE_TITLE = { on: 'En ligne — synchronisé', off: 'Hors ligne — données locales', hub: 'Serveur central' };

export function Layout() {
  const { admin, logout } = useAuth();
  const { state: presence } = useSyncPresence();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // ⌘K / Ctrl-K from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-emblem">SC</div>
          <div className="sb-brand-text">
            <div className="sb-brand-name">SWIFT CARGO</div>
            <div className="sb-brand-sub">Gestion</div>
          </div>
        </div>

        <nav className="sb-nav">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="sb-group-label">{section.group}</div>
              {section.items.filter((it) => it.to !== '/utilisateurs' || admin?.role === 'superadmin').map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  title={collapsed ? it.label : undefined}
                  className={({ isActive }) => (isActive ? 'sb-link active' : 'sb-link')}
                >
                  <IconEl name={it.icon} />
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <div className="sb-user">
            <div className="sb-avatar-wrap">
              <div className="sb-avatar">{initialsOf(admin?.full_name)}</div>
              <span className={`presence presence-${presence}`} title={PRESENCE_TITLE[presence]} />
            </div>
            <div className="sb-user-info">
              <div className="sb-user-name">{admin?.full_name}</div>
              <div className="sb-user-role">{admin?.role === 'superadmin' ? 'Super Admin' : 'Administrateur'}</div>
            </div>
            <button className="sb-logout" onClick={logout} title="Déconnexion" aria-label="Déconnexion">
              <IconEl name="logout" />
            </button>
          </div>
          <button
            className="sb-collapse"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
            aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          >
            <IconEl name={collapsed ? 'chevronRight' : 'collapse'} />
          </button>
        </div>
      </aside>

      <div className="main">
        <TopBar onToggleSidebar={() => setCollapsed((c) => !c)} onOpenSearch={openSearch} />
        <div className="content">
          <Outlet />
        </div>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
