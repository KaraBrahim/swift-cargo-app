// Creates one realistic bon passager in the RUNNING dev database, so there is
// something real to print and to look at.
//
// It talks to the live API rather than the database directly, for two reasons:
// the embedded Postgres is owned by the running server process (a second
// connection from a script fights it for the data directory), and going through
// the API means the bon is built by the same code the UI uses — statuses, stock
// movements and ledger entries all end up consistent.
//
//   node scripts/demo-bon.js              # against http://localhost:4000
//   API=http://autre:4000 node scripts/demo-bon.js
//
// The bon is walked all the way to « Réglé » through a reception that is one
// carton short, so the printed ticket exercises the interesting cases: three
// units of measure, a manquant, and a passager payment net of the loss.
import './testCredentials.js';
import { config } from '../src/config.js';

const base = process.env.API || `http://localhost:${config.port}`;
const user = process.env.ADMIN_USER || 'admin1';
const pass = process.env.ADMIN_PASSWORD || config.seedAdminPassword;

let token = '';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    throw new Error(`${method} ${path} → ${res.status} ${e.message || ''} ${e.details ? JSON.stringify(e.details) : ''}`);
  }
  return json;
}

try {
  // Demonstration data has no business touching real books.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refus : ce script crée des données de démonstration et NODE_ENV vaut « production ».');
  }

  await fetch(`${base}/api/health`).catch(() => {
    throw new Error(`Serveur injoignable sur ${base}. Lancez « npm run dev » d'abord.`);
  });

  token = (await call('POST', '/api/auth/login', { username: user, password: pass })).token;
  console.log(`Connecté en tant que ${user}.`);

  const fournisseurs = (await call('GET', '/api/people?role=fournisseur&search=Guangzhou')).people || [];
  const fournisseur = fournisseurs[0]
    || (await call('POST', '/api/people', {
      isFournisseur: true,
      name: 'Guangzhou Trading Co.', phone: '+86 20 8888 1234', notes: 'Fournisseur de démonstration',
    })).person;

  const passagers = (await call('GET', '/api/people?role=passager&search=Karim')).people || [];
  const passager = passagers[0]
    || (await call('POST', '/api/people', {
      isPassager: true,
      full_name: 'Karim Benali', phone: '+213 550 12 34 56', type: 'regular', notes: 'Passager de démonstration',
    })).person;

  // Three lines, one per unit of measure, so the ticket shows each form.
  const bon = (await call('POST', '/api/bons', {
    fournisseurId: fournisseur.id,
    passagerId: passager.id,
    transportCurrency: 'DZD',
    notes: 'Bon de démonstration — impression',
    lines: [
      { designation: 'Cartons électronique', measure: 'quantite', value: '10', unit: 'carton', unitPrice: '500' },
      { designation: 'Textile en sacs', measure: 'poids', value: '25.5', unitPrice: '120' },
      { designation: 'Pièces détachées', measure: 'cbm', value: '1.2', unitPrice: '3000' },
    ],
  })).bon;
  console.log(`Bon créé : ${bon.reference} (frais ${bon.transport_fee} ${bon.transport_currency})`);

  await call('POST', `/api/bons/${bon.id}/advance`, { note: 'Départ Guangzhou' });   // → en_transit
  await call('POST', `/api/bons/${bon.id}/advance`, { note: 'Arrivée Alger' });      // → arrivé

  // Reception: 9 of the 10 cartons arrived, the rest is complete.
  const [l1, l2, l3] = bon.lines;
  await call('POST', `/api/bons/${bon.id}/reconcile`, {
    lines: [
      { lineId: l1.id, receivedQuantity: '9', responsible: 'Passager' },
      { lineId: l2.id, receivedQuantity: '25.5' },
      { lineId: l3.id, receivedQuantity: '1.2' },
    ],
  });

  const settled = (await call('POST', `/api/bons/${bon.id}/settle`, { note: 'Règlement démonstration' })).bon;

  console.log('');
  console.log(`  Référence         ${settled.reference}`);
  console.log(`  Statut            ${settled.status}`);
  console.log(`  Fournisseur       ${settled.fournisseur_name}`);
  console.log(`  Passager          ${settled.passager_name}`);
  console.log(`  Frais transport   ${settled.transport_fee} ${settled.transport_currency}`);
  console.log(`  Manquants         ${settled.loss_total}`);
  console.log(`  Payé au passager  ${settled.passager_payment}`);
  console.log('');
  console.log(`  À imprimer : http://localhost:5173/bons-passager/${settled.id}`);
} catch (err) {
  console.error('ÉCHEC :', err.message);
  process.exitCode = 1;
}
