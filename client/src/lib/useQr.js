// L'image du code, prete a etre imprimee.
//
// qrcode rend une data-URL de facon asynchrone, alors que les constructeurs de
// documents (printDocument.js, printTicket.js) sont synchrones et rendent une
// chaine HTML. On genere donc l'image en amont, une fois, quand la fiche se
// charge — et le document la recoit toute faite. Un document sans image reste
// un document valide : le bloc disparait, la reference suffit.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { encodeScan } from './scanCode.js';

export function qrDataUrl(kind, uuid, size = 220) {
  if (!uuid) return Promise.resolve(null);
  return QRCode.toDataURL(encodeScan(kind, uuid), {
    margin: 0,
    width: size,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  }).catch(() => null);
}

export function useQr(kind, uuid, size = 220) {
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    if (!uuid) { setDataUrl(null); return undefined; }
    let alive = true;
    qrDataUrl(kind, uuid, size).then((url) => { if (alive) setDataUrl(url); });
    return () => { alive = false; };
  }, [kind, uuid, size]);

  return dataUrl;
}
