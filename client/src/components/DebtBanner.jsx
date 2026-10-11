// La dette, dite en grand — avant, pendant et APRÈS la confirmation.
//
// « Payer plus tard » et « encaisser plus tard » ne font bouger aucune caisse, et
// c'est voulu. Mais l'argent qui reste dû ne doit jamais devenir silencieux : tant
// qu'il y en a, la pièce le dit en gros, avec qui doit à qui, combien reste, et
// combien a déjà été réglé. Une dette qui disparaît de l'écran est une dette qu'on
// oublie — et l'argent est ce qui compte le plus ici.
//
//   DebtBanner  : la bannière en tête d'une fiche (bon, ordre, personne)
//   DebtCell    : la même chose, en une cellule de liste
//
// Deux sens, deux couleurs, jamais confondus :
//   out → VOUS devez  (rouge : une sortie d'argent à venir)
//   in  → on VOUS doit (or    : une entrée d'argent attendue)
import { formatMoney, formatNumber } from '../lib/format.js';
import { IconEl } from './icons.jsx';

const pctOf = (paid, total) => (Number(total) > 0 ? Math.min(100, Math.round((Number(paid) / Number(total)) * 1000) / 10) : 0);

// direction : 'out' | 'in' · due : ce qui reste · paid : déjà réglé · total : le dû d'origine
// pending : pas encore de montant (le bon n'est pas réglé) · onAct : saute au formulaire d'argent
export function DebtBanner({ direction, who, due, paid = 0, total, currency, actLabel, onAct, pending, remise }) {
  const d = Number(due);
  // `total` absent : on ne connaît que le solde ouvert (la fiche d'une personne).
  const known = total != null;
  const t = known ? Number(total) : Number(due) + Number(paid);

  if (pending) {
    return (
      <div className="debt-banner pending" role="status">
        <span className="debt-ico"><IconEl name="coins" /></span>
        <div className="debt-main"><div className="debt-title">{pending}</div></div>
      </div>
    );
  }

  // Tout est réglé : on le dit aussi — un compte soldé est une information.
  if (!(d > 0)) {
    if (!(t > 0)) return null;
    return (
      <div className="debt-banner ok" role="status">
        <span className="debt-ico"><IconEl name="check" /></span>
        <div className="debt-main">
          <div className="debt-title">Soldé</div>
          <div className="debt-sub">
            {formatMoney(paid, currency)} réglés sur {formatMoney(t, currency)}
            {Number(remise) !== 0 && remise != null ? ` · remise de règlement ${formatMoney(remise, currency)}` : ''}
          </div>
        </div>
      </div>
    );
  }

  const out = direction === 'out';
  return (
    <div className={`debt-banner ${out ? 'out' : 'in'}`} role="status">
      <span className="debt-ico"><IconEl name={out ? 'arrowOut' : 'arrowIn'} /></span>
      <div className="debt-main">
        <div className="debt-kicker">{out ? 'DETTE — vous devez' : 'CRÉANCE — on vous doit'}</div>
        <div className="debt-line">
          <strong className="debt-amount">{formatMoney(d, currency)}</strong>
          <span className="debt-who">{out ? <>à <b>{who}</b></> : <>par <b>{who}</b></>}</span>
        </div>
        <div className="debt-sub">
          {!known
            ? <>Solde ouvert de ce compte : il reste à {out ? 'payer' : 'encaisser'} jusqu’à ce qu’il soit soldé.</>
            : Number(paid) > 0
            ? <>Déjà réglé : <b>{formatMoney(paid, currency)}</b> sur {formatMoney(t, currency)} · {formatNumber(pctOf(paid, t), { decimals: 1, trim: true })} %</>
            : <>Rien n’a encore été {out ? 'payé' : 'encaissé'} : la caisse n’a pas bougé, la dette reste ouverte.</>}
        </div>
        {known && t > 0 && (
          <div className="debt-bar" aria-hidden="true"><span style={{ width: `${pctOf(paid, t)}%` }} /></div>
        )}
      </div>
      {onAct && (
        <button type="button" className={`btn ${out ? 'btn-danger-soft' : 'btn-gold'}`} onClick={onAct}>
          <IconEl name={out ? 'arrowOut' : 'arrowIn'} />{actLabel || (out ? 'Payer maintenant' : 'Encaisser maintenant')}
        </button>
      )}
    </div>
  );
}

// Une cellule de liste : le reste dû en évidence, ou « Soldé ». `pay` vient du
// serveur ({ due, paid, rest, pct, remise }) ; sans lui, rien n'est encore dû.
export function DebtCell({ pay, code, direction = 'out', idle }) {
  if (!pay || (Number(pay.due) === 0 && Number(pay.paid) === 0)) return <span className="muted debt-idle">{idle ?? '—'}</span>;
  const rest = Number(pay.rest);
  if (rest > 0) {
    return (
      <span className={`debt-cell ${direction}`}>
        <strong>Reste dû {formatMoney(rest, code)}</strong>
        <span className="debt-cell-sub">
          {Number(pay.paid) > 0 ? `${formatMoney(pay.paid, code)} déjà réglés (${formatNumber(pay.pct, { decimals: 0 })} %)` : 'rien de réglé'}
        </span>
      </span>
    );
  }
  return <span className="debt-cell ok"><strong>Soldé</strong><span className="debt-cell-sub">{formatMoney(pay.paid, code)} réglés</span></span>;
}
