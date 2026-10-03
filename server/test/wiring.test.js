// L'authentification et l'idempotence sont posées UNE fois, dans app.js.
//
// Elles vivaient dans chaque routeur. Tous étant montés sur '/api', elles
// s'exécutaient à chaque traversée — d'où des rustines, puis leur retrait quand
// la garde est devenue unique. Un routeur qui en repose une aujourd'hui ne
// double plus un compteur : il fait échouer la route. L'idempotence, au second
// passage, retrouve la clé que le premier vient d'écrire et répond
// « Opération déjà en cours de traitement » à une requête qui n'a rien commencé
// — c'est exactement ce qui a cassé le versement des salaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MODULES = new URL('../src/modules/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('aucun routeur ne repose requireAuth ou idempotent : app.js le fait pour tous', async () => {
  const offenders = [];
  for (const dir of await readdir(MODULES)) {
    for (const f of (await readdir(join(MODULES, dir))).filter((x) => x.endsWith('.routes.js'))) {
      // auth.routes.js est public par endroits : il applique requireAuth route
      // par route, en connaissance de cause, et n'est pas monté sous la garde.
      if (f === 'auth.routes.js') continue;
      const src = await readFile(join(MODULES, dir, f), 'utf8');
      const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/^import .*$/gm, '');
      for (const m of ['requireAuth', 'idempotent']) {
        if (new RegExp(`\b${m}\b`).test(code)) offenders.push(`${dir}/${f} → ${m}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'ces routeurs reposent une garde déjà posée dans app.js');
});
