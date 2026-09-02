// L'écran de bienvenue, joué avant chaque connexion.
// Choreography lives in theme/intro.css; this file only decides when it plays,
// when it leaves, and how a letter gets its delay.
import { useEffect, useRef, useState } from 'react';

// The message finishes assembling around 2.4s; HOLD lets it rest well past
// that before anything moves, so the welcome is read rather than glimpsed.
const HOLD = 4200;
// Must match .intro.leaving in intro.css — veil 0.9s + its 0.1s delay.
const EXIT = 1000;
const SKIP_EXIT = 580;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// Played on every arrival at the sign-in screen. Login mounts once per arrival,
// so a failed password does not replay it — the form stays put and only the
// error appears.
export function shouldPlayIntro() {
  return !prefersReducedMotion();
}

// One <span> per character so each can carry its own delay. Spaces are kept as
// characters (white-space: pre) so the wordmark keeps its rhythm.
function Letters({ text, start, step, className }) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="intro-ch" style={{ '--d': `${start + i * step}ms` }} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}

/**
 * Two signals, deliberately:
 *   onHandover  the veil has *started* lifting — mount the form now, so it
 *               rises in underneath while this fades out and the handover
 *               reads as one movement instead of two.
 *   onEnd       the veil is gone — the parent can stop rendering this.
 *
 * They have to be separate: a single callback that the parent used to unmount
 * this component would kill the exit animation on its first frame.
 */
export function WelcomeIntro({ onHandover, onEnd }) {
  const [leaving, setLeaving] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return undefined;
    let endTimer;

    const leave = (fast) => {
      if (done.current) return;
      done.current = true;
      setSkipped(fast);
      setLeaving(true);
      onHandover?.();
      endTimer = setTimeout(() => onEnd?.(), fast ? SKIP_EXIT : EXIT);
    };

    const timer = setTimeout(() => leave(false), HOLD);
    const skip = () => leave(true);

    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      clearTimeout(timer);
      clearTimeout(endTimer);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [onHandover, onEnd]);

  return (
    <div
      className={`intro ${leaving ? 'leaving' : ''} ${skipped ? 'skipped' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="intro-aurora" aria-hidden="true"><i /><i /></div>

      <div className="intro-inner">
        <div className="intro-emblem" aria-hidden="true">SC</div>

        <Letters className="intro-line intro-hello" text="Bienvenue" start={520} step={45} />
        <Letters className="intro-line intro-title" text="SWIFT CARGO" start={1120} step={42} />

        <span className="intro-rule" aria-hidden="true" />
        <p className="intro-sub">Votre espace de gestion, de la Chine à l'Algérie.</p>
      </div>

      <span className="intro-hint" aria-hidden="true">Appuyez pour continuer</span>
    </div>
  );
}
