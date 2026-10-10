-- Swift Cargo — la wilaya d'une personne.
--
-- Un fournisseur ou un passager se situe quelque part : une wilaya d'Algérie, ou
-- un lieu ailleurs (une ville de Chine, par exemple). Texte libre, sans table de
-- référence : la liste des 58 wilayas est proposée à l'écran, mais rien
-- n'oblige à y rester.
ALTER TABLE people ADD COLUMN wilaya TEXT;
