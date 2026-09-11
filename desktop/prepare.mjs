// Prépare ce que l'installeur embarquera : `desktop/payload/`.
//
// Pourquoi une copie plutôt qu'un pointeur vers ../server : l'arbre de
// développement contient les dépendances de DÉVELOPPEMENT (electron-builder,
// les outils de test…) et des dossiers de bases de données locales. Les
// embarquer ferait un installeur bien plus lourd, et livrerait du code de test
// à un poste de production. On installe donc les dépendances de production dans
// un dossier neuf, dont on maîtrise le contenu.
//
// `embedded-postgres` en fait partie : c'est ~100 Mo de vrai PostgreSQL, et
// c'est exactement ce qui permet au poste de travailler sans Internet.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const payload = join(here, 'payload');

// Une commande fixe, ecrite en toutes lettres : aucune entree exterieure ne
// s'y glisse. execSync plutot que execFileSync + shell:true, qui deprecie le
// passage d'arguments a un shell (DEP0190) — et npm est un .cmd sous Windows,
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
mkdirSync(join(payload, 'server'), { recursive: true });

console.log('\n— Serveur (sources + dépendances de production)');
for (const f of ['package.json', 'package-lock.json']) {
  cpSync(join(root, 'server', f), join(payload, 'server', f));
}
cpSync(join(root, 'server', 'src'), join(payload, 'server', 'src'), { recursive: true });
// --omit=dev seulement : les dépendances OPTIONNELLES doivent rester, c'est là
// que vit PostgreSQL embarqué. C'est l'inverse du hub, qui les exclut.
run('npm ci --omit=dev', join(payload, 'server'));

console.log('\n— Interface construite');
cpSync(dist, join(payload, 'client', 'dist'), { recursive: true });

// Ce que le poste trouvera déjà rempli à l'installation : l'adresse du hub et
// le jeton de synchronisation.
//
// Il y avait ici un `site.json` — le bureau, décidé à la construction, qui
// imposait deux installeurs. Le bureau se demande maintenant au premier
// démarrage (main.js) : un seul installeur suffit pour les deux postes.
//
// Le jeton vient de l'ENVIRONNEMENT de construction, jamais du dépôt : c'est un
// secret partagé, et un secret écrit dans le code est un secret publié au
// premier `git push`. Construire sans lui reste permis — le poste démarre alors
// seul, et le message ci-dessous dit exactement ce qu'il manque.
//
// Pas via `--config.extraMetadata` d'electron-builder : cette option réécrit le
// package.json SOURCE, et lui fait perdre ses scripts et ses dépendances. Un
// fichier à nous, dans un dossier de toute façon reconstruit à chaque fois, ne
// peut rien abîmer.
const defaults = {
  CLOUD_URL: (process.env.SWIFT_CLOUD_URL || '').replace(/\/+$/, ''),
  NODE_TOKEN: process.env.SWIFT_NODE_TOKEN || '',
};
writeFileSync(join(payload, 'defaults.json'), JSON.stringify(defaults, null, 2) + '\n', 'utf8');

const missing = Object.entries(defaults).filter(([, v]) => !v).map(([k]) => k);
console.log(
  missing.length
    ? `\npayload/ prêt — MAIS ${missing.join(' et ')} manque(nt) : les postes installés `
      + 'travailleront seuls.\nDéfinissez SWIFT_CLOUD_URL et SWIFT_NODE_TOKEN avant de construire.'
    : `\npayload/ prêt — hub ${defaults.CLOUD_URL}, jeton pré-rempli.`
);
