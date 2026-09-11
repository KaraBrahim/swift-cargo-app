// Prépare ce que l'installeur embarquera : `desktop/payload/`.
//
// C'est-à-dire l'interface, et rien d'autre.
//
// Il y avait ici tout un serveur : les sources, ses dépendances de production,
// et PostgreSQL embarqué — une centaine de mégaoctets — pour que le poste
// puisse travailler sans Internet. L'application est désormais EN LIGNE : les
// données vivent sur le hub, les deux bureaux voient la même chose au même
// instant, et il n'y a plus ni base locale ni synchronisation à faire.
//
// Ce qui reste est donc l'interface construite, plus l'adresse du serveur.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const payload = join(here, 'payload');

// Une commande fixe, écrite en toutes lettres : aucune entrée extérieure ne s'y
// glisse. execSync plutôt que execFileSync + shell:true, qui déprécie le
// passage d'arguments à un shell (DEP0190) — et npm est un .cmd sous Windows,
// qui exige justement un shell.
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

console.log('— Interface');
run('npm run build', join(root, 'client'));

const dist = join(root, 'client', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  throw new Error('client/dist/index.html est absent : la construction de l’interface a échoué.');
}

console.log('\n— Remise à neuf de payload/');
rmSync(payload, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
cpSync(dist, join(payload, 'client', 'dist'), { recursive: true });

// L'adresse du serveur, écrite DANS la charge utile.
//
// Elle vient de l'environnement de construction. Le jeton de synchronisation a
// disparu avec la synchronisation elle-même : il n'y a plus de nœud à
// authentifier, seulement des personnes qui se connectent.
//
// Pas via `--config.extraMetadata` d'electron-builder : cette option réécrit le
// package.json SOURCE et lui fait perdre ses scripts et ses dépendances. Un
// fichier à nous, dans un dossier de toute façon reconstruit à chaque fois, ne
// peut rien abîmer.
const CLOUD_URL = (process.env.SWIFT_CLOUD_URL || '').replace(/\/+$/, '');
writeFileSync(join(payload, 'defaults.json'), JSON.stringify({ CLOUD_URL }, null, 2) + '\n', 'utf8');

console.log(
  CLOUD_URL
    ? `\npayload/ prêt — serveur ${CLOUD_URL}.`
    : '\npayload/ prêt — MAIS SWIFT_CLOUD_URL est vide : l’application installée '
      + 'ne saura pas à quel serveur parler.\nDéfinissez SWIFT_CLOUD_URL avant de construire.'
);
