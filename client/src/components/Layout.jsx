import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  // On a phone the sidebar is a drawer, not a column: `collapsed` is a desktop
  // width preference and means nothing here, so the two are separate states.
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Tapping a link must close the drawer — otherwise it stays open on top of
  // the page it just opened.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // While the drawer covers the screen, the page behind it must not scroll.
  useEffect(() => {
    if (!navOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  // The same button means two different things by width: open the drawer on a
  // phone, widen/narrow the column on a desktop.
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 860px)').matches) setNavOpen((o) => !o);
    else setCollapsed((c) => !c);
  }, []);

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
    <div className={`app-shell ${collapsed ? 'collapsed' : ''} ${navOpen ? 'nav-open' : ''}`}>
      {/* Phone only (see shell.css): tapping beside the drawer closes it. */}
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-emblem">SC</div>
          <div className="sb-brand-text">
            <div className="sb-brand-name">SWIFT CARGO</div>
            <div className="sb-brand-sub">Gestion</div>
          </div>
          <button className="sb-close" onClick={() => setNavOpen(false)} aria-label="Fermer le menu">
            <IconEl name="close" />
          </button>
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
        <TopBar onToggleSidebar={toggleSidebar} onOpenSearch={openSearch} />
        <div className="content">
          <Outlet />
        </div>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
