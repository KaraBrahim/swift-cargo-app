// « À surveiller » — la bande d'alertes du tableau de bord.
//
// Le reste de la page raconte l'activité : combien de bons, quel chiffre, en
// hausse ou en baisse. Cette bande-ci ne raconte rien, elle DEMANDE : de
// l'argent qu'on n'a pas encaissé, de la marchandise que personne n'est venu
// chercher, un transporteur qu'on n'a pas payé, un autre qui perd des colis.
//
// Deux partis pris d'affichage :
//
//   • Une carte vide reste en place, en gris, avec « Rien à signaler ». La
//     masquer ferait sauter la mise en page d'un jour à l'autre, et on
//     finirait par ne plus savoir si le chiffre est à zéro ou si le bloc a
//     disparu. La couleur ne s'allume que lorsqu'il y a réellement à faire.
//
//   • Chaque carte nomme deux ou trois personnes et rien de plus. Ce n'est pas
//     un tableau à lire, c'est une liste d'appels à passer ; le reste est
//     derrière le lien « Tout voir ».
import { Link } from 'react-router-dom';
import { IconEl } from './icons.jsx';
import { formatMoney } from './ui.jsx';
import { formatQty } from '../lib/format.js';

// L'ancienneté en mots. « 47 j » ne dit rien à personne ; « 1 mois » si.
function age(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'depuis hier';
  if (days < 31) return `depuis ${days} j`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'depuis 1 mois' : `depuis ${months} mois`;
}

function Card({ icon, accent, title, active, headline, unit, note, children, to, linkLabel }) {
  return (
    <div className={`watch ${active ? 'watch-on' : ''}`} style={{ '--accent': accent }}>
      <div className="watch-top">
        <span className="watch-ico"><IconEl name={icon} /></span>
        <span className="watch-title">{title}</span>
      </div>

      {active ? (
        <>
          <div className="watch-val">
            {headline}
            {unit && <span className="watch-unit">{unit}</span>}
          </div>
          {note && <div className="watch-note">{note}</div>}
          <ul className="watch-list">{children}</ul>
          <Link to={to} className="watch-link">
            {linkLabel} <IconEl name="chevronRight" />
          </Link>
        </>
      ) : (
        <div className="watch-empty">
          <IconEl name="check" />
          Rien à signaler
        </div>
      )}
    </div>
  );
}

const Row = ({ to, name, value, tone }) => (
  <li>
    <Link to={to} className="watch-row">
      <span className="watch-name">{name}</span>
      <span className={`watch-amt ${tone || ''}`}>{value}</span>
    </Link>
  </li>
);

export function DashWatch({ receivables, carriersToSettle, goodsWaiting, lossesByCarrier }) {
  const rec = receivables ?? { debiteurs: [], crediteurs: [] };
  const carriers = carriersToSettle ?? { lignes: [] };
  const goods = goodsWaiting ?? { lignes: [] };
  const losses = lossesByCarrier ?? { lignes: [] };

  return (
    <div className="panel watch-panel">
      <div className="panel-head">
        <h2 className="panel-title">À surveiller</h2>
        <span className="muted watch-sub">Ce qui attend une action</span>
      </div>

      <div className="watch-grid">
        {/* ── Argent dû ─────────────────────────────────────────────
            Le montant à recevoir est le titre ; ce qu'on doit tient sur une
            ligne en dessous. Les deux comptent, mais un seul se poursuit. */}
        <Card
          icon="coins" accent="var(--c-caisse)" title="À recevoir"
          active={rec.nb_debiteurs > 0 || rec.nb_crediteurs > 0}
          headline={formatMoney(rec.a_recevoir)} unit={rec.currency}
          note={
            Number(rec.a_payer) > 0
              ? `${rec.nb_debiteurs} débiteur${rec.nb_debiteurs > 1 ? 's' : ''} · à payer ${formatMoney(rec.a_payer)} ${rec.currency}`
              : `${rec.nb_debiteurs} débiteur${rec.nb_debiteurs > 1 ? 's' : ''}`
          }
          to="/rapports" linkLabel="Voir le rapport"
        >
          {rec.debiteurs.slice(0, 3).map((p) => (
            <Row key={p.id} to={`/personnes/${p.id}`} name={p.name}
              value={formatMoney(p.montant)} tone="neg" />
          ))}
        </Card>

        {/* ── Marchandise à remettre ────────────────────────────────
            Groupée par personne : ce qui vide ce bloc est un appel. */}
        <Card
          icon="stock" accent="var(--c-stock)" title="Marchandise à remettre"
          active={goods.personnes > 0}
          headline={goods.personnes} unit={goods.personnes > 1 ? 'personnes' : 'personne'}
          note={[
            `${goods.commandes} commande${goods.commandes > 1 ? 's' : ''}`,
            age(goods.plus_ancien),
          ].filter(Boolean).join(' · ')}
          to="/bons-fournisseur" linkLabel="Voir les commandes"
        >
          {goods.lignes.slice(0, 3).map((p) => (
            <Row key={p.id} to={`/personnes/${p.id}`} name={p.name}
              value={age(p.jours) || formatQty(p.quantite)} />
          ))}
        </Card>

        {/* ── Transporteurs à régler ────────────────────────────────
            Triés par ancienneté : le plus vieux est celui qu'on a oublié. */}
        <Card
          icon="passager" accent="var(--c-people)" title="Transporteurs à régler"
          active={carriers.nb > 0}
          headline={carriers.nb} unit={carriers.nb > 1 ? 'bons' : 'bon'}
          note={age(carriers.plus_ancien)}
          to="/bons-passager" linkLabel="Voir les bons"
        >
          {carriers.lignes.slice(0, 3).map((b) => (
            <Row key={b.id} to={`/bons-passager/${b.id}`}
              name={b.passager || b.reference} value={age(b.jours)} />
          ))}
        </Card>

        {/* ── Manquants ─────────────────────────────────────────────
            Le TAUX, pas le montant : il se compare d'un transporteur à
            l'autre, ce qu'une somme ne fait pas — les bons n'ont ni la même
            taille ni la même devise. */}
        <Card
          icon="alert" accent="var(--c-alert)" title={`Manquants · ${losses.months ?? 6} mois`}
          active={losses.lignes.length > 0}
          headline={losses.lignes.length} unit={losses.lignes.length > 1 ? 'transporteurs' : 'transporteur'}
          note="Un manquant est un accident, trois sont une habitude"
          to="/bons-passager" linkLabel="Voir les bons"
        >
          {losses.lignes.slice(0, 3).map((p) => (
            <Row key={p.id} to={`/personnes/${p.id}`} name={p.name}
              value={`${p.incidents}/${p.bons} · ${p.taux} %`} tone="neg" />
          ))}
        </Card>
      </div>
    </div>
  );
}
