// Font picker. Each card renders its own family, so the choice is made by
// looking at the thing itself rather than at a label — and the sample carries
// digits, because most of this app is amounts and references.
import { useEffect, useState } from 'react';
import { IconEl } from './icons.jsx';
import { FONTS, readFont, setFont, subscribeFont } from '../theme/fonts.js';

export function useFontChoice() {
  const [fontId, setId] = useState(readFont);
  useEffect(() => subscribeFont(setId), []);
  return [fontId, setFont];
}

export function FontGrid({ wide = false }) {
  const [fontId, choose] = useFontChoice();
  return (
    <div className={`font-grid ${wide ? 'font-grid-wide' : ''}`}>
      {FONTS.map((f) => (
        <button
          key={f.id}
          className={`font-card ${fontId === f.id ? 'active' : ''}`}
          style={{ fontFamily: `var(--f-${f.id})` }}
          onClick={() => choose(f.id)}
          aria-pressed={fontId === f.id}
          title={f.note}
        >
          <span className="font-sample">
            <span className="font-sample-a">Bon 1042</span>
            <span className="font-sample-b">128 450,00 DZD</span>
          </span>
          <span className="font-card-foot">
            <span className="font-name">{wide ? f.name : f.short}</span>
            {fontId === f.id && <span className="font-check"><IconEl name="check" /></span>}
          </span>
          <span className="font-hint">{wide ? f.note : f.hint}</span>
        </button>
      ))}
    </div>
  );
}
