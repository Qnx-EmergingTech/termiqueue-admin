import { createContext, useState, useContext, useEffect } from 'react';
import { auth, db, firebaseInitialized } from '../firebase'; 
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { loginAPI, logoutAPI, getCurrentUser as apiGetCurrentUser } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);


 // Auth mode is explicit to avoid accidental API auth for fresh clones.
const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER || 'firebase').toLowerCase();

// Checks if the provider is 'api' AND the URL is actually defined
const apiConfigured = AUTH_PROVIDER === 'api' && !!import.meta.env.VITE_API_URL;


  useEffect(() => {
    // 1. Handle External API Auth
    if (apiConfigured) {
      (async () => {
        try {
          const current = await apiGetCurrentUser();
          if (current) {
            setUser(current);
            setIsAuthenticated(true);
          }
        } catch (e) {
          console.error("API Auth Check Failed", e);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    // 2. Handle Demo/Offline Mode (If Firebase is missing)
    if (!firebaseInitialized || !auth || !db) {
      const demo = localStorage.getItem('demoAuth');
      if (demo) {
        try {
          const parsed = JSON.parse(demo);
          setUser(parsed);
          setIsAuthenticated(true);
        } catch (e) {
          localStorage.removeItem('demoAuth');
        }
      }
      setLoading(false);
      return;
    }

    // 3. Handle Firebase Auth (Only runs if auth/db are valid)
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists() && userDoc.data().isAdmin === true) {
            setUser({ ...firebaseUser, ...userDoc.data() });
            setIsAuthenticated(true);
          } else {
            await signOut(auth);
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (error) {
          console.error("Firestore access error:", error);
          setUser(null);
          setIsAuthenticated(false);
        }
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [apiConfigured]);

  const login = async (email, password) => {
    if (apiConfigured) {
      try {
        const data = await loginAPI(email, password);
        if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
        if (data.user) {
          setUser(data.user);
          setIsAuthenticated(true);
          return { success: true };
        }
        return { success: false, error: 'Invalid API response' };
      } catch (err) {
        return { success: false, error: err?.response?.data?.message || 'Login failed' };
      }
    }

    // Demo Login fallback
    if (!firebaseInitialized || !auth || !db) {
      const demoUser = { uid: 'demo', name: 'Demo Admin', role: 'Admin' };
      setUser(demoUser);
      setIsAuthenticated(true);
      localStorage.setItem('demoAuth', JSON.stringify(demoUser));
      return { success: true };
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));

      if (userDoc.exists() && userDoc.data().isAdmin === true) {
        setUser({ ...userCredential.user, ...userDoc.data() });
        setIsAuthenticated(true);
        return { success: true };
      } else {
        await signOut(auth);
        return { success: false, error: "Access Denied: Admin privileges required." };
      }
    } catch (error) {
      return { success: false, error: "Invalid credentials or connection error." };
    }
  };

  const logout = async () => {
    if (apiConfigured) {
      try { await logoutAPI(); } catch (e) {}
      localStorage.removeItem('accessToken');
    }
    if (firebaseInitialized && auth) {
      await signOut(auth);
    }
    localStorage.removeItem('demoAuth');
    setUser(null);
    setIsAuthenticated(false);
  };

  const value = { user, isAuthenticated, loading, login, logout };

  return <AuthContext.Provider value={value}>{loading ? null : children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export default AuthContext;