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

export default function RateCalendar({ mode, value, onChange }) {
  return (
    <div className="hist-cal">
      <DayPicker
        locale={fr}
        mode={mode}
        selected={value}
        defaultMonth={(mode === 'range' ? value?.from : value) ?? new Date()}
        // A rate cannot be looked up in the future, and offering it invites an
        // empty answer that looks like a bug.
        disabled={{ after: new Date() }}
        onSelect={onChange}
      />
    </div>
  );
}
