import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { ratesRouter } from './modules/rates/rates.routes.js';
import { caisseRouter } from './modules/caisse/caisse.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { peopleRouter } from './modules/people/people.routes.js';
import { stockRouter } from './modules/stock/stock.routes.js';
import { bonsRouter } from './modules/bons/bons.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { adminsRouter } from './modules/admins/admins.routes.js';
import { syncRouter } from './modules/sync/sync.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { printingRouter } from './modules/printing/printing.routes.js';
import { scanRouter } from './modules/scan/scan.routes.js';
import { maintenanceRouter } from './modules/maintenance/maintenance.routes.js';
import { employeesRouter } from './modules/employees/employees.routes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { scrubResponses } from './lib/visibility.js';
import { nudgeSync } from './modules/sync/sync.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src -> swift-cargo-app/client/dist
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

// Serve the built interface from the API server.
//
// In development Vite serves the UI on :5173 and proxies /api here, so this does
// nothing (there is no build). In production there is no Vite: without this the
// server answers the API and serves a blank page.
function serveClient(app) {
  if (!existsSync(join(CLIENT_DIST, 'index.html'))) return false;

  // Vite fingerprints everything under /assets (index-B8Z345ME.js), so those may
  // be cached hard — the name changes whenever the content does. index.html must
  // NOT be cached, or a deploy leaves browsers holding the previous app forever,
  // pointing at asset names that no longer exist.
  app.use('/assets', express.static(join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));

  // React Router uses real URLs, so /bons-passager/1 must return index.html
  // rather than 404 — otherwise reloading a page, or opening a link to one,
  // breaks. /api is excluded so an unknown endpoint still gives a JSON 404
  // instead of quietly returning the HTML page.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(CLIENT_DIST, 'index.html'));
  });
  return true;
}

export function createApp() {
  const app = express();
  // See config.trustProxy: `true` here would let any caller set its own IP via
  // X-Forwarded-For, which the login throttle and the audit trail now rely on.
  app.set('trust proxy', config.trustProxy);

  // `cors({ origin: true, credentials: true })` reflects back WHATEVER origin
  // asks, while allowing credentials — which tells the browser that any website
  // on the internet may make authenticated calls to this API and read the
  // replies. Replaced by an explicit allow-list: with none configured the API
  // answers same-origin requests only, which is the correct answer when the SPA
  // is served by this server or through the Vite proxy.
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : false,
      credentials: true,
    })
  );
  // Le client est loin : une liste de bons en JSON se compresse cinq à dix
  // fois, et c'est du temps d'attente en moins sur chaque page.
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // A normal admin must never see the super-admin's name. Applied to every
  // response centrally rather than per route — see lib/visibility.js.
  app.use(scrubResponses);

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'swift-cargo', time: new Date().toISOString() }));

  // Ce que ce poste vient d'écrire part vers le hub SANS attendre le prochain
  // tour de l'horloge : le temps que la réponse s'affiche, l'évènement est déjà
  // en route. C'est ce qui rend la synchronisation instantanée à l'usage.
  //
  // Après la réponse, jamais avant : la synchronisation ne doit rien ajouter au
  // temps d'attente de la personne au comptoir. Les routes /sync/ sont exclues —
  // appliquer ce que le hub nous envoie n'est pas une écriture à lui renvoyer.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/sync')) return next();
    res.on('finish', () => { if (res.statusCode < 400) nudgeSync(); });
    next();
  });

  app.use('/api/auth', authRouter);

  // AVANT les autres, et l'ordre est le correctif : dix-sept routeurs sont
  // montés sur '/api' et appellent `router.use(requireAuth)`. Or `router.use()`
  // s'exécute pour toute requête qui TRAVERSE le routeur, même sans route
  // correspondante. Monté plus bas, /api/sync/pull était donc refusé par le
  // requireAuth de `rates` avant même d'atteindre son propre `requireNode` : le
  // hub répondait « Authentification requise » à un poste qui présentait
  // pourtant le bon jeton. Entre deux machines, la synchronisation ne pouvait
  // pas démarrer du tout — sur une seule, rien ne le montrait.
  //
  // syncRouter n'a pas de `router.use()` à lui, donc le monter tôt ne change
  // rien pour les autres. Ses deux routes destinées à l'interface (/sync/run,
  // /sync/status) portent `requireAuth` route par route et restent protégées.
  // test/sync-auth.test.js échoue si on le redescend.
  app.use('/api', syncRouter);

  app.use('/api', ratesRouter);
  app.use('/api', caisseRouter);
  app.use('/api', auditRouter);
  app.use('/api', peopleRouter);
  app.use('/api', stockRouter);
  app.use('/api', bonsRouter);
  app.use('/api', ordersRouter);
  app.use('/api', accountsRouter);
  app.use('/api', adminsRouter);
  app.use('/api', transfersRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', searchRouter);
  app.use('/api', reportsRouter);
  app.use('/api', settingsRouter);
  app.use('/api', printingRouter);
  app.use('/api', scanRouter);
  app.use('/api', maintenanceRouter);
  app.use('/api', employeesRouter);

  // After every API route, before the 404 handler.
  serveClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
