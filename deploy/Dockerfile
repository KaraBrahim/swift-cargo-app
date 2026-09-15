# Swift Cargo — le serveur.
#
# L'API, et l'interface construite s'il la trouve (client/dist). Une seule base
# PostgreSQL, par DATABASE_URL : le conteneur n'embarque pas de PostgreSQL —
# c'est pourquoi les dépendances optionnelles sont exclues.
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
