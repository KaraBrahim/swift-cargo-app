// Les marchandises d'un bon fournisseur — éditées SANS quitter les bons
// fournisseurs.
//
// En base, la marchandise d'un ordre est portée par une ligne `bons` rattachée
// à lui : la caisse dans laquelle elle attend qu'un passager l'emporte. C'est
// une pièce interne. Elle n'a pas de passager, elle porte la commission du bon
// fournisseur, et elle reçoit un numéro BP-… tiré de la même série que les bons
// passagers.
//
// L'écran d'édition est donc le même que celui d'un bon — mais l'adresse ne
// doit pas l'être. « Modifier » sur un bon fournisseur envoyait jusqu'ici vers
// /bons-passager/…, ce qui allumait « Bons passagers » dans le menu et titrait
// l'onglet d'un numéro BP-… : l'écran décrivait une pièce qui n'existe pas, sur
// un bon fournisseur bien réel. Ici, l'adresse reste /bons-fournisseur/:id/…,
// et c'est l'ordre qui donne son numéro à la page.
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { Spinner, EmptyState } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import BonDetailPage from './BonDetailPage.jsx';

export default function OrderGoodsPage() {
  const { id } = useParams();
  const { data, loading, error } = useApi(`/orders/${id}`);

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  const order = data.order;
  const bonId = order.bons?.[0]?.id;
  if (!bonId) {
    return (
      <EmptyState icon="box" title="Aucune marchandise sur ce bon fournisseur"
        sub="Il n’a pas de ligne à modifier.">
        <Link to={`/bons-fournisseur/${id}`} className="btn">
          <IconEl name="order" />Revenir à {order.reference}
        </Link>
      </EmptyState>
    );
  }
  return <BonDetailPage bonId={bonId} />;
}
