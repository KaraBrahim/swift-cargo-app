
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

// Everything that can go wrong between the click and the answer, said in words
// the person at the counter can act on. Codes and HTTP numbers stay on the
// object for the code to branch on; they are never what gets shown.
export const NETWORK_MESSAGES = {
  OFFLINE: 'Pas de connexion Internet.',
  SERVER_DOWN: 'Serveur injoignable.',
  TIMEOUT: 'Le serveur ne répond pas assez vite.',
};

// Used only where the server's own message would say less than this one — see
// the comment on prefersOwnMessage() below.
export const STATUS_MESSAGES = {
  401: 'Session expirée. Reconnectez-vous.',
  500: "Une erreur interne est survenue. L'opération n'a pas été enregistrée.",
  502: 'Serveur indisponible pour le moment. Réessayez dans un instant.',
  503: 'Serveur indisponible pour le moment. Réessayez dans un instant.',
  504: 'Le serveur met trop de temps à répondre. Réessayez.',
};

// A 404 from the API says « Bon introuvable » — more useful than any generic
// text we could write. A 500 says « Erreur interne du serveur », which tells
// nobody anything. So the server wins everywhere it can know better, and that
// is everywhere below 500.
//
// 401 in particular must NOT be overridden: the same status covers a wrong
// password at sign-in and an expired session, and only the server knows which.
// Replacing it turned « Nom d'utilisateur ou mot de passe incorrect » into
// « Session expirée » on the login form — an answer to a question nobody asked.
// The table above still catches the case where a 401 arrives with no message.
const prefersOwnMessage = (status) => status >= 500;

export class ApiError extends Error {
  constructor({ code, message, details, status, ref }) {
    super(message || NETWORK_MESSAGES[code] || 'Erreur inattendue.');
    this.code = code;
    this.details = details;
    this.status = status;
    this.ref = ref;               // support reference printed with a 500
  }
}

// Twelve seconds: long enough for a slow query on a cold cloud database, short
// enough that nobody sits watching a spinner that will never resolve.
const TIMEOUT_MS = 12000;

// The banner listens to these — one failure is enough to raise it, one success
// to take it down. See ConnectionBanner.jsx.
const announce = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

// Une opération d'argent qui n'aboutit pas visiblement — un timeout, une
// coupure — laisse la personne au guichet devant un choix impossible : est-ce
// passé ou non ? Elle reclique, et le passager est payé deux fois.
//
// `idem` est une clé attachée à l'INTENTION, pas à la requête : le même geste
// réessayé porte la même clé, et le serveur rend alors la réponse d'origine au
// lieu de bouger l'argent une seconde fois (server/src/middleware/idempotent.js).
// Créée ici pour que chaque appel qui la demande en ait une sans y penser.
export const newIdemKey = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Où vit l'API.
//
// Vide par défaut, c'est-à-dire « la même origine que cette page » — ce qui est
// le cas partout où l'interface est servie par son propre serveur : le poste de
// travail (Electron, sur http://localhost) et le hub qui sert aussi le site.
//
// VITE_API_URL ne sert qu'au cas où l'interface est hébergée SÉPARÉMENT de
// l'API (un CDN d'un côté, le serveur de l'autre). Il faut alors que le serveur
// autorise cette origine dans CORS_ORIGINS, sinon le navigateur refusera les
// requêtes — les deux réglages vont toujours ensemble.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export async function api(path, { method = 'GET', body, timeout = TIMEOUT_MS, idem } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        ...(idem ? { 'idempotency-key': idem } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: abort.signal,
    });
  } catch (e) {
    // fetch() reports the same failure whether the network is down, the server
    // is stopped, or the request timed out — and those three call for three
    // different actions. navigator.onLine separates the first from the second;
    // the third we know because we aborted it ourselves.
    const code = e?.name === 'AbortError' ? 'TIMEOUT'
      : navigator.onLine === false ? 'OFFLINE'
        : 'SERVER_DOWN';
    announce('sc-net-down', { code });
    throw new ApiError({ code });
  } finally {
    clearTimeout(timer);
  }
  announce('sc-net-up');

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
      message: prefersOwnMessage(res.status)
        ? STATUS_MESSAGES[res.status] || STATUS_MESSAGES[500]
        : err.message || STATUS_MESSAGES[res.status] || `L'opération a échoué (${res.status}).`,
      details: err.details,
      status: res.status,
      ref: err.ref,
    });
  }
  return json;
}
