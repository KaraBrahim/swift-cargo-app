// Order lifecycle labels/styles.
//
// Le statut est DÉRIVÉ — de cinq portes : la marchandise est-elle toute confiée,
// est-elle arrivée, a-t-elle été remise au fournisseur, les passagers sont-ils
// réglés, les frais encaissés. Rien ici ne se clique : le stepper de la fiche
// est un indicateur, pas une commande.
export const ORDER_STATUS = {
  ouverte: { label: 'Ouverte', cls: 'st-cree' },
  en_transit: { label: 'En transit', cls: 'st-transit' },
  arrivee: { label: 'Arrivée', cls: 'st-arrive' },
  livree: { label: 'Livrée', cls: 'st-livree' },
  cloturee: { label: 'Clôturée', cls: 'st-regle' },
};
export const ORDER_ORDER = ['ouverte', 'en_transit', 'arrivee', 'livree', 'cloturee'];
