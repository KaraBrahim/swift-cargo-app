// Telling the browser "that was a sign-in".
//
// A single-page app defeats the password manager's usual heuristic: the form is
// never really submitted (we preventDefault and POST with fetch), and no page
// navigation follows, so Chrome/Edge often never offer to save the password
// even when the form markup is perfect.
//
// The Credential Management API is the explicit, supported way to say it. After
// a successful sign-in we hand the browser a PasswordCredential and it prompts
// to store it in the OS keychain (Windows Credential Manager / Keychain).
// Firefox and Safari do not implement `store()` — there the correct markup
// (name/id/autocomplete/method/action on the form) is what triggers their own
// heuristic, so both paths are covered.
//
// Everything here is best-effort: any failure is swallowed, because failing to
// offer a save prompt must never break signing in.
export async function storePasswordCredential({ username, password, name }) {
  try {
    const PC = window.PasswordCredential;
    if (!PC || !navigator.credentials?.store) return false;
    // Requires a secure context (https, or localhost during development).
    if (!window.isSecureContext) return false;
    await navigator.credentials.store(new PC({ id: username, password, name: name || username }));
    return true;
  } catch {
    return false;
  }
}

// Stops the browser from silently re-filling after an explicit sign-out.
export async function forgetCredentialSession() {
  try {
    await navigator.credentials?.preventSilentAccess?.();
  } catch { /* ignore */ }
}
