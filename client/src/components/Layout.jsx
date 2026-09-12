import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { IconEl, initialsOf } from './icons.jsx';
import icon from '../assets/swift-cargo-logo-files/swift-cargo-icon.svg';
import { TopBar } from './TopBar.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import ConnectionBanner from './ConnectionBanner.jsx';
import { TabsProvider, TabPaneProvider, useTabs } from './TabsContext.jsx';
import { TabStrip } from './TabStrip.jsx';
import { AppPages } from '../routes.jsx';
import { useToast, errorMessage } from './ui.jsx';
import { api } from '../api/client.js';
import { useScanner } from '../lib/useScanner.js';
import { setScanHit } from '../lib/scanSignal.js';

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
      { to: '/utilisateurs', label: 'Utilisateurs', icon: 'users', superadmin: true },
      { to: '/audit', label: "Journal d'audit", icon: 'audit' },
      { to: '/maintenance', label: 'Maintenance', icon: 'alert', superadmin: true },
    ],
  },
];

const COLLAPSE_KEY = 'sc_sidebar_collapsed';


// Toutes les pages ouvertes sont montées ; seule celle de l'onglet actif est
// affichée. C'est ce qui fait qu'un formulaire à moitié rempli est encore là au
// retour, au lieu d'être reconstruit à neuf comme après un rechargement.
function TabPanes() {
  const { tabs, activeId } = useTabs();
  return (
    <div className="content">
      {tabs.map((t) => (
        <div key={t.id} className="tabpane" hidden={t.id !== activeId}>
          <TabPaneProvider value={t.id}>
            <AppPages path={t.path} />
          </TabPaneProvider>
        </div>
      ))}
    </div>
  );
}

// Le shell a besoin du contexte des onglets ; le fournisseur doit donc être
// au-dessus de lui, pas dedans.
export function Layout() {
  const toast = useToast();
  return (
    <TabsProvider onRefused={(m) => toast.error(m)}>
      <Shell />
    </TabsProvider>
  );
}

function Shell() {
  const { admin, logout } = useAuth();
  const toast = useToast();
  const { open: openTab, openOrFocus } = useTabs();

  // La douchette, ecoutee une seule fois pour toute l'application. Le scan
  // ouvre la fiche et signale son arrivee ; il ne change jamais rien tout seul,
  // parce qu'un coup de douchette par erreur ne doit pas deplacer un bon.
  useScanner(useCallback(async (code) => {
    try {
      const hit = await api(`/scan?code=${encodeURIComponent(code)}`);
      setScanHit(hit);
      openOrFocus(hit.path);
      toast.success(`${hit.label} ${hit.reference}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [openOrFocus, toast]));
  // Whether the sidebar shows its section headings — a per-desk preference,
  // kept with the theme. See ThemeContext.
  const { navGroups } = useTheme();
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
      {/* Inside the application only. The sign-in page states its own problems
          in its own card — a floating banner over it would say the same thing
          twice, and cover the message about the credentials while doing it. */}
      <ConnectionBanner />
      {/* Phone only (see shell.css): tapping beside the drawer closes it. */}
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className="sidebar">
        <div className="sb-brand">
          <img className="sb-emblem" src={icon} alt="" />
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
              {navGroups && <div className="sb-group-label">{section.group}</div>}
              {section.items.filter((it) => !it.superadmin || admin?.role === 'superadmin').map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  title={collapsed ? `${it.label} — ctrl+clic : nouvel onglet` : undefined}
                  className={({ isActive }) => (isActive ? 'sb-link active' : 'sb-link')}
                  // Le geste que tout le monde connaît des navigateurs :
                  // ctrl/⌘+clic ouvre à côté sans quitter la page en cours,
                  // clic du milieu de même.
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      openTab(it.to, { background: true });
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openTab(it.to, { background: true });
                    }
                  }}
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
        <TabStrip />
        <TabPanes />
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
