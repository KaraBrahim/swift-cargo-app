// Une date civile n'est pas un instant.
//
// « Du 1er au 30 septembre » ne désigne rien tant qu'on n'a pas dit de quelle
// horloge il s'agit. Une écriture passée à Guangzhou le 1er septembre à 07h00
// est encore le 31 août à Alger : la même ligne tombe dans deux mois différents
// selon qui regarde. Toutes les colonnes de date sont des TIMESTAMPTZ, donc la
// base sait de quel instant il s'agit — c'est la frontière du JOUR qui manquait.
//
// Choix retenu : CHAQUE BUREAU COMPTE À SON HEURE. La journée du desk de Chine
// commence à minuit à Guangzhou, celle d'Alger à minuit à Alger. C'est ce que
// ressent la personne qui consulte l'écran — au prix, assumé, que les deux
// bureaux impriment des totaux différents pour le même mois. Aucun des deux
// n'a tort ; c'est pourquoi chaque rapport ANNONCE le fuseau qui l'a produit.
// Pour revenir à une horloge commune, il suffit de faire pointer les trois
// entrées de OFFICE_TZ sur la même valeur.
import { config } from '../config.js';
import { errors } from './AppError.js';

const OFFICE_TZ = {
  algeria: 'Africa/Algiers',
  china: 'Asia/Shanghai',
  // Le hub n'a pas de guichet : il compte à l'heure de la maison mère.
  cloud: 'Africa/Algiers',
};

// Étiquette lisible, imprimée sur le rapport à côté de la période.
const TZ_LABEL = {
  'Africa/Algiers': 'heure d’Alger',
  'Asia/Shanghai': 'heure de Chine',
};

export const reportTz = () => OFFICE_TZ[config.site] ?? OFFICE_TZ.cloud;
export const tzLabel = (tz = reportTz()) => TZ_LABEL[tz] ?? tz;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Un jour réel, pas seulement dix chiffres bien rangés : le 2026-02-31 passe la
// regex et n'existe pas.
function assertDay(value, field) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) {
    throw errors.validation([{ field, message: `${field} : date attendue au format AAAA-MM-JJ.` }]);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw errors.validation([{ field, message: `${field} : cette date n’existe pas.` }]);
  }
  return value;
}

// Le premier jour du mois en cours, à l'heure du bureau — la plage par défaut.
export function monthToDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: reportTz(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // en-CA rend déjà AAAA-MM-JJ
  return { from: `${parts.slice(0, 8)}01`, to: parts };
}

// La plage d'un rapport. Rend les deux jours et le fuseau qui les résout ; ce
// sont eux qui partent en paramètres liés vers SQL, jamais interpolés.
//
// Absente, la plage vaut le mois en cours jusqu'à aujourd'hui : c'est ce que
// quelqu'un qui ouvre la page sans rien demander veut voir, et les totaux ne
// couvrent alors que des jours qui ont réellement eu lieu.
export function parseRange({ from, to } = {}) {
  const tz = reportTz();
  if (from == null && to == null) return { ...monthToDate(), tz };
  if (from == null || to == null) {
    throw errors.validation([{ field: 'from', message: 'Indiquez un début ET une fin de période.' }]);
  }
  assertDay(from, 'from');
  assertDay(to, 'to');
  if (to < from) {
    throw errors.validation([{ field: 'to', message: 'La date de fin précède la date de début.' }]);
  }
  return { from, to, tz };
}

// ── Le fragment SQL, écrit une fois ───────────────────────────────────
//
// Semi-ouvert : >= début ET < fin + 1 jour. La borne haute inclusive à
// .999 milliseconde qui traînait dans le module des taux perd les lignes
// enregistrées entre-temps, et l'application avait déjà trois conventions
// différentes. Il n'y en a plus qu'une.
//
// `AT TIME ZONE` fait la conversion dans Postgres : une date civile devient
// l'instant correspondant DANS LE FUSEAU DONNÉ, et l'index sur created_at
// reste utilisable parce que la colonne, elle, n'est pas transformée.
export const RANGE_SQL = (col, iFrom, iTo, iTz) =>
  `${col} >= (($${iFrom})::date)::timestamp AT TIME ZONE $${iTz}
   AND ${col} <  ((($${iTo})::date + 1))::timestamp AT TIME ZONE $${iTz}`;

// Tout ce qui précède la plage — l'à-nouveau d'un relevé.
export const BEFORE_SQL = (col, iFrom, iTz) =>
  `${col} < (($${iFrom})::date)::timestamp AT TIME ZONE $${iTz}`;
