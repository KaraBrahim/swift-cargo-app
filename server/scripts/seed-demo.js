#!/usr/bin/env node
// Remplit une base VIDE avec six mois d'activité crédible.
//
// Deux règles ont décidé de toute la forme de ce fichier.
//
// 1. RIEN N'EST ÉCRIT EN SQL. Chaque bon, chaque encaissement, chaque
//    conversion passe par l'API, exactement comme s'il avait été saisi à
//    l'écran. Un INSERT direct dans `transactions` serait dix fois plus court
//    et produirait une base fausse : les soldes de caisse, les grands livres
//    des personnes, les niveaux de stock et les statuts d'ordre sont des
//    PROJECTIONS que seuls les services savent tenir d'accord. Une démo qui
//    ment sur les soldes ne sert à rien — c'est précisément les soldes qu'on
//    regarde.
//
// 2. LE TEMPS EST REÉCRIT À LA FIN, PAS SIMULÉ PENDANT. On ne peut pas
//    demander à l'API de dater un bon au 14 avril. Alors le script joue toute
//    l'histoire dans l'ordre, en notant avant chaque geste « ceci se passe le
//    14 avril à 9 h 40 » dans une table d'horloge, puis une passe finale
//    remplace chaque horodatage réel par sa date simulée. L'ordre réel et
//    l'ordre simulé étant le même, aucune chaîne de solde ne se retrouve à
//    l'envers — et la passe de reconstruction à la fin le vérifie.
//
// Usage :  node scripts/reset-data.js --yes   (repartir d'une base propre)
//          npm run demo:seed                  (refuse une base déjà peuplée)
//          npm run demo:seed -- --force       (écrit par-dessus quand même)
import 'dotenv/config';
import pg from 'pg';
import { config } from '../src/config.js';

// ── Réglages ─────────────────────────────────────────────────────────
const API = process.env.DEMO_API_URL || `http://localhost:${config.port}/api`;
const DB_URL = config.databaseUrl
  || `postgres://postgres:postgres@localhost:${config.embeddedPgPort}/swiftcargo`;

// L'histoire va de ce lundi-là à aujourd'hui. Six mois : assez pour que
// « mois dernier » et « ce trimestre » aient un sens dans les rapports, assez
// pour que la courbe des taux ait une forme.
const START = process.env.DEMO_START || '2026-03-02';
const END = process.env.DEMO_END || new Date().toISOString().slice(0, 10);

// Africa/Algiers est à UTC+1 toute l'année (pas d'heure d'été). Écrire le
// décalage en clair plutôt que de laisser Postgres interpréter une date nue
// dans le fuseau de la session : c'est ce qui fait qu'un mouvement daté du
// 1er septembre tombe bien en septembre dans les rapports.
const TZ = '+01:00';

const FORCE = process.argv.includes('--force');

// Pas de remise à zéro ici : scripts/reset-data.js le fait déjà, et le fait
// mieux — il montre ce qu'il va effacer avant de toucher à quoi que ce soit,
// et il remet aussi les séquences de références, si bien que le premier bon
// du remplissage suivant repart de BP-…-00001 au lieu de continuer la
// numérotation de la démonstration précédente. Deux effaceurs pour une base,
// c'est celui qu'on n'a pas mis à jour qui finit par être lancé.

// ── Hasard reproductible ─────────────────────────────────────────────
// Deux exécutions doivent donner la même base : sinon une capture d'écran, un
// chiffre cité dans une démo ou un bug reproduit sur « le bon BP-00042 »
// s'évaporent au prochain remplissage.
let _seed = 20260908;
const rnd = () => {
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const money = (a, b, step = 50) => (Math.round((a + rnd() * (b - a)) / step) * step).toFixed(2);
const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── Dates ────────────────────────────────────────────────────────────
const dayMs = 86400000;
const d0 = new Date(`${START}T00:00:00Z`);
const dEnd = new Date(`${END}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + n * dayMs));
const weekday = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = dimanche
const beyondEnd = (isoDate) => new Date(`${isoDate}T00:00:00Z`) > dEnd;

// ── Client HTTP ──────────────────────────────────────────────────────
const failures = [];
let calls = 0;

async function call(method, path, body, token) {
  calls++;
  const res = await fetch(API + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* réponse non-JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200);
    const err = new Error(`${method} ${path} → ${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Un échec ne doit pas arrêter six mois d'histoire : il est noté, compté, et
// affiché à la fin. Un remplissage qui s'interrompt à la moitié laisse une base
// à moitié cohérente, ce qui est pire qu'un rapport d'erreurs.
async function tryCall(label, fn) {
  try {
    return await fn();
  } catch (e) {
    failures.push(`${label} — ${e.message}`);
    return null;
  }
}

const get = (p, t) => call('GET', p, undefined, t);
const post = (p, b, t) => call('POST', p, b, t);
const put = (p, b, t) => call('PUT', p, b, t);

// ── L'horloge ────────────────────────────────────────────────────────
// Avant chaque geste, on note « l'instant réel qui commence maintenant
// correspond à tel instant simulé ». La passe finale relit cette table.
let db;
let clockRows = 0;

// Pendant la simulation des jours, l'instant simule doit AVANCER a chaque
// geste. Les soldes courants se recalculent par `ORDER BY created_at, id` : si
// deux ecritures du meme jour tombaient dans le desordre, un retrait daterait
// d'avant le depot qui le finance et la caisse plongerait sous zero dans un
// historique ou elle ne l'a jamais fait. L'heure demandee reste un plancher ;
// une collision est repoussee d'une minute.
let strictClock = false;
let lastSimMs = 0;

const simText = (ms) => `${new Date(ms + 3600000).toISOString().slice(0, 19).replace('T', ' ')}${TZ}`;

async function at(isoDate, hour = 9, minute = 0) {
  let ms = Date.parse(`${isoDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${TZ}`);
  if (strictClock) {
    if (ms <= lastSimMs) ms = lastSimMs + 60000;
    lastSimMs = ms;
  }
  await db.query('INSERT INTO demo_clock (real_at, sim_at) VALUES (clock_timestamp(), $1)', [simText(ms)]);
  clockRows++;
}

// ── Catalogue ────────────────────────────────────────────────────────
const CATEGORIES = [
  'Textile', 'Électronique', 'Chaussures', 'Cosmétiques', 'Pièces auto',
  'Jouets', 'Maroquinerie', 'Quincaillerie', 'Téléphonie', 'Électroménager',
  'Alimentaire', 'Papeterie',
];

// [nom, catégorie, mesure, unité, prix de vente bas, prix de vente haut]
// Le prix est ce que le FOURNISSEUR paie — le transport de cette marchandise.
const ARTICLES = [
  ['Jeans homme', 'Textile', 'quantite', 'carton', 1400, 1900],
  ['T-shirts coton (lot 50)', 'Textile', 'quantite', 'carton', 1200, 1650],
  ['Vestes hiver', 'Textile', 'quantite', 'carton', 1900, 2400],
  ['Robes femme', 'Textile', 'quantite', 'carton', 1500, 2000],
  ['Tissu ameublement', 'Textile', 'cbm', 'm³', 44000, 62000],
  ['Chaussettes (lot 200)', 'Textile', 'quantite', 'carton', 900, 1300],
  ['Écouteurs Bluetooth', 'Électronique', 'quantite', 'carton', 1700, 2300],
  ['Chargeurs USB-C', 'Électronique', 'quantite', 'carton', 1300, 1750],
  ['Câbles HDMI', 'Électronique', 'quantite', 'carton', 1100, 1500],
  ['Enceintes portables', 'Électronique', 'quantite', 'carton', 1850, 2400],
  ['Power banks', 'Électronique', 'poids', 'kg', 820, 1150],
  ['Montres connectées', 'Électronique', 'quantite', 'carton', 2000, 2450],
  ['Baskets homme', 'Chaussures', 'quantite', 'carton', 1600, 2100],
  ['Sandales femme', 'Chaussures', 'quantite', 'carton', 1150, 1600],
  ['Chaussures enfant', 'Chaussures', 'quantite', 'carton', 1050, 1450],
  ['Bottes cuir', 'Chaussures', 'quantite', 'carton', 1900, 2400],
  ['Crèmes visage', 'Cosmétiques', 'poids', 'kg', 900, 1150],
  ['Parfums', 'Cosmétiques', 'quantite', 'carton', 1800, 2400],
  ['Vernis à ongles', 'Cosmétiques', 'quantite', 'carton', 1000, 1400],
  ['Shampoings', 'Cosmétiques', 'poids', 'kg', 780, 1000],
  ['Plaquettes de frein', 'Pièces auto', 'poids', 'kg', 850, 1100],
  ['Filtres à huile', 'Pièces auto', 'quantite', 'carton', 1250, 1700],
  ["Bougies d'allumage", 'Pièces auto', 'quantite', 'carton', 1150, 1550],
  ['Essuie-glaces', 'Pièces auto', 'quantite', 'carton', 1000, 1350],
  ['Poupées', 'Jouets', 'cbm', 'm³', 42000, 58000],
  ['Voitures télécommandées', 'Jouets', 'quantite', 'carton', 1400, 1900],
  ['Puzzles', 'Jouets', 'quantite', 'carton', 950, 1300],
  ['Peluches', 'Jouets', 'cbm', 'm³', 40000, 55000],
  ['Sacs à main', 'Maroquinerie', 'quantite', 'carton', 1750, 2350],
  ['Portefeuilles cuir', 'Maroquinerie', 'quantite', 'carton', 1300, 1750],
  ['Valises cabine', 'Maroquinerie', 'cbm', 'm³', 46000, 66000],
  ['Ceintures', 'Maroquinerie', 'quantite', 'carton', 1050, 1450],
  ['Visserie assortie', 'Quincaillerie', 'poids', 'kg', 800, 980],
  ['Serrures', 'Quincaillerie', 'quantite', 'carton', 1300, 1750],
  ['Charnières inox', 'Quincaillerie', 'poids', 'kg', 830, 1050],
  ['Coques téléphone', 'Téléphonie', 'quantite', 'carton', 1150, 1600],
  ['Verres trempés', 'Téléphonie', 'quantite', 'carton', 1000, 1400],
  ['Supports voiture', 'Téléphonie', 'quantite', 'carton', 1100, 1500],
  ['Mixeurs', 'Électroménager', 'quantite', 'carton', 1900, 2450],
  ['Bouilloires', 'Électroménager', 'quantite', 'carton', 1600, 2100],
  ['Ventilateurs', 'Électroménager', 'cbm', 'm³', 45000, 64000],
  ['Thé vert', 'Alimentaire', 'poids', 'kg', 790, 1000],
  ['Épices assorties', 'Alimentaire', 'poids', 'kg', 820, 1050],
];

// Trois articles jamais transportés : ils servent aux inventaires manuels, et
// restent ainsi hors du chemin des bons (un inventaire qui écrase un niveau
// pendant qu'un bon compte dessus ferait échouer un départ).
const CATALOGUE_ONLY = [
  ['Cahiers', 'Papeterie'],
  ['Stylos (lot 100)', 'Papeterie'],
  ['Cartables', 'Papeterie'],
];

const FOURNISSEURS = [
  ['Hamza Boudjelal', '0550 41 22 07'],
  ['Sarl Nour Import', '0770 18 63 90'],
  ['Mourad Cherifi', '0661 27 44 15'],
  ['Établissement Beldi', '0555 90 11 38'],
  ['Yiwu Trade Center', '+86 137 5820 4471'],
  ['Amine Ghezali', '0699 33 07 52'],
  ['Sarl El Baraka Distribution', '0560 74 19 03'],
  ['Fatiha Belkhodja', '0771 62 85 40'],
  ['Guangzhou Sun Textile', '+86 138 2644 9012'],
  ['Redouane Aït Amara', '0553 08 76 21'],
  ['Sarl Chettouh Electronics', '0662 45 90 17'],
  ['Nadir Loucif', '0776 20 51 84'],
];

// [nom, téléphone, type]
const PASSAGERS = [
  ['Karim Belhadj', '0551 33 78 04', 'regular'],
  ['Nabil Aissaoui', '0663 91 20 47', 'regular'],
  ['Djamel Ouali', '0772 55 13 68', 'regular'],
  ['Yasmine Belaïd', '0559 74 62 30', 'regular'],
  ['Rachid Bouzid', '0669 02 47 91', 'auto'],
  ['Toufik Hamdani', '0778 36 80 25', 'regular'],
  ['Salim Kaci', '0554 19 73 06', 'auto'],
  ['Farid Meziane', '0666 84 30 59', 'regular'],
  ['Lynda Bensalem', '0775 47 91 12', 'regular'],
  ['Abdelkader Tounsi', '0557 60 25 88', 'regular'],
  ['Walid Rezig', '0668 13 54 70', 'auto'],
  ['Mehdi Slimani', '0779 28 06 43', 'regular'],
  ['Hocine Ferhat', '0552 85 39 17', 'regular'],
  ['Imane Cherfaoui', '0664 71 02 96', 'regular'],
  ['Bilal Merzouk', '0773 40 68 21', 'auto'],
];

// Deux personnes portent les deux casquettes : elles achètent ET convoient.
// C'est le cas que la migration 022 a été écrite pour — un seul solde par
// humain — et il ne se voit que s'il existe dans les données.
const DOUBLES = [
  ['Sofiane Mansouri', '0556 22 84 39', 'regular'],
  ['Zineddine Ould Ali', '0667 55 71 08', 'auto'],
];

const STAFF = [
  ['y.belkacem', 'Yacine Belkacem', 'china', 'y.belkacem@swiftcargo.dz', '+86 131 4408 2266'],
  ['l.zerrouki', 'Lamia Zerrouki', 'china', 'l.zerrouki@swiftcargo.dz', '+86 133 7712 5094'],
  ['n.haddad', 'Nadia Haddad', 'algeria', 'n.haddad@swiftcargo.dz', '0551 07 44 82'],
  ['r.benali', 'Riad Benali', 'algeria', 'r.benali@swiftcargo.dz', '0662 90 31 75'],
];

const CHINA = 1; // caisse Chine
const ALGERIA = 2; // caisse Algérie
const caisseFor = (currency) => (currency === 'DZD' ? ALGERIA : CHINA);

// ── État de la simulation ────────────────────────────────────────────
const tokens = {}; // username → token
let chinaStaff = [];
let algeriaStaff = [];
const people = { fournisseurs: [], passagers: [] };
const catById = new Map();
const items = []; // { id, name, category, measure, unit, low, high }
const catalogueOnly = [];
const lots = []; // lignes fournisseurs encore disponibles
const tasks = new Map(); // date ISO → [{ label, fn }]
const counts = { orders: 0, bonsPassagers: 0, fees: 0, payments: 0, charges: 0, conversions: 0, transfers: 0, reconciles: 0, deliveries: 0 };

const chinaToken = () => tokens[pick(chinaStaff)];
const algeriaToken = () => tokens[pick(algeriaStaff)];

function schedule(isoDate, label, fn) {
  if (beyondEnd(isoDate)) return; // la queue de l'histoire reste en cours, comme dans la vraie vie
  if (!tasks.has(isoDate)) tasks.set(isoDate, []);
  tasks.get(isoDate).push({ label, fn });
}

// Le solde d'une caisse, tel que l'API le donne — pas tel que le script le
// croit. Un « fonds insuffisants » au milieu du remplissage laisserait un
// paiement manquant sans que rien ne le dise.
async function balanceOf(caisseId, currency) {
  const r = await get(`/caisses/${caisseId}`, tokens.superadmin);
  const row = r.caisse.balances.find((b) => b.currency_code === currency);
  return Number(row?.balance ?? 0);
}

// Approvisionner avant de sortir de l'argent. C'est aussi ce qu'on fait
// vraiment : on ne paie pas un passager avec une caisse vide, on la remplit.
async function ensureCash(caisseId, currency, needed, date, hour) {
  const have = await balanceOf(caisseId, currency);
  if (have >= needed) return;
  const gap = needed - have;
  const step = currency === 'DZD' ? 50000 : 5000;
  const top = (Math.ceil(gap / step) + 1) * step;
  await at(date, hour, int(0, 45));
  await tryCall(`approvisionnement caisse ${caisseId}`, () => post(
    `/caisses/${caisseId}/deposit`,
    { currency, amount: top.toFixed(2), note: 'Approvisionnement de caisse' },
    caisseId === CHINA ? chinaToken() : algeriaToken()
  ));
}

// ── Phase 1 · L'équipe ───────────────────────────────────────────────
async function seedStaff() {
  const login = await post('/auth/login', { username: 'superadmin', password: config.superadminPassword });
  tokens.superadmin = login.token;

  // Aucun mot de passe n'est écrit dans ce fichier. Celui des comptes de
  // démonstration vient de l'environnement, ou est tiré au hasard et affiché
  // une fois — le super-admin peut le changer depuis Utilisateurs.
  const pwd = process.env.DEMO_ADMIN_PASSWORD || config.seedAdminPassword
    || `demo-${Math.random().toString(36).slice(2, 10)}`;
  const generated = !process.env.DEMO_ADMIN_PASSWORD && !config.seedAdminPassword;

  const existing = (await get('/admins?includeInactive=1', tokens.superadmin)).admins;
  for (const [username, full_name, office, email, phone] of STAFF) {
    const found = existing.find((a) => a.username === username);
    if (!found) {
      await at(START, 8, 0);
      const r = await tryCall(`création ${username}`, () => post(
        '/admins', { username, password: pwd, full_name, office, email, phone }, tokens.superadmin
      ));
      if (!r) continue;
    }
    const t = await tryCall(`connexion ${username}`, () => post('/auth/login', { username, password: pwd }));
    if (!t) continue;
    tokens[username] = t.token;
    (office === 'china' ? chinaStaff : algeriaStaff).push(username);
  }
  // Si aucun compte employé n'a pu se connecter, le super-admin joue tout —
  // la base reste juste, seuls les noms de l'audit changent.
  if (!chinaStaff.length) chinaStaff = ['superadmin'];
  if (!algeriaStaff.length) algeriaStaff = ['superadmin'];
  return generated ? pwd : null;
}

// ── Phase 2 · Identité, taux, paires ─────────────────────────────────
async function seedSettings() {
  await at(START, 8, 10);
  await tryCall('société', () => put('/settings/societe', {
    nom: 'Swift Cargo',
    adresse: 'Cité 1200 Logements, Bt B4 — Alger',
    telephone: '+213 555 01 02 03',
    pied_de_page: 'Swift Cargo — Chine ⇄ Algérie · merci de votre confiance',
  }, tokens.superadmin));
}

// Une marche aléatoire bornée : le dinar dérive semaine après semaine sans
// jamais partir en vrille. C'est ce qui donne une courbe à la page Taux.
async function seedRates() {
  const rate = { CNY: 30.0, USD: 255.0, EUR: 270.0 };
  const drift = { CNY: 0.28, USD: 2.4, EUR: 2.8 };
  const floor = { CNY: 27.5, USD: 240, EUR: 254 };
  const ceil = { CNY: 33.5, USD: 276, EUR: 292 };

  let d = START;
  while (!beyondEnd(d)) {
    for (const code of ['CNY', 'USD', 'EUR']) {
      if (!chance(0.75)) continue;
      const next = Math.min(ceil[code], Math.max(floor[code], rate[code] + (rnd() - 0.45) * drift[code] * 2));
      rate[code] = next;
      const value = code === 'CNY' ? next.toFixed(4) : next.toFixed(2);
      const day = d;
      schedule(day, `taux ${code}`, async () => {
        await at(day, 8, int(15, 50));
        await tryCall(`taux ${code}`, () => post('/rates', {
          currencyCode: code, dzdPerUnit: value, note: 'Cotation marché parallèle',
        }, algeriaToken()));
      });
    }
    d = addDays(d, 7);
  }

  // Deux paires cotées à la main, à partir de mai : le prix que cette maison
  // pratique, qui n'est pas le quotient de deux cotations en dinars.
  schedule('2026-05-04', 'paire DZD/CNY', async () => {
    await at('2026-05-04', 9, 5);
    await tryCall('paire DZD→CNY', () => post('/pairs', { fromCode: 'DZD', toCode: 'CNY' }, tokens.superadmin));
    await tryCall('taux paire DZD→CNY', () => post('/pairs/DZD/CNY/rate', { unitsPerUnit: '0.03390', note: 'Prix maison' }, tokens.superadmin));
  });
  schedule('2026-05-04', 'paire CNY/ALP', async () => {
    await at('2026-05-04', 9, 12);
    await tryCall('paire CNY→ALP', () => post('/pairs', { fromCode: 'CNY', toCode: 'ALP' }, tokens.superadmin));
    await tryCall('taux paire CNY→ALP', () => post('/pairs/CNY/ALP/rate', { unitsPerUnit: '0.99500', note: 'Frais Alipay' }, tokens.superadmin));
  });
  for (const [day, v] of [['2026-06-15', '0.03415'], ['2026-07-20', '0.03362'], ['2026-08-24', '0.03438']]) {
    schedule(day, 'recotation DZD/CNY', async () => {
      await at(day, 9, int(5, 40));
      await tryCall('recotation DZD→CNY', () => post('/pairs/DZD/CNY/rate', { unitsPerUnit: v, note: 'Révision hebdomadaire' }, tokens.superadmin));
    });
  }
}

// ── Phase 3 · Les personnes ──────────────────────────────────────────
async function seedPeople() {
  // Étalées sur les premières semaines : un carnet d'adresses ne naît pas en
  // un jour, et la page Personnes montre alors de vraies dates d'entrée.
  const spread = (i, n) => addDays(START, Math.floor((i / n) * 45));

  for (const [i, [name, phone]] of FOURNISSEURS.entries()) {
    await at(spread(i, FOURNISSEURS.length), int(9, 16), int(0, 59));
    const r = await tryCall(`fournisseur ${name}`, () => post('/people', {
      name, phone, isFournisseur: true, isPassager: false,
      notes: chance(0.3) ? 'Client régulier — facturation mensuelle.' : undefined,
    }, chinaToken()));
    if (r) people.fournisseurs.push(r.person);
  }

  for (const [i, [name, phone, passagerType]] of PASSAGERS.entries()) {
    await at(spread(i, PASSAGERS.length), int(9, 16), int(0, 59));
    const r = await tryCall(`passager ${name}`, () => post('/people', {
      name, phone, isFournisseur: false, isPassager: true, passagerType,
    }, algeriaToken()));
    if (r) people.passagers.push(r.person);
  }

  for (const [name, phone, passagerType] of DOUBLES) {
    await at(addDays(START, int(20, 60)), int(9, 16), int(0, 59));
    const r = await tryCall(`double rôle ${name}`, () => post('/people', {
      name, phone, isFournisseur: true, isPassager: true, passagerType,
      notes: 'Achète et convoie — un seul compte, un seul solde.',
    }, chinaToken()));
    if (r) { people.fournisseurs.push(r.person); people.passagers.push(r.person); }
  }

  // Une fiche désactivée : le filtre « inclure les inactifs » n'a de sens que
  // s'il y a quelque chose à inclure.
  await at(addDays(START, 70), 11, 20);
  const gone = await tryCall('personne inactive', () => post('/people', {
    name: 'Kamel Sadi', phone: '0558 12 90 44', isFournisseur: true, isPassager: false,
    notes: 'A cessé son activité.',
  }, chinaToken()));
  if (gone) {
    await at(addDays(START, 120), 15, 5);
    await tryCall('désactivation', () => post(`/people/${gone.person.id}/active`, { active: false }, tokens.superadmin));
  }
}

// ── Phase 4 · Le catalogue ───────────────────────────────────────────
async function seedCatalogue() {
  for (const name of CATEGORIES) {
    await at(START, int(8, 10), int(0, 59));
    const r = await tryCall(`catégorie ${name}`, () => post('/stock/categories', { name }, chinaToken()));
    if (r) catById.set(name, r.category.id);
  }
  for (const [name, category, measure, unit, low, high] of ARTICLES) {
    await at(addDays(START, int(0, 10)), int(8, 17), int(0, 59));
    const r = await tryCall(`article ${name}`, () => post('/stock/items', {
      name, category_id: catById.get(category),
    }, chinaToken()));
    if (r) items.push({ id: r.item.id, name, category, measure, unit, low, high });
  }
  for (const [name, category] of CATALOGUE_ONLY) {
    await at(addDays(START, int(0, 10)), int(8, 17), int(0, 59));
    const r = await tryCall(`article ${name}`, () => post('/stock/items', {
      name, category_id: catById.get(category), notes: 'Fourniture de bureau — non transportée.',
    }, chinaToken()));
    if (r) catalogueOnly.push(r.item.id);
  }
}

// ── Phase 5 · Les fonds de départ ────────────────────────────────────
async function seedOpeningCash() {
  const opening = [
    [ALGERIA, 'DZD', '2400000.00', 'Fonds de roulement Algérie'],
    [CHINA, 'CNY', '90000.00', 'Fonds de roulement Chine'],
    [CHINA, 'ALP', '35000.00', 'Solde Alipay initial'],
    [CHINA, 'DZD', '150000.00', 'Avance bureau de Chine'],
    [ALGERIA, 'EUR', '4200.00', 'Réserve en euros'],
  ];
  for (const [caisseId, currency, amount, note] of opening) {
    await at(START, 8, int(20, 50));
    await tryCall(`fonds ${currency}`, () => post(`/caisses/${caisseId}/deposit`,
      { currency, amount, note },
      caisseId === CHINA ? chinaToken() : algeriaToken()));
  }
}

// ── Le cycle d'une expédition ────────────────────────────────────────
// C'est le cœur : un ordre part de Chine, ses lots sont confiés à des
// passagers, la marchandise voyage, on compte ce qui manque, on règle.
const CURRENCIES = [
  ['DZD', 0.72], ['CNY', 0.22], ['ALP', 0.06],
];
function pickCurrency() {
  const r = rnd();
  let acc = 0;
  for (const [code, w] of CURRENCIES) { acc += w; if (r < acc) return code; }
  return 'DZD';
}
// Les prix du catalogue sont en dinars. En yuan, la même marchandise se compte
// au trentième — sinon un carton vaudrait deux mois de loyer.
const scaleFor = (currency) => (currency === 'DZD' ? 1 : 1 / 30);

function makeLine(currency) {
  const it = pick(items);
  const s = scaleFor(currency);
  const unitPrice = (money(it.low, it.high, 10) * s).toFixed(2);
  const qty = it.measure === 'quantite' ? int(8, 60)
    : it.measure === 'poids' ? int(20, 180)
      : (int(8, 45) / 10).toFixed(1);
  return {
    itemId: it.id,
    measure: it.measure,
    unit: it.unit,
    value: String(qty),
    unitPrice,
    _qty: Number(qty),
    _name: it.name,
  };
}

async function createOrder(date) {
  const currency = pickCurrency();
  const fournisseur = pick(people.fournisseurs);
  const lines = Array.from({ length: int(2, 4) }, () => makeLine(currency));
  const commission = currency === 'DZD' ? money(2000, 14000, 500) : money(80, 500, 10);

  await at(date, int(9, 15), int(0, 59));
  const r = await tryCall(`ordre ${fournisseur.name}`, () => post('/orders', {
    fournisseurId: fournisseur.id,
    notes: chance(0.25) ? 'Expédition groupée — plusieurs passagers.' : undefined,
    bons: [{
      transportCurrency: currency,
      commission,
      lines: lines.map(({ itemId, measure, unit, value, unitPrice }) => ({ itemId, measure, unit, value, unitPrice })),
    }],
  }, chinaToken()));
  if (!r) return;
  counts.orders++;

  const order = r.order;
  const bonId = order.bons[0].id;
  const fee = Number(order.totals?.transport_fee ?? order.bons[0].transport_fee);

  // Les lots deviennent disponibles pour les passagers.
  for (const l of order.lines) {
    lots.push({
      lineId: l.line_id,
      orderId: order.id,
      currency,
      measure: l.measure,
      remaining: Number(l.quantity),
      salePrice: Number(l.unit_price),
      name: l.designation,
      readyOn: addDays(date, int(1, 3)),
    });
  }

  // L'encaissement des frais : tout d'un coup, en deux fois, ou pas encore —
  // c'est ce mélange qui donne une page « Dettes » qui ressemble à quelque chose.
  const roll = rnd();
  if (roll < 0.55) {
    const on = addDays(date, int(1, 6));
    schedule(on, 'encaissement', () => collectFee(bonId, currency, on, null));
  } else if (roll < 0.85) {
    const first = (fee * (0.4 + rnd() * 0.25)).toFixed(2);
    const d1 = addDays(date, int(1, 5));
    const d2 = addDays(date, int(12, 30));
    schedule(d1, 'acompte', () => collectFee(bonId, currency, d1, first));
    schedule(d2, 'solde', () => collectFee(bonId, currency, d2, null));
  } // sinon : la dette reste ouverte

  // L'affectation aux passagers, deux à trois jours plus tard.
  const full = chance(0.72);
  const carriers = int(1, 2);
  for (let k = 0; k < carriers; k++) {
    const when = addDays(date, int(2, 5));
    const last = k === carriers - 1;
    schedule(when, 'bon passager', () => createPassagerBon(when, currency, order.id, full && last));
  }
}

async function collectFee(bonId, currency, date, amount) {
  await at(date, int(9, 16), int(0, 59));
  const body = { caisseId: caisseFor(currency), note: 'Encaissement frais de transport' };
  if (amount) body.amount = amount;
  const r = await tryCall('encaissement frais', () => post(`/bons/${bonId}/collect-fee`, body,
    currency === 'DZD' ? algeriaToken() : chinaToken()));
  if (r) counts.fees++;
}

// Un passager remplit sa valise avec ce qui est prêt. Il prend en priorité les
// lots de l'ordre qui vient de partir, et complète avec des restes plus anciens
// de la même devise — mélanger deux devises sur un même bon obligerait à saisir
// la valeur des manquants à la main, ce que l'API refuse à juste titre.
async function createPassagerBon(date, currency, orderId, takeAll) {
  const ready = lots.filter((l) => l.currency === currency && l.remaining > 0.01 && l.readyOn <= date);
  if (!ready.length) return;
  const own = ready.filter((l) => l.orderId === orderId);
  const others = shuffled(ready.filter((l) => l.orderId !== orderId)).slice(0, chance(0.35) ? int(1, 2) : 0);
  const wanted = [...(own.length ? own : shuffled(ready).slice(0, int(1, 3))), ...others];
  // Dédoublonner par lot, et pas seulement par confort d'écriture : quand
  // l'ordre du jour n'a rien de prêt, la valise se remplit de restes anciens —
  // et ces restes-là peuvent déjà figurer dans le complément tiré juste après.
  // Le même lot deux fois sur un bon en fait sortir le double de ce qu'il
  // contient : le serveur ne l'arrête pas (voir NOTE ci-dessous), et le départ
  // échoue plus tard, faute de stock en Chine.
  //
  // NOTE (serveur) : allocatedOf() exclut le bon COURANT en entier pour qu'un
  // bon en cours de modification revoie sa propre marchandise comme
  // disponible. Deux lignes du même bon pointant le même lot lisent donc toutes
  // les deux « rien de pris » et passent. Le garde-fou devrait exclure la
  // LIGNE, pas le bon.
  const seen = new Set();
  const chosen = wanted.filter((l) => !seen.has(l.lineId) && seen.add(l.lineId));
  if (!chosen.length) return;

  const passager = pick(people.passagers);
  const ratio = 0.55 + rnd() * 0.13; // ce que le passager touche, part du prix facturé
  const lines = [];
  for (const lot of chosen) {
    let take = takeAll ? lot.remaining : lot.remaining * (0.45 + rnd() * 0.4);
    // On ne coupe pas un carton en deux : ce qui se compte en pieces se prend
    // en entier, ce qui se pese ou se cube garde ses decimales.
    take = lot.measure === 'quantite' ? Math.max(1, Math.round(take)) : Number(take.toFixed(3));
    if (take < 0.05 || take > lot.remaining + 1e-9) take = lot.measure === 'quantite' ? Math.floor(lot.remaining) : Number(lot.remaining.toFixed(3));
    if (take < 0.05) continue;
    lines.push({
      sourceLineId: lot.lineId,
      measure: lot.measure,
      value: take.toFixed(3),
      unitPrice: (lot.salePrice * ratio).toFixed(2),
      _lot: lot,
      _take: take,
    });
  }
  if (!lines.length) return;

  await at(date, int(9, 16), int(0, 59));
  const r = await tryCall(`bon passager ${passager.name}`, () => post('/bons', {
    passagerId: passager.id,
    transportCurrency: currency,
    notes: chance(0.2) ? 'Bagage accompagné — vol Guangzhou → Alger.' : undefined,
    lines: lines.map(({ sourceLineId, measure, value, unitPrice }) => ({ sourceLineId, measure, value, unitPrice })),
  }, chinaToken()));
  if (!r) return;
  counts.bonsPassagers++;
  for (const l of lines) l._lot.remaining -= l._take;

  const bon = r.bon;
  const depart = addDays(date, int(1, 4));
  schedule(depart, 'départ', async () => {
    await at(depart, int(8, 12), int(0, 59));
    const ok = await tryCall(`départ ${bon.reference}`, () => post(`/bons/${bon.id}/advance`, { note: 'Départ de Chine' }, chinaToken()));
    if (!ok) return;

    const arrivee = addDays(depart, int(4, 11));
    schedule(arrivee, 'arrivée', async () => {
      await at(arrivee, int(9, 15), int(0, 59));
      const arr = await tryCall(`arrivée ${bon.reference}`, () => post(`/bons/${bon.id}/advance`, { note: 'Arrivée à Alger' }, algeriaToken()));
      if (!arr) return;
      schedule(arrivee, 'réconciliation', () => reconcileBon(bon.id, currency, arrivee, passager));
    });
  });
}

async function reconcileBon(bonId, currency, date, passager) {
  const detail = await tryCall('lecture bon', () => get(`/bons/${bonId}`, algeriaToken()));
  if (!detail) return;
  const bon = detail.bon;

  // Trois quarts des bons arrivent complets. Le reste perd un peu — et c'est
  // ce reste qui fait vivre le rapport Manquants et les avoirs fournisseurs.
  const withLoss = chance(0.26);
  const lines = bon.lines.map((l, i) => {
    const qty = Number(l.measure === 'poids' ? l.weight_kg : l.measure === 'cbm' ? l.cbm : l.quantity);
    const missing = withLoss && i === 0 ? Number((qty * (0.03 + rnd() * 0.1)).toFixed(3)) : 0;
    return {
      lineId: l.id,
      missing: missing.toFixed(3),
      responsible: missing > 0 ? pick(['Casse au transport', 'Retenu à la douane', 'Non chargé']) : undefined,
    };
  });

  await at(date, int(15, 17), int(0, 59));
  const r = await tryCall(`réconciliation ${bon.reference}`, () => post(`/bons/${bonId}/reconcile`, { lines }, algeriaToken()));
  if (!r) return;
  counts.reconciles++;

  const settleOn = addDays(date, int(0, 3));
  schedule(settleOn, 'règlement', async () => {
    await at(settleOn, int(9, 16), int(0, 59));
    const s = await tryCall(`règlement ${bon.reference}`, () => post(`/bons/${bonId}/settle`, { note: 'Règlement du bon' }, algeriaToken()));
    if (!s) return;

    // Le fournisseur passe prendre sa marchandise quelques jours plus tard. Un
    // même ordre peut être servi par plusieurs passagers : chaque arrivée
    // déclenche sa propre remise, qui n'emporte que ce qui est au bureau ce
    // jour-là. C'est exactement le cas partiel que l'étape « livrée » existe
    // pour représenter.
    const orderIds = [...new Set((s.bon.lines ?? []).map((l) => l.source_order_id).filter(Boolean))];
    for (const oid of orderIds) {
      const on = addDays(settleOn, int(1, 7));
      schedule(on, 'livraison', () => deliverGoods(oid, on));
    }

    const due = Number(s.bon.passager_payment ?? 0);
    if (due <= 0) return;

    // Le passager n'est pas toujours payé le jour même, et pas toujours en une
    // fois : quelques bons restent dus, ce que la page Dettes doit montrer.
    if (chance(0.12)) return;
    const payOn = addDays(settleOn, int(1, 8));
    schedule(payOn, 'paiement passager', async () => {
      const caisse = caisseFor(currency);
      const part = chance(0.15) ? (due * 0.5).toFixed(2) : null;
      await ensureCash(caisse, currency, Number(part ?? due), payOn, 8);
      await at(payOn, int(9, 16), int(0, 59));
      const body = { caisseId: caisse, note: `Paiement transport — ${passager.name}` };
      if (part) body.amount = part;
      const p = await tryCall(`paiement ${bon.reference}`, () => post(`/bons/${bonId}/pay-passager`, body,
        currency === 'DZD' ? algeriaToken() : chinaToken()));
      if (p) counts.payments++;
      if (part) {
        const rest = addDays(payOn, int(5, 20));
        schedule(rest, 'solde passager', async () => {
          await ensureCash(caisse, currency, due, rest, 8);
          await at(rest, int(9, 16), int(0, 59));
          const q = await tryCall(`solde ${bon.reference}`, () => post(`/bons/${bonId}/pay-passager`,
            { caisseId: caisse, note: 'Solde du transport' },
            currency === 'DZD' ? algeriaToken() : chinaToken()));
          if (q) counts.payments++;
        });
      }
    });
  });
}

// La remise au comptoir d'Alger. Une fois sur cinq le client n'emporte qu'une
// partie de ce qui l'attend — il repassera. Sans ces cas-là, la base ne
// contiendrait que des ordres tout blancs ou tout noirs, et la barre « Livré »
// de la fiche n'aurait jamais rien à montrer.
async function deliverGoods(orderId, date) {
  const r = await tryCall('lecture ordre', () => get(`/orders/${orderId}`, algeriaToken()));
  const avail = (r?.order?.lines ?? []).filter((l) => Number(l.deliverable) > 0);
  if (!avail.length) return;

  const partial = chance(0.2);
  const lines = avail.map((l, i) => {
    if (!partial || i > 0) return { lineId: l.line_id, quantity: l.deliverable };
    const part = Number(l.deliverable) * (0.4 + rnd() * 0.3);
    // Un carton ne se coupe pas en deux ; un poids et un volume, si.
    const q = l.measure === 'quantite' ? Math.max(1, Math.round(part)) : Number(part.toFixed(3));
    return { lineId: l.line_id, quantity: String(q) };
  });

  await at(date, int(9, 16), int(0, 59));
  const d = await tryCall(`livraison ordre ${orderId}`, () => post(
    `/orders/${orderId}/deliver`, { lines }, algeriaToken()
  ));
  if (d) counts.deliveries++;
}

// ── Les frais de la maison ───────────────────────────────────────────
const MONTHLY = [
  ['loyer', 'Loyer bureau Alger', ALGERIA, 'DZD', 45000, 45000],
  ['loyer', 'Loyer bureau Guangzhou', CHINA, 'CNY', 6800, 6800],
  ['internet', 'Internet fibre — Alger', ALGERIA, 'DZD', 4500, 4500],
  ['electricite', 'Électricité — Alger', ALGERIA, 'DZD', 5200, 11800],
  ['eau', 'Eau — Alger', ALGERIA, 'DZD', 1800, 3400],
];
const ONE_OFF = [
  ['fourniture', 'Fournitures de bureau', ALGERIA, 'DZD', 3000, 14000],
  ['entretien', 'Entretien véhicule', ALGERIA, 'DZD', 8000, 32000],
  ['transport', 'Frais de manutention', ALGERIA, 'DZD', 5000, 26000],
  ['taxe', 'Taxe communale', ALGERIA, 'DZD', 12000, 40000],
  ['fourniture', 'Emballage et palettes', CHINA, 'CNY', 400, 2200],
  ['entretien', 'Réparation climatiseur', CHINA, 'CNY', 300, 1600],
];

function scheduleCharges() {
  let d = START;
  while (!beyondEnd(d)) {
    const [y, m] = d.split('-');
    const period = `${y}-${m}`;
    const on = `${y}-${m}-04`;
    if (!beyondEnd(on)) {
      for (const [category, label, caisseId, currency, low, high] of MONTHLY) {
        schedule(on, `charge ${label}`, async () => {
          const amount = money(low, high, currency === 'DZD' ? 100 : 10);
          await ensureCash(caisseId, currency, Number(amount), on, 8);
          await at(on, int(9, 12), int(0, 59));
          const r = await tryCall(`charge ${label}`, () => post('/charges', {
            category, label, amount, currency, caisseId, period, recurring: true,
          }, caisseId === CHINA ? chinaToken() : algeriaToken()));
          if (r) counts.charges++;
        });
      }
    }
    // Une ou deux dépenses ponctuelles par mois — sans période : c'est ce qui
    // les distingue d'une charge mensuelle, et il faut les deux pour le voir.
    for (let k = 0; k < int(1, 2); k++) {
      const day = `${y}-${m}-${String(int(6, 26)).padStart(2, '0')}`;
      if (beyondEnd(day)) continue;
      const [category, label, caisseId, currency, low, high] = pick(ONE_OFF);
      schedule(day, `charge ${label}`, async () => {
        const amount = money(low, high, currency === 'DZD' ? 100 : 10);
        await ensureCash(caisseId, currency, Number(amount), day, 8);
        await at(day, int(9, 16), int(0, 59));
        const r = await tryCall(`charge ${label}`, () => post('/charges', {
          category, label, amount, currency, caisseId, recurring: false,
          note: 'Dépense ponctuelle',
        }, caisseId === CHINA ? chinaToken() : algeriaToken()));
        if (r) counts.charges++;
      });
    }
    // Les salaires : une écriture sur le compte de chaque employé, pas une
    // charge anonyme — c'est ce qui donne un solde à la fiche utilisateur.
    const payday = `${y}-${m}-28`;
    if (!beyondEnd(payday)) {
      schedule(payday, 'salaires', async () => {
        const admins = (await tryCall('liste admins', () => get('/admins', tokens.superadmin)))?.admins ?? [];
        for (const a of admins) {
          if (a.role === 'superadmin' || !a.office) continue;
          const chinaSide = a.office === 'china';
          const currency = chinaSide ? 'CNY' : 'DZD';
          const caisseId = chinaSide ? CHINA : ALGERIA;
          const amount = chinaSide ? money(7000, 9000, 100) : money(55000, 78000, 1000);
          await ensureCash(caisseId, currency, Number(amount), payday, 8);
          await at(payday, int(10, 15), int(0, 59));
          await tryCall(`salaire ${a.username}`, () => post('/person-transactions', {
            personType: 'utilisateur', personId: a.id, direction: 'out',
            amount, currency, type: 'salaire', caisseId,
            note: `Salaire ${period}`,
          }, tokens.superadmin));
        }
      });
    }
    // mois suivant
    const next = new Date(Date.UTC(Number(y), Number(m), 1));
    d = iso(next);
  }
}

// ── Trésorerie : conversions, transferts, avances ────────────────────
function scheduleTreasury() {
  let d = addDays(START, 6);
  let n = 0;
  while (!beyondEnd(d)) {
    const day = d;
    n++;

    // Un versement au bureau de Chine toutes les deux semaines. Le dernier
    // reste « envoyé » : un transfert en vol, que quelqu'un doit confirmer.
    if (n % 2 === 0) {
      const amount = money(300000, 800000, 10000);
      schedule(day, 'transfert bureau', async () => {
        await ensureCash(ALGERIA, 'DZD', Number(amount) + 200000, day, 8);
        await at(day, int(9, 12), int(0, 59));
        const r = await tryCall('transfert', () => post('/office-transfers', {
          fromCaisseId: ALGERIA, toCaisseId: CHINA, currency: 'DZD', amount,
          note: 'Versement au bureau de Chine',
        }, algeriaToken()));
        if (!r) return;
        counts.transfers++;
        const recvOn = addDays(day, int(1, 4));
        if (beyondEnd(recvOn) || chance(0.12)) return; // reste en vol
        schedule(recvOn, 'réception transfert', async () => {
          await at(recvOn, int(9, 14), int(0, 59));
          await tryCall('réception transfert', () => post(`/office-transfers/${r.transfer.id}/receive`,
            { note: 'Reçu au bureau de Chine' }, chinaToken()));
        });
      });
    }

    // La Chine change des dinars en yuan ou en Alipay pour payer sur place.
    if (n % 3 === 0) {
      const to = chance(0.6) ? 'CNY' : 'ALP';
      const amount = money(120000, 380000, 10000);
      schedule(day, `conversion DZD→${to}`, async () => {
        await ensureCash(CHINA, 'DZD', Number(amount), day, 8);
        await at(day, int(10, 15), int(0, 59));
        const r = await tryCall(`conversion DZD→${to}`, () => post(`/caisses/${CHINA}/convert`, {
          fromCurrency: 'DZD', toCurrency: to, amount, note: `Achat de ${to} — marché parallèle`,
        }, chinaToken()));
        if (r) counts.conversions++;
      });
    }

    // Alger met de côté un peu de devise forte.
    if (n % 5 === 0) {
      const to = chance(0.7) ? 'USD' : 'EUR';
      const amount = money(150000, 400000, 10000);
      schedule(day, `conversion DZD→${to}`, async () => {
        await ensureCash(ALGERIA, 'DZD', Number(amount) + 300000, day, 8);
        await at(day, int(10, 16), int(0, 59));
        const r = await tryCall(`conversion DZD→${to}`, () => post(`/caisses/${ALGERIA}/convert`, {
          fromCurrency: 'DZD', toCurrency: to, amount, note: `Réserve en ${to}`,
        }, algeriaToken()));
        if (r) counts.conversions++;
      });
    }

    // Recettes et retraits d'exploitation, pour que le journal de caisse ne
    // soit pas fait uniquement d'écritures automatiques.
    if (n % 2 === 1) {
      schedule(day, 'retrait', async () => {
        const amount = money(20000, 90000, 1000);
        await ensureCash(ALGERIA, 'DZD', Number(amount), day, 8);
        await at(day, int(14, 17), int(0, 59));
        await tryCall('retrait', () => post(`/caisses/${ALGERIA}/withdraw`, {
          currency: 'DZD', amount, note: pick(['Frais de route', 'Espèces coffre', 'Avance chauffeur', 'Dépenses diverses']),
        }, algeriaToken()));
      });
    }

    d = addDays(d, 7);
  }

  // Avances aux passagers avant un départ, remboursements ensuite : des
  // écritures qui n'appartiennent à aucun bon, et qui existent pour de vrai.
  for (let i = 0; i < 18; i++) {
    const day = addDays(START, int(10, Math.max(11, Math.round((dEnd - d0) / dayMs) - 3)));
    schedule(day, 'avance passager', async () => {
      const p = pick(people.passagers);
      const out = chance(0.7);
      const amount = money(15000, 60000, 1000);
      if (out) await ensureCash(ALGERIA, 'DZD', Number(amount), day, 8);
      await at(day, int(9, 17), int(0, 59));
      await tryCall('avance', () => post('/person-transactions', {
        personType: 'personne', personId: p.id, direction: out ? 'out' : 'in',
        amount, currency: 'DZD', type: out ? 'avance' : 'remboursement',
        caisseId: ALGERIA,
        note: out ? 'Avance avant voyage' : 'Remboursement d’avance',
      }, algeriaToken()));
    });
  }

  // Des fournisseurs qui viennent solder leur compte au comptoir.
  for (let i = 0; i < 14; i++) {
    const day = addDays(START, int(40, Math.max(41, Math.round((dEnd - d0) / dayMs) - 2)));
    schedule(day, 'règlement compte', async () => {
      const f = pick(people.fournisseurs);
      const acct = await tryCall('compte', () => get(`/people/${f.id}/account`, algeriaToken()));
      const dzd = acct?.account?.balances?.find?.((b) => b.currency_code === 'DZD');
      const owed = Number(dzd?.balance ?? 0);
      if (owed >= -1000) return; // rien à solder
      const amount = Math.min(-owed, Number(money(20000, 150000, 1000))).toFixed(2);
      await at(day, int(9, 17), int(0, 59));
      await tryCall('règlement', () => post(`/people/${f.id}/payment`, {
        caisseId: ALGERIA, amount, currency: 'DZD', direction: 'in',
        note: 'Règlement partiel au comptoir',
      }, algeriaToken()));
    });
  }

  // Deux inventaires manuels, sur des articles que rien ne transporte.
  for (const [k, office] of [[0, 'algeria'], [1, 'china']]) {
    const day = addDays(START, 90 + k * 40);
    schedule(day, 'inventaire', async () => {
      for (const id of catalogueOnly) {
        await at(day, int(9, 12), int(0, 59));
        await tryCall('inventaire', () => post(`/stock/items/${id}/level`, {
          office, quantity: String(int(20, 400)), note: 'Inventaire physique',
        }, office === 'china' ? chinaToken() : algeriaToken()));
      }
    });
  }
}

// ── La boucle des jours ──────────────────────────────────────────────
function scheduleShipments() {
  let d = START;
  while (!beyondEnd(d)) {
    const w = weekday(d);
    // On travaille du dimanche au jeudi côté Algérie, et la Chine tourne du
    // lundi au samedi : les nouveaux ordres tombent en semaine, pas le vendredi.
    if (w !== 5) {
      const n = w === 1 || w === 3 ? int(1, 2) : chance(0.45) ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const day = d;
        schedule(day, 'ordre', () => createOrder(day));
      }
    }
    d = addDays(d, 1);
  }
}

async function runDays() {
  strictClock = true;
  lastSimMs = Date.parse(`${START}T00:00:00${TZ}`);
  let d = START;
  let done = 0;
  while (!beyondEnd(d)) {
    const list = tasks.get(d);
    if (list) {
      // La liste grandit pendant qu'on la parcourt (une tâche en programme
      // d'autres le même jour) : un index, pas un for…of figé.
      for (let i = 0; i < list.length; i++) {
        await list[i].fn();
        done++;
        if (done % 100 === 0) process.stdout.write(`  … ${done} évènements joués (${d})\n`);
      }
    }
    d = addDays(d, 1);
  }
  return done;
}

// ── Phase finale · réécrire le temps ─────────────────────────────────
const SKIP_TABLES = new Set([
  'sessions', 'login_attempts', 'idempotency_keys', 'sync_cursor',
  'notification_cursor', 'app_settings', 'demo_clock', 'sync_outbox',
]);

async function rewriteTime(startedAt) {
  const c = await db.connect();
  try {
    // Réécrire une date n'est pas un évènement métier : les triggers CDC se
    // taisent, sinon la boîte d'envoi de synchronisation doublerait de taille
    // pour dire deux fois la même chose.
    await c.query("SELECT set_config('app.sync_applying', 'on', false)");
    const { rows: cols } = await c.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'timestamp with time zone'
          AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        ORDER BY table_name, column_name`
    );
    let touched = 0;
    for (const { table_name: t, column_name: col } of cols) {
      if (SKIP_TABLES.has(t)) continue;
      const r = await c.query(
        `UPDATE ${t} SET ${col} = (
           SELECT k.sim_at FROM demo_clock k WHERE k.real_at <= ${t}.${col}
            ORDER BY k.real_at DESC LIMIT 1)
         WHERE ${col} >= $1
           AND EXISTS (SELECT 1 FROM demo_clock k WHERE k.real_at <= ${t}.${col})`,
        [startedAt]
      );
      touched += r.rowCount;
    }
    return touched;
  } finally {
    c.release();
  }
}

// Les soldes courants (`balance_after`) sont des totaux courants ordonnés par
// date. Les dates viennent de changer, alors on les recalcule — et comme
// l'ordre simulé est l'ordre réel, ce recalcul doit être un non-évènement.
// S'il ne l'est pas, la vérification ci-dessous le dira.
async function rebuildChains() {
  const c = await db.connect();
  try {
    await c.query("SELECT set_config('app.sync_applying', 'on', false)");
    await c.query(`
      WITH ordered AS (
        SELECT id, SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                 OVER (PARTITION BY caisse_id, currency_code
                       ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
          FROM transactions)
      UPDATE transactions t SET balance_after = o.running FROM ordered o WHERE t.id = o.id`);
    await c.query(`
      WITH ordered AS (
        SELECT id, SUM(amount)
                 OVER (PARTITION BY person_type, person_id, currency_code
                       ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running
          FROM person_ledger)
      UPDATE person_ledger p SET balance_after = o.running FROM ordered o WHERE p.id = o.id`);
  } finally {
    c.release();
  }
}

async function verify() {
  const out = [];
  const q = async (sql) => (await db.query(sql)).rows;

  const bad = await q(`
    SELECT c.caisse_id, c.currency_code, c.balance,
           COALESCE(s.total, 0) AS ledger
      FROM caisse_balances c
      LEFT JOIN (SELECT caisse_id, currency_code,
                        SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) AS total
                   FROM transactions GROUP BY 1,2) s
        ON s.caisse_id = c.caisse_id AND s.currency_code = c.currency_code
     WHERE c.balance <> COALESCE(s.total, 0)`);
  out.push(bad.length
    ? `✗ ${bad.length} solde(s) de caisse ne correspondent pas au journal`
    : '✓ chaque solde de caisse = la somme de son journal');

  const badP = await q(`
    SELECT b.person_type, b.person_id, b.currency_code
      FROM person_balances b
      LEFT JOIN (SELECT person_type, person_id, currency_code, SUM(amount) AS total
                   FROM person_ledger GROUP BY 1,2,3) s
        ON s.person_type=b.person_type AND s.person_id=b.person_id AND s.currency_code=b.currency_code
     WHERE b.balance <> COALESCE(s.total, 0)`);
  out.push(badP.length
    ? `✗ ${badP.length} solde(s) de personne ne correspondent pas au grand livre`
    : '✓ chaque solde de personne = la somme de son grand livre');

  const neg = await q(`
    SELECT caisse_id, currency_code, MIN(running) AS low FROM (
      SELECT caisse_id, currency_code,
             SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
               OVER (PARTITION BY caisse_id, currency_code ORDER BY created_at, id
                     ROWS UNBOUNDED PRECEDING) AS running
        FROM transactions) x
     GROUP BY 1,2 HAVING MIN(running) < 0`);
  out.push(neg.length
    ? `✗ ${neg.length} caisse(s) passent sous zéro dans leur historique : ${neg.map((r) => `${r.caisse_id}/${r.currency_code} ${r.low}`).join(', ')}`
    : '✓ aucune caisse ne passe sous zéro, à aucun moment de son historique');

  // La date est lue EN TEXTE, dans le fuseau des bureaux. Ramenée en objet
  // Date puis reformatée en UTC, une soirée d'Alger deviendrait la veille — et
  // le contrôle censé prouver la bonne période en afficherait une fausse.
  const span = (await q(
    `SELECT to_char(MIN(created_at) AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD') a,
            to_char(MAX(created_at) AT TIME ZONE 'Africa/Algiers', 'YYYY-MM-DD') b
       FROM transactions`
  ))[0];
  out.push(span?.a ? `✓ mouvements du ${span.a} au ${span.b} (heure d'Alger)` : '— aucun mouvement');

  const future = await q(`SELECT count(*)::int n FROM transactions WHERE created_at > now()`);
  out.push(future[0].n ? `✗ ${future[0].n} mouvement(s) restés dans le futur` : '✓ aucun horodatage laissé à la date du remplissage');

  return out;
}

async function tally() {
  const tables = ['people', 'orders', 'bons', 'bon_lines', 'transactions', 'person_ledger',
    'conversions', 'office_transfers', 'charges', 'stock_items', 'stock_movements',
    'exchange_rates', 'pair_rates', 'audit_log'];
  const rows = [];
  for (const t of tables) {
    const { rows: r } = await db.query(`SELECT count(*)::int n FROM ${t}`);
    rows.push([t, r[0].n]);
  }
  return rows;
}

// ── Entrée ───────────────────────────────────────────────────────────
async function main() {
  db = new pg.Pool({ connectionString: DB_URL, max: 4, client_encoding: 'UTF8' });

  const { rows: pre } = await db.query('SELECT count(*)::int n FROM people');
  if (pre[0].n > 0 && !FORCE) {
    console.error(
      `Cette base contient déjà ${pre[0].n} personne(s). Le remplissage ajouterait\n`
      + 'une seconde histoire par-dessus la première.\n\n'
      + '  Pour repartir d’une base propre :  node scripts/reset-data.js --yes\n'
      + '  Pour empiler quand même         :  npm run demo:seed -- --force'
    );
    await db.end();
    process.exit(1);
  }

  await db.query('DROP TABLE IF EXISTS demo_clock');
  await db.query('CREATE TABLE demo_clock (real_at TIMESTAMPTZ PRIMARY KEY, sim_at TIMESTAMPTZ NOT NULL)');
  const startedAt = (await db.query('SELECT clock_timestamp() t')).rows[0].t;

  console.log(`Swift Cargo — remplissage de démonstration`);
  console.log(`  API   ${API}`);
  console.log(`  base  ${DB_URL.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`  du ${START} au ${END}\n`);

  const generatedPwd = await seedStaff();
  await seedSettings();
  await seedPeople();
  await seedCatalogue();
  await seedOpeningCash();

  await seedRates();
  scheduleShipments();
  scheduleCharges();
  scheduleTreasury();

  console.log('Déroulement de six mois d’activité…');
  const done = await runDays();
  console.log(`  ${done} évènements, ${calls} appels API.\n`);

  console.log('Réécriture du temps…');
  const touched = await rewriteTime(startedAt);
  console.log(`  ${touched} horodatages replacés sur ${clockRows} points d’horloge.`);
  await rebuildChains();
  await db.query('DROP TABLE demo_clock');

  console.log('\nContrôles :');
  for (const line of await verify()) console.log(`  ${line}`);

  console.log('\nContenu :');
  for (const [t, n] of await tally()) console.log(`  ${t.padEnd(18)} ${String(n).padStart(6)}`);

  // Les gestes, pas les lignes : une livraison n'a pas de table à elle — son
  // trace est dans stock_movements — et sans ce compteur on ne saurait pas si
  // l'étape « livrée » a seulement été jouée.
  console.log('\nGestes joués :');
  for (const [k, n] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${String(n).padStart(6)}`);

  if (failures.length) {
    console.log(`\n${failures.length} appel(s) refusés (l’histoire a continué sans eux) :`);
    const seen = new Map();
    for (const f of failures) {
      const key = f.replace(/\d+/g, '#');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [k, n] of [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ×${String(n).padStart(3)}  ${k.slice(0, 150)}`);
    }
  }

  if (generatedPwd) {
    console.log(`\nComptes employés créés avec le mot de passe : ${generatedPwd}`);
    console.log('  (affiché une seule fois — changez-le depuis Utilisateurs.)');
  }

  await db.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await db?.end(); } catch { /* déjà fermée */ }
  process.exit(1);
});
