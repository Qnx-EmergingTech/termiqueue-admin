import { createContext, useState, useContext, useEffect } from 'react';
// 1. Import Firebase tools instead of the old API files
import { auth, db, firebaseInitialized } from '../firebase'; 
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { API_SESSION_EXPIRED_EVENT, loginAPI, logoutAPI, getCurrentUser as apiGetCurrentUser } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authNotice, setAuthNotice] = useState('');

  // Prefer API auth when API URL is configured unless Firebase is explicitly requested.
  const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase();
  const apiConfigured = AUTH_PROVIDER === 'api' && !!String(import.meta.env.VITE_API_URL || '').trim();
  const allowFirebaseFallback = !apiConfigured && AUTH_PROVIDER === 'firebase';

  const hasApiToken = () => {
    const tokenKeys = [
      'accessToken',
      'access_token',
      'token',
      'idToken',
      'id_token',
      'jwt',
      'authToken',
      'auth_token',
    ];

    return tokenKeys.some((key) => String(localStorage.getItem(key) || '').trim().length > 0);
  };

  const isLikelyEmail = (value) => {
    const normalized = String(value || '').trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  };

  const getAdminProfileFromFirestore = async (firebaseUser) => {
    const collectionsToCheck = ['users', 'profiles'];
    const normalizedEmail = String(firebaseUser?.email || '').trim().toLowerCase();

    for (const collectionName of collectionsToCheck) {
      const byUidDoc = await getDoc(doc(db, collectionName, firebaseUser.uid));
      if (byUidDoc.exists()) {
        const data = byUidDoc.data();
        if (data?.isAdmin === true || String(data?.user_type || '').toLowerCase() === 'admin') {
          return data;
        }
      }

      if (!normalizedEmail) {
        continue;
      }

      const profileQuery = query(
        collection(db, collectionName),
        where('email', '==', normalizedEmail),
        limit(1)
      );
      const byEmailSnapshot = await getDocs(profileQuery);

      if (!byEmailSnapshot.empty) {
        const profileData = byEmailSnapshot.docs[0].data();
        if (profileData?.isAdmin === true || String(profileData?.user_type || '').toLowerCase() === 'admin') {
          return profileData;
        }
      }
    }

    return null;
  };

  // 2. Firebase "Watcher" - This checks if you are logged in automatically
  useEffect(() => {
    // If an API backend is configured, try restoring auth from API/localStorage
    if (apiConfigured) {
      (async () => {
        try {
          const current = await apiGetCurrentUser();
          if (current && hasApiToken()) {
            setUser(current);
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('user');
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (e) {
          localStorage.removeItem('user');
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
        try {
          const adminProfile = await getAdminProfileFromFirestore(firebaseUser);

          if (adminProfile) {
            setUser({ ...firebaseUser, ...adminProfile });
            setIsAuthenticated(true);
          } else {
            await signOut(auth);
            setUser(null);
            setIsAuthenticated(false);
          }
        } catch (error) {
          console.error('Admin profile lookup failed:', error);
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
  const login = async (identifier, password) => {
    const normalizedIdentifier = String(identifier || '').trim();

    // If an API backend is configured, use it for login
    if (apiConfigured) {
      try {
        const data = await loginAPI(normalizedIdentifier, password);
        const normalizedToken = String(
          data?.accessToken ||
          data?.raw?.idToken ||
          data?.raw?.id_token ||
          data?.raw?.accessToken ||
          data?.raw?.access_token ||
          ''
        ).trim();

        // loginAPI may return tokens first, then user profile from /profiles/me
        if (normalizedToken) {
          localStorage.setItem('accessToken', normalizedToken);
          localStorage.setItem('access_token', normalizedToken);
          localStorage.setItem('idToken', normalizedToken);
          localStorage.setItem('id_token', normalizedToken);
          localStorage.setItem('token', normalizedToken);
          localStorage.setItem('authToken', normalizedToken);
          localStorage.setItem('auth_token', normalizedToken);
          localStorage.setItem('sessionStartedAt', String(Date.now()));
        }

        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
          localStorage.setItem('refresh_token', data.refreshToken);
        }

        if (!hasApiToken()) {
          localStorage.removeItem('user');
          return { success: false, error: 'Login response did not include an API token.' };
        }

        let resolvedUser = null;

        try {
          resolvedUser = await apiGetCurrentUser();
        } catch {
          resolvedUser = null;
        }

        if (normalizedToken && !hasApiToken()) {
          localStorage.setItem('accessToken', normalizedToken);
          localStorage.setItem('access_token', normalizedToken);
          localStorage.setItem('idToken', normalizedToken);
          localStorage.setItem('id_token', normalizedToken);
          localStorage.setItem('token', normalizedToken);
          localStorage.setItem('authToken', normalizedToken);
          localStorage.setItem('auth_token', normalizedToken);
          localStorage.setItem('sessionStartedAt', String(Date.now()));
        }

        if (!resolvedUser && data.user) {
          resolvedUser = data.user;
        }

        if (firebaseInitialized) {
          const firebaseLoginEmail = [
            isLikelyEmail(normalizedIdentifier) ? normalizedIdentifier : '',
            resolvedUser?.email,
            data?.user?.email,
            data?.raw?.email,
          ].map((value) => String(value || '').trim()).find((value) => isLikelyEmail(value));

          if (firebaseLoginEmail) {
            try {
              await signInWithEmailAndPassword(auth, firebaseLoginEmail, password);
            } catch (firebaseLoginError) {
              console.warn('Firebase parallel sign-in failed in API mode:', firebaseLoginError);
            }
          }
        }

        if (!resolvedUser) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('access_token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          if (!allowFirebaseFallback) {
            return { success: false, error: 'Login succeeded but profile could not be loaded.' };
          }
        }

        if (resolvedUser) {
          localStorage.setItem('user', JSON.stringify(resolvedUser));
          setAuthNotice('');
          setUser(resolvedUser);
          setIsAuthenticated(true);
          return { success: true };
        }
      } catch (err) {
        if (!allowFirebaseFallback) {
          const msg = err?.response?.data?.message || err?.message || 'Login failed';
          return { success: false, error: msg };
        }
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

    if (!isLikelyEmail(normalizedIdentifier)) {
      return {
        success: false,
        error: 'Firebase login requires your email address. Usernames work only in API mode.',
      };
    }

    try {
      // Sign in with Firebase
      const userCredential = await signInWithEmailAndPassword(auth, normalizedIdentifier, password);
      const firebaseUser = userCredential.user;

      const adminProfile = await getAdminProfileFromFirestore(firebaseUser);

      if (adminProfile) {
        setUser({ ...firebaseUser, ...adminProfile });
        setIsAuthenticated(true);
        return { success: true };
      } else {
        await signOut(auth); // Kick them out if not admin
        return {
          success: false,
          error: 'Access Denied: Admin profile not found for this Firebase account. Ensure users/{uid} exists with isAdmin=true.',
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorCode = String(error?.code || '');

      if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
        return {
          success: false,
          error: 'Invalid email or password.',
        };
      }

      if (errorCode === 'auth/too-many-requests') {
        return {
          success: false,
          error: 'Too many failed attempts. Please wait a moment and try again.',
        };
      }

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
        localStorage.removeItem('access_token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('refresh_token');
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