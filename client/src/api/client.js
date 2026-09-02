// Single fetch wrapper. Attaches the auth token, normalises every error into an
// ApiError with the backend's { code, message, details }, and signals a global
// logout on 401 so the whole app reacts consistently.
const TOKEN_KEY = 'sc_token';
const LAST_USER_KEY = 'sc_last_user';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

// The last username, remembered when « Rester connecté » is ticked. A username
// is not a secret — it is on every bon and in the audit trail. The password is
// a secret, and is never put here: storing it (even scrambled) would only mean
// shipping the key next to the lock. The browser's own password manager is the
// right place for it, which is what the login form's autocomplete attributes
// ask for.
export const getLastUser = () => localStorage.getItem(LAST_USER_KEY) || '';
export const setLastUser = (u) =>
  u ? localStorage.setItem(LAST_USER_KEY, u) : localStorage.removeItem(LAST_USER_KEY);

export class ApiError extends Error {
  constructor({ code, message, details, status }) {
    super(message || 'Erreur inattendue.');
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({ code: 'NETWORK', message: 'Serveur injoignable. Vérifiez la connexion.' });
  }

  let json = {};
  try {
    json = await res.json();
  } catch {
    /* empty / non-json body */
  }

  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('sc-unauthorized'));
    }
    const err = json.error || {};
    throw new ApiError({
      code: err.code || 'ERROR',
      message: err.message || `Erreur ${res.status}.`,
      details: err.details,
      status: res.status,
    });
  }
  return json;
}
