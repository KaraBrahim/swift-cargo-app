// Où en est la marchandise (ou l'argent), d'un coup d'œil.
//
// Une barre empilée : chaque tranche est une part du total, et leur somme fait
// le total. Les chiffres viennent du serveur (server/src/lib/progress.js) —
// ici on ne calcule rien, on dessine. Ainsi la liste, la fiche, le tableau de
// bord et le PDF disent la même chose.
import { formatQty, formatNumber } from '../lib/format.js';
import { formatMoney } from './ui.jsx';

// La tranche la plus avancée qui porte quelque chose : c'est elle que dit la
// version courte, dans une liste où la place manque.
const ADVANCED_FIRST = ['delivered', 'arrived', 'office', 'transit', 'waiting', 'china'];

export function progressSummary(progress) {
  const segs = progress?.segments ?? [];
  for (const key of ADVANCED_FIRST) {
    const s = segs.find((x) => x.key === key && x.pct > 0);
    if (s) return `${formatNumber(s.pct, { decimals: 1, trim: true })} % ${s.label.toLowerCase()}`;
  }
  return '0 %';
}

const pctText = (p) => `${formatNumber(p, { decimals: 1, trim: true })} %`;

// progress : { segments, total, unit, mixed }
//   compact : la barre et une ligne, pour les listes
//   legend  : le détail tranche par tranche (chiffres et pourcentages)
export function ProgressBar({ progress, compact = false, legend = !compact, className = '' }) {
  if (!progress || !progress.segments?.length) return null;
  const segs = progress.segments;
  const live = segs.filter((s) => s.pct > 0);
  const label = live.length ? live.map((s) => `${s.label} ${pctText(s.pct)}`).join(', ') : 'Rien';

  return (
    <div className={`pg ${compact ? 'pg-compact' : ''} ${className}`}>
      <div className="pg-bar" role="img" aria-label={label} title={label}>
        {live.map((s) => (
          <span key={s.key} className={`pg-seg pg-${s.tone}`} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      {compact && <div className="pg-line">{progressSummary(progress)}</div>}
      {legend && (
        <ul className="pg-legend">
          {segs.map((s) => (
            <li key={s.key} className={s.pct > 0 ? '' : 'pg-zero'}>
              <i className={`pg-dot pg-${s.tone}`} />
              <span className="pg-name">{s.label}</span>
              <span className="pg-num">
                {s.value != null && `${formatQty(s.value)} ${progress.unit ?? ''} · `}
                <strong>{pctText(s.pct)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// L'argent : une seule tranche, ce qui est réglé sur ce qui est dû.
export function MoneyBar({ pay, code, label = 'Réglé', compact = false }) {
  if (!pay) return null;
  const text = `${label} ${formatMoney(pay.paid, code)} sur ${formatMoney(pay.due, code)}`;
  return (
    <div className={`pg ${compact ? 'pg-compact' : ''}`}>
      <div className="pg-bar" role="img" aria-label={`${text} (${pctText(pay.pct)})`} title={text}>
        {pay.pct > 0 && <span className="pg-seg pg-green" style={{ width: `${pay.pct}%` }} />}
      </div>
      <div className="pg-line">
        {compact ? `${pctText(pay.pct)} ${label.toLowerCase()}` : <>{text} · <strong>{pctText(pay.pct)}</strong></>}
      </div>
    </div>
  );
}
