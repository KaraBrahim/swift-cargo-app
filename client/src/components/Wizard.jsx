// Un formulaire long devient trois questions courtes.
//
// Créer un bon demandait de remplir un mur de champs d'un coup : qui, quoi,
// combien, dans quelle devise, avec quelle remise. Ici chaque étape pose UNE
// question, montre une grande icône et une seule zone de saisie, et ne laisse
// avancer que lorsqu'elle a sa réponse. La barre du bas rappelle en permanence
// ce qui est déjà décidé et ce que ça coûte.

import { IconEl } from './icons.jsx';

export function Wizard({
  icon = 'bon',
  accent,
  title,
  steps = [],           // [{ key, label, icon, ok }]
  step = 0,
  onStep,
  onCancel,
  children,
  summary = null,       // ce que le bon vaut, montré en bas à gauche
  footer = null,
}) {
  // On peut revenir en arrière librement, et avancer jusqu'à la première étape
  // qui n'a pas encore sa réponse — pas plus loin.
  const firstIncomplete = steps.findIndex((s) => !s.ok);
  const reachable = firstIncomplete === -1 ? steps.length - 1 : firstIncomplete;

  return (
    <div className="wz" style={accent ? { '--accent': accent } : undefined}>
      <header className="wz-top">
        <div className="wz-title">
          <span className="wz-ico"><IconEl name={icon} /></span>
          <h1>{title}</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          <IconEl name="close" />Annuler
        </button>
      </header>

      <nav className="wz-rail" aria-label="Étapes">
        {steps.map((s, i) => {
          const state = i === step ? 'now' : s.ok ? 'ok' : '';
          return (
            <button
              key={s.key}
              type="button"
              className={`wz-step ${state}`}
              disabled={i > reachable && i !== step}
              onClick={() => onStep(i)}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="wz-dot">
                {s.ok && i !== step ? <IconEl name="check" /> : <IconEl name={s.icon} />}
              </span>
              <span className="wz-step-label">{s.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="wz-body">{children}</div>

      <footer className="wz-foot">
        <div className="wz-sum">{summary}</div>
        <div className="wz-acts">{footer}</div>
      </footer>
    </div>
  );
}

// L'en-tête d'une étape : une question, pas un titre de section.
export function StepHead({ icon, question, hint }) {
  return (
    <div className="wz-q">
      <span className="wz-q-ico"><IconEl name={icon} /></span>
      <div>
        <h2>{question}</h2>
        {hint && <p>{hint}</p>}
      </div>
    </div>
  );
}
