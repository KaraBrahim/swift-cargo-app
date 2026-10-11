# Le système de remises

Statut : **construit** (migration 038, `remises` côté serveur, bloc « Remise » et page `/remises` côté écran).

## Ce que c'est

Une remise est une **décision prise au règlement** : on laisse tomber une partie du dû (un fournisseur paie moins) ou on paie moins qu'on ne devait (un passager, un salarié). Quatre sortes, un motif facultatif, une note libre.

| Sorte | Ce que l'on tape | Effet |
|---|---|---|
| `amount` — Montant | 400 | on laisse tomber 400 ; le versement proposé devient dû − 400 |
| `percent` — Pourcentage | 5 | 5 % du dû, **recalculé par le serveur** |
| `round` — Arrondir | un clic (52 000 / 52 500) | la différence est la remise ; arrondi au-dessus plafonné au pas de la devise |
| `settle` — Solder | le versement | la différence entre le dû et le versé |

Portée : tous les règlements — fiche de la personne, règlement direct depuis Caisses, bon fournisseur (encaisser), bon passager (payer, régler et verser), salaires. Pas les dépôts / retraits / conversions (aucune dette à solder).

## Règles de l'argent (le serveur fait foi)

- La caisse ne bouge que du **versement réel**. La remise s'écrit au grand livre de la personne (`type='remise'`, même `caisse_tx_id` que le paiement) ou dans `employee_remises` pour un salaire.
- `amount` / `percent` : versement + remise ≤ dû, sinon refus. Un reste non couvert reste dû (la dette reste ouverte).
- `round` / `settle` : la dette tombe à zéro ; au-dessus du dû, plafonné au pas d'arrondi (500 DZD par défaut).
- Le motif doit exister et être actif ; sinon refus.
- Annuler le paiement emporte sa remise ; un paiement qui porte une remise ne se corrige pas à la main (on l'annule et on le refait).
- `settle: true` (ancien client) reste accepté : équivaut à `{ kind: 'settle' }`.

## Modèle de données (038)

- `remise_reasons(id, label, active, sort_order)` — la liste du patron. Six motifs au départ ; désactiver plutôt que supprimer (l'historique reste lisible).
- `person_ledger` : `remise_kind`, `remise_percent`, `remise_reason_id`. `employee_remises` : `kind`, `percent`, `reason_id`, `note`.
- Les remises d'avant sont reclassées `settle`.

## API

- `POST /people/:id/payment`, `/bons/:id/collect-fee`, `/bons/:id/pay-passager`, `/bons/:id/settle`, `/employees/:id/pay` acceptent `remise: { kind, value?, reasonId?, note? }`.
- `GET /remises/reasons[?includeInactive]` · `POST` · `PATCH /remises/reasons/:id` (écriture : super-administrateur).
- `GET /remises?from&to[&personId&adminId&reasonId&kind&direction]` — le rapport.

## Le sens d'une remise

- **Accordée** : on a laissé tomber de l'argent qu'on nous devait (fournisseur).
- **Obtenue** : on a payé moins que ce qu'on devait (passager, salarié).
- Net = obtenues − accordées, devise par devise (jamais additionnées entre devises).

## Écrans

- `RemiseBlock` (`components/`) : un seul bloc partout — *Aucune · Montant · % · Arrondir · Solder*, la ligne « Dû − remise (x %) = à verser », les motifs, la note.
- `MoneyConfirm` / `PaymentCheck` : la vérification montre la remise sur sa propre ligne, avec son motif.
- Fiche de la personne et bon : la remise dit sa sorte et son motif (« Remise · 5 % · Geste commercial »).
- **Paramètres → Motifs de remise** et **Remises** (menu Analyse) : période, sens, motif, sorte ; totaux par devise, par motif, par administrateur, par sorte ; détail qui ouvre la pièce ; impression.

## Hors périmètre (décidé)

- Pas de plafond de remise par rôle.
- Pas de remise sur le bon avant règlement, ni de remise permanente par personne, ni de préréglages nommés.
- Pas de remise de 100 % sans versement (le versement reste > 0).
