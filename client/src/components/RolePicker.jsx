import { IconEl } from './icons.jsx';

// Fournisseur, passager, or both — the same fiche either way.
//
// Two toggles rather than a dropdown: the roles are not exclusive, and the
// answer to "is this person also a passager?" is one tap, not a menu. The
// passager kind (régulier / auto-entrepreneur) only appears once that role is
// on, because it means nothing otherwise.

export const emptyPerson = (roles = {}) => ({
  name: '', phone: '', notes: '',
  isFournisseur: Boolean(roles.isFournisseur),
  isPassager: Boolean(roles.isPassager),
  passagerType: 'regular',
});

// A record from the API, opened in the form.
export const personToForm = (p) => ({
  id: p.id,
  name: p.name || '',
  phone: p.phone || '',
  notes: p.notes || '',
  isFournisseur: Boolean(p.is_fournisseur),
  isPassager: Boolean(p.is_passager),
  passagerType: p.passager_type || 'regular',
});

// What POST/PUT /people expects.
export const personBody = (f) => ({
  name: f.name.trim(),
  phone: f.phone || undefined,
  notes: f.notes || undefined,
  isFournisseur: Boolean(f.isFournisseur),
  isPassager: Boolean(f.isPassager),
  passagerType: f.isPassager ? f.passagerType || 'regular' : undefined,
});

export const personValid = (f) => Boolean(f.name.trim()) && (f.isFournisseur || f.isPassager);

export function RolePicker({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const none = !value.isFournisseur && !value.isPassager;

  return (
    <div className="role-pick">
      <span className="role-pick-label">Rôles</span>
      <div className="role-chips">
        <button
          type="button"
          className={value.isFournisseur ? 'role-chip on' : 'role-chip'}
          aria-pressed={value.isFournisseur}
          onClick={() => set({ isFournisseur: !value.isFournisseur })}
        >
          <IconEl name="fournisseur" />
          <span>Fournisseur</span>
          {value.isFournisseur && <IconEl name="check" />}
        </button>

        <button
          type="button"
          className={value.isPassager ? 'role-chip on' : 'role-chip'}
          aria-pressed={value.isPassager}
          onClick={() => set({ isPassager: !value.isPassager })}
        >
          <IconEl name="passager" />
          <span>Passager</span>
          {value.isPassager && <IconEl name="check" />}
        </button>
      </div>

      {value.isPassager && (
        <div className="seg role-seg">
          <button type="button" className={value.passagerType !== 'auto' ? 'active' : ''}
            onClick={() => set({ passagerType: 'regular' })}>Régulier</button>
          <button type="button" className={value.passagerType === 'auto' ? 'active' : ''}
            onClick={() => set({ passagerType: 'auto' })}>Auto-entrepreneur</button>
        </div>
      )}

      {/* Said out loud rather than left to a disabled button nobody can explain. */}
      {none && <span className="role-pick-hint">Choisissez au moins un rôle.</span>}
    </div>
  );
}

// The badge shown next to a name once a person holds the other role too.
export function RoleBadges({ person, hide }) {
  const roles = [
    person.is_fournisseur && { key: 'fournisseur', label: 'Fournisseur', icon: 'fournisseur' },
    person.is_passager && { key: 'passager', label: 'Passager', icon: 'passager' },
  ].filter(Boolean).filter((r) => r.key !== hide);
  if (!roles.length) return null;
  return (
    <>
      {roles.map((r) => (
        <span key={r.key} className={`role-badge role-${r.key}`}>
          <IconEl name={r.icon} />{r.label}
        </span>
      ))}
    </>
  );
}
