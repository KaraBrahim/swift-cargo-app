// Un rapport qu'on ne peut pas sortir de l'écran s'arrête à l'écran.
//
// Pas de bibliothèque : un CSV est du texte, et les trois pièges qui le font
// rater sous Excel français tiennent en trois lignes.

// 1. Le séparateur. Excel configuré en français lit la virgule comme une
//    DÉCIMALE, pas comme un séparateur de colonnes : « 1 234,56 » se casserait
//    en deux cellules. Le point-virgule est ce qu'attend cet Excel-là.
const SEP = ';';

// 2. Le BOM. Sans lui, Excel ouvre le fichier en ANSI et « Réglé » devient
//    « RÃ©glÃ© ». Trois octets qui décident si le fichier est lisible.
//    Écrit par son code plutôt qu'en clair : U+FEFF est invisible, et un
//    caractère invisible finit toujours par disparaître d'un fichier au fil
//    des copies, des éditeurs et des outils.
const BOM = String.fromCharCode(0xFEFF);

// 3. L'échappement. Un point-virgule, un guillemet ou un retour à la ligne dans
//    une note suffisent à décaler toutes les colonnes suivantes.
function cell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// `columns` : [{ key, label, map? }]. `map` sert quand la cellule affichée
// n'est pas la valeur brute — un statut traduit, un montant recomposé.
export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(SEP);
  const body = rows.map((r) =>
    columns.map((c) => cell(c.map ? c.map(r) : r[c.key])).join(SEP)
  );
  return BOM + [head, ...body].join('\r\n');
}

// Le nom porte la période : trois exports dans un dossier de téléchargements
// doivent se distinguer sans qu'on ait à les ouvrir.
export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Révoqué au tour suivant : le faire tout de suite annule le téléchargement
  // sur certains navigateurs avant qu'il ait commencé.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const exportCsv = (name, from, to, columns, rows) =>
  download(`${name}_${from}_${to}.csv`, toCsv(columns, rows));
