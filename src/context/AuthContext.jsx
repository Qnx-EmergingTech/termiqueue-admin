import { createContext, useState, useContext, useEffect } from 'react';
// 1. Import Firebase tools instead of the old API files
import { auth, db, firebaseInitialized } from '../firebase'; 
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { API_SESSION_EXPIRED_EVENT, loginAPI, logoutAPI, getCurrentUser as apiGetCurrentUser } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authNotice, setAuthNotice] = useState('');

  // Prefer API auth when API URL is configured unless Firebase is explicitly requested.
  const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase();
  const apiConfigured = AUTH_PROVIDER !== 'firebase' && !!import.meta.env.VITE_API_URL;

  // 2. Firebase "Watcher" - This checks if you are logged in automatically
  useEffect(() => {
    // If an API backend is configured, try restoring auth from API/localStorage
    if (apiConfigured) {
      (async () => {
        try {
          const current = await apiGetCurrentUser();
          if (current) {
            setUser(current);
            setIsAuthenticated(true);
          } else {
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (e) {
          setUser(null);
          setIsAuthenticated(false);
        } finally {
          setLoading(false);
        }
      })();

      return;
    }

    if (!firebaseInitialized) {
      // Running without Firebase — restore demo auth from localStorage if present
      const demo = localStorage.getItem('demoAuth');
      if (demo) {
        try {
          const parsed = JSON.parse(demo);
          setUser(parsed);
          setIsAuthenticated(true);
        } catch (e) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // If user exists in Auth, check if they are an Admin in Firestore
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        
        if (userDoc.exists() && userDoc.data().isAdmin === true) {
          setUser({ ...firebaseUser, ...userDoc.data() });
          setIsAuthenticated(true);
        } else {
          // Not an admin? Log them out!
          await signOut(auth);
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
    });

    return () => unsubscribe(); // Cleanup the watcher
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleSessionExpired = (event) => {
      const message = event?.detail?.message || 'Session expired. Please login again.';
      setAuthNotice(message);
      setUser(null);
      setIsAuthenticated(false);
      setLoading(false);
    };

    window.addEventListener(API_SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(API_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  // 3. New Firebase Login Logic
  const login = async (email, password) => {
    // If an API backend is configured, use it for login
    if (apiConfigured) {
      try {
        const data = await loginAPI(email, password);
        // loginAPI may return tokens first, then user profile from /profiles/me
        if (data.accessToken) {
          localStorage.setItem('accessToken', data.accessToken);
        }
        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }

        let resolvedUser = null;

        try {
          resolvedUser = await apiGetCurrentUser();
        } catch {
          resolvedUser = null;
        }

        if (!resolvedUser && data.user) {
          resolvedUser = data.user;
        }

        if (!resolvedUser) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          return { success: false, error: 'Login succeeded but profile could not be loaded.' };
        }

        localStorage.setItem('user', JSON.stringify(resolvedUser));
        setAuthNotice('');
        setUser(resolvedUser);
        setIsAuthenticated(true);
        return { success: true };
      } catch (err) {
        const msg = err?.response?.data?.message || err?.message || 'Login failed';
        return { success: false, error: msg };
      }
    }

    // If Firebase isn't configured, allow a demo login so the app can run locally
    if (!firebaseInitialized) {
      const demoUser = { uid: 'demo', name: 'Demo User', role: 'Admin' };
      setUser(demoUser);
      setIsAuthenticated(true);
      localStorage.setItem('demoAuth', JSON.stringify(demoUser));
      return { success: true };
    }

    try {
      // Sign in with Firebase
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Immediately check if this person is an Admin in your "users" collection
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));

      if (userDoc.exists() && userDoc.data().isAdmin === true) {
        setUser({ ...firebaseUser, ...userDoc.data() });
        setIsAuthenticated(true);
        return { success: true };
      } else {
        await signOut(auth); // Kick them out if not admin
        return { success: false, error: "Access Denied: You are not an Admin." };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { 
        success: false, 
        error: "Login failed. Check your email/password." 
      };
    }
  };

  // 4. New Firebase Logout Logic
  const logout = async () => {
    try {
      if (apiConfigured) {
        try {
          await logoutAPI();
        } catch (e) {
          console.warn('API logout failed:', e);
        }
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
      }

      if (firebaseInitialized) {
        await signOut(auth);
      }

      localStorage.removeItem('demoAuth');
      setAuthNotice('');
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const clearAuthNotice = () => setAuthNotice('');

  const value = { user, isAuthenticated, loading, login, logout, authNotice, clearAuthNotice };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export default AuthContext;