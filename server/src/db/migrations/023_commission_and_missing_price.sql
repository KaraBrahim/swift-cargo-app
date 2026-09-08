-- Swift Cargo — deux prix manquaient au modele, et c'est le metier qui les
-- reclame.
--
-- 1. LA COMMISSION (bon fournisseur). Une ligne de bon fournisseur porte le
--    PRIX DE REVIENT du transport de ce lot — ce qu'il coute, pas ce qu'il
--    rapporte. La marge se decide a la fin, en un seul montant saisi a la main
--    une fois tous les details connus. Elle vit donc sur le bon, pas sur la
--    ligne :  a facturer = Somme(revient x quantite) + commission - remise.
--
--    transport_fee continue de valoir CE QUE DOIT LE FOURNISSEUR, commission
--    comprise : c'est ce qui evite de rejouer le grand livre, les totaux
--    d'ordre, le tableau de bord et les rapports. La colonne ci-dessous ne sert
--    qu'a montrer le detail et a proposer la commission du bon suivant.
--
-- 2. LA VALEUR DU MANQUANT (bon passager). Une ligne de bon passager n'avait
--    qu'un prix, celui paye au passager, et ce meme prix chiffrait ce qu'il
--    n'avait pas livre. Ce sont deux choses differentes : on paie le passager au
--    tarif convenu avec lui, et on lui retient le manquant a la valeur convenue
--    avec le FOURNISSEUR pour cette marchandise — c'est celle-la qu'il faudra
--    rembourser. D'ou une seconde colonne, proposee au prix de la ligne
--    d'origine mais modifiable.
--
-- Aucune ecriture n'est rejouee : les bons deja reconcilies gardent le
-- loss_value calcule a l'epoque. Le nouveau calcul ne vaut que pour la suite.

ALTER TABLE bons ADD COLUMN commission NUMERIC(20,2) NOT NULL DEFAULT 0
  CHECK (commission >= 0);

ALTER TABLE bon_lines ADD COLUMN missing_unit_price NUMERIC(20,2) NOT NULL DEFAULT 0
  CHECK (missing_unit_price >= 0);

-- Reprise de l'existant : la valeur du manquant d'une ligne passager est celle
-- de la ligne fournisseur dont elle tire sa marchandise ; a defaut, son propre
-- prix — ce que le code faisait jusqu'ici.
UPDATE bon_lines l
   SET missing_unit_price = src.unit_price
  FROM bon_lines src
 WHERE src.id = l.source_line_id;

UPDATE bon_lines
   SET missing_unit_price = unit_price
 WHERE source_line_id IS NULL;

-- 3. LA DETTE DE MANQUANT. Quand ce que le passager n'a pas livre vaut plus que
--    son portage, le plafonner a zero efface une vraie creance : il ne doit pas
--    seulement n'etre pas paye, il vous doit la difference. Elle s'inscrit a son
--    compte sous un type a elle, pour que le releve la nomme et que le retour en
--    arriere la retrouve sans deviner.
ALTER TABLE person_ledger DROP CONSTRAINT person_ledger_type_check;
ALTER TABLE person_ledger ADD CONSTRAINT person_ledger_type_check
  CHECK (type IN (
    'transport_fee', 'fee_payment', 'passager_due', 'passager_payment',
    'passager_manquant', 'adjustment',
    'avance', 'remboursement', 'salaire', 'prime', 'autre'
  ));
