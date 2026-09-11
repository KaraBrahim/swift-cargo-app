# Swift Cargo — le poste de travail (Windows)

Une fenêtre, et derrière elle l'application entière : le serveur, **sa propre
base PostgreSQL** et l'interface. C'est ce qui fait qu'un bureau continue de
travailler quand la connexion tombe — saisir un bon, encaisser, régler, imprimer
ne demandent rien à Internet. La ligne ne sert qu'à la synchronisation avec le
hub, qui tourne en arrière-plan et rattrape son retard toute seule.

## Construire l'installeur

**Un seul**, pour les deux bureaux — `desktop/release/Swift Cargo Desk Setup …exe`.

```bash
npm --prefix desktop install

# Windows (PowerShell)
$env:SWIFT_CLOUD_URL  = 'https://…onrender.com'
$env:SWIFT_NODE_TOKEN = '…'
npm --prefix desktop run dist
```

Ces deux variables sont **pré-remplies dans l'installeur** (`payload/defaults.json`),
pour que le poste installé parle au hub sans configuration manuelle. Elles
viennent de l'environnement de construction et **jamais du dépôt** : le jeton est
un secret partagé, et un secret écrit dans le code est un secret publié au
premier `git push`. Construire sans elles reste permis — le poste travaille
alors seul, et `prepare.mjs` le dit en toutes lettres.

Le bureau (`SITE`) n'est plus fixé à la construction : l'application le **demande
au premier démarrage** et le range dans le fichier de configuration. C'est ce qui
permet un installeur unique. Il reste un vrai réglage, pas une étiquette — il
réserve au poste sa plage d'identifiants et signe ses écritures vers le hub —
d'où une question posée avant que la base ne soit semée, et une seule fois.

Comptez **250–350 Mo** : PostgreSQL est dedans. C'est le prix du fonctionnement
hors ligne, et on le paie une fois.

Pour essayer sans empaqueter : `npm --prefix desktop start`.

## Ce qui est installé, et où

| Quoi | Où |
|---|---|
| Le programme | `%LOCALAPPDATA%\Programs\Swift Cargo …` |
| **Les données** (base, configuration) | `%APPDATA%\swift-cargo-desktop\` |

Les deux sont séparés **volontairement** : le dossier du programme est remplacé à
chaque mise à jour. Une base de données rangée là disparaîtrait avec la première
mise à jour, c'est-à-dire une entreprise à l'arrêt.

## La configuration

Au premier lancement, l'application écrit
`%APPDATA%\swift-cargo-desktop\swift-cargo.env` et affiche le mot de passe tiré
au hasard pour le compte `superadmin` **de ce poste**. Menu *Fichier → Modifier
la configuration* pour y revenir ; **fermez l'application avant de l'éditer**.

```ini
SUPERADMIN_PASSWORD=…      # celui de CE poste
CLOUD_URL=https://…        # le hub. Vide = ce poste travaille seul
NODE_TOKEN=…               # le même que sur le hub et l'autre poste
PORT=47821                 # à ne changer qu'en cas de conflit
EMBEDDED_PG_PORT=55433
```

Sans `CLOUD_URL`, le poste fonctionne parfaitement — il ne parle simplement à
personne. On peut donc installer les postes d'abord et brancher le hub ensuite.

## Ce qui se synchronise, et ce qui ne se synchronise pas

**Se synchronise** : ordres, bons et leurs lignes, mouvements de caisse,
conversions, comptes des personnes, marchandises, charges, transferts, taux,
journal d'audit.

**Ne se synchronise PAS — et c'est voulu :**

- **Les comptes utilisateurs.** Chaque poste a les siens. Créez les employés sur
  chaque machine ; c'est aussi ce qui fait qu'un poste volé ne donne pas accès
  aux autres.
- **Les soldes** (caisses, personnes, stock). Ce ne sont pas des données mais des
  *sommes* : chaque machine les recalcule depuis les écritures qu'elle a reçues.
  C'est précisément ce qui permet à deux bureaux d'écrire chacun de leur côté et
  de retomber sur le même chiffre.

## Le rythme

Instantané quand la ligne est là : ce que le poste écrit part **sans attendre**
le prochain cycle, et ce que l'autre bureau écrit arrive en quelques secondes.

Quand la ligne tombe, le délai double à chaque échec jusqu'à une minute, puis
repart au rythme court dès que ça repasse. Rien n'est perdu entre-temps : les
évènements s'empilent dans la file locale et partent au retour du réseau.
L'indicateur de synchronisation, dans l'application, dit où on en est.

## Avant de livrer aux bureaux

- **Signature.** L'installeur n'est pas signé : Windows SmartScreen affichera un
  avertissement, et il faudra cliquer « Informations complémentaires → Exécuter
  quand même ». Pour l'éviter, il faut un certificat de signature de code.
- **Mises à jour.** Il n'y a pas de mise à jour automatique : une nouvelle
  version se réinstalle par-dessus. Les données restent, elles sont ailleurs.
- **Sauvegarde.** Le hub est la source de vérité — c'est lui qu'on sauvegarde.
  Un poste ne connaît que ce qu'il a vu passer.
