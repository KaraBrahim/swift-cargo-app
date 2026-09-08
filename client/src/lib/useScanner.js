// La douchette.
//
// Un lecteur USB ou Bluetooth n'est pas un périphérique à part : pour Windows
// c'est un clavier. Il « tape » le code très vite — quelques millisecondes entre
// deux touches — puis un Entrée. Rien à installer, rien à autoriser, et ça
// marche depuis n'importe quel écran sans qu'on ait à cliquer dans un champ.
//
// Tout tient donc dans un écouteur clavier, et dans une seule question : est-ce
// une machine ou un humain qui tape ? La vitesse répond. Un humain ne produit
// pas quarante caractères à 30 ms d'intervalle ; et pour que même un humain très
// rapide ne déclenche rien par accident, on exige en plus le début exact d'un
// code — « SC: », la lettre de type, son deux-points.
//
// Le problème restant est le champ qui a le focus : les cinq premières touches y
// sont déjà tombées avant qu'on sache qu'il s'agit d'un scan. On note donc ce que
// le champ contenait au début de la rafale, on le lui rend, et on avale le reste
// — la recherche en cours n'est pas polluée.
//
// Et si le pari est perdu — un humain a vraiment tapé « SC:B: » à la main — ce
// qui a été avalé lui revient intégralement. Intercepter ne doit jamais faire
// disparaître une saisie.

import { useEffect, useRef } from 'react';
import { parseScan } from './scanCode.js';

// On n'avale les touches qu'une fois le debut complet reconnu — « SC: » plus
// la lettre de type et son deux-points. Cinq caracteres exacts a la vitesse
// d'une machine : un humain ne les produit pas par hasard.
const PREFIX_RE = /^SC:[A-Z]:$/i;
const PREFIX_LEN = 5;
// Au-delà, c'est une frappe humaine : on repart de zéro.
const MAX_GAP_MS = 60;
// Filet pour une douchette configurée sans suffixe Entrée. Ne se déclenche que
// sur un code complet et valide, donc ne peut pas partir à tort.
const FLUSH_MS = 150;

export function useScanner(onScan, enabled = true) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    let buffer = '';
    let last = 0;
    let swallowing = false;
    let target = null;        // le champ qui avait le focus quand la rafale a commencé
    let targetValue = '';
    let flushTimer = null;

    const reset = () => {
      buffer = '';
      swallowing = false;
      target = null;
      targetValue = '';
      clearTimeout(flushTimer);
    };

    // Rendre au champ ce qu'il contenait — ou, si le pari etait faux, ce qu'il
    // contenait PLUS ce qui a ete tape. Intercepter est un pari ; quand il est
    // perdu, l'utilisateur ne doit pas voir sa saisie disparaitre.
    const restore = (append = '') => {
      if (!target) return;
      const wanted = targetValue + append;
      try {
        if (target.value !== wanted) {
          const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, 'value')?.set;
          // Passer par le setter natif, sinon React ne voit pas le changement.
          if (setter) setter.call(target, wanted); else target.value = wanted;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          if (append) {
            try { target.setSelectionRange(wanted.length, wanted.length); } catch { /* pas un champ texte */ }
          }
        }
      } catch { /* le champ a disparu entre-temps */ }
    };

    // Le code n'en etait pas un : on rend les touches avalees et on oublie.
    const giveBack = (typed) => { restore(typed); reset(); };

    const fire = (code) => {
      restore();
      reset();
      onScanRef.current(code);
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) { reset(); return; }

      const now = Date.now();
      if (now - last > MAX_GAP_MS) {
        // La rafale s'est interrompue : c'etait une frappe humaine.
        if (swallowing) restore(buffer);
        reset();
      }
      last = now;

      if (e.key === 'Enter') {
        const code = buffer;
        const wasSwallowing = swallowing;
        if (wasSwallowing) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (parseScan(code)) { fire(code); return; }
        // Faux depart : ce qui a ete avale revient dans le champ, avec Entree
        // simplement perdue — un moindre mal devant une saisie effacee.
        if (wasSwallowing) giveBack(code); else reset();
        return;
      }

      // Une seule touche imprimable ; Shift, Tab, les flèches ne comptent pas.
      if (e.key.length !== 1) return;

      if (!buffer) {
        const el = e.target;
        if (el && typeof el.value === 'string') { target = el; targetValue = el.value; }
      }
      buffer += e.key;

      if (!swallowing && buffer.length >= PREFIX_LEN) {
        if (PREFIX_RE.test(buffer.slice(0, PREFIX_LEN))) {
          swallowing = true;
          restore();                    // enlève le « SC:B: » déjà tombé dans le champ
        } else {
          // Une frappe ordinaire : on ne la surveille plus jusqu'à la prochaine pause.
          reset();
          last = now;
          return;
        }
      }

      if (swallowing) {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(flushTimer);
        const snapshot = buffer;
        flushTimer = setTimeout(() => { if (parseScan(snapshot)) fire(snapshot); else giveBack(snapshot); }, FLUSH_MS);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearTimeout(flushTimer);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled]);
}
