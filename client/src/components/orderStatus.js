// Order lifecycle labels/styles (status is derived from the order's bons).
export const ORDER_STATUS = {
  ouverte: { label: 'Ouverte', cls: 'st-cree' },
  en_transit: { label: 'En transit', cls: 'st-transit' },
  arrivee: { label: 'Arrivée', cls: 'st-arrive' },
  cloturee: { label: 'Clôturée', cls: 'st-regle' },
};
export const ORDER_ORDER = ['ouverte', 'en_transit', 'arrivee', 'cloturee'];
