import { useEffect, useRef } from 'react';
import { IconEl } from './icons.jsx';
import { useTabs, MAX_TABS } from './TabsContext.jsx';

// La barre d'onglets. Elle n'apparaît qu'à partir de deux onglets : une barre
// qui ne contient qu'un seul onglet ne fait que prendre de la place et répéter
// le titre déjà écrit sur la page.
//
// Ce qu'on peut faire, dans l'ordre de fréquence : cliquer un onglet, en fermer
// un (croix, ou clic du milieu comme partout ailleurs), en ouvrir un (+ ou
// ctrl+clic sur une entrée du menu), et passer de l'un à l'autre au clavier.
export function TabStrip() {
  const { tabs, activeId, activate, close, open, full } = useTabs();
  const stripRef = useRef(null);

  // Alt+1…9 pour aller droit à un onglet, Alt+W pour fermer celui qui est
  // devant. Pas Ctrl+T ni Ctrl+W : ceux-là appartiennent au navigateur, et une
  // page qui les vole ferme la fenêtre de quelqu'un un jour ou l'autre.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key >= '1' && e.key <= '9') {
        const t = tabs[Number(e.key) - 1];
        if (t) { e.preventDefault(); activate(t.id); }
      } else if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        close(activeId);
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        open('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeId, activate, close, open]);

  // L'onglet actif reste visible quand la barre déborde — en faisant défiler LA
  // BARRE, jamais la fenêtre. `scrollIntoView` remonte la page entière au
  // passage, ce qui annulait la position retrouvée de l'onglet qu'on ouvre.
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector('.ts-tab.active');
    if (!strip || !el) return;
    // Par rectangles plutôt que par offsetLeft : l'onglet et la barre n'ont pas
    // forcément le même parent de référence, et un décalage de quelques pixels
    // laisse l'onglet actif à moitié coupé au bord.
    const strip_ = strip.getBoundingClientRect();
    const tab = el.getBoundingClientRect();
    // La marge de droite tient compte du « + » qui suit le dernier onglet.
    const margin = 12;
    const addW = strip.querySelector('.ts-add')?.offsetWidth ?? 0;
    if (tab.left < strip_.left + margin) strip.scrollLeft -= strip_.left + margin - tab.left;
    else if (tab.right > strip_.right - margin - addW) strip.scrollLeft += tab.right - strip_.right + margin + addW;
  }, [activeId, tabs.length]);

  // Toujours affichée, même avec un seul onglet : c'est le « + » qui apprend que
  // les onglets existent. Cachée tant qu'il n'y en a qu'un, la fonction était
  // invisible — il fallait déjà la connaître pour la découvrir.

  return (
    <div className="ts-bar">
      {/* Le « + » suit le dernier onglet, comme dans un navigateur : on ouvre à
          la suite de ce qu'on a, pas dans un coin séparé. Il défile donc avec
          eux — d'où le décalage prévu dans le calcul de défilement plus haut,
          pour qu'il reste visible quand l'onglet actif est le dernier. */}
      <div className="ts-scroll" ref={stripRef} role="tablist" aria-label="Onglets ouverts">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={0}
            aria-selected={t.id === activeId}
            className={t.id === activeId ? 'ts-tab active' : 'ts-tab'}
            title={`${t.title}${i < 9 ? ` — Alt+${i + 1}` : ''}`}
            onClick={() => activate(t.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.id); } }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t.id); } }}
          >
            <IconEl name={t.icon} />
            <span className="ts-title">{t.title}</span>
            <button
              type="button"
              className="ts-x"
              aria-label={`Fermer ${t.title}`}
              onClick={(e) => { e.stopPropagation(); close(t.id); }}
            >
              <IconEl name="close" />
            </button>
          </div>
        ))}

        <button
          type="button"
          className="ts-add"
          onClick={() => open('/')}
          disabled={full}
          title={full ? `Maximum ${MAX_TABS} onglets` : 'Nouvel onglet (Alt+T)'}
          aria-label="Nouvel onglet"
        >
          <IconEl name="plus" />
        </button>
      </div>
    </div>
  );
}
