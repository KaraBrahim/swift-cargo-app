// Animated backdrop for the whole app — an abstract air-cargo route network in
// the active brand colour.
//
// The metaphor, since this is a China -> Algeria courier business:
//   * particles are TRIANGLES (aircraft / arrowheads), not dots;
//   * `rotate.path` turns each one to face its own heading, so they read as
//     craft in flight rather than tumbling debris;
//   * they drift LEFTWARD, because Algeria is west of China — the flow on
//     screen runs the same way the cargo does;
//   * varied speeds, so it looks like traffic rather than a marching formation;
//   * the links are the route network forming and dissolving between waypoints.
//
// Deliberately NOT emoji planes/parcels: the brand spec is black & gold with no
// emoji, and literal icons would read as toylike behind a finance screen.
//
// Package: tsparticles (@tsparticles/react v4 + the "slim" engine bundle).
// NOTE v4 registers the engine through <ParticlesProvider init={...}>; there is
// no initParticlesEngine export (that was v3).
//
// Mounted ONCE at the app root so it keeps running across route changes instead
// of tearing down and re-initialising on every navigation. The canvas is fixed
// at z-index 0; the shell and the login card sit above it (z-index 1 / 10).
//
// Theme handling — the important part:
// the brand tokens SWAP ROLES between modes. In dark mode --brand-text is the
// bright tint and --brand-deep is dark; in light mode it is the other way round
// (--brand-text #7f6118 is dark, --brand-deep #d8bd80 is pale). So we cannot
// reuse one colour list: on a light canvas the pale tones vanish. We pick the
// darker trio for light mode and raise the opacity instead of lowering it.
//
// Under prefers-reduced-motion nothing renders at all.
import { useMemo } from 'react';
import { ParticlesProvider, Particles } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import { useTheme, readThemeVars } from '../theme/ThemeContext.jsx';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Les jetons dont le fond a besoin, dans cet ordre.
const TOKENS = [
  '--brand', '--brand-2', '--brand-text', '--brand-deep',
  '--c-dash', '--c-order', '--c-caisse', '--c-bon', '--c-people',
];

export function AnimatedBackground() {
  const { themeId, theme } = useTheme();
  // Le MODE vient du thème choisi, pas de <html>. Voir juste en dessous.
  const isLight = theme.mode === 'light';

  const options = useMemo(() => {
    // `readThemeVars` demande les couleurs DU THÈME CHOISI, et non celles
    // posées sur <html>.
    //
    // La nuance était le défaut : ce fond lisait `getComputedStyle` pendant le
    // rendu, alors que `applyTheme` écrit les attributs dans un effet — donc
    // APRÈS. À chaque changement, les particules recevaient les couleurs du
    // thème PRÉCÉDENT : en quittant un thème violet, les lignes restaient
    // violettes jusqu'au changement suivant.
    //
    // Demander explicitement les couleurs du thème visé supprime la course :
    // il n'y a plus d'ordre à respecter entre cet effet-ci et celui du thème.
    const [brand, brand2, text, deep, ...hues] = readThemeVars(themeId, TOKENS);

    // Light: lean on the darker tones and push opacity UP so the constellation
    // actually reads against a near-white surface.
    const base = isLight ? [text, brand, brand2] : [brand, text, deep];
    // Un jeton absent revient vide : il ne doit pas entrer dans la liste.
    const usable = [...base, ...hues].filter(Boolean);
    // Deduplicated, because on the sober palette the hues ARE the brand and a
    // list of five identical colours only wastes work.
    const colors = [...new Set(usable)];
    const linkColor = isLight ? brand2 : brand;
    const opacity = isLight ? { min: 0.35, max: 0.85 } : { min: 0.2, max: 0.7 };
    const linkOpacity = isLight ? 0.38 : 0.32;

    return {
      fullScreen: { enable: true, zIndex: 0 },
      background: { color: 'transparent' },
      fpsLimit: 60,
      detectRetina: true,
      particles: {
        number: { value: 160, density: { enable: true } },
        color: { value: colors },
        shape: { type: 'triangle' },
        // Face the direction of travel — this is what makes them aircraft.
        rotate: { path: true },
        links: { enable: true, color: linkColor, distance: 130, opacity: linkOpacity, width: 1 },
        move: {
          enable: true,
          speed: { min: 0.8, max: 2.4 },   // mixed traffic, not one formation
          direction: 'left',                // China (east) -> Algeria (west)
          straight: false,
          outModes: { default: 'out' },
        },
        opacity: { value: opacity, animation: { enable: true, speed: 1.1, sync: false } },
        // Small enough to stay background, large enough to read as a shape.
        size: { value: { min: 1.5, max: 3.5 } },
      },
      interactivity: {
        // Hover only: a click-to-spawn mode would keep adding particles for the
        // whole working day, since this layer now lives under every screen.
        events: { onHover: { enable: true, mode: 'grab' }, resize: { enable: true } },
        modes: { grab: { distance: 180, links: { opacity: 0.6 } } },
      },
    };
  }, [themeId, isLight]);

  if (reducedMotion()) return null;
  return (
    <ParticlesProvider init={loadSlim}>
      <Particles key={`${themeId}-${isLight ? 'l' : 'd'}`} id="sc-bg-particles" options={options} />
    </ParticlesProvider>
  );
}
