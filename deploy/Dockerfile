# Swift Cargo — le HUB (serveur central).
#
# Ce qu'il est : l'API et rien d'autre. La source de vérité de la topologie en
# étoile — les deux postes, Chine et Algérie, poussent leurs évènements ici et
# tirent ceux de l'autre.
#
# Il ne sert PAS l'interface. Celle-ci vit dans les postes de travail, qui la
# servent depuis leur propre machine. Ouvrir l'URL du hub dans un navigateur
# répondra donc « 404 » — c'est normal ; le point de contrôle est /api/health.
# (Pour servir l'interface ici aussi, il suffirait de construire client/dist et
# de le copier dans l'image : app.js le sert dès qu'il le trouve.)
#
# Ce qu'il n'est PAS non plus : un poste de travail. Il n'embarque donc PAS PostgreSQL.
# Le hub parle à une vraie base par DATABASE_URL — celle du fournisseur, ou un
# conteneur postgres à côté. C'est pourquoi les dépendances optionnelles sont
# exclues : `embedded-postgres` traîne un binaire de ~100 Mo dont ce conteneur
# n'a aucun usage.
#
# Construire depuis la RACINE du dépôt :
#     docker build -f deploy/Dockerfile -t swift-cargo-hub .

# ── 1 · Les dépendances de production ────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --omit=optional

# ── 2 · L'image finale ───────────────────────────────────────────────
FROM node:22-alpine
# tini : sans lui, le process Node est PID 1 et ne reçoit pas SIGTERM
# proprement — l'arrêt gracieux (fermeture du pool, du serveur) ne se ferait
# jamais, et un déploiement couperait des requêtes en cours.
RUN apk add --no-cache tini
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps  /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src

# Ne pas tourner en root. L'image node fournit déjà l'utilisateur `node`.
USER node
EXPOSE 4000

# Le serveur applique ses migrations au démarrage (server.js), donc un déploiement
# suffit à mettre la base à jour. Le verrou d'avis dans migrate.js fait que
# plusieurs instances qui démarrent ensemble ne se marchent pas dessus.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/src/server.js"]
