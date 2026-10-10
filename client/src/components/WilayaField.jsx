// La wilaya d'une personne : une liste d'Algérie proposée, un texte libre accepté.
import { useId } from 'react';
import { WILAYAS } from '../lib/wilayas.js';

export function WilayaField({ value, onChange, label = 'Wilaya' }) {
  const listId = useId();
  return (
    <label className="field">
      <span>{label}</span>
      <input
        list={listId}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Oran, Alger… ou une ville"
        autoComplete="off"
      />
      <datalist id={listId}>
        {WILAYAS.map((w, i) => <option key={w} value={w}>{String(i + 1).padStart(2, '0')}</option>)}
      </datalist>
    </label>
  );
}
