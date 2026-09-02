// Password input with a « voir » toggle. Split out because the same control is
// wanted on the sign-in form and on every screen that sets a password.
//
// The button is type="button" on purpose: inside a <form> an untyped button
// defaults to submit, so showing the password would send the form.
import { useId, useState } from 'react';
import { IconEl } from './icons.jsx';

export function PasswordField({
  label = 'Mot de passe',
  value,
  onChange,
  id,
  name = 'password',
  autoComplete = 'current-password',
  placeholder,
  autoFocus = false,
}) {
  const [shown, setShown] = useState(false);
  const fallbackId = useId();
  const inputId = id || fallbackId;

  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      <span className="pw-wrap">
        <input
          id={inputId}
          name={name}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="pw-eye"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={shown}
          title={shown ? 'Masquer' : 'Afficher'}
          /* Keeps the caret where it was: clicking the eye must not steal focus
             from the field being typed into. */
          onMouseDown={(e) => e.preventDefault()}
        >
          <IconEl name={shown ? 'eyeOff' : 'eye'} />
        </button>
      </span>
    </label>
  );
}
