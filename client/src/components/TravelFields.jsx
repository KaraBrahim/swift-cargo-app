// Le voyage d'un bon passager : quand il part, quand il a promis d'arriver, où il
// atterrit, avec quelle compagnie.
//
// La date PROMISE est la plus importante : c'est sur elle que les gens
// organisent leur venue au bureau. Les aéroports et les compagnies se proposent
// à partir de ce qui a déjà été saisi (plus fréquent d'abord) — mais le champ
// reste libre : un nouvel aéroport, une nouvelle compagnie, se tapent.
import { useId } from 'react';
import { useApi } from '../api/useApi.js';
import { WilayaField } from './WilayaField.jsx';
import { formatDateFr } from '../lib/format.js';

export const emptyTravel = () => ({
  departurePlannedOn: '', arrivalPromisedOn: '', airport: '', airportWilaya: '', airline: '',
});

// Un bon de l'API, ouvert dans le formulaire.
export const travelOf = (bon) => ({
  departurePlannedOn: bon.departure_planned_on || '',
  arrivalPromisedOn: bon.arrival_promised_on || '',
  airport: bon.airport || '',
  airportWilaya: bon.airport_wilaya || '',
  airline: bon.airline || '',
  departureActualOn: bon.departure_actual_on || '',
  arrivalActualOn: bon.arrival_actual_on || '',
});

// La date d'un champ <input type="date"> : AAAA-MM-JJ, tel quel.
function DayField({ label, value, onChange, min, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" value={value || ''} min={min || undefined} onChange={(e) => onChange(e.target.value)} />
      {hint && <em className="field-hint">{hint}</em>}
    </label>
  );
}

// `showActual` : ajoute les dates RÉELLES — pour corriger un vol après coup.
export function TravelFields({ value, onChange, showActual = false }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const sugg = useApi('/bons/travel-suggestions');
  const airports = sugg.data?.airports ?? [];
  const airlines = sugg.data?.airlines ?? [];
  const airportList = useId();
  const airlineList = useId();

  // Un aéroport connu ramène sa wilaya habituelle — sans écraser une saisie.
  const pickAirport = (name) => {
    const known = airports.find((a) => a.value.toLowerCase() === name.trim().toLowerCase());
    set({ airport: name, ...(known?.wilaya && !value.airportWilaya ? { airportWilaya: known.wilaya } : {}) });
  };

  const promisedBeforeDeparture = value.departurePlannedOn && value.arrivalPromisedOn
    && value.arrivalPromisedOn < value.departurePlannedOn;

  return (
    <div className="travel-fields">
      <div className="travel-row">
        <DayField label="Départ prévu" value={value.departurePlannedOn} onChange={(v) => set({ departurePlannedOn: v })} />
        <DayField
          label="Arrivée promise"
          value={value.arrivalPromisedOn}
          min={value.departurePlannedOn}
          onChange={(v) => set({ arrivalPromisedOn: v })}
          hint={value.arrivalPromisedOn ? formatDateFr(value.arrivalPromisedOn) : 'la date que le passager a donnée'}
        />
        {showActual && (
          <>
            <DayField label="Départ réel" value={value.departureActualOn} onChange={(v) => set({ departureActualOn: v })} />
            <DayField label="Arrivée réelle" value={value.arrivalActualOn} onChange={(v) => set({ arrivalActualOn: v })} />
          </>
        )}
      </div>
      {promisedBeforeDeparture && <p className="neg travel-warn">L’arrivée promise précède le départ prévu.</p>}

      <div className="travel-row">
        <label className="field field-grow">
          <span>Aéroport d’arrivée</span>
          <input
            list={airportList}
            value={value.airport || ''}
            onChange={(e) => pickAirport(e.target.value)}
            placeholder="Houari Boumediene, Es Senia…"
            autoComplete="off"
          />
          <datalist id={airportList}>
            {airports.map((a) => <option key={a.value} value={a.value}>{a.wilaya || ''}</option>)}
          </datalist>
        </label>
        <WilayaField value={value.airportWilaya} onChange={(v) => set({ airportWilaya: v })} />
        <label className="field field-grow">
          <span>Compagnie</span>
          <input
            list={airlineList}
            value={value.airline || ''}
            onChange={(e) => set({ airline: e.target.value })}
            placeholder="Air China, Turkish Airlines…"
            autoComplete="off"
          />
          <datalist id={airlineList}>
            {airlines.map((a) => <option key={a.value} value={a.value} />)}
          </datalist>
        </label>
      </div>
    </div>
  );
}

// Ce qu'on envoie à POST /bons ou PATCH /bons/:id/travel : les clés connues, rien d'autre.
export const travelBody = (v, { actual = false } = {}) => ({
  departurePlannedOn: v.departurePlannedOn || null,
  arrivalPromisedOn: v.arrivalPromisedOn || null,
  airport: v.airport || null,
  airportWilaya: v.airportWilaya || null,
  airline: v.airline || null,
  ...(actual ? { departureActualOn: v.departureActualOn || null, arrivalActualOn: v.arrivalActualOn || null } : {}),
});
