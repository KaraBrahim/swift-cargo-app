import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken, setLastUser } from '../api/client.js';
import { forgetCredentialSession } from '../lib/credentials.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    try {
      const { admin } = await api('/auth/me');
      setAdmin(admin);
    } catch {
      setToken(null);
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Any 401 anywhere logs the user out.
  useEffect(() => {
    const onUnauth = () => setAdmin(null);
    window.addEventListener('sc-unauthorized', onUnauth);
    return () => window.removeEventListener('sc-unauthorized', onUnauth);
  }, []);

  // `remember` asks the server for a long-lived session and stores the
  // USERNAME so the field is pre-filled next time. The password itself is
  // never written anywhere by this app — see the note in pages/Login.jsx.
  const login = async (username, password, remember = false) => {
    const r = await api('/auth/login', { method: 'POST', body: { username, password, remember } });
    setToken(r.token);
    setLastUser(remember ? username : null);
    setAdmin(r.admin);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    // The remembered username deliberately survives logout: that is what makes
    // the next sign-in one field shorter. Clearing the box clears it.
    setToken(null);
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
