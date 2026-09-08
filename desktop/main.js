// Swift Cargo — le poste de travail.
//
// Une fenêtre, et derrière elle l'application entière : le serveur Node, sa base
// PostgreSQL locale, et l'interface. Rien de ce que fait la personne au comptoir
// ne dépend d'Internet — saisir un bon, encaisser, régler et imprimer marchent
// avec le câble débranché. La connexion ne sert qu'à la synchronisation avec le
// hub, qui tourne en arrière-plan et rattrape son retard toute seule.
//
// Le serveur tourne dans un PROCESSUS SÉPARÉ, pas dans celui de la fenêtre :
// s'il meurt, on peut le dire proprement au lieu de faire disparaître
// l'application, et son arrêt (PostgreSQL compris) reste maîtrisable.

const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

// En développement, `npm start` lance depuis le dossier desktop/ ; une fois
// empaquetée, la charge utile vit à côté de l'exécutable.
const PAYLOAD = app.isPackaged ? join(process.resourcesPath, 'payload') : join(__dirname, 'payload');
const SERVER_ENTRY = join(PAYLOAD, 'server', 'src', 'server.js');

// Les données de l'utilisateur, JAMAIS dans le dossier d'installation : celui-ci
// est remplacé à chaque mise à jour, et une base de données effacée par une
// mise à jour est une entreprise à l'arrêt.
const DATA_DIR = app.getPath('userData');
const PG_DIR = join(DATA_DIR, 'pgdata');
const CONFIG_FILE = join(DATA_DIR, 'swift-cargo.env');

// Le bureau auquel ce poste appartient est décidé à la CONSTRUCTION
// (dist:china / dist:algeria) : c'est ce qui distingue les deux installeurs, et
// ce n'est pas un réglage qu'on veut voir changé par erreur sur place.
// Écrit dans la charge utile par prepare.mjs, au moment de la construction.
// C'est ce qui distingue les deux installeurs, et ce n'est volontairement pas
// un réglage modifiable sur place : un poste qui se croirait dans l'autre
// bureau enverrait ses écritures sous la mauvaise identité de site.
function builtSite() {
  try {
    return JSON.parse(readFileSync(join(PAYLOAD, 'site.json'), 'utf8')).site;
  } catch {
    return 'algeria';
  }
}
const BUILT_SITE = builtSite();

// Deux instances se disputeraient le même dossier PostgreSQL. La seconde ne
// démarrerait pas, avec un message parlant de fichier verrou : autant refuser
// tout de suite et ramener la fenêtre déjà ouverte.
if (!app.requestSingleInstanceLock()) app.quit();

let child = null;
let win = null;

// ── La configuration du poste ────────────────────────────────────────
// Un fichier texte à côté des données. Écrit au premier lancement avec un mot
// de passe tiré au hasard — le code ne contient aucun mot de passe par défaut,
// et deux postes installés le même jour ne doivent pas partager le leur.
function loadConfig() {
  mkdirSync(DATA_DIR, { recursive: true });
  let first = false;

  if (!existsSync(CONFIG_FILE)) {
    first = true;
    writeFileSync(CONFIG_FILE, [
      '# Swift Cargo — configuration de ce poste.',
      '# Refermez l\'application avant de modifier ce fichier.',
      '',
      '# Mot de passe du compte « superadmin » de CE poste. Les comptes ne se',
      '# synchronisent pas d\'une machine à l\'autre : chaque poste a les siens.',
      `SUPERADMIN_PASSWORD=${randomBytes(9).toString('base64url')}`,
      '',
      '# Le hub. Laissez CLOUD_URL vide pour travailler seul, sans synchronisation.',
      'CLOUD_URL=',
      '# Le même jeton que sur le hub et sur l\'autre poste. Sans lui, le hub',
      '# refuse toute synchronisation.',
      'NODE_TOKEN=',
      '',
      '# À ne changer qu\'en cas de conflit avec un autre logiciel de la machine.',
      'PORT=47821',
      'EMBEDDED_PG_PORT=55433',
      '',
    ].join('\n'), 'utf8');
  }

  const env = {};
  for (const line of readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
  return { env, first };
}

// ── Le serveur ───────────────────────────────────────────────────────
function startServer(cfg) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SITE: BUILT_SITE,
    // Le poste parle à sa base LOCALE. DATABASE_URL vide = PostgreSQL embarqué,
    // dans le dossier de données de l'utilisateur.
    DATABASE_URL: '',
    USE_EMBEDDED_PG: '1',
    EMBEDDED_PG_DIR: PG_DIR,
    EMBEDDED_PG_PORT: cfg.EMBEDDED_PG_PORT || '55433',
    PORT: cfg.PORT || '47821',
    SUPERADMIN_PASSWORD: cfg.SUPERADMIN_PASSWORD || '',
    // Vide en production : aucun compte de démonstration sur un poste réel.
    SEED_ADMIN_PASSWORD: '',
    CLOUD_URL: cfg.CLOUD_URL || '',
    NODE_TOKEN: cfg.NODE_TOKEN || '',
    // L'interface est servie par ce même serveur, sur http://localhost : c'est
    // la même origine, il n'y a pas de HTTPS à exiger et le jeton ne quitte
    // jamais la machine.
    COOKIE_SECURE: '0',
    // Indispensable : `fork` depuis Electron doit lancer du Node, pas une
    // seconde fenêtre Electron.
    ELECTRON_RUN_AS_NODE: '1',
  };

  child = fork(SERVER_ENTRY, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

  let tail = '';
  const keep = (buf) => {
    tail = (tail + buf.toString()).slice(-4000);
    process.stdout.write(buf);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  child.on('exit', (code) => {
    child = null;
    if (app.isQuitting || code === 0) return;

    // PostgreSQL embarqué remet les droits d'exécution sur ses binaires au
    // démarrage. Dans « C:\Program Files », un utilisateur ordinaire n'a pas le
    // droit d'écrire : chmod échoue et rien ne démarre. L'installeur pose donc
    // l'application dans le dossier de l'utilisateur — mais une installation
    // faite avant cette correction, ou déplacée à la main, tombe encore dessus,
    // et le message brut ne dit pas quoi faire.
    const readOnly = /EPERM|EACCES/.test(tail) && /chmod/.test(tail);
    dialog.showErrorBox(
      'Swift Cargo n’a pas pu démarrer',
      readOnly
        ? 'L’application est installée dans un dossier protégé par Windows '
          + `(${app.getAppPath()}).\n\n`
          + 'PostgreSQL a besoin d’écrire dans son propre dossier pour démarrer.\n\n'
          + 'Désinstallez Swift Cargo, puis réinstallez-le en laissant le dossier '
          + 'proposé par défaut — il s’installe alors dans votre profil utilisateur.\n\n'
          + 'Vos données ne sont pas concernées : elles sont ailleurs, dans\n'
          + DATA_DIR
        : `Le service s’est arrêté (code ${code}).\n\n${tail.slice(-1500)}\n\n`
          + `Configuration : ${CONFIG_FILE}`
    );
    app.quit();
  });
}

// Attendre que le serveur réponde vraiment. Le premier démarrage est long : il
// initialise PostgreSQL, applique les migrations et sème la base. Charger la
// fenêtre trop tôt donnerait un écran d'erreur au lieu d'une application qui
// démarre.
async function waitForServer(port, timeoutMs = 180_000) {
  const url = `http://localhost:${port}/api/health`;
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (!child) throw new Error('Le service s’est arrêté pendant le démarrage.');
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* pas encore prêt */ }
    if (Date.now() > until) throw new Error('Le service n’a pas répondu à temps.');
    await new Promise((r) => setTimeout(r, 400));
  }
}

function createWindow(port) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0f111a',
    title: `Swift Cargo — ${BUILT_SITE === 'china' ? 'Chine' : 'Algérie'}`,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://localhost:${port}/`);

  // Un lien externe s'ouvre dans le navigateur, pas dans la fenêtre de
  // l'application : on ne veut pas qu'un clic remplace le poste de travail par
  // une page web sans moyen de revenir.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Un menu réduit à ce qui sert : recharger, zoomer, imprimer, quitter. Le menu
// par défaut d'Electron parle d'un navigateur, pas de cette application.
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [
        { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: () => win?.webContents.print() },
        { type: 'separator' },
        { label: 'Ouvrir le dossier des données', click: () => shell.openPath(DATA_DIR) },
        { label: 'Modifier la configuration', click: () => shell.openPath(CONFIG_FILE) },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'resetZoom', label: 'Taille normale' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
      ],
    },
  ]));
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  const { env: cfg, first } = loadConfig();
  const port = cfg.PORT || '47821';

  buildMenu();
  startServer(cfg);

  try {
    await waitForServer(port);
  } catch (err) {
    dialog.showErrorBox('Swift Cargo n’a pas pu démarrer', `${err.message}\n\nConfiguration : ${CONFIG_FILE}`);
    app.quit();
    return;
  }

  createWindow(port);

  if (first) {
    // Une seule fois, au premier lancement : le mot de passe tiré au hasard ne
    // se retrouve nulle part ailleurs, et sans le hub le poste travaille seul.
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Premier démarrage',
      message: `Poste ${BUILT_SITE === 'china' ? 'Chine' : 'Algérie'} prêt.`,
      detail:
        `Connectez-vous avec l'identifiant « superadmin » et le mot de passe écrit dans :\n${CONFIG_FILE}\n\n`
        + 'Changez-le depuis l\'application, puis créez les comptes des employés — '
        + 'les comptes ne se synchronisent pas d\'un poste à l\'autre.\n\n'
        + (cfg.CLOUD_URL
          ? `Synchronisation avec ${cfg.CLOUD_URL}.`
          : 'Aucun hub configuré : ce poste travaille seul. Renseignez CLOUD_URL et NODE_TOKEN dans le fichier de configuration pour l\'activer.'),
      buttons: ['Compris'],
    });
  }
});

// L'arrêt doit être PROPRE : PostgreSQL a besoin qu'on le lui demande. Le tuer
// laisse un verrou périmé, et le démarrage suivant s'en plaint. On demande, puis
// on force au bout de dix secondes plutôt que de rester bloqué.
app.on('before-quit', (e) => {
  if (!child || app.isQuitting) return;
  app.isQuitting = true;
  e.preventDefault();
  const done = () => { child = null; app.quit(); };
  const hard = setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} done(); }, 10_000);
  child.once('exit', () => { clearTimeout(hard); done(); });
  child.kill('SIGTERM');
});

app.on('window-all-closed', () => app.quit());
