import axios from 'axios';
import { collection, getDocs } from 'firebase/firestore';
import { getBusesData, saveBusesData } from '../data/busesData';
import { db, firebaseInitialized } from '../firebase';

const API_URL = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const AUTH_PROVIDER = String(import.meta.env.VITE_AUTH_PROVIDER || 'firebase').trim().toLowerCase();
export const API_SESSION_EXPIRED_EVENT = 'qnext:api-session-expired';
const LOCAL_ATTENDANTS_KEY = 'qnext_admin_attendants';
const LOCAL_ROUTES_KEY = 'routesManagement.localRoutes';
const LOCAL_DESTINATIONS_KEY = 'routesManagement.localDestinations';
const LOCAL_ORIGIN_KEY = 'routesManagement.globalOrigin';

const requireApiUrl = () => {
  if (!API_URL) {
    console.warn('VITE_API_URL is not set. API-backed features will be unavailable until configured.');
  }

  return API_URL;
};

const readLocalJson = (key, fallbackValue) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }

    const parsed = JSON.parse(raw);
    return parsed ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
};

const writeLocalJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local storage write failures
  }
};

const splitName = (fullName) => {
  const normalized = String(fullName || '').trim();
  if (!normalized) {
    return { first_name: '', last_name: '' };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: '' };
  }

  return {
    first_name: parts.slice(0, parts.length - 1).join(' '),
    last_name: parts[parts.length - 1],
  };
};

const buildLocalQueueItemsFromBuses = () => {
  const buses = getBusesData();
  const seen = new Set();

  return buses
    .map((bus, index) => {
      const routeText = String(bus?.route || '').trim();
      const parts = routeText.split('-').map((part) => part.trim()).filter(Boolean);
      const origin = parts[0] || '';
      const destination = String(bus?.registeredDestination || parts.slice(1).join(' - ') || '').trim();

      if (!origin || !destination) {
        return null;
      }

      const key = `${origin.toLowerCase()}::${destination.toLowerCase()}`;
      if (seen.has(key)) {
        return null;
      }

      seen.add(key);

      return {
        id: `local-queue-${index + 1}`,
        queue_id: `local-queue-${index + 1}`,
        origin,
        destination,
        destinationName: destination,
        updatedAt: Number(bus?.lastUpdated || Date.now()),
      };
    })
    .filter(Boolean);
};

const getLocalAttendants = () => {
  const stored = readLocalJson(LOCAL_ATTENDANTS_KEY, null);
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }

  const buses = getBusesData();
  const attendants = buses
    .filter((bus) => String(bus?.busAttendant || '').trim() && String(bus?.busAttendant || '').trim().toLowerCase() !== 'n/a')
    .map((bus, index) => {
      const fullName = String(bus.busAttendant || '').trim();
      const { first_name, last_name } = splitName(fullName);
      const baseUsername = `${first_name}.${last_name}`.replace(/\.+/g, '.').replace(/^\.|\.$/g, '').toLowerCase();

      return {
        id: `local-attendant-${index + 1}`,
        first_name,
        middle_name: '',
        last_name,
        full_name: fullName,
        email: `${baseUsername || `attendant${index + 1}`}@example.com`,
        username: (baseUsername || `attendant${index + 1}`).replace(/[^a-z0-9._-]/g, ''),
        user_type: 'bus_attendant',
        is_archived: false,
        assignedBusId: String(bus?.id || ''),
        updatedAt: Number(bus?.lastUpdated || Date.now()),
      };
    });

  writeLocalJson(LOCAL_ATTENDANTS_KEY, attendants);
  return attendants;
};

const normalizeFirebaseAttendant = (item, fallbackId) => {
  const firstName = String(item?.first_name || item?.firstName || '').trim();
  const lastName = String(item?.last_name || item?.lastName || '').trim();
  const fullName = String(item?.full_name || item?.fullName || item?.name || `${firstName} ${lastName}`.trim()).trim();
  const resolvedUpdatedAt =
    item?.updated_at ||
    item?.updatedAt ||
    item?.last_updated ||
    item?.lastUpdated ||
    item?.created_at ||
    item?.createdAt ||
    0;

  return {
    ...item,
    id: String(item?.id || item?.profile_id || item?.uid || item?.user_id || fallbackId),
    first_name: firstName,
    middle_name: String(item?.middle_name || item?.middleName || '').trim(),
    last_name: lastName,
    full_name: fullName,
    email: String(item?.email || '').trim(),
    username: String(item?.username || '').trim(),
    username_lower: String(item?.username_lower || item?.usernameLower || item?.username || '').trim().toLowerCase(),
    user_type: String(item?.user_type || item?.userType || item?.role || item?.user_role || '').trim(),
    assignedBusId: String(item?.assignedBusId || item?.assigned_bus_id || item?.busId || item?.bus_id || '').trim(),
    is_archived: Boolean(item?.is_archived),
    updatedAt: resolvedUpdatedAt,
  };
};

const getFirebaseBusAttendants = async () => {
  if (!firebaseInitialized || !db) {
    return [];
  }

  const [profilesSnapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, 'profiles')),
    getDocs(collection(db, 'users')),
  ]);

  const mergedByKey = new Map();

  const mergeItem = (docSnapshot) => {
    const raw = docSnapshot.data() || {};
    const normalized = normalizeFirebaseAttendant(raw, docSnapshot.id);
    const dedupeKey = [
      String(normalized?.email || '').trim().toLowerCase(),
      String(normalized?.username_lower || '').trim().toLowerCase(),
      String(normalized?.username || '').trim().toLowerCase(),
      String(normalized?.id || '').trim(),
      docSnapshot.id,
    ].find((value) => String(value || '').trim());

    if (!dedupeKey) {
      return;
    }

    const existing = mergedByKey.get(dedupeKey) || {};
    mergedByKey.set(dedupeKey, {
      ...existing,
      ...normalized,
      id: String(existing?.id || normalized?.id || docSnapshot.id),
      raw: {
        ...(existing?.raw || {}),
        ...(raw || {}),
      },
    });
  };

  profilesSnapshot.docs.forEach(mergeItem);
  usersSnapshot.docs.forEach(mergeItem);

  return Array.from(mergedByKey.values()).filter((profile) => {
    const userType = String(profile?.user_type || profile?.role || profile?.user_role || '').trim().toLowerCase();
    const isBusAttendant = userType === 'bus_attendant' || userType.includes('attendant');
    return isBusAttendant;
  });
};

const BUS_ENDPOINTS = ['/buses', '/busses'];

const toDisplayRoute = (originValue, destinationValue) => {
  const origin = String(originValue || '').trim();
  const destination = String(destinationValue || '').trim();

  if (origin && destination) {
    return `${origin} - ${destination}`;
  }

  if (origin) {
    return origin;
  }

  return destination;
};

const normalizeBusRecord = (bus, fallbackIndex = 0) => {
  const origin = String(bus?.origin || '').trim();
  const destination = String(bus?.destination || '').trim();
  const routeFromParts = toDisplayRoute(origin, destination);
  const route = String(bus?.route || routeFromParts || '').trim();
  const registeredDestination = String(
    bus?.registeredDestination ||
    bus?.registered_destination ||
    destination ||
    ''
  ).trim();

  return {
    ...bus,
    id: bus?.id || bus?.bus_id || `bus-${fallbackIndex + 1}`,
    busNumber: String(bus?.busNumber || bus?.bus_number || bus?.busNo || '').trim(),
    route,
    busCompany: String(
      bus?.busCompany ||
      bus?.bus_company ||
      bus?.company ||
      bus?.operator ||
      bus?.bus_name ||
      ''
    ).trim(),
    status: String(bus?.status || '').trim(),
    plateNumber: String(bus?.plateNumber || bus?.plate_number || bus?.plateNo || '').trim(),
    capacity: Number(bus?.capacity || 0),
    busAttendant: String(bus?.busAttendant || bus?.attendant_name || bus?.attendantName || '').trim(),
    busCompanyEmail: String(bus?.busCompanyEmail || bus?.bus_company_email || bus?.company_email || '').trim(),
    busCompanyContact: String(bus?.busCompanyContact || bus?.bus_company_contact || bus?.company_contact || '').trim(),
    registeredDestination,
    origin,
    destination,
    lastUpdated: Number(
      bus?.lastUpdated ||
      bus?.updatedAt ||
      bus?.updated_at ||
      bus?.createdAt ||
      bus?.created_at ||
      Date.now()
    ),
  };
};

const normalizeBusList = (items) => {
  return (Array.isArray(items) ? items : []).map((bus, index) => normalizeBusRecord(bus, index));
};

const toBusWritePayload = (busData = {}) => {
  const normalized = normalizeBusRecord(busData);
  const routeParts = String(normalized.route || '').split('-').map((part) => part.trim()).filter(Boolean);
  const origin = String(normalized.origin || routeParts[0] || '').trim();
  const destination = String(normalized.registeredDestination || normalized.destination || routeParts.slice(1).join(' - ') || '').trim();

  return {
    ...busData,
    id: normalized.id,
    busNumber: normalized.busNumber,
    bus_number: normalized.busNumber,
    route: toDisplayRoute(origin, destination),
    origin,
    destination,
    busCompany: normalized.busCompany,
    bus_company: normalized.busCompany,
    status: normalized.status,
    plateNumber: normalized.plateNumber,
    plate_number: normalized.plateNumber,
    capacity: normalized.capacity,
    busAttendant: normalized.busAttendant,
    attendant_name: normalized.busAttendant,
    busCompanyEmail: normalized.busCompanyEmail,
    bus_company_email: normalized.busCompanyEmail,
    busCompanyContact: normalized.busCompanyContact,
    bus_company_contact: normalized.busCompanyContact,
    registeredDestination: destination,
    registered_destination: destination,
    updatedAt: normalized.lastUpdated,
    updated_at: normalized.lastUpdated,
  };
};

const buildUrl = (endpoint = '') => {
  const apiUrl = requireApiUrl();
  const normalizedEndpoint = `/${String(endpoint || '').trim().replace(/^\/+/, '')}`;
  return `${apiUrl}${normalizedEndpoint}`;
};

const getStoredToken = () => {
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

  for (const key of tokenKeys) {
    const value = String(localStorage.getItem(key) || '').trim();
    if (value) {
      return value;
    }
  }

  return '';
};

const getStoredRefreshToken = () => {
  const refreshTokenKeys = ['refreshToken', 'refresh_token'];

  for (const key of refreshTokenKeys) {
    const value = String(localStorage.getItem(key) || '').trim();
    if (value) {
      return value;
    }
  }

  return '';
};

const persistAccessToken = (token) => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return;
  }

  [
    'accessToken',
    'access_token',
    'token',
    'idToken',
    'id_token',
    'jwt',
    'authToken',
    'auth_token',
  ].forEach((key) => localStorage.setItem(key, normalizedToken));
};

const persistRefreshToken = (token) => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return;
  }

  ['refreshToken', 'refresh_token'].forEach((key) => localStorage.setItem(key, normalizedToken));
};

const getAuthHeaders = () => {
  const token = getStoredToken();

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
    authorization: `Bearer ${token}`,
    'x-access-token': token,
    token,
  };
};

const clearStoredSession = () => {
  [
    'accessToken',
    'access_token',
    'token',
    'idToken',
    'id_token',
    'jwt',
    'authToken',
    'auth_token',
    'refreshToken',
    'refresh_token',
    'user',
  ].forEach((key) => localStorage.removeItem(key));
};

const clearStoredApiTokens = () => {
  [
    'accessToken',
    'access_token',
    'token',
    'idToken',
    'id_token',
    'jwt',
    'authToken',
    'auth_token',
    'refreshToken',
    'refresh_token',
    'sessionStartedAt',
  ].forEach((key) => localStorage.removeItem(key));
};

const emitSessionExpired = (message) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(API_SESSION_EXPIRED_EVENT, {
      detail: { message: message || 'Session expired. Please login again.' },
    })
  );
};

const shouldEmitSessionExpired = () => AUTH_PROVIDER === 'api';

const handleUnauthorizedSession = (error, { forceFullClear = false } = {}) => {
  if (forceFullClear) {
    clearStoredSession();
  } else {
    clearStoredApiTokens();
  }

  if (shouldEmitSessionExpired()) {
    emitSessionExpired(getErrorMessage(error, 'Session expired. Please login again.'));
  }
};

const getErrorMessage = (error, fallbackMessage = 'Request failed') => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallbackMessage
  );
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.queues)) {
    return payload.queues;
  }

  if (Array.isArray(payload?.routes)) {
    return payload.routes;
  }

  if (Array.isArray(payload?.profiles)) {
    return payload.profiles;
  }

  return [];
};

const extractObject = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (Array.isArray(payload)) {
    return null;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.result && typeof payload.result === 'object') {
    return payload.result;
  }

  if (payload.route && typeof payload.route === 'object') {
    return payload.route;
  }

  if (payload.profile && typeof payload.profile === 'object') {
    return payload.profile;
  }

  return payload;
};

const DEFAULT_ORIGIN_GEOFENCE_CONFIG = {
  label: 'One Ayala Terminal',
  latitude: 14.5527,
  longitude: 121.0244,
  radius: 500,
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeOriginGeofenceCandidate = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  const latitude = toFiniteNumber(candidate?.latitude ?? candidate?.lat);
  const longitude = toFiniteNumber(candidate?.longitude ?? candidate?.lng ?? candidate?.lon ?? candidate?.long);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const parsedRadius = toFiniteNumber(candidate?.radius ?? candidate?.radius_meters ?? candidate?.radiusMeters);
  const radius = Number.isFinite(parsedRadius) && parsedRadius > 0
    ? parsedRadius
    : DEFAULT_ORIGIN_GEOFENCE_CONFIG.radius;

  return {
    label: String(candidate?.label || candidate?.originLabel || candidate?.origin_name || candidate?.name || DEFAULT_ORIGIN_GEOFENCE_CONFIG.label).trim() || DEFAULT_ORIGIN_GEOFENCE_CONFIG.label,
    latitude,
    longitude,
    radius,
    updatedAt: Number(candidate?.updatedAt || candidate?.updated_at || Date.now()),
  };
};

const resolveOriginGeofenceConfig = (payload) => {
  const directObject = normalizeOriginGeofenceCandidate(extractObject(payload));
  if (directObject) {
    return directObject;
  }

  const fromArray = extractArray(payload)
    .map((item) => normalizeOriginGeofenceCandidate(item))
    .find(Boolean);

  return fromArray || null;
};

const REFRESH_ENDPOINTS = ['/profiles/refresh', '/auth/refresh', '/token/refresh'];

const tryRefreshAccessToken = async () => {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken || !API_URL) {
    return '';
  }

  let lastError = null;

  for (const endpoint of REFRESH_ENDPOINTS) {
    try {
      const response = await axios.post(
        buildUrl(endpoint),
        {
          refreshToken,
          refresh_token: refreshToken,
        },
        {
          headers: {
            'x-refresh-token': refreshToken,
            Authorization: `Bearer ${refreshToken}`,
          },
        }
      );

      const raw = response?.data || {};
      const nextAccessToken = String(
        raw?.accessToken ||
        raw?.access_token ||
        raw?.token ||
        raw?.idToken ||
        raw?.id_token ||
        ''
      ).trim();

      const nextRefreshToken = String(raw?.refreshToken || raw?.refresh_token || '').trim();

      if (!nextAccessToken) {
        continue;
      }

      persistAccessToken(nextAccessToken);
      if (nextRefreshToken) {
        persistRefreshToken(nextRefreshToken);
      }

      return nextAccessToken;
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status === 404 || status === 405) {
        continue;
      }

      break;
    }
  }

  if (lastError) {
    console.warn('API token refresh failed:', lastError);
  }

  return '';
};

const requestWithFallback = async ({ method, endpoints, data, params, withAuth = true }) => {
  const endpointList = Array.isArray(endpoints) ? endpoints : [endpoints];
  let lastError = null;
  const normalizedMethod = String(method || '').trim().toLowerCase();
  const isReadMethod = normalizedMethod === 'get' || normalizedMethod === 'head' || normalizedMethod === 'options';
  let hasAttemptedAuthRecovery = false;

  for (let index = 0; index < endpointList.length; index += 1) {
    const endpoint = endpointList[index];

    try {
      const response = await axios({
        method,
        url: buildUrl(endpoint),
        data,
        params,
        headers: withAuth ? getAuthHeaders() : undefined,
      });

      return response;
    } catch (error) {
      lastError = error;
      let activeError = error;
      let status = Number(activeError?.response?.status || 0);

      const isUnauthorized = status === 401 || status === 403;
      if (withAuth && isUnauthorized && !hasAttemptedAuthRecovery) {
        hasAttemptedAuthRecovery = true;

        const refreshedToken = await tryRefreshAccessToken();
        if (refreshedToken) {
          try {
            const retryResponse = await axios({
              method,
              url: buildUrl(endpoint),
              data,
              params,
              headers: getAuthHeaders(),
            });

            return retryResponse;
          } catch (retryError) {
            lastError = retryError;
            activeError = retryError;
            status = Number(activeError?.response?.status || 0);
          }
        } else {
          clearStoredApiTokens();
        }
      }

      if (withAuth && isUnauthorized && index >= endpointList.length - 1) {
        handleUnauthorizedSession(activeError);
      }

      const isRetryableReadStatus = [404, 405, 500, 501, 502, 503, 504].includes(status);
      const shouldTryNext = index < endpointList.length - 1 && (status === 404 || (isReadMethod && (isRetryableReadStatus || !activeError?.response)));

      if (!shouldTryNext) {
        throw activeError;
      }
    }
  }

  throw lastError || new Error('Request failed.');
};

const isRecoverableReadFailure = (error) => {
  if (!error?.response) {
    return true;
  }

  const status = Number(error?.response?.status || 0);
  return [404, 405, 500, 501, 502, 503, 504].includes(status);
};

const getFallbackAttendants = async () => {
  try {
    const firebaseAttendants = await getFirebaseBusAttendants();
    if (firebaseAttendants.length > 0) {
      return firebaseAttendants;
    }
  } catch (error) {
    console.warn('Failed to fetch bus attendants from Firebase, falling back to local data:', error);
  }

  return getLocalAttendants();
};

const resolveProfileFromApi = async (token) => {
  const apiUrl = requireApiUrl();
  const bearerToken = String(token || getStoredToken() || '').trim();

  if (!apiUrl || !bearerToken) {
    return null;
  }

  const endpoints = ['/profiles/me', '/auth/me'];

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(`${apiUrl}${endpoint}`, {
        headers: {
          ...getAuthHeaders(),
          Authorization: `Bearer ${bearerToken}`,
        },
      });

      return response.data?.user || response.data?.profile || response.data || null;
    } catch (error) {
      const status = Number(error?.response?.status || 0);

      if (status === 404) {
        continue;
      }

      if (status === 401 || status === 403) {
        handleUnauthorizedSession(error, { forceFullClear: true });
        return null;
      }

      throw error;
    }
  }

  return null;
};

// --- AUTH FUNCTIONS ---
export const loginAPI = async (usernameOrEmail, password) => {
  const apiUrl = requireApiUrl();
  const identifier = String(usernameOrEmail || '').trim();
  const endpoints = ['/profiles/login', '/auth/login'];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(`${apiUrl}${endpoint}`, {
        username: identifier,
        email: identifier,
        password,
      });

      const raw = response.data || {};
      const accessToken = String(
        raw?.accessToken ||
        raw?.access_token ||
        raw?.token ||
        raw?.idToken ||
        raw?.id_token ||
        ''
      ).trim();

      const refreshToken = String(raw?.refreshToken || raw?.refresh_token || '').trim();
      const profile = await resolveProfileFromApi(accessToken);

      return {
        ...raw,
        accessToken,
        refreshToken,
        user: raw?.user || raw?.profile || profile || null,
        raw,
      };
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      lastError = error;

      if (status === 404) {
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('No supported login endpoint is available on the API server.');
};

export const logoutAPI = async () => {
  const apiUrl = requireApiUrl();
  const endpoints = ['/profiles/logout', '/auth/logout'];
  const token = getStoredToken();
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      return await axios.post(
        `${apiUrl}${endpoint}`,
        {},
        token ? { headers: getAuthHeaders() } : undefined
      );
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      lastError = error;

      if (status === 404) {
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error('No supported logout endpoint is available on the API server.');
};

export const getCurrentUser = async () => {
  const token = getStoredToken();

  if (API_URL && token) {
    const profile = await resolveProfileFromApi(token);
    if (profile) {
      localStorage.setItem('user', JSON.stringify(profile));
      return profile;
    }
  }

  try {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  } catch (error) {
    return null;
  }
};

// --- BUS FUNCTIONS (Add these to fix the Buses page crash) ---
export const fetchBuses = async (params = {}) => {
  if (!API_URL) {
    return normalizeBusList(getBusesData());
  }

  const response = await requestWithFallback({
    method: 'get',
    endpoints: BUS_ENDPOINTS.map((endpoint) => `${endpoint}/`),
    params,
  });

  return normalizeBusList(extractArray(response.data));
};

export const createBus = async (busData) => {
  if (!API_URL) {
    const buses = getBusesData();
    const created = normalizeBusRecord({ ...busData, id: busData?.id || Date.now(), lastUpdated: Date.now() });
    const next = [created, ...buses];
    saveBusesData(next);
    return created;
  }

  const payload = toBusWritePayload(busData);

  const response = await requestWithFallback({
    method: 'post',
    endpoints: BUS_ENDPOINTS.map((endpoint) => `${endpoint}/`),
    data: payload,
  });

  return normalizeBusRecord(extractObject(response.data) || payload);
};

export const updateBus = async (id, busData) => {
  if (!API_URL) {
    const buses = getBusesData();
    const next = buses.map((bus) => (
      String(bus?.id) === String(id)
        ? normalizeBusRecord({ ...bus, ...busData, id: bus.id, lastUpdated: Date.now() })
        : bus
    ));
    saveBusesData(next);
    return next.find((bus) => String(bus?.id) === String(id)) || normalizeBusRecord({ id, ...busData, lastUpdated: Date.now() });
  }

  const payload = toBusWritePayload({ id, ...busData });

  const response = await requestWithFallback({
    method: 'put',
    endpoints: BUS_ENDPOINTS.map((endpoint) => `${endpoint}/${encodeURIComponent(String(id))}`),
    data: payload,
  });

  return normalizeBusRecord(extractObject(response.data) || payload);
};

export const deleteBus = async (id) => {
  if (!API_URL) {
    const buses = getBusesData();
    const next = buses.filter((bus) => String(bus?.id) !== String(id));
    saveBusesData(next);
    return { success: true };
  }

  const response = await requestWithFallback({
    method: 'delete',
    endpoints: BUS_ENDPOINTS.map((endpoint) => `${endpoint}/${encodeURIComponent(String(id))}`),
  });

  return response.data;
};

export const claimBus = async (busId, payload = {}) => {
  const normalizedBusId = String(busId || '').trim();
  if (!normalizedBusId) {
    return { success: false, reason: 'missing-bus-id' };
  }

  const claimPayload = {
    bus_id: normalizedBusId,
    busId: normalizedBusId,
    attendant_id: String(payload?.attendant_id || payload?.attendantId || payload?.profile_id || payload?.profileId || payload?.user_id || payload?.userId || '').trim(),
    profile_id: String(payload?.profile_id || payload?.profileId || payload?.attendant_id || payload?.attendantId || payload?.user_id || payload?.userId || '').trim(),
    user_id: String(payload?.user_id || payload?.userId || payload?.profile_id || payload?.profileId || payload?.attendant_id || payload?.attendantId || '').trim(),
    username: String(payload?.username || '').trim(),
    email: String(payload?.email || '').trim(),
    attendant_name: String(payload?.attendant_name || payload?.attendantName || payload?.full_name || payload?.fullName || '').trim(),
  };

  if (!API_URL) {
    const buses = getBusesData();
    const next = buses.map((bus) => {
      const isTargetBus = String(bus?.id || bus?.bus_id || '').trim() === normalizedBusId;
      if (!isTargetBus) {
        return bus;
      }

      return {
        ...bus,
        attendantId: claimPayload.attendant_id || bus?.attendantId || '',
        attendant_id: claimPayload.attendant_id || bus?.attendant_id || '',
        busAttendant: claimPayload.attendant_name || bus?.busAttendant || '',
        attendant_name: claimPayload.attendant_name || bus?.attendant_name || '',
        lastUpdated: Date.now(),
      };
    });

    saveBusesData(next);
    return { success: true, local: true };
  }

  const response = await requestWithFallback({
    method: 'post',
    endpoints: [
      ...BUS_ENDPOINTS.map((endpoint) => `${endpoint}/${encodeURIComponent(normalizedBusId)}/claim`),
      ...BUS_ENDPOINTS.map((endpoint) => `${endpoint}/attendant/my-bus`),
    ],
    data: claimPayload,
  });

  return extractObject(response.data) || response.data || { success: true };
};

const normalizeMyBusAssignment = (item, fallbackIndex = 0) => {
  const bus = item?.bus && typeof item.bus === 'object' ? item.bus : item;
  const attendant = item?.attendant && typeof item.attendant === 'object'
    ? item.attendant
    : (item?.profile && typeof item.profile === 'object' ? item.profile : item);

  const attendantId = String(
    attendant?.id ||
    attendant?.profile_id ||
    attendant?.user_id ||
    attendant?.uid ||
    item?.attendant_id ||
    item?.profile_id ||
    item?.user_id ||
    ''
  ).trim();

  const email = String(attendant?.email || item?.email || '').trim().toLowerCase();
  const username = String(
    attendant?.username_lower ||
    attendant?.username ||
    item?.username_lower ||
    item?.username ||
    ''
  ).trim().toLowerCase();

  return {
    key: `my-bus-${fallbackIndex + 1}`,
    attendantId,
    email,
    username,
    busId: String(bus?.id || bus?.bus_id || item?.bus_id || item?.busId || '').trim(),
    busNumber: String(bus?.bus_number || bus?.busNumber || bus?.busNo || item?.bus_number || item?.busNumber || '').trim(),
    busPlateNumber: String(bus?.plate_number || bus?.plateNumber || bus?.plateNo || item?.plate_number || item?.plateNumber || '').trim(),
    attendantName: String(
      attendant?.full_name ||
      attendant?.name ||
      `${String(attendant?.first_name || '').trim()} ${String(attendant?.last_name || '').trim()}`.trim() ||
      item?.attendant_name ||
      ''
    ).trim(),
  };
};

export const fetchAttendantMyBusAssignments = async () => {
  if (!API_URL) {
    return [];
  }

  const response = await requestWithFallback({
    method: 'get',
    endpoints: [
      ...BUS_ENDPOINTS.map((endpoint) => `${endpoint}/attendant/my-bus`),
      ...BUS_ENDPOINTS.map((endpoint) => `${endpoint}/attendant/my-bus/`),
    ],
  });

  const payload = response?.data;
  const items = (() => {
    const arrayPayload = extractArray(payload);
    if (Array.isArray(arrayPayload) && arrayPayload.length > 0) {
      return arrayPayload;
    }

    const objectPayload = extractObject(payload);
    if (objectPayload && typeof objectPayload === 'object') {
      return [objectPayload];
    }

    return [];
  })();

  return items
    .map((item, index) => normalizeMyBusAssignment(item, index))
    .filter((assignment) => {
      return Boolean(
        assignment.attendantId ||
        assignment.email ||
        assignment.username ||
        assignment.busId ||
        assignment.busNumber ||
        assignment.busPlateNumber
      );
    });
};

export const fetchQueues = async () => {
  if (!API_URL) {
    return buildLocalQueueItemsFromBuses();
  }

  try {
    const response = await requestWithFallback({
      method: 'get',
      endpoints: ['/queues/', '/queues'],
    });

    return extractArray(response.data);
  } catch (error) {
    if (!isRecoverableReadFailure(error)) {
      throw error;
    }

    console.warn('Queue destination API unavailable or incompatible. Falling back to local route-derived destinations.', error);
    return buildLocalQueueItemsFromBuses();
  }
};

export const fetchQueueDestinations = async () => {
  if (!API_URL) {
    const stored = readLocalJson(LOCAL_DESTINATIONS_KEY, []);
    if (Array.isArray(stored) && stored.length > 0) {
      return stored;
    }

    const derived = buildLocalQueueItemsFromBuses().map((item) => ({
      id: item.id,
      destinationName: item.destinationName,
      destination: item.destination,
      route: `${item.origin} - ${item.destination}`,
      origin: item.origin,
      updatedAt: item.updatedAt,
    }));

    writeLocalJson(LOCAL_DESTINATIONS_KEY, derived);
    return derived;
  }

  const routes = await fetchQueues();
  return routes.map((routeItem, index) => ({
    ...routeItem,
    id: String(routeItem?.id || routeItem?.queue_id || `queue-${index + 1}`),
    destinationName: String(routeItem?.destinationName || routeItem?.destination || routeItem?.name || '').trim(),
  }));
};

export const createQueueDestination = async (payload) => {
  if (!API_URL) {
    const current = readLocalJson(LOCAL_DESTINATIONS_KEY, []);
    const destinationName = String(payload?.destinationName || payload?.destination || '').trim();
    const created = {
      ...payload,
      id: `local-destination-${Date.now()}`,
      destinationName,
      destination: destinationName,
      updatedAt: Date.now(),
    };
    const next = [created, ...(Array.isArray(current) ? current : [])];
    writeLocalJson(LOCAL_DESTINATIONS_KEY, next);
    return created;
  }

  const normalizedBusId = String(payload?.bus_id || payload?.busId || '').trim();

  if (normalizedBusId) {
    const departResponse = await requestWithFallback({
      method: 'post',
      endpoints: BUS_ENDPOINTS.map((endpoint) => `${endpoint}/${encodeURIComponent(normalizedBusId)}/depart`),
      data: payload,
    });

    const departed = extractObject(departResponse.data) || payload;
    return {
      ...departed,
      id: String(departed?.id || departed?.queue_id || departed?.destination_id || `queue-${Date.now()}`),
      destinationName: String(departed?.destinationName || departed?.destination || payload?.destinationName || payload?.destination || '').trim(),
    };
  }

  const response = await requestWithFallback({
    method: 'post',
    endpoints: ['/queues/', '/queues'],
    data: payload,
  });

  const created = extractObject(response.data) || payload;
  return {
    ...created,
    id: String(created?.id || created?.queue_id || `queue-${Date.now()}`),
    destinationName: String(created?.destinationName || created?.destination || payload?.destinationName || payload?.destination || '').trim(),
  };
};

export const fetchRouteGeofences = async () => {
  if (!API_URL) {
    return readLocalJson(LOCAL_ROUTES_KEY, []);
  }

  let response;
  try {
    response = await requestWithFallback({
      method: 'get',
      endpoints: ['/geofence', '/geofence/', '/route-geofences/', '/route-geofences', '/routes/geofences', '/routes/geofences/'],
    });
  } catch (error) {
    if (!isRecoverableReadFailure(error)) {
      throw error;
    }

    console.warn('Route geofence API unavailable or incompatible. Falling back to cached/local route data.', error);
    return readLocalJson(LOCAL_ROUTES_KEY, []);
  }

  return extractArray(response.data).map((routeItem, index) => ({
    ...routeItem,
    id: String(routeItem?.id || routeItem?.geofence_id || `route-${index + 1}`),
    sourceType: routeItem?.sourceType || 'geofence',
  }));
};

export const createRouteGeofence = async (payload) => {
  if (!API_URL) {
    const current = readLocalJson(LOCAL_ROUTES_KEY, []);
    const created = {
      ...payload,
      id: `local-route-${Date.now()}`,
      sourceType: 'geofence',
      updatedAt: Date.now(),
    };
    const next = [created, ...(Array.isArray(current) ? current : [])];
    writeLocalJson(LOCAL_ROUTES_KEY, next);
    return created;
  }

  const response = await requestWithFallback({
    method: 'post',
    endpoints: ['/geofence', '/geofence/', '/route-geofences/', '/route-geofences', '/routes/geofences', '/routes/geofences/'],
    data: payload,
  });

  const created = extractObject(response.data) || payload;
  return {
    ...created,
    id: String(created?.id || created?.geofence_id || `route-${Date.now()}`),
    sourceType: created?.sourceType || 'geofence',
    updatedAt: created?.updatedAt || created?.updated_at || Date.now(),
  };
};

export const updateRouteGeofence = async (id, payload) => {
  if (!API_URL) {
    const current = readLocalJson(LOCAL_ROUTES_KEY, []);
    const next = (Array.isArray(current) ? current : []).map((routeItem) => (
      String(routeItem?.id) === String(id)
        ? { ...routeItem, ...payload, id: routeItem.id, sourceType: 'geofence', updatedAt: Date.now() }
        : routeItem
    ));
    writeLocalJson(LOCAL_ROUTES_KEY, next);
    return next.find((routeItem) => String(routeItem?.id) === String(id)) || {
      id: String(id),
      ...payload,
      sourceType: 'geofence',
      updatedAt: Date.now(),
    };
  }

  const routeId = encodeURIComponent(String(id));
  const response = await requestWithFallback({
    method: 'put',
    endpoints: [`/geofence/${routeId}`, `/route-geofences/${routeId}`, `/routes/geofences/${routeId}`],
    data: payload,
  });

  const updated = extractObject(response.data) || { id, ...payload };
  return {
    ...updated,
    id: String(updated?.id || id),
    sourceType: updated?.sourceType || 'geofence',
    updatedAt: updated?.updatedAt || updated?.updated_at || Date.now(),
  };
};

export const deleteRouteGeofence = async (id) => {
  if (!API_URL) {
    const current = readLocalJson(LOCAL_ROUTES_KEY, []);
    const next = (Array.isArray(current) ? current : []).filter((routeItem) => String(routeItem?.id) !== String(id));
    writeLocalJson(LOCAL_ROUTES_KEY, next);
    return { success: true };
  }

  const routeId = encodeURIComponent(String(id));
  const response = await requestWithFallback({
    method: 'delete',
    endpoints: [`/geofence/${routeId}`, `/route-geofences/${routeId}`, `/routes/geofences/${routeId}`],
  });

  return response.data;
};

export const fetchOriginGeofenceConfig = async () => {
  if (!API_URL) {
    const stored = readLocalJson(LOCAL_ORIGIN_KEY, null);
    if (stored && Number.isFinite(Number(stored?.latitude)) && Number.isFinite(Number(stored?.longitude))) {
      return stored;
    }

    return DEFAULT_ORIGIN_GEOFENCE_CONFIG;
  }

  try {
    const response = await requestWithFallback({
      method: 'get',
      endpoints: ['/geofence', '/geofence/', '/route-geofences/origin-config', '/routes/origin-geofence', '/origin-geofence'],
    });

    const resolvedOrigin = resolveOriginGeofenceConfig(response.data);
    if (resolvedOrigin) {
      writeLocalJson(LOCAL_ORIGIN_KEY, resolvedOrigin);
      return resolvedOrigin;
    }

    const stored = readLocalJson(LOCAL_ORIGIN_KEY, null);
    if (stored && Number.isFinite(Number(stored?.latitude)) && Number.isFinite(Number(stored?.longitude))) {
      return stored;
    }

    return DEFAULT_ORIGIN_GEOFENCE_CONFIG;
  } catch (error) {
    if (!isRecoverableReadFailure(error)) {
      throw error;
    }

    console.warn('Origin geofence API unavailable or incompatible. Falling back to local/default origin config.', error);
    const stored = readLocalJson(LOCAL_ORIGIN_KEY, null);
    if (stored && Number.isFinite(Number(stored?.latitude)) && Number.isFinite(Number(stored?.longitude))) {
      return stored;
    }

    return DEFAULT_ORIGIN_GEOFENCE_CONFIG;
  }
};

export const saveOriginGeofenceConfig = async (payload = {}) => {
  const normalizedPayload = {
    label: String(payload?.label || 'Pinned Origin').trim() || 'Pinned Origin',
    latitude: Number(payload?.latitude),
    longitude: Number(payload?.longitude),
    radius: Number(payload?.radius),
    updatedAt: Date.now(),
  };

  if (!API_URL) {
    writeLocalJson(LOCAL_ORIGIN_KEY, normalizedPayload);
    return normalizedPayload;
  }

  try {
    const response = await requestWithFallback({
      method: 'put',
      endpoints: ['/geofence', '/geofence/', '/route-geofences/origin-config', '/routes/origin-geofence', '/origin-geofence'],
      data: normalizedPayload,
    });

    const saved = extractObject(response.data) || normalizedPayload;
    return {
      ...normalizedPayload,
      ...saved,
      label: String(saved?.label || normalizedPayload.label).trim() || normalizedPayload.label,
      latitude: Number(saved?.latitude ?? normalizedPayload.latitude),
      longitude: Number(saved?.longitude ?? normalizedPayload.longitude),
      radius: Number(saved?.radius ?? normalizedPayload.radius),
      updatedAt: Number(saved?.updatedAt || saved?.updated_at || Date.now()),
    };
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if (status !== 404 && status !== 405) {
      throw error;
    }

    const response = await requestWithFallback({
      method: 'post',
      endpoints: ['/geofence', '/geofence/', '/route-geofences/origin-config', '/routes/origin-geofence', '/origin-geofence'],
      data: normalizedPayload,
    });

    const saved = extractObject(response.data) || normalizedPayload;
    return {
      ...normalizedPayload,
      ...saved,
      label: String(saved?.label || normalizedPayload.label).trim() || normalizedPayload.label,
      latitude: Number(saved?.latitude ?? normalizedPayload.latitude),
      longitude: Number(saved?.longitude ?? normalizedPayload.longitude),
      radius: Number(saved?.radius ?? normalizedPayload.radius),
      updatedAt: Number(saved?.updatedAt || saved?.updated_at || Date.now()),
    };
  }
};

export const fetchBusAttendants = async () => {
  if (!API_URL) {
    return getFallbackAttendants();
  }

  let response;
  try {
    response = await requestWithFallback({
      method: 'get',
      endpoints: ['/profiles/', '/profiles', '/users/', '/users'],
      params: { user_type: 'bus_attendant' },
    });
  } catch (error) {
    if (!isRecoverableReadFailure(error)) {
      throw error;
    }

    console.warn('Bus attendant API unavailable or incompatible. Falling back to Firebase/local data.', error);
    return getFallbackAttendants();
  }

  const profiles = extractArray(response.data);
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return getFallbackAttendants();
  }

  return profiles
    .map((profile, index) => ({
      ...profile,
      id: String(profile?.id || profile?.profile_id || profile?.uid || profile?.user_id || `attendant-${index + 1}`),
    }))
    .filter((profile) => {
      const userType = String(profile?.user_type || profile?.role || profile?.user_role || '').toLowerCase();
      return !userType || userType.includes('attendant');
    });
};

export const createBusAttendant = async (payload) => {
  if (!API_URL) {
    const current = getLocalAttendants();
    const created = {
      ...payload,
      id: `local-attendant-${Date.now()}`,
      user_type: payload?.user_type || 'bus_attendant',
      is_archived: false,
      updatedAt: Date.now(),
    };
    const next = [created, ...current];
    writeLocalJson(LOCAL_ATTENDANTS_KEY, next);
    return created;
  }

  const response = await requestWithFallback({
    method: 'post',
    endpoints: ['/profiles/register', '/profiles/', '/profiles'],
    data: payload,
    withAuth: true,
  });

  const created = extractObject(response.data) || payload;
  return {
    ...created,
    id: String(created?.id || created?.profile_id || created?.uid || created?.user_id || `attendant-${Date.now()}`),
  };
};

export const updateBusAttendant = async (id, payload) => {
  if (!API_URL) {
    const current = getLocalAttendants();
    const next = current.map((attendant) => (
      String(attendant?.id) === String(id)
        ? { ...attendant, ...payload, id: attendant.id, updatedAt: Date.now() }
        : attendant
    ));
    writeLocalJson(LOCAL_ATTENDANTS_KEY, next);
    return next.find((attendant) => String(attendant?.id) === String(id)) || { id: String(id), ...payload, updatedAt: Date.now() };
  }

  const profileId = encodeURIComponent(String(id));
  const response = await requestWithFallback({
    method: 'put',
    endpoints: [`/profiles/${profileId}`, `/profiles/${profileId}/`],
    data: payload,
  });

  const updated = extractObject(response.data) || { id, ...payload };
  return {
    ...updated,
    id: String(updated?.id || id),
  };
};

export const archiveBusAttendant = async (id) => {
  if (!API_URL) {
    const current = getLocalAttendants();
    const next = current.map((attendant) => (
      String(attendant?.id) === String(id)
        ? { ...attendant, is_archived: true, updatedAt: Date.now() }
        : attendant
    ));
    writeLocalJson(LOCAL_ATTENDANTS_KEY, next);
    return next.find((attendant) => String(attendant?.id) === String(id)) || { id: String(id), is_archived: true, updatedAt: Date.now() };
  }

  const profileId = encodeURIComponent(String(id));

  try {
    const response = await requestWithFallback({
      method: 'patch',
      endpoints: [`/profiles/${profileId}/archive`, `/profiles/${profileId}`],
      data: { is_archived: true },
    });

    const updated = extractObject(response.data) || {};
    return { ...updated, id: String(updated?.id || id), is_archived: true };
  } catch {
    const response = await requestWithFallback({
      method: 'put',
      endpoints: [`/profiles/${profileId}`, `/profiles/${profileId}/`],
      data: { is_archived: true },
    });

    const updated = extractObject(response.data) || {};
    return { ...updated, id: String(updated?.id || id), is_archived: true };
  }
};

export const unarchiveBusAttendant = async (id) => {
  if (!API_URL) {
    const current = getLocalAttendants();
    const next = current.map((attendant) => (
      String(attendant?.id) === String(id)
        ? { ...attendant, is_archived: false, updatedAt: Date.now() }
        : attendant
    ));
    writeLocalJson(LOCAL_ATTENDANTS_KEY, next);
    return next.find((attendant) => String(attendant?.id) === String(id)) || { id: String(id), is_archived: false, updatedAt: Date.now() };
  }

  const profileId = encodeURIComponent(String(id));

  try {
    const response = await requestWithFallback({
      method: 'patch',
      endpoints: [`/profiles/${profileId}/unarchive`, `/profiles/${profileId}`],
      data: { is_archived: false },
    });

    const updated = extractObject(response.data) || {};
    return { ...updated, id: String(updated?.id || id), is_archived: false };
  } catch {
    const response = await requestWithFallback({
      method: 'put',
      endpoints: [`/profiles/${profileId}`, `/profiles/${profileId}/`],
      data: { is_archived: false },
    });

    const updated = extractObject(response.data) || {};
    return { ...updated, id: String(updated?.id || id), is_archived: false };
  }
};