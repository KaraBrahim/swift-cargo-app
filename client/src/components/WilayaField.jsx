// La wilaya d'une personne : une liste d'Algérie proposée, un texte libre accepté.
import { useMemo } from 'react';
import { WILAYAS } from '../lib/wilayas.js';
import { ComboInput } from './ComboInput.jsx';

export function WilayaField({ value, onChange, label = 'Wilaya' }) {
  // Le numéro officiel à droite de chaque nom : 01 Adrar, 31 Oran…
  const options = useMemo(() => WILAYAS.map((w, i) => ({ value: w, hint: String(i + 1).padStart(2, '0') })), []);
  return (
    <label className="field">
      <span>{label}</span>
      <ComboInput value={value} onChange={onChange} options={options} placeholder="Oran, Alger… ou une ville" maxShown={60} />
    </label>
  );
}
