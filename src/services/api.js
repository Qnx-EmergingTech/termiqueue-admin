// api.js
import axios from 'axios';

/* ================================
 * 1) Environment & Configuration
 * ================================ */

// Backward-compatible env variables
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://44.202.107.196:8080';

// Allow changing the login path without touching code everywhere
// Set VITE_LOGIN_PATH=/auth/login if your server uses that.
const LOGIN_PATH = (import.meta.env.VITE_LOGIN_PATH || '/login').replace(/\/+$/, '') || '/login';

// Optional: if your backend sets cookies for sessions (not typical with JWT in SPA)
// Set VITE_WITH_CREDENTIALS=true to send cookies.
const WITH_CREDENTIALS = String(import.meta.env.VITE_WITH_CREDENTIALS || 'false') === 'true';

// Default request timeout (ms)
const TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);

// Centralized storage keys
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';

/* ================================
 * 2) Axios Instance
 * ================================ */

const api = axios.create({
  baseURL: API_URL.replace(/\/+$/, ''), // no trailing slash
  timeout: TIMEOUT_MS,
  withCredentials: WITH_CREDENTIALS,
  // Always treat only 2xx as success
  validateStatus: (status) => status >= 200 && status < 300,
  headers: {
    'Content-Type': 'application/json'
  }
});

/* ================================
 * 3) Token Utilities
 * ================================ */

const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY) || null;
const setAccessToken = (token) => {
  if (!token) {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } else {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  }
};

const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY) || null;
const setRefreshToken = (token) => {
  if (!token) {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
};

const setUser = (user) => {
  if (!user) {
    localStorage.removeItem(USER_KEY);
  } else {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
};

export const getCurrentUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

/* ================================
 * 4) Interceptors
 * ================================ */

// Attach Authorization header if token is present
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    // Do not mutate config.headers directly if undefined
    config.headers = config.headers || {};
    // Avoid overriding existing auth header if present
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

/**
 * Optional: Auto-refresh access token on 401
 * Enable by setting VITE_ENABLE_TOKEN_REFRESH=true and implement /auth/refresh on backend.
 */
const ENABLE_TOKEN_REFRESH = String(import.meta.env.VITE_ENABLE_TOKEN_REFRESH || 'false') === 'true';
let isRefreshing = false;
let pendingQueue = [];

const processQueue = (error, token = null) => {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  pendingQueue = [];
};

if (ENABLE_TOKEN_REFRESH) {
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config || {};
      const status = error.response?.status;

      // Only handle 401 once per request
      if (status === 401 && !original._retry) {
        original._retry = true;

        // Queue parallel requests while refreshing
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            pendingQueue.push({
              resolve: (token) => {
                if (token) original.headers.Authorization = `Bearer ${token}`;
                resolve(api(original));
              },
              reject
            });
          });
        }

        try {
          isRefreshing = true;
          const refreshed = await refreshAccessToken(); // defined below
          processQueue(null, refreshed);
          original.headers.Authorization = `Bearer ${refreshed}`;
          return api(original);
        } catch (refreshErr) {
          processQueue(refreshErr, null);
          // If refresh fails, force logout
          logoutAPI();
          return Promise.reject(refreshErr);
        } finally {
          isRefreshing = false;
        }
      }

      // Not a handled case: propagate
      return Promise.reject(error);
    }
  );
}

/* ================================
 * 5) Error Helpers
 * ================================ */

const extractError = (err) => {
  // Network error or timeout
  if (err.code === 'ECONNABORTED') {
    return { message: `Request timed out after ${TIMEOUT_MS}ms`, status: 0, data: null };
  }
  if (!err.response) {
    return { message: err.message || 'Network error', status: 0, data: null };
  }
  const { status, data } = err.response;
  const message =
    (typeof data === 'string' && data) ||
    data?.message ||
    data?.error ||
    `Request failed with status ${status}`;
  return { message, status, data };
};

const logApiError = (label, err) => {
  const { message, status, data } = extractError(err);
  console.error(`[API:${label}] ${message}`, {
    status,
    baseURL: API_URL,
    path: err.config?.url,
    method: err.config?.method,
    data
  });
};

/* ================================
 * 6) Auth APIs
 * ================================ */

/**
 * Login
 * - Configurable path via VITE_LOGIN_PATH (default: /login)
 * - Expects API to return at least { accessToken, user, refreshToken? }
 */
export const loginAPI = async (email, password) => {
  try {
    const response = await api.post(LOGIN_PATH, { email, password });
    const { accessToken, user, refreshToken } = response.data || {};

    if (accessToken) setAccessToken(accessToken);
    if (refreshToken) setRefreshToken(refreshToken);
    if (user) setUser(user);

    return response.data;
  } catch (error) {
    logApiError('login', error);
    throw extractError(error);
  }
};

/**
 * Optional: refresh token flow
 * Requires backend endpoint and refresh token to be stored.
 * Configure VITE_REFRESH_PATH (default: /auth/refresh).
 */
const REFRESH_PATH = (import.meta.env.VITE_REFRESH_PATH || '/auth/refresh').replace(/\/+$/, '') || '/auth/refresh';
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token');
  const res = await api.post(REFRESH_PATH, { refreshToken });
  const newToken = res.data?.accessToken;
  if (!newToken) throw new Error('Refresh did not return accessToken');
  setAccessToken(newToken);
  return newToken;
}

/**
 * Logout (client-side)
 * - If your backend supports server-side logout, POST there too.
 */
export const logoutAPI = () => {
  setAccessToken(null);
  setRefreshToken(null);
  setUser(null);
  // If you need to notify server, do it here:
  // await api.post('/auth/logout');
  window.location.href = '/login';
};

/* ================================
 * 7) Domain Mappers
 * ================================ */

const normalizeBus = (bus, index) => {
  const statusMap = {
    available: 'Available',
    active: 'Active',
    in_transit: 'In Transit',
    arrived: 'Arrived',
    maintenance: 'Maintenance'
  };
  const rawStatus = (bus.status || '').toString().toLowerCase();

  const routePieces = [];
  if (bus.origin) routePieces.push(bus.origin);
  if (bus.destination) routePieces.push(bus.destination);

  return {
    id: bus.id ?? bus.bus_id ?? index,
    busNumber: bus.bus_number ?? bus.busNumber ?? 'N/A',
    route: bus.route || (routePieces.length ? routePieces.join(' - ') : 'No Route'),
    status: statusMap[rawStatus] || 'Offline',
    plateNumber: bus.plate_number ?? bus.plateNumber ?? 'N/A',
    busCompany: bus.bus_name ?? bus.busCompany ?? 'Unknown Co.',
    capacity: Number.isFinite(bus.capacity) ? bus.capacity : 0,
    attendantName: bus.attendant_name || 'No Attendant'
  };
};

/* ================================
 * 8) Bus APIs
 * ================================ */

export const fetchBuses = async () => {
  try {
    const res = await api.get('/buses');
    const raw = Array.isArray(res.data) ? res.data : (res.data?.data || []);
    return raw.map((bus, i) => normalizeBus(bus, i));
  } catch (error) {
    logApiError('fetchBuses', error);
    return [];
  }
};

export const createBus = async (busData) => {
  try {
    const res = await api.post('/buses', busData);
    return normalizeBus(res.data, 0);
  } catch (error) {
    logApiError('createBus', error);
    throw extractError(error);
  }
};

export const updateBus = async (id, busData) => {
  try {
    const res = await api.put(`/buses/${id}`, busData);
    return normalizeBus(res.data, 0);
  } catch (error) {
    logApiError('updateBus', error);
    throw extractError(error);
  }
};

export const deleteBus = async (id) => {
  try {
    await api.delete(`/buses/${id}`);
    return true;
  } catch (error) {
    logApiError('deleteBus', error);
    return false;
  }
};