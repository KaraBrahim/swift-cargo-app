// La grille des quatre thèmes.
//
// Elle était écrite deux fois — dans la page Paramètres et dans le menu des
// réglages — avec le même balisage recopié. Deux copies finissent toujours par
// être corrigées l'une sans l'autre ; ici elles partagent en plus les couleurs,
// qui avaient justement dérivé. Une seule grille, deux endroits qui l'appellent.
import { useMemo } from 'react';
import { IconEl } from './icons.jsx';
import { useTheme, readAllSwatches } from '../theme/ThemeContext.jsx';

export function ThemeGrid({ wide = false }) {
  const { themeId, themes, setTheme } = useTheme();
  // Les jetons de tokens.css ne changent pas en cours de route : une lecture
  // au montage suffit.
  const swatches = useMemo(readAllSwatches, []);

  return (
    <div className={wide ? 'theme-grid theme-grid-wide' : 'theme-grid'}>
      {themes.map((t) => (
        <button
          key={t.id}
          className={`theme-card ${themeId === t.id ? 'active' : ''}`}
          onClick={() => setTheme(t.id)}
          aria-pressed={themeId === t.id}
        >
          <span className="theme-preview">
            {swatches[t.id].map((color, i) => (
              <span key={i} className="theme-dot" style={{ background: color }} />
            ))}
            {themeId === t.id && <span className="theme-check"><IconEl name="check" /></span>}
          </span>
          <span className="theme-name">{t.name}</span>
          <span className="theme-hint">{t.hint}</span>
        </button>
      ))}
    </div>
  );
}
