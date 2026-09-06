import { useEffect } from 'react';
import { IconEl } from './icons.jsx';
import { useTabs } from './TabsContext.jsx';
import { pathMeta } from '../lib/pathMeta.js';

// ── Reculer / avancer, dans l'onglet où l'on se trouve ────────────────
// Pas `navigate(-1)` sur l'historique du navigateur : cette pile commence avant
// l'application, donc « retour » depuis la première page en sort complètement,
// et le navigateur ne dit jamais s'il y a quelque chose devant — les boutons ne
// pourraient pas être désactivés honnêtement.
//
// L'historique vit donc avec les onglets (voir TabsContext) : chacun a le sien,
// comme dans un navigateur, il est vide au début de chaque session et ne touche
// à aucun stockage durable — où l'on était hier ne regarde pas aujourd'hui.
export default function NavArrows() {
  const { go, canGoBack, canGoForward, backPath, forwardPath } = useTabs();

  // Alt+flèche, ce que fait un navigateur pour la même chose : l'habitude
  // fonctionne aussi à l'intérieur de l'application.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  return (
    <nav className="nav-arrows" aria-label="Navigation dans l’historique">
      <button
        type="button"
        className="nav-arrow"
        disabled={!canGoBack}
        onClick={() => go(-1)}
        aria-label={backPath ? `Retour : ${pathMeta(backPath).title}` : 'Aucune page précédente'}
      >
        <IconEl name="chevronLeft" />
        {backPath && <span className="nav-arrow-tip">{pathMeta(backPath).title}</span>}
      </button>

      <span className="nav-arrows-sep" aria-hidden="true" />

      <button
        type="button"
        className="nav-arrow"
        disabled={!canGoForward}
        onClick={() => go(1)}
        aria-label={forwardPath ? `Suivant : ${pathMeta(forwardPath).title}` : 'Aucune page suivante'}
      >
        <IconEl name="chevronRight" />
        {forwardPath && <span className="nav-arrow-tip">{pathMeta(forwardPath).title}</span>}
      </button>
    </nav>
  );
}
