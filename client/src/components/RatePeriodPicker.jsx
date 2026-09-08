import { DayPicker } from 'react-day-picker';
import { fr } from 'date-fns/locale';
import 'react-day-picker/style.css';

// The calendar is always on screen rather than hidden behind a button: it is
// half of what this panel is for, and a date picker you have to open first is a
// date picker you forget is there.
//
// react-day-picker rather than something hand-rolled: keyboard navigation,
// range selection, month paging, disabled days and a French locale are a lot of
// detail to get right, and getting one of them wrong is how a date picker
// silently returns the wrong day.

// Local formatting, never toISOString(): that converts to UTC first, so an
// evening in Algiers becomes the previous day and the rate you asked for is
// yesterday's.
export const toISO = (d) =>
  !d ? null
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// `disabled` est un réglage, plus une règle gravée. Pour un taux, le futur n'a
// pas de sens et l'offrir invite une réponse vide qui ressemble à une panne —
// c'est pourquoi il reste interdit par défaut. Un rapport, lui, demande
// légitimement « du 1er au 30 septembre » le 8 : la fin du mois est dans
// l'avenir et doit rester cliquable.
export default function RateCalendar({ mode, value, onChange, disabled = { after: new Date() } }) {
  return (
    <div className="hist-cal">
      <DayPicker
        locale={fr}
        mode={mode}
        selected={value}
        defaultMonth={(mode === 'range' ? value?.from : value) ?? new Date()}
        disabled={disabled}
        onSelect={onChange}
      />
    </div>
  );
}
