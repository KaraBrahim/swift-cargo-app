import { useCallback, useState } from 'react';
import icon from '../assets/swift-cargo-logo-files/swift-cargo-icon.svg';
import { useAuth } from '../auth/AuthContext.jsx';
import { getLastUser } from '../api/client.js';
import { errorMessage } from '../components/ui.jsx';
import { WelcomeIntro, shouldPlayIntro } from '../components/WelcomeIntro.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { storePasswordCredential } from '../lib/credentials.js';

// ─────────────────────────────────────────────────────────────────────
// On « se souvenir du mot de passe »
//
// This form does not save passwords, and deliberately so. An app that keeps a
// password on the machine has to keep the means of reading it back on the same
// machine — so "encrypting" it in localStorage only means shipping the key next
// to the lock. Anyone with the file, or any script running on the page, gets
// the password itself, which is the one secret that also unlocks the other
// desk, the other accounts, and anything else it was reused on.
//
// What actually works is three separate things, and all three are here:
//   1. the USERNAME is remembered by us — it is not a secret;
//   2. the PASSWORD is offered to the browser's own password manager, which
//      keeps it in the operating system's encrypted store (Windows Credential
//      Manager / Keychain) behind the session login. That is what the name/id/
//      autocomplete attributes below are for — without them the browser cannot
//      recognise the form and never offers to save;
//   3. « Rester connecté » asks the server for a session that lasts weeks
//      instead of hours, so the password is not needed again in the meantime.
// ─────────────────────────────────────────────────────────────────────

export default function Login() {
  const { login } = useAuth();
  const remembered = getLastUser();
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Decided once, on mount: the welcome plays before the form, and never
  // replays because a sign-in failed. Three phases rather than a boolean, so
  // the veil and the form overlap during 'leaving' — the veil is still on
  // screen fading out while the form is already rising in behind it.
  const [phase, setPhase] = useState(() => (shouldPlayIntro() ? 'playing' : 'off'));
  const handover = useCallback(() => setPhase('leaving'), []);
  const endIntro = useCallback(() => setPhase('off'), []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = username.trim();
      await login(id, password, remember);
      // Ask the browser to save it (Chrome/Edge). Best-effort: a refusal or an
      // unsupported browser must never affect the sign-in itself.
      await storePasswordCredential({ username: id, password });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen login-bg">
      {phase !== 'off' && <WelcomeIntro onHandover={handover} onEnd={endIntro} />}

      {/* Mounted only once the welcome hands over, so the autofocus lands on a
          field the user can actually see. */}
      {phase !== 'playing' && (
        <form
          className="login-card login-enter"
          onSubmit={submit}
          /* method/action are never used — submit is intercepted — but their
             presence is part of what makes a browser treat this as a real
             login form and offer to save the password. */
          method="post"
          action="/api/auth/login"
        >
          <img className="login-emblem" src={icon} alt="" />
          <div className="login-brand">SWIFT CARGO</div>
          <div className="login-sub">Espace de gestion</div>

          {error && <div className="alert alert-error">{error}</div>}

          <label className="field" htmlFor="sc-username">
            <span>Identifiant</span>
            <input
              id="sc-username"
              name="username"
              autoFocus={!remembered}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin1"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
            />
          </label>
          <PasswordField
            id="sc-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={Boolean(remembered)}
          />

          <label className="check-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Rester connecté
              <small>Garde la session ouverte 3 jours sur ce poste.</small>
            </span>
          </label>

          <button className="btn btn-gold btn-block" disabled={busy || !username || !password}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      )}
    </div>
  );
}
