// Swift Cargo — l'application de bureau.
//
// Une fenêtre, l'interface dedans, et le serveur EN LIGNE. Il n'y a pas de base
// de données ici : toutes les données vivent sur le hub, et les deux bureaux
// voient la même chose au même instant, sans rien à synchroniser.
//
// Pourquoi un petit serveur local malgré tout. La fenêtre doit charger
// l'interface depuis quelque part. Chargée en `file://`, son origine vaut
// « null » : le navigateur traiterait chaque appel au hub comme une requête
// inter-origines, et il faudrait déclarer cette origine côté serveur, gérer les
// requêtes préalables, et recommencer à chaque changement d'adresse.
//
// On sert donc l'interface sur http://127.0.0.1 et on fait suivre /api vers le
// hub. Pour la page, tout vient de la même origine : aucun CORS, aucun réglage
// à poser sur le serveur en ligne. Ce serveur-là ne fait que ça — servir des
// fichiers et transmettre des requêtes.

const { app, BrowserWindow, dialog, shell, Menu, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } = require('node:fs');
const { join, normalize, extname } = require('node:path');

// Le nom est fixé ICI, et pas laissé au `productName` de l'installeur : c'est
// lui qui donne le dossier de configuration. Le renommer ferait repartir
// l'application sur une configuration vide.
app.setName('swift-cargo-desktop');

const PAYLOAD = app.isPackaged ? join(process.resourcesPath, 'payload') : join(__dirname, 'payload');
const DIST = join(PAYLOAD, 'client', 'dist');

const DATA_DIR = app.getPath('userData');
const CONFIG_FILE = join(DATA_DIR, 'swift-cargo.env');

// Deux fenêtres se disputeraient le même port local. Autant refuser tout de
// suite et ramener celle qui est déjà ouverte.
//
// `app.quit()` ne coupe pas l'exécution : la seconde instance continuait
// jusqu'à `listen()`, tombait sur le port déjà pris et affichait une erreur —
// alors qu'il ne s'était rien passé d'anormal, quelqu'un avait simplement
// double-cliqué deux fois. D'où ce drapeau, relu avant de démarrer quoi que ce
// soit.
const IS_FIRST_INSTANCE = app.requestSingleInstanceLock();
if (!IS_FIRST_INSTANCE) app.quit();

let win = null;
let local = null;

// ── La configuration ─────────────────────────────────────────────────
// L'adresse du hub est écrite dans la charge utile à la construction
// (prepare.mjs). Le fichier de configuration ne sert qu'à la changer sur place
// — déménagement du serveur, essai contre un autre environnement.
function buildDefaults() {
  try {
    return JSON.parse(readFileSync(join(PAYLOAD, 'defaults.json'), 'utf8'));
  } catch {
    return {};
  }
}

function loadConfig() {
  mkdirSync(DATA_DIR, { recursive: true });
  const d = buildDefaults();

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, [
      '# Swift Cargo — configuration de cette installation.',
      '# Refermez l\'application avant de modifier ce fichier.',
      '',
      '# L\'adresse du serveur. C\'est là que vivent TOUTES les données ; cette',
      '# application n\'en garde aucune.',
      `CLOUD_URL=${d.CLOUD_URL || ''}`,
      '',
      '# Le pays de ce poste (code ISO, ex. DZ). Demandé au premier démarrage.',
      'SITE=',
      '',
      '# Port local, utilisé seulement pour afficher l\'interface sur cette',
      '# machine. À ne changer qu\'en cas de conflit avec un autre logiciel.',
      'PORT=47821',
      '',
    ].join('\n'), 'utf8');
  }

  const env = {};
  for (const line of readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
  // Une installation antérieure peut avoir un fichier sans CLOUD_URL, ou vide :
  // la valeur de construction reprend alors la main plutôt que de laisser
  // l'application démarrer sans savoir à qui parler.
  if (!env.CLOUD_URL && d.CLOUD_URL) env.CLOUD_URL = d.CLOUD_URL;
  return env;
}

// ── Le pays de ce poste ───────────────────────────────────────────────
// Un seul installeur pour tous : le pays se choisit au premier démarrage,
// dans une liste, et se range dans le fichier de configuration (code ISO).
const countryName = (code) => {
  try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code.toUpperCase()); }
  catch { return code; }
};
const isCountry = (v) => /^[A-Za-z]{2}$/.test(v || '');

function setConfigValue(key, value) {
  const lines = readFileSync(CONFIG_FILE, 'utf8').split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(CONFIG_FILE, lines.join('\n'), 'utf8');
}

function askCountry() {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 460, height: 360, resizable: false, minimizable: false, maximizable: false,
      title: 'Swift Cargo — premier démarrage', backgroundColor: '#0f111a',
      icon: join(__dirname, 'build', 'icon.png'),
      webPreferences: { preload: join(__dirname, 'setup-preload.js'), contextIsolation: true },
    });
    w.setMenuBarVisibility(false);
    ipcMain.handleOnce('setup:choose', (_e, code) => { resolve(code); w.close(); });
    w.on('closed', () => resolve(null));
    w.loadFile(join(__dirname, 'setup.html'));
  });
}

// ── Le serveur local : fichiers + relais vers le hub ──────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// Ces en-têtes décrivent la connexion qui vient de se terminer, pas le contenu.
// Les recopier ferait mentir la réponse qu'on écrit nous-mêmes — une longueur
// ou un encodage hérités de l'autre connexion, et le navigateur coupe.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-encoding', 'content-length',
]);

async function forwardToHub(req, res, cloudUrl) {
  const chunks = [];
  for await (const c of req) chunks.push(c);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k) && k !== 'host') headers[k] = v;
  }

  try {
    const upstream = await fetch(cloudUrl + req.url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    });

    const out = {};
    upstream.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k)) out[k] = v; });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, out);
    res.end(buf);
  } catch {
    // Le serveur en ligne est injoignable. On répond dans la forme que
    // l'interface sait lire, pour qu'elle affiche « Serveur injoignable »
    // plutôt qu'une erreur brute.
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: { code: 'SERVER_DOWN', message: 'Le serveur est injoignable. Vérifiez la connexion Internet.' },
    }));
  }
}

function serveFile(res, path) {
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    // L'interface est remplacée à chaque mise à jour de l'application : la
    // garder en cache ferait rouvrir l'ancienne après une réinstallation.
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}

async function startLocalServer(cfg) {
  const cloudUrl = (cfg.CLOUD_URL || '').replace(/\/+$/, '');

  local = createServer((req, res) => {
    if (req.url.startsWith('/api/')) return forwardToHub(req, res, cloudUrl);

    // `normalize` puis la vérification du préfixe : sans elles, une adresse
    // contenant « ../ » servirait n'importe quel fichier de la machine.
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = normalize(join(DIST, rel));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
      return serveFile(res, file);
    }
    // React Router utilise de vraies adresses : /bons-passager/12 doit rendre
    // index.html, pas une erreur 404.
    return serveFile(res, join(DIST, 'index.html'));
  });

  // Si le port demandé est pris, on en prend un autre au lieu de refuser de
  // démarrer. Rien d'extérieur ne dépend de ce numéro : la fenêtre est le seul
  // client, et elle apprend le port ici même. Un conflit de port n'est donc pas
  // un problème de l'utilisateur, et n'a pas à lui être montré.
  const listen = (port) => new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    local.once('error', onError);
    local.listen(port, '127.0.0.1', () => {
      local.removeListener('error', onError);
      resolve(local.address().port);
    });
  });

  try {
    return await listen(Number(cfg.PORT) || 47821);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    return listen(0); // 0 = « n'importe lequel de libre »
  }
}

// Render endort les instances inactives : la première requête peut mettre une
// minute à revenir. Réveiller le serveur AVANT d'afficher l'interface évite que
// la toute première action de la journée — la connexion — parte en délai
// dépassé sous les yeux de la personne.
async function wakeHub(cloudUrl, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${cloudUrl}/api/health`);
      if (r.ok) return true;
    } catch { /* pas encore réveillé */ }
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function createWindow(port, site) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0f111a',
    title: `Swift Cargo — ${countryName(site)}`,
    // L'icône de la fenêtre et de la barre des tâches. L'exécutable lui-même
    // n'est pas retouché (signAndEditExecutable: false), donc c'est ici qu'elle
    // se pose.
    icon: join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);

  // Un lien externe s'ouvre dans le navigateur, pas dans la fenêtre de
  // l'application : un clic ne doit pas remplacer le poste de travail par une
  // page web sans moyen de revenir.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Le menu existe pour ses raccourcis (Ctrl+P, Ctrl+R, zoom, F11, F12) ; la
// barre elle-même est cachée — voir createWindow.
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [
        { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: () => win?.webContents.print() },
        { type: 'separator' },
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
  // Une seconde instance ne doit rien démarrer : la première a déjà le port et
  // la fenêtre, et `second-instance` la ramène au premier plan.
  if (!IS_FIRST_INSTANCE) return;

  const cfg = loadConfig();
  const cloudUrl = (cfg.CLOUD_URL || '').replace(/\/+$/, '');

  // Une configuration d'avant portait « algeria » / « china » : on la reprend
  // telle quelle plutôt que de reposer la question.
  const legacy = { algeria: 'DZ', china: 'CN' };
  if (legacy[cfg.SITE]) { cfg.SITE = legacy[cfg.SITE]; setConfigValue('SITE', cfg.SITE); }
  if (!isCountry(cfg.SITE)) {
    const chosen = await askCountry();
    if (!chosen) { app.quit(); return; }
    setConfigValue('SITE', chosen);
    cfg.SITE = chosen;
  }

  if (!cloudUrl) {
    dialog.showErrorBox(
      'Swift Cargo — serveur non configuré',
      'Aucune adresse de serveur n’est renseignée, et cette application ne garde '
      + 'aucune donnée en local : sans serveur, elle ne peut rien afficher.\n\n'
      + `Indiquez CLOUD_URL dans :\n${CONFIG_FILE}`
    );
    app.quit();
    return;
  }

  buildMenu();

  const port = await startLocalServer(cfg);

  if (!(await wakeHub(cloudUrl))) {
    const answer = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Serveur injoignable',
      message: 'Le serveur ne répond pas.',
      detail:
        `Swift Cargo n’a pas réussi à joindre ${cloudUrl}.\n\n`
        + 'Vérifiez la connexion Internet. Vous pouvez ouvrir quand même : '
        + 'l’application réessaiera à chaque action.',
      buttons: ['Ouvrir quand même', 'Quitter'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (answer === 1) { app.quit(); return; }
  }

  createWindow(port, cfg.SITE);
});

app.on('before-quit', () => { try { local?.close(); } catch { /* déjà fermé */ } });
app.on('window-all-closed', () => app.quit());
