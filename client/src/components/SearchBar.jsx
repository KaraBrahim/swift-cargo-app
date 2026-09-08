// Une barre de recherche, la même partout : loupe, champ, croix pour effacer.
// Elle ne fait rien d'autre — le filtrage appartient à la page.
import { IconEl } from './icons.jsx';

export function SearchBar({ value, onChange, placeholder = 'Rechercher…', autoFocus = false }) {
  return (
    <div className="sbar">
      <IconEl name="search" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="sbar-x" onClick={() => onChange('')} aria-label="Effacer la recherche">
          <IconEl name="close" />
        </button>
      )}
    </div>
  );
}
