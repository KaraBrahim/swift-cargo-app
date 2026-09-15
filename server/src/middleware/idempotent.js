// Rejouer un geste d'argent ne doit pas le faire deux fois.
//
// Le trou qu'il bouche est banal et coûteux : le client abandonne au bout de
// douze secondes (api/client.js), la personne au guichet voit « Le serveur ne
// répond pas assez vite » et reclique — alors que la première requête avait
// abouti. Le passager est payé deux fois. Aucun verrou côté base ne peut
// l'empêcher : les deux appels sont, pour le serveur, deux ordres légitimes.
//
// Le client envoie donc un en-tête `Idempotency-Key` par TENTATIVE d'opération,
// conservé à travers les réessais. La première requête pose la clé et enregistre
// sa réponse ; toute requête ultérieure portant la même clé reçoit cette
// réponse, sans rien exécuter.
//
// La clé est posée dans sa PROPRE transaction, avant le travail : c'est ce qui
// permet à un second appel arrivé pendant que le premier tourne encore de se
// heurter à la clé au lieu de doubler l'opération.
import { createHash } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { errors } from '../lib/AppError.js';
import { logger } from '../lib/logger.js';

const fingerprintOf = (req) =>
  createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex').slice(0, 32);

export function idempotent(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const key = req.get('idempotency-key');
  // Sans clé, on ne change rien : les scripts, les smokes et les anciens
  // clients continuent d'appeler comme avant. C'est le client qui décide de se
  // protéger, et il le fait sur toutes les routes d'argent.
  if (!key) return next();
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    return next(errors.validation([{ field: 'Idempotency-Key', message: 'Clé d’idempotence invalide.' }]));
  }


  const pool = getPool();
  const fingerprint = fingerprintOf(req);
  const path = req.baseUrl + req.path;

  pool.query(
    `INSERT INTO idempotency_keys (key, admin_id, method, path, fingerprint)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key, req.admin?.id ?? null, req.method, path, fingerprint]
  ).then(({ rows }) => {
    if (rows.length) {
      // Première fois : on laisse passer et on retient ce qui sera répondu.
      const send = res.json.bind(res);
      res.json = (body) => {
        // Une opération qui a échoué ne se mémorise pas : le réessai doit
        // pouvoir la retenter pour de bon.
        if (res.statusCode < 400) {
          pool.query('UPDATE idempotency_keys SET status=$2, response=$3 WHERE key=$1',
            [key, res.statusCode, body])
            .catch((e) => logger.error('Idempotency store failed', e.message));
        } else {
          pool.query('DELETE FROM idempotency_keys WHERE key=$1', [key])
            .catch((e) => logger.error('Idempotency release failed', e.message));
        }
        return send(body);
      };
      return next();
    }

    // Déjà vue. Soit l'opération est finie et on rend sa réponse, soit elle est
    // encore en vol et on le dit — dans les deux cas, rien ne s'exécute deux fois.
    return pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key]).then(({ rows: seen }) => {
      const rec = seen[0];
      if (!rec) return next();
      if (rec.fingerprint !== fingerprint) {
        return next(errors.conflict('Cette clé d’idempotence a déjà servi pour une autre opération.'));
      }
      if (rec.response == null) {
        return next(errors.conflict('Opération déjà en cours de traitement. Patientez avant de réessayer.'));
      }
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(rec.status ?? 200).json(rec.response);
    });
  }).catch(next);
}
