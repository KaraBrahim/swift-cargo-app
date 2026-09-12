// Le vocabulaire des fiches — bon fournisseur, bon passager.
//
// Une fiche répondait par un pavé de couples « libellé : valeur » où tout avait
// le même poids : le nom du créateur autant que la somme à encaisser. Ici les
// quelques chiffres qui comptent deviennent des tuiles avec une icône, le reste
// descend en note de bas de fiche, et chaque section porte son icône plutôt
// qu'un paragraphe d'explication.

import { Link } from 'react-router-dom';
import { IconEl, initialsOf } from './icons.jsx';

export function DetailHead({ icon, accent, title, status, sub, actions }) {
  return (
    <header className="dt-head" style={accent ? { '--accent': accent } : undefined}>
      <span className="dt-ico"><IconEl name={icon} /></span>
      <div className="dt-id">
        <h1>{title}</h1>
        {sub}
      </div>
      {status}
      <div className="dt-acts">{actions}</div>
    </header>
  );
}

export function Kpis({ children }) {
  return <div className="dt-kpis">{children}</div>;
}

// Une tuile = une icône, un chiffre, un mot. Le lien facultatif en fait une
// porte : la tuile « Fournisseur » ouvre sa fiche.
// `hero` : la carte qui compte — l'argent — en couleurs inversées, pour qu'elle
// se lise avant les autres.
export function Kpi({ icon, label, value, sub, tone = '', to, person = false, hero = false }) {
  const inner = (
    <>
      <span className="dt-kpi-ico">
        {person && typeof value === 'string' && value !== '—'
          ? <span className="dt-kpi-av">{initialsOf(value)}</span>
          : <IconEl name={icon} />}
      </span>
      <span className="dt-kpi-body">
        <span className="dt-kpi-label">{label}</span>
        <strong className={`dt-kpi-v ${tone}`}>{value}</strong>
        {sub && <span className="dt-kpi-sub">{sub}</span>}
      </span>
      {to && <IconEl name="chevronRight" className="dt-kpi-go" />}
    </>
  );
  const cls = `dt-kpi${to ? ' link' : ''}${hero ? ' hero' : ''}`;
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

// Le fil du parcours, partagé par les deux fiches.
//
// Il était écrit deux fois, à la main, et les deux copies ne faisaient déjà plus
// tout à fait la même chose. Une troisième aurait achevé de les séparer.
//
// Deux natures, qu'il faut garder distinctes : le statut d'un BON est réel —
// stocké, avancé à la main — donc son fil est une commande (`onJump`). Celui
// d'un ORDRE est DÉDUIT de cinq portes, donc son fil est un indicateur : rien
// ne l'écrit, et un bouton qui prétendrait le faire serait écrasé par le
// recalcul une ligne plus loin.
//
// `fill` (0…1) remplit partiellement la pastille et le trait, parce qu'une
// étape à moitié faite ne ressemblait en rien à une étape à moitié faite : elle
// ressemblait à une étape finie. `tag` pose le mot sous le libellé, et `title`
// donne les nombres au survol — le mot d'abord, pour qu'on le remarque sans
// avoir à chercher ; les nombres ensuite, pour qui veut savoir.
export function StepFlow({ steps, current, onJump, busy = false }) {
  const curIdx = steps.findIndex((s) => s.key === current);
  const Tag = onJump ? 'button' : 'div';
  return (
    <div className={`stepper ${onJump ? 'stepper-click' : ''}`}>
      {steps.map((s, i) => {
        const partial = s.fill != null && s.fill > 0 && s.fill < 1;
        return (
          <Tag
            key={s.key}
            {...(onJump
              ? { type: 'button', onClick: () => onJump(s.key), disabled: busy || i === curIdx }
              : {})}
            className={`step ${i <= curIdx ? 'done' : ''} ${i === curIdx ? 'current' : ''} ${partial ? 'partial' : ''}`}
            style={partial ? { '--fill': s.fill } : undefined}
            title={s.title || (onJump && i !== curIdx ? `Aller à « ${s.label} »` : undefined)}
          >
            <span className="step-dot" />
            <span className="step-label">{s.label}</span>
            {/* « ouvert » = il reste un geste à faire ; « réglé » = le manque est
                constaté et déjà compensé. Le même badge pour les deux et, en une
                semaine, plus personne ne le lit. */}
            {s.tag && <span className={`step-tag ${s.tone === 'open' ? 'open' : 'settled'}`}>{s.tag}</span>}
          </Tag>
        );
      })}
    </div>
  );
}

// Une barre vaut mieux que « 12 sur 40 » : on voit la part d'un coup d'œil.
export function Bar({ value, max, title }) {
  const pct = Number(max) > 0 ? Math.min(100, Math.max(0, (Number(value) / Number(max)) * 100)) : 0;
  return (
    <span className="dt-bar" title={title} aria-hidden="true">
      <span className="dt-bar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Section({ icon, title, count, right, children, tone = '' }) {
  return (
    <section className={`panel dt-sec ${tone}`}>
      <header className="dt-sec-head">
        <span className="dt-sec-ico"><IconEl name={icon} /></span>
        <h2>{title}</h2>
        {count != null && <span className="dt-sec-n">{count}</span>}
        <span className="dt-sec-right">{right}</span>
      </header>
      {children}
    </section>
  );
}

// « Ce bon vient d'être scanné. »
//
// La douchette a ouvert cette fiche ; le bandeau dit d'où elle vient et met en
// avant la seule action qu'on attend à ce stade. Il ne fait rien tout seul : un
// coup de douchette par erreur ne doit jamais déplacer un bon.
export function ScanBanner({ hit, onAct, onDismiss }) {
  if (!hit) return null;
  return (
    <div className="dt-scan">
      <span className="dt-scan-ico"><IconEl name="scan" /></span>
      <span className="dt-scan-txt">
        Scanné à l'instant
        {hit.subtitle && <em>{hit.subtitle}</em>}
      </span>
      {hit.next && (
        <button type="button" className="btn btn-gold" onClick={onAct}>
          <IconEl name="chevronRight" />{hit.next.label}
        </button>
      )}
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Fermer le bandeau">
        <IconEl name="close" />
      </button>
    </div>
  );
}

// Qui a créé la fiche et quand : utile, jamais urgent — donc en bas, en petit.
export function Footnote({ by, at, extra }) {
  return (
    <p className="dt-foot">
      <IconEl name="note" />
      Créé par {by} · {new Date(at).toLocaleString('fr-FR')}{extra ? ` · ${extra}` : ''}
    </p>
  );
}
