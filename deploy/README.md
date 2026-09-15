# Déployer Swift Cargo

Deux pièces.

| Pièce | Où | Base de données | Sert l'interface |
|---|---|---|---|
| **Serveur** | Render (ou tout hôte Docker) | une seule base, via `DATABASE_URL` (Neon) | oui (site web) |
| **Poste** | le PC de chaque bureau | aucune — il parle au serveur | oui (fenêtre Electron) |

Toutes les données vivent sur le serveur. Les postes sont des fenêtres dessus.

---

## 1 · Le serveur

```bash
docker build -f deploy/Dockerfile -t swift-cargo .
docker run -d --name swift-cargo -p 4000:4000 --env-file server.env swift-cargo
```

### Les variables

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | **oui** | `postgres://user:pass@host:5432/swiftcargo`. Sans elle le serveur cherche PostgreSQL embarqué, que l'image n'a pas — et refuse de démarrer en le disant. |
| `SUPERADMIN_PASSWORD` | **oui** | Le serveur refuse de démarrer sans. C'est le SEUL compte créé en production ; les employés sont ensuite créés depuis « Utilisateurs », sous leurs vrais noms, pour que le journal d'audit soit lisible. |
| `SITE` | oui | `cloud` sur le hub. |
| `NODE_ENV` | oui | `production`. Déjà dans l'image. |
| `PORT` | non | 4000 par défaut. |
| `COOKIE_SECURE` | non | `1` dès qu'il y a HTTPS. À `0`, le jeton de session circule en clair. |
| `TRUST_PROXY` | non | `1` derrière un reverse proxy, sinon l'adresse IP du journal d'audit est celle du proxy — et la limite de tentatives de connexion par IP devient contournable. |
| `CORS_ORIGINS` | non | Uniquement si l'interface est hébergée sur une AUTRE origine que l'API. |
| `SEED_ADMIN_PASSWORD` | non | **Laisser vide en production.** Ne sert qu'à créer les comptes de démonstration admin1..admin4. |

### Avant d'ouvrir au public

- **HTTPS**, et `COOKIE_SECURE=1` avec. Le jeton de session et les mots de passe
  passent par là.
- **Sauvegardes de la base.** Le hub est la source de vérité ; les postes n'en
  sont pas une copie complète (chacun ne connaît que ce qu'il a vu passer).
- Les migrations s'appliquent **au démarrage**. Un déploiement suffit à mettre la
  base à jour, et le verrou d'avis de `migrate.js` fait que deux instances qui
  démarrent ensemble ne se marchent pas dessus.

### Avec une base dans un conteneur voisin

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: change-moi
      POSTGRES_DB: swiftcargo
    volumes: [pgdata:/var/lib/postgresql/data]
  hub:
    build: { context: ., dockerfile: deploy/Dockerfile }
    depends_on: [db]
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgres://postgres:change-moi@db:5432/swiftcargo
      SUPERADMIN_PASSWORD: ${SUPERADMIN_PASSWORD}
      SITE: cloud
volumes: { pgdata: {} }
```

Le volume n'est pas décoratif : sans lui, la base disparaît avec le conteneur.

---

## 2 · Les postes (Windows)

```bash
npm --prefix desktop run dist:china
npm --prefix desktop run dist:algeria
```

Deux installeurs, un par bureau — ils ne diffèrent que par leur `SITE`. Voir
[desktop/README.md](../desktop/README.md) pour ce que l'installeur contient, où
vivent les données, et comment le poste est relié au hub.

---

## 3 · L'ordre des opérations, la première fois

1. Le serveur, avec son `SUPERADMIN_PASSWORD`.
2. Ouvrir le site, se connecter en `superadmin`, **changer le mot de passe**,
   créer les comptes des employés.
3. Installer les postes (`desktop/`, un seul installeur) : ils parlent au
   serveur et ne gardent rien en local.
