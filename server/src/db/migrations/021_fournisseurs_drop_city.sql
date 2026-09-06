-- Fournisseurs : la ville ne sert pas.
--
-- Elle n'a jamais été affichée que dans le répertoire et sur la fiche, et elle
-- n'entre dans aucun calcul, aucun bon, aucun document imprimé. Une colonne
-- qu'on remplit sans que rien ne la lise finit par contenir n'importe quoi.
--
-- La suppression efface les valeurs déjà saisies : c'est demandé, et rien
-- ailleurs dans la base n'y fait référence (aucune vue, aucune contrainte).
ALTER TABLE fournisseurs DROP COLUMN IF EXISTS city;
