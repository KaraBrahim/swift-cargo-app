import { useCallback, useRef } from 'react';
import { newIdemKey } from '../api/client.js';

// Un geste d'argent, réessayé, doit rester UN geste.
//
// Le cas est celui-ci : le paiement part, le réseau tombe ou le serveur met
// plus de douze secondes, le client abandonne. La personne au guichet voit une
// erreur et reclique — mais le serveur, lui, avait peut-être déjà tout
// enregistré. Sans clé, le second clic paie une seconde fois.
//
// Ce hook garde la clé tant que le doute existe :
//
//   • réponse du serveur, même un refus (err.status présent) → l'intention est
//     tranchée, la clé est libérée et le prochain clic est un geste neuf ;
//   • panne réseau, timeout, serveur injoignable (pas de status) → on ne sait
//     pas ce qui s'est passé, donc on garde la clé : le réessai porte la même
//     et le serveur rend la réponse d'origine plutôt que de rejouer l'opération.
//
// Usage :   const idem = useIdempotent();
//           idem((key) => api('/…', { method: 'POST', body, idem: key }))
export function useIdempotent() {
  const held = useRef(null);

  return useCallback(async (call) => {
    const key = (held.current ||= newIdemKey());
    try {
      const out = await call(key);
      held.current = null;
      return out;
    } catch (err) {
      if (err?.status) held.current = null;
      throw err;
    }
  }, []);
}
