import axios from 'axios';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { auth, db, firebaseInitialized } from '../firebase';

const API_URL = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const USE_CREDENTIALS = String(import.meta.env.VITE_API_WITH_CREDENTIALS || '').trim().toLowerCase() === 'true';
const BUS_ENDPOINTS = ['buses', 'busses'];
const QUEUE_ENDPOINTS = ['queue', 'queues'];
const GEOFENCE_ENDPOINTS = ['geofence', 'geofences', 'geofense', 'geofenses'];
const ORIGIN_CONFIG_ENDPOINTS = ['config/geofence', 'config/geofences', 'config/geofense', 'geofence', 'geofences', 'geofense', 'config'];
export const API_SESSION_EXPIRED_EVENT = 'auth:session-expired';
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_STARTED_AT_KEY = 'sessionStartedAt';
let authInterceptorRegistered = false;

const ACCESS_TOKEN_STORAGE_KEYS = [
  'accessToken',
  'access_token',
  'token',
  'idToken',
  'id_token',
  'jwt',
  'authToken',
  'auth_token',
];

if (!API_URL) {
  throw new Error('Missing VITE_API_URL. Set it in your environment before running the app.');
}

const clearApiAuthStorage = () => {
  ACCESS_TOKEN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  localStorage.removeItem(SESSION_STARTED_AT_KEY);
};

const getStoredAccessToken = () => {
  for (const key of ACCESS_TOKEN_STORAGE_KEYS) {
    const token = String(localStorage.getItem(key) || '').trim();
    if (token) {
      return token;
    }
  }

  return '';
};

const persistAccessToken = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized) {
    ACCESS_TOKEN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    return;
  }

  localStorage.setItem('accessToken', normalized);
  localStorage.setItem('access_token', normalized);
};

const parseJwtPayload = (token) => {
  const parts = String(token || '').split('.');

  if (parts.length < 2) {
    return null;
  }

  try {
    const payloadSegment = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const normalizedPayload = payloadSegment.padEnd(payloadSegment.length + ((4 - payloadSegment.length % 4) % 4), '=');
    const decoded = globalThis?.atob ? globalThis.atob(normalizedPayload) : null;

    if (!decoded) {
      return null;
    }

    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const isTokenExpired = (token) => {
  const payload = parseJwtPayload(token);
  const exp = Number(payload?.exp);

  if (!Number.isFinite(exp)) {
    return false;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  return exp <= nowInSeconds;
};

const getSessionStartedAt = (token) => {
  const startedAtRaw = localStorage.getItem(SESSION_STARTED_AT_KEY);
  const startedAt = Number(startedAtRaw);

  if (Number.isFinite(startedAt) && startedAt > 0) {
    return startedAt;
  }

  const payload = parseJwtPayload(token);
  const issuedAtSeconds = Number(payload?.iat);
  if (Number.isFinite(issuedAtSeconds) && issuedAtSeconds > 0) {
    return issuedAtSeconds * 1000;
  }

  return null;
};

const ensureSessionStartedAt = (token) => {
  const existing = getSessionStartedAt(token);
  if (existing) {
    localStorage.setItem(SESSION_STARTED_AT_KEY, String(existing));
    return existing;
  }

  const now = Date.now();
  localStorage.setItem(SESSION_STARTED_AT_KEY, String(now));
  return now;
};

const isMaxSessionAgeExceeded = (token) => {
  const startedAt = ensureSessionStartedAt(token);
  return Date.now() - startedAt > MAX_SESSION_AGE_MS;
};

const shouldIgnoreSessionExpiredSignal = (config) => {
  const url = String(config?.url || '');
  return url.includes('/auth/login') || url.includes('/profiles/login');
};

const notifySessionExpired = (error) => {
  if (typeof window === 'undefined') {
    return;
  }

  const message = error?.response?.data?.message || error?.response?.data?.detail || 'Session expired. Please login again.';

  window.dispatchEvent(
    new CustomEvent(API_SESSION_EXPIRED_EVENT, {
      detail: { message },
    })
  );
};

if (!authInterceptorRegistered) {
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const statusCode = error?.response?.status;
      const hasAuthorizationHeader = Boolean(
        error?.config?.headers?.Authorization ||
        error?.config?.headers?.authorization ||
        getStoredAccessToken()
      );

      if (statusCode === 401 && hasAuthorizationHeader && !shouldIgnoreSessionExpiredSignal(error?.config)) {
        clearApiAuthStorage();
        notifySessionExpired(error);
      }

      return Promise.reject(error);
    }
  );

  authInterceptorRegistered = true;
}

const getAuthHeaders = () => {
  const accessToken = getStoredAccessToken();

  if (!accessToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    authorization: `Bearer ${accessToken}`,
    'x-access-token': accessToken,
    token: accessToken,
  };
};

const getFirebaseAccessToken = async () => {
  if (!firebaseInitialized || !auth?.currentUser) {
    return '';
  }

  try {
    const firebaseToken = await auth.currentUser.getIdToken();
    return String(firebaseToken || '').trim();
  } catch {
    return '';
  }
};

const toAuthHeaderSet = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return {};
  }

  return {
    Authorization: `Bearer ${normalized}`,
    authorization: `Bearer ${normalized}`,
    'x-access-token': normalized,
    token: normalized,
    'x-firebase-token': normalized,
  };
};

const getMutationAuthHeaderCandidates = async () => {
  const candidates = [];
  const seenTokens = new Set();

  const addTokenCandidate = (token) => {
    const normalized = String(token || '').trim();
    if (!normalized || seenTokens.has(normalized)) {
      return;
    }

    seenTokens.add(normalized);
    candidates.push(toAuthHeaderSet(normalized));
  };

  addTokenCandidate(getStoredAccessToken());
  addTokenCandidate(await getFirebaseAccessToken());

  if (candidates.length === 0) {
    candidates.push({});
  }

  return candidates;
};

const getFirstDefinedValue = (source, keys, fallback = '') => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return fallback;
};

const extractProfileObject = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.profile && typeof payload.profile === 'object') {
    return payload.profile;
  }

  if (payload.user && typeof payload.user === 'object') {
    return payload.user;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    const nested = extractProfileObject(payload.data);
    if (nested) {
      return nested;
    }
  }

  if (
    payload.id !== undefined ||
    payload._id !== undefined ||
    payload.uid !== undefined ||
    payload.user_id !== undefined ||
    payload.username !== undefined ||
    payload.email !== undefined ||
    payload.user_type !== undefined ||
    payload.role !== undefined
  ) {
    return payload;
  }

  return null;
};

const normalizeAuthenticatedUser = (profile) => {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const firstName = String(getFirstDefinedValue(profile, ['first_name', 'firstName', 'given_name'], '')).trim();
  const lastName = String(getFirstDefinedValue(profile, ['last_name', 'lastName', 'family_name'], '')).trim();
  const combinedName = `${firstName} ${lastName}`.trim();
  const name = String(
    getFirstDefinedValue(
      profile,
      ['name', 'full_name', 'fullName', 'display_name', 'username', 'email'],
      combinedName || 'User'
    )
  ).trim() || 'User';
  const role = String(
    getFirstDefinedValue(
      profile,
      ['role', 'user_role', 'userType', 'user_type', 'type', 'account_type', 'designation'],
      'User'
    )
  ).trim() || 'User';

  return {
    ...profile,
    id: String(getFirstDefinedValue(profile, ['id', '_id', 'uid', 'user_id'], profile.id || '')),
    name,
    role,
  };
};

const getUserIdFromToken = (token) => {
  const payload = parseJwtPayload(token);
  return String(
    getFirstDefinedValue(
      payload,
      ['uid', 'user_id', 'sub', 'id'],
      ''
    ) || ''
  ).trim();
};

const hasDisplayProfileFields = (profile) => {
  if (!profile || typeof profile !== 'object') {
    return false;
  }

  const firstName = String(profile.first_name || profile.firstName || '').trim();
  const lastName = String(profile.last_name || profile.lastName || '').trim();
  const userType = String(profile.user_type || profile.userType || profile.role || '').trim();

  return !!(firstName && lastName && userType);
};

const tryHydrateProfileFromProfilesApi = async (profile, token) => {
  const normalized = normalizeAuthenticatedUser(profile);

  if (hasDisplayProfileFields(normalized)) {
    return normalized;
  }

  try {
    const response = await axios.get(`${API_URL}/profiles/`, {
      headers: getAuthHeaders(),
    });

    const rawProfiles = extractProfileArray(response?.data);
    if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
      return normalized;
    }

    const tokenPayload = parseJwtPayload(token) || {};
    const baseCandidates = [
      String(normalized?.id || '').trim(),
      String(normalized?.uid || '').trim(),
      String(normalized?.user_id || '').trim(),
      String(normalized?.name || '').trim(),
      String(normalized?.username || '').trim(),
      String(normalized?.username_lower || '').trim(),
      String(normalized?.email || '').trim(),
      String(tokenPayload?.sub || '').trim(),
      String(tokenPayload?.uid || '').trim(),
      String(tokenPayload?.user_id || '').trim(),
      String(tokenPayload?.name || '').trim(),
      String(tokenPayload?.username || '').trim(),
      String(tokenPayload?.preferred_username || '').trim(),
      String(tokenPayload?.email || '').trim(),
    ].filter(Boolean);
    const emailLocalPartCandidates = baseCandidates
      .filter((value) => value.includes('@'))
      .map((value) => value.split('@')[0]?.trim())
      .filter(Boolean);
    const candidates = [...new Set([...baseCandidates, ...emailLocalPartCandidates].map((value) => value.toLowerCase()))];

    if (candidates.length === 0) {
      return normalized;
    }

    const matchedRawProfile = rawProfiles.find((item) => {
      const source = extractProfileObject(item) || item;
      const values = [
        String(source?.id || '').trim(),
        String(source?._id || '').trim(),
        String(source?.uid || '').trim(),
        String(source?.user_id || '').trim(),
        String(source?.name || '').trim(),
        String(source?.username || '').trim(),
        String(source?.username_lower || '').trim(),
        String(source?.email || '').trim(),
        String(source?.email_lower || '').trim(),
      ].filter(Boolean).map((value) => value.toLowerCase());

      return values.some((value) => candidates.includes(value));
    });

    if (!matchedRawProfile) {
      return normalized;
    }

    return normalizeAuthenticatedUser({
      ...normalized,
      ...matchedRawProfile,
    });
  } catch {
    return normalized;
  }
};

const tryHydrateProfileFromFirestore = async (profile, token) => {
  const normalized = normalizeAuthenticatedUser(profile);

  if (hasDisplayProfileFields(normalized)) {
    return normalized;
  }

  if (!firebaseInitialized || !db) {
    return normalized;
  }

  const docId = String(
    getFirstDefinedValue(
      normalized,
      ['uid', 'user_id', 'id', '_id'],
      getUserIdFromToken(token)
    ) || ''
  ).trim();

  if (!docId) {
    return normalized;
  }

  try {
    const profileRef = doc(db, 'profiles', docId);
    const profileSnap = await getDoc(profileRef);

    if (profileSnap.exists()) {
      const firestoreProfile = profileSnap.data() || {};
      return normalizeAuthenticatedUser({
        ...normalized,
        ...firestoreProfile,
        uid: normalized?.uid || normalized?.id || docId,
        user_id: normalized?.user_id || docId,
        id: normalized?.id || docId,
      });
    }
  } catch {
    // Continue to query-based fallback below.
  }

  const tokenPayload = parseJwtPayload(token) || {};
  const rawCandidates = [
    normalized?.username,
    normalized?.username_lower,
    normalized?.email,
    tokenPayload?.preferred_username,
    tokenPayload?.username,
    tokenPayload?.email,
    tokenPayload?.sub,
  ];
  const candidateValues = [...new Set(rawCandidates.map((value) => String(value || '').trim()).filter(Boolean))];

  if (candidateValues.length === 0) {
    return normalized;
  }

  const profilesRef = collection(db, 'profiles');

  for (const candidate of candidateValues) {
    const lowered = candidate.toLowerCase();
    const strategies = [
      query(profilesRef, where('username', '==', candidate), limit(1)),
      query(profilesRef, where('username_lower', '==', lowered), limit(1)),
      query(profilesRef, where('email', '==', candidate), limit(1)),
      query(profilesRef, where('email_lower', '==', lowered), limit(1)),
    ];

    for (const strategy of strategies) {
      try {
        const snap = await getDocs(strategy);
        if (snap.empty) {
          continue;
        }

        const matchedDoc = snap.docs[0];
        const firestoreProfile = matchedDoc.data() || {};
        return normalizeAuthenticatedUser({
          ...normalized,
          ...firestoreProfile,
          uid: normalized?.uid || normalized?.id || matchedDoc.id,
          user_id: normalized?.user_id || matchedDoc.id,
          id: normalized?.id || matchedDoc.id,
        });
      } catch {
        // Try next strategy/candidate.
      }
    }
  }

  return normalized;
};

const mapApiStatusToUi = (rawStatus) => {
  const normalized = String(rawStatus || 'Inactive').trim().toLowerCase();

  if (normalized === 'available') {
    return 'Available';
  }

  if (normalized === 'active') {
    return 'Active';
  }

  if (normalized === 'in_transit' || normalized === 'intransit' || normalized === 'in transit') {
    return 'In Transit';
  }

  if (normalized === 'arrived') {
    return 'Arrived';
  }

  if (normalized === 'maintenance') {
    return 'Maintenance';
  }

  if (normalized === 'archived' || normalized === 'offline') {
    return 'Offline';
  }

  return 'Offline';
};

const mapUiStatusToApi = (rawStatus) => {
  const normalized = String(rawStatus || '').trim().toLowerCase();

  if (normalized === 'active' || normalized === 'available' || normalized === 'offline') {
    return normalized;
  }

  if (normalized === 'in transit' || normalized === 'in_transit' || normalized === 'intransit' || normalized === 'arrived') {
    return 'active';
  }

  if (normalized === 'inactive' || normalized === 'maintenance' || normalized === 'archived') {
    return 'offline';
  }

  return 'available';
};

const resolveAlternateInTransitStatus = (rawStatus) => {
  const normalized = String(rawStatus || '').trim().toLowerCase();

  if (normalized === 'in_transit') {
    return 'intransit';
  }

  if (normalized === 'intransit') {
    return 'in_transit';
  }

  return '';
};

const shouldRetryBusStatusAlias = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  return statusCode === 400 || statusCode === 422;
};

const requestBusWithStatusAliasFallback = async (requestBuilder, payload) => {
  try {
    return await requestBuilder(payload);
  } catch (error) {
    if (!shouldRetryBusStatusAlias(error)) {
      throw error;
    }

    const alternateStatus = resolveAlternateInTransitStatus(payload?.status);
    if (!alternateStatus) {
      throw error;
    }

    const fallbackPayload = {
      ...payload,
      status: alternateStatus,
    };

    return requestBuilder(fallbackPayload);
  }
};

const splitRoute = (routeValue) => {
  const routeText = String(routeValue || '').trim();
  if (!routeText) {
    return { origin: '', destination: '' };
  }

  const parts = routeText.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { origin: parts[0] || '', destination: '' };
  }

  return {
    origin: parts[0],
    destination: parts.slice(1).join(' - '),
  };
};

const normalizeTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    if (Number.isFinite(millis)) {
      return millis;
    }
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) {
      return parsedDate;
    }
  }

  return Date.now();
};

const normalizeBus = (bus, index) => {
  const normalizedCapacity = Number(getFirstDefinedValue(bus, ['capacity', 'seat_capacity', 'max_capacity'], 0));
  const normalizedLastUpdated = normalizeTimestamp(
    getFirstDefinedValue(
      bus,
      ['updated_at', 'arrived_at', 'last_updated', 'lastUpdated', 'updatedAt', 'created_at', 'createdAt'],
      Date.now()
    )
  );
  const origin = String(getFirstDefinedValue(bus, ['origin', 'route_origin', 'start_point'], '')).trim();
  const destination = String(getFirstDefinedValue(bus, ['destination', 'registered_destination', 'registeredDestination'], '')).trim();

  let normalizedRoute = String(getFirstDefinedValue(bus, ['route', 'route_name'], 'N/A')).trim();
  if (origin && destination) {
    normalizedRoute = `${origin} - ${destination}`;
  } else if (origin) {
    normalizedRoute = origin;
  } else if (destination) {
    normalizedRoute = destination;
  }

  return {
    id: getFirstDefinedValue(bus, ['id', 'bus_id', '_id'], index + 1),
    busNumber: String(getFirstDefinedValue(bus, ['busNumber', 'bus_number', 'busNo', 'code'], 'N/A')),
    route: normalizedRoute,
    busCompany: String(getFirstDefinedValue(bus, ['bus_name', 'busCompany', 'bus_company', 'company', 'operator'], 'N/A')),
    status: mapApiStatusToUi(getFirstDefinedValue(bus, ['status', 'bus_status'], 'Inactive')),
    plateNumber: String(getFirstDefinedValue(bus, ['plateNumber', 'plate_number', 'plateNo'], 'N/A')),
    capacity: Number.isFinite(normalizedCapacity) ? normalizedCapacity : 0,
    busAttendant: String(getFirstDefinedValue(bus, ['attendant_name', 'busAttendant', 'bus_attendant'], 'N/A')),
    attendantId: String(getFirstDefinedValue(bus, ['attendantId', 'attendant_id'], '')),
    busCompanyEmail: String(getFirstDefinedValue(bus, ['busCompanyEmail', 'company_email', 'email'], 'N/A')),
    busCompanyContact: String(getFirstDefinedValue(bus, ['busCompanyContact', 'company_contact', 'contact_number'], 'N/A')),
    registeredDestination: String(getFirstDefinedValue(bus, ['destination', 'registeredDestination', 'registered_destination'], 'N/A')),
    busPhoto: getFirstDefinedValue(bus, ['busPhoto', 'bus_photo', 'photo_url'], null),
    lastUpdated: normalizedLastUpdated,
  };
};

const extractBusArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.buses)) {
    return payload.buses;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const extractSingleBus = (payload) => {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload[0] || null;
  }

  if (payload.bus && typeof payload.bus === 'object') {
    return payload.bus;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }

  return payload;
};

const normalizeProfile = (profile, index) => {
  const profileId = getFirstDefinedValue(profile, ['id', 'profile_id', 'uid', 'user_id', '_id'], index + 1);
  const firstName = String(getFirstDefinedValue(profile, ['first_name', 'firstName', 'given_name'], '')).trim();
  const lastName = String(getFirstDefinedValue(profile, ['last_name', 'lastName', 'family_name'], '')).trim();
  const username = String(getFirstDefinedValue(profile, ['username', 'user_name', 'handle'], '')).trim();
  const email = String(getFirstDefinedValue(profile, ['email', 'mail'], '')).trim();
  const combinedName = `${firstName} ${lastName}`.trim();
  const fullName = String(getFirstDefinedValue(profile, ['full_name', 'fullName', 'name', 'display_name'], combinedName)).trim();
  const userType = String(getFirstDefinedValue(profile, ['user_type', 'userType', 'type', 'account_type', 'role', 'user_role', 'designation'], '')).trim();
  const role = String(getFirstDefinedValue(profile, ['role', 'user_role', 'userType', 'user_type', 'type', 'account_type', 'designation'], userType)).trim();
  const isPrivileged = Boolean(getFirstDefinedValue(profile, ['is_privileged', 'isPrivileged'], false));
  const inQueue = Boolean(getFirstDefinedValue(profile, ['in_queue', 'inQueue'], false));
  const assignedBusId = String(getFirstDefinedValue(profile, ['assigned_bus_id', 'bus_id', 'busId', 'assignedBusId'], '')).trim();
  const isArchived = Boolean(getFirstDefinedValue(profile, ['is_archived', 'isArchived', 'archived', 'is_deleted'], false));
  const updatedAt = normalizeTimestamp(getFirstDefinedValue(profile, ['updated_at', 'updatedAt', 'last_updated', 'lastUpdated', 'created_at', 'createdAt'], Date.now()));
  const createdAt = normalizeTimestamp(getFirstDefinedValue(profile, ['created_at', 'createdAt', 'registered_at', 'registeredAt', 'updated_at', 'updatedAt'], Date.now()));

  return {
    id: String(profileId),
    first_name: firstName,
    last_name: lastName,
    username,
    email,
    user_type: userType,
    is_privileged: isPrivileged,
    in_queue: inQueue,
    fullName: fullName || `Profile ${profileId}`,
    role,
    assignedBusId,
    is_archived: isArchived,
    updatedAt,
    createdAt,
    raw: profile,
  };
};

const extractProfileArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.profiles)) {
    return payload.profiles;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const normalizeQueueRoute = (queueItem, index) => {
  const originRaw = String(getFirstDefinedValue(queueItem, ['origin', 'route_origin', 'start_point'], '')).trim();
  const destinationRaw = String(
    getFirstDefinedValue(
      queueItem,
      ['destination', 'route_destination', 'end_point', 'registered_destination', 'registeredDestination'],
      ''
    )
  ).trim();
  const routeFromPayload = String(getFirstDefinedValue(queueItem, ['route', 'route_name'], '')).trim();
  const splitFromRoute = splitRoute(routeFromPayload);
  const origin = originRaw || splitFromRoute.origin;
  const destination = destinationRaw || splitFromRoute.destination;
  const route = origin && destination
    ? `${origin} - ${destination}`
    : routeFromPayload || origin || destination;

  return {
    id: String(getFirstDefinedValue(queueItem, ['id', 'queue_id', '_id'], index + 1)),
    origin,
    destination,
    route,
    raw: queueItem,
  };
};

const normalizeQueueDestination = (queueItem, index) => {
  const normalizedRoute = normalizeQueueRoute(queueItem, index);
  const destinationName = String(
    getFirstDefinedValue(
      queueItem,
      ['destination_name', 'destinationName', 'destination', 'name', 'title', 'route_name', 'route'],
      normalizedRoute.destination || normalizedRoute.route || `Destination ${index + 1}`
    )
  ).trim();

  return {
    id: String(getFirstDefinedValue(queueItem, ['id', 'queue_id', '_id'], index + 1)),
    destinationName,
    route: normalizedRoute.route,
    origin: normalizedRoute.origin,
    destination: normalizedRoute.destination,
    raw: queueItem,
  };
};

const normalizeGeofenceRoute = (geofenceItem, index) => {
  const latitude = Number(getFirstDefinedValue(geofenceItem, ['latitude', 'lat', 'origin_lat', 'originLat', 'center_lat', 'centerLat'], 0));
  const longitude = Number(getFirstDefinedValue(geofenceItem, ['longitude', 'lng', 'lon', 'origin_lng', 'originLng', 'center_lng', 'centerLng'], 0));
  const radius = Number(getFirstDefinedValue(geofenceItem, ['radius', 'radius_m', 'radiusMeters'], 0));
  const destinationName = String(
    getFirstDefinedValue(
      geofenceItem,
      ['destination_name', 'destinationName', 'destination', 'queue_name', 'queueName', 'route_name'],
      ''
    )
  ).trim();

  return {
    id: String(getFirstDefinedValue(geofenceItem, ['id', 'geofence_id', '_id'], index + 1)),
    latitude: Number.isFinite(latitude) ? latitude : 0,
    longitude: Number.isFinite(longitude) ? longitude : 0,
    radius: Number.isFinite(radius) ? radius : 0,
    queueId: String(getFirstDefinedValue(geofenceItem, ['queue_id', 'queueId', 'destination_id', 'destinationId'], '')).trim(),
    destinationName: destinationName || 'N/A',
    updatedAt: normalizeTimestamp(
      getFirstDefinedValue(
        geofenceItem,
        ['updated_at', 'updatedAt', 'created_at', 'createdAt'],
        Date.now()
      )
    ),
    raw: geofenceItem,
  };
};

const normalizeOriginGeofenceConfig = (payload) => {
  const pickOriginCandidate = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4) {
      return null;
    }

    const latitude = Number(getFirstDefinedValue(value, ['latitude', 'lat', 'origin_lat', 'originLat', 'center_lat', 'centerLat'], NaN));
    const longitude = Number(getFirstDefinedValue(value, ['longitude', 'lng', 'lon', 'origin_lng', 'originLng', 'center_lng', 'centerLng'], NaN));
    const radius = Number(getFirstDefinedValue(value, ['radius', 'radius_m', 'radiusMeters', 'radius_meters'], NaN));

    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(radius)) {
      return value;
    }

    const nestedCandidates = [
      value.geofence,
      value.config,
      value.data,
      value.item,
      value.settings,
      value.origin,
    ];

    for (const nestedValue of nestedCandidates) {
      const found = pickOriginCandidate(nestedValue, depth + 1);
      if (found) {
        return found;
      }
    }

    return null;
  };

  const source = pickOriginCandidate(payload);

  if (!source || typeof source !== 'object') {
    return null;
  }

  const latitude = Number(getFirstDefinedValue(source, ['latitude', 'lat', 'origin_lat', 'originLat', 'center_lat', 'centerLat'], NaN));
  const longitude = Number(getFirstDefinedValue(source, ['longitude', 'lng', 'lon', 'origin_lng', 'originLng', 'center_lng', 'centerLng'], NaN));
  const radius = Number(getFirstDefinedValue(source, ['radius', 'radius_m', 'radiusMeters', 'radius_meters'], NaN));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius)) {
    return null;
  }

  const label = String(
    getFirstDefinedValue(
      source,
      ['label', 'name', 'location_name', 'locationName', 'geofence_name', 'geofenceName', 'title'],
      'Pinned Origin'
    )
  ).trim() || 'Pinned Origin';

  return {
    label,
    latitude,
    longitude,
    radius,
    updatedAt: normalizeTimestamp(
      getFirstDefinedValue(
        source,
        ['updated_at', 'updatedAt', 'created_at', 'createdAt'],
        Date.now()
      )
    ),
    raw: source,
  };
};

const extractQueueArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.queues)) {
    return payload.queues;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
};

const shouldFallbackEndpoint = (error) => {
  const statusCode = error?.response?.status;
  return statusCode === 404;
};

const requestWithEndpointFallback = async (endpoints, requestBuilder) => {
  let lastError = null;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];

    try {
      return await requestBuilder(endpoint);
    } catch (error) {
      lastError = error;
      const isLastEndpoint = index === endpoints.length - 1;

      if (isLastEndpoint || !shouldFallbackEndpoint(error)) {
        throw error;
      }
    }
  }

  throw lastError;
};

const requestWithBusEndpointFallback = async (requestBuilder) => {
  return requestWithEndpointFallback(BUS_ENDPOINTS, requestBuilder);
};

const requestWithQueueEndpointFallback = async (requestBuilder) => {
  return requestWithEndpointFallback(QUEUE_ENDPOINTS, requestBuilder);
};

const requestWithGeofenceEndpointFallback = async (requestBuilder) => {
  return requestWithEndpointFallback(GEOFENCE_ENDPOINTS, requestBuilder);
};

const requestMyProfile = async () => {
  return axios.get(`${API_URL}/profiles/me`, {
    headers: getAuthHeaders(),
  });
};

const mapBusToApiPayload = (busData = {}, options = { partial: false }) => {
  const payload = {};
  const { partial } = options;
  const routeParts = splitRoute(getFirstDefinedValue(busData, ['route', 'route_name'], ''));

  const assignMappedValue = (targetKey, sourceKeys, transform = (value) => value) => {
    for (const sourceKey of sourceKeys) {
      if (Object.prototype.hasOwnProperty.call(busData, sourceKey) && busData[sourceKey] !== undefined) {
        payload[targetKey] = transform(busData[sourceKey]);
        return;
      }
    }

    if (!partial) {
      payload[targetKey] = transform('');
    }
  };

  assignMappedValue('bus_number', ['bus_number', 'busNumber']);
  assignMappedValue('bus_name', ['bus_name', 'busName', 'operator', 'busCompany'], (value) => String(value || '').trim());
  assignMappedValue('plate_number', ['plate_number', 'plateNumber']);
  assignMappedValue('capacity', ['capacity', 'seat_capacity', 'max_capacity'], (value) => Number(value || 0));
  assignMappedValue('priority_seat', ['priority_seat', 'prioritySeat'], (value) => Number(value || 0));
  assignMappedValue('status', ['status', 'bus_status'], (value) => mapUiStatusToApi(value));
  assignMappedValue('origin', ['origin', 'route_origin'], (value) => String(value || '').trim());
  assignMappedValue('destination', ['destination', 'registeredDestination', 'route_destination'], (value) => String(value || '').trim());
  assignMappedValue('attendant_name', ['attendant_name', 'busAttendant', 'bus_attendant', 'attendantName'], (value) => String(value || '').trim());
  assignMappedValue('attendant_id', ['attendant_id', 'attendantId'], (value) => String(value || '').trim());
  assignMappedValue('company_email', ['company_email', 'busCompanyEmail', 'email']);
  assignMappedValue('company_contact', ['company_contact', 'busCompanyContact', 'contact_number']);

  if (!partial) {
    if (!payload.bus_name || !String(payload.bus_name).trim()) {
      payload.bus_name = payload.bus_number || 'Bus';
    }

    if ((payload.priority_seat === '' || payload.priority_seat === undefined || Number.isNaN(payload.priority_seat))) {
      payload.priority_seat = 5;
    }

    if ((!payload.origin || !String(payload.origin).trim()) && routeParts.origin) {
      payload.origin = routeParts.origin;
    }

    if ((!payload.destination || !String(payload.destination).trim())) {
      payload.destination = getFirstDefinedValue(
        busData,
        ['registeredDestination', 'destination'],
        routeParts.destination
      ) || routeParts.destination;
    }
  }

  return payload;
};

// --- AUTH FUNCTIONS ---
export const loginAPI = async (usernameOrEmail, password) => {
  const response = await axios.post(`${API_URL}/profiles/login`, {
    username: usernameOrEmail,
    password,
  }, {
    withCredentials: USE_CREDENTIALS,
  });

  const rawPayload = response.data || {};
  const responseData =
    rawPayload?.data && typeof rawPayload.data === 'object' && !Array.isArray(rawPayload.data)
      ? rawPayload.data
      : rawPayload;
  const extractTokenFromPayload = (value, depth = 0) => {
    if (!value || depth > 3) {
      return '';
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.split('.').length >= 3 || trimmed.toLowerCase().startsWith('bearer ')) {
        return trimmed.replace(/^bearer\s+/i, '');
      }

      return '';
    }

    if (typeof value !== 'object') {
      return '';
    }

    const direct = String(
      getFirstDefinedValue(
        value,
        ['access_token', 'accessToken', 'token', 'id_token', 'idToken', 'jwt', 'auth_token', 'authToken', 'authorization', 'access'],
        ''
      ) || ''
    ).trim();

    if (direct) {
      return direct.replace(/^bearer\s+/i, '');
    }

    const nestedCandidates = [
      value.data,
      value.tokens,
      value.auth,
      value.session,
      value.result,
      value.profile,
      value.user,
    ];

    for (const nested of nestedCandidates) {
      const token = extractTokenFromPayload(nested, depth + 1);
      if (token) {
        return token;
      }
    }

    return '';
  };

  const accessToken = String(
    getFirstDefinedValue(
      responseData,
      ['access_token', 'accessToken', 'token', 'id_token', 'idToken', 'jwt', 'auth_token', 'authToken', 'authorization', 'access'],
      getFirstDefinedValue(rawPayload, ['access_token', 'accessToken', 'token', 'id_token', 'idToken', 'jwt', 'auth_token', 'authToken', 'authorization', 'access'], '')
    ) || extractTokenFromPayload(responseData) || extractTokenFromPayload(rawPayload)
  ).trim().replace(/^bearer\s+/i, '');
  const refreshToken = String(
    getFirstDefinedValue(
      responseData,
      ['refresh_token', 'refreshToken'],
      getFirstDefinedValue(rawPayload, ['refresh_token', 'refreshToken'], '')
    ) || ''
  );
  const user = normalizeAuthenticatedUser(extractProfileObject(responseData) || extractProfileObject(rawPayload));

  return {
    accessToken,
    refreshToken,
    user,
    raw: responseData,
  };
};

export const logoutAPI = async () => {
  return axios.post(`${API_URL}/auth/logout`);
};

export const getCurrentUser = async () => {
  const accessToken = getStoredAccessToken();
  const savedUserRaw = localStorage.getItem('user');

  const getSavedUser = () => {
    if (!savedUserRaw) {
      return null;
    }

    try {
      return normalizeAuthenticatedUser(JSON.parse(savedUserRaw));
    } catch {
      return null;
    }
  };

  if (!accessToken) {
    const savedUser = getSavedUser();
    return savedUser || null;
  }

  if (isMaxSessionAgeExceeded(accessToken)) {
    clearApiAuthStorage();
    return null;
  }

  if (isTokenExpired(accessToken)) {
    ACCESS_TOKEN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem(SESSION_STARTED_AT_KEY);
    const savedUser = getSavedUser();
    return savedUser || null;
  }

  try {
    const response = await requestMyProfile();
    const extractedProfile = extractProfileObject(response?.data);
    let profile = normalizeAuthenticatedUser(extractedProfile);

    if (!hasDisplayProfileFields(profile)) {
      profile = await tryHydrateProfileFromProfilesApi(profile, accessToken);
    }

    if (!hasDisplayProfileFields(profile)) {
      profile = await tryHydrateProfileFromFirestore(profile, accessToken);
    }

    if (profile) {
      localStorage.setItem('user', JSON.stringify(profile));
      return profile;
    }

    return getSavedUser();
  } catch {
    const savedUser = getSavedUser();
    if (savedUser) {
      return savedUser;
    }

    clearApiAuthStorage();
    return null;
  }
};

export const fetchProfiles = async (params = {}) => {
  const fetchProfilesFromFirestore = async () => {
    if (!firebaseInitialized || !db) {
      return null;
    }

    const snapshot = await getDocs(collection(db, 'profiles'));
    return snapshot.docs.map((docItem, index) => {
      const data = docItem.data() || {};
      return normalizeProfile({ id: docItem.id, ...data }, index);
    });
  };

  try {
    const response = await axios.get(`${API_URL}/profiles/`, {
      params,
      headers: getAuthHeaders(),
    });

    const rawProfiles = extractProfileArray(response.data);
    return rawProfiles.map((profile, index) => normalizeProfile(profile, index));
  } catch (error) {
    if (error?.response?.status === 405) {
      try {
        const fallbackResponse = await axios.post(`${API_URL}/profiles/`, params, {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
        });

        const rawProfiles = extractProfileArray(fallbackResponse.data);
        return rawProfiles.map((profile, index) => normalizeProfile(profile, index));
      } catch (postError) {
        const firestoreProfiles = await fetchProfilesFromFirestore();
        if (firestoreProfiles) {
          return firestoreProfiles;
        }

        throw postError;
      }
    }

    if (error?.response?.status === 401 || error?.response?.status === 403) {
      const firestoreProfiles = await fetchProfilesFromFirestore();
      if (firestoreProfiles) {
        return firestoreProfiles;
      }
    }

    throw error;
  }
};

export const fetchBusAttendants = async (params = {}) => {
  const profiles = await fetchProfiles(params);

  return profiles.filter((profile) => {
    const typeValue = String(profile.user_type || profile.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return typeValue === 'bus_attendant';
  });
};

const mapBusAttendantPayload = (attendantData = {}, options = { partial: false }) => {
  const payload = {};
  const { partial } = options;

  const normalizeBirthdate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return `${raw}T00:00:00.000Z`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }

    return parsed.toISOString();
  };

  const assignMappedValue = (targetKey, sourceKeys, transform = (value) => value) => {
    for (const sourceKey of sourceKeys) {
      if (Object.prototype.hasOwnProperty.call(attendantData, sourceKey) && attendantData[sourceKey] !== undefined) {
        payload[targetKey] = transform(attendantData[sourceKey]);
        return;
      }
    }

    if (!partial) {
      payload[targetKey] = transform('');
    }
  };

  assignMappedValue('first_name', ['first_name', 'firstName'], (value) => String(value || '').trim());
  assignMappedValue('middle_name', ['middle_name', 'middleName', 'middlename'], (value) => String(value || '').trim());
  assignMappedValue('last_name', ['last_name', 'lastName'], (value) => String(value || '').trim());
  assignMappedValue('username', ['username'], (value) => String(value || '').trim());
  assignMappedValue('username_lower', ['username_lower', 'usernameLower'], (value) => String(value || '').trim().toLowerCase());
  assignMappedValue('email', ['email'], (value) => String(value || '').trim());
  assignMappedValue('birthdate', ['birthdate', 'birthDate', 'birth_date', 'date_of_birth', 'dateOfBirth'], normalizeBirthdate);

  if (!payload.username_lower && payload.username) {
    payload.username_lower = String(payload.username).toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(attendantData, 'password') && attendantData.password !== undefined) {
    payload.password = String(attendantData.password || '');
  } else if (Object.prototype.hasOwnProperty.call(attendantData, 'plainPassword') && attendantData.plainPassword !== undefined) {
    payload.password = String(attendantData.plainPassword || '');
  } else if (!partial) {
    payload.password = '';
  }

  assignMappedValue('assigned_bus_id', ['assigned_bus_id', 'assignedBusId', 'bus_id', 'busId'], (value) => String(value || '').trim());

  if (Object.prototype.hasOwnProperty.call(attendantData, 'is_archived') || Object.prototype.hasOwnProperty.call(attendantData, 'isArchived')) {
    const archivedValue = Object.prototype.hasOwnProperty.call(attendantData, 'is_archived')
      ? attendantData.is_archived
      : attendantData.isArchived;
    payload.is_archived = Boolean(archivedValue);
  } else if (!partial) {
    payload.is_archived = false;
  }

  if (Object.prototype.hasOwnProperty.call(attendantData, 'is_privileged') || Object.prototype.hasOwnProperty.call(attendantData, 'isPrivileged')) {
    const privilegedValue = Object.prototype.hasOwnProperty.call(attendantData, 'is_privileged')
      ? attendantData.is_privileged
      : attendantData.isPrivileged;
    payload.is_privileged = Boolean(privilegedValue);
  } else if (!partial) {
    payload.is_privileged = true;
  }

  if (Object.prototype.hasOwnProperty.call(attendantData, 'in_queue') || Object.prototype.hasOwnProperty.call(attendantData, 'inQueue')) {
    const inQueueValue = Object.prototype.hasOwnProperty.call(attendantData, 'in_queue')
      ? attendantData.in_queue
      : attendantData.inQueue;
    payload.in_queue = Boolean(inQueueValue);
  } else if (!partial) {
    payload.in_queue = false;
  }

  if (Object.prototype.hasOwnProperty.call(attendantData, 'user_type') || Object.prototype.hasOwnProperty.call(attendantData, 'userType') || Object.prototype.hasOwnProperty.call(attendantData, 'role')) {
    payload.user_type = String(attendantData.user_type || attendantData.userType || attendantData.role || '').trim();
  } else if (!partial) {
    payload.user_type = 'bus_attendant';
  }

  return payload;
};

const createBusAttendantInFirebase = async (payload) => {
  if (!firebaseInitialized || !db) {
    throw new Error('Firebase fallback is unavailable.');
  }

  const firebaseApiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
  if (!firebaseApiKey) {
    throw new Error('Missing VITE_FIREBASE_API_KEY for Firebase fallback account creation.');
  }

  const normalizedEmail = String(payload?.email || '').trim().toLowerCase();
  const normalizedPassword = String(payload?.password || '');

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Missing email or password for Firebase fallback account creation.');
  }

  let localId = '';

  try {
    const signUpResponse = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseApiKey}`,
      {
        email: normalizedEmail,
        password: normalizedPassword,
        returnSecureToken: true,
      }
    );

    localId = String(signUpResponse?.data?.localId || '').trim();
  } catch (firebaseError) {
    const firebaseErrorCode = String(
      firebaseError?.response?.data?.error?.message ||
      firebaseError?.response?.data?.message ||
      ''
    ).trim().toUpperCase();

    if (firebaseErrorCode.includes('EMAIL_EXISTS')) {
      const profilesRef = collection(db, 'profiles');
      const existingByEmail = await getDocs(query(profilesRef, where('email', '==', normalizedEmail), limit(1)));
      if (!existingByEmail.empty) {
        const profileDoc = existingByEmail.docs[0];
        return normalizeProfile({ id: profileDoc.id, ...(profileDoc.data() || {}) }, 0);
      }
    }

    throw firebaseError;
  }

  if (!localId) {
    throw new Error('Firebase fallback did not return a localId for the new account.');
  }

  const nowIso = new Date().toISOString();
  const firestoreProfile = {
    first_name: String(payload?.first_name || '').trim(),
    middle_name: String(payload?.middle_name || '').trim(),
    last_name: String(payload?.last_name || '').trim(),
    email: normalizedEmail,
    birthdate: String(payload?.birthdate || '').trim(),
    is_privileged: Boolean(payload?.is_privileged ?? true),
    in_queue: Boolean(payload?.in_queue ?? false),
    user_type: String(payload?.user_type || 'bus_attendant').trim() || 'bus_attendant',
    username: String(payload?.username || '').trim(),
    username_lower: String(payload?.username_lower || payload?.username || '').trim().toLowerCase(),
    assigned_bus_id: String(payload?.assigned_bus_id || payload?.assignedBusId || '').trim(),
    created_at: nowIso,
    updated_at: nowIso,
  };

  await setDoc(doc(db, 'profiles', localId), firestoreProfile, { merge: true });

  return normalizeProfile({ id: localId, ...firestoreProfile }, 0);
};

export const createBusAttendant = async (attendantData) => {
  const payload = mapBusAttendantPayload(attendantData, { partial: false });

  if (firebaseInitialized && db) {
    try {
      return await createBusAttendantInFirebase(payload);
    } catch (firebaseError) {
      const firebaseMessage = String(
        firebaseError?.response?.data?.error?.message ||
        firebaseError?.response?.data?.message ||
        firebaseError?.message ||
        ''
      ).toUpperCase();

      if (firebaseMessage.includes('EMAIL_EXISTS')) {
        throw new Error('Email already exists. Please use a unique email address.');
      }

      if (firebaseMessage.includes('OPERATION_NOT_ALLOWED')) {
        throw new Error('Firebase Email/Password sign-up is disabled. Enable it in Firebase Authentication settings.');
      }

      if (firebaseMessage.includes('INVALID_API_KEY')) {
        throw new Error('Invalid Firebase API key. Please verify VITE_FIREBASE_API_KEY.');
      }

      if (firebaseMessage.includes('CONFIGURATION_NOT_FOUND') || firebaseMessage.includes('PROJECT_NOT_FOUND')) {
        throw new Error('Firebase project configuration is invalid or missing.');
      }

      if (firebaseMessage.includes('MISSING OR INSUFFICIENT PERMISSIONS') || firebaseMessage.includes('PERMISSION_DENIED')) {
        throw new Error('Firestore rules blocked profile creation. Grant your admin user write access to the profiles collection, then retry.');
      }

      throw new Error(`Firebase attendant creation failed: ${firebaseMessage || 'Unknown error'}`);
    }
  }

  const authHeaderCandidates = await getMutationAuthHeaderCandidates();
  const profileCreateEndpoints = [
    `${API_URL}/profiles/`,
    `${API_URL}/profiles`,
  ];

  let lastError = null;
  let authError = null;

  for (let index = 0; index < profileCreateEndpoints.length; index += 1) {
    const endpoint = profileCreateEndpoints[index];
    for (const candidateHeaders of authHeaderCandidates) {
      try {
        const response = await axios.post(endpoint, payload, {
          headers: candidateHeaders,
          withCredentials: USE_CREDENTIALS,
        });

        const createdProfile = extractProfileObject(response.data) || extractSingleBus(response.data) || payload;
        return normalizeProfile(createdProfile, 0);
      } catch (error) {
        lastError = error;
        const statusCode = error?.response?.status;
        const isNotFoundLike = statusCode === 404 || statusCode === 405;
        const isUnauthorized = statusCode === 401 || statusCode === 403;

        if (isUnauthorized && !authError) {
          authError = error;
        }

        const isLastEndpoint = index === profileCreateEndpoints.length - 1;
        if (!isNotFoundLike && !isLastEndpoint && !isUnauthorized) {
          throw error;
        }
      }
    }
  }

  const shouldTryFirebaseFallback = Boolean(
    authError ||
    String(lastError?.response?.data?.detail || lastError?.response?.data?.message || lastError?.message || '')
      .toLowerCase()
      .includes('profile already completed')
  );

  if (shouldTryFirebaseFallback) {
    try {
      return await createBusAttendantInFirebase(payload);
    } catch {
      // Fallback failed; throw original API error below for clarity.
    }
  }

  throw authError || lastError || new Error('Failed to create bus attendant.');
};

export const updateBusAttendant = async (id, attendantData) => {
  const payload = mapBusAttendantPayload(attendantData, { partial: true });
  const authHeaderCandidates = await getMutationAuthHeaderCandidates();
  let lastError = null;

  for (const candidateHeaders of authHeaderCandidates) {
    try {
      const response = await axios.put(`${API_URL}/profiles/${id}`, payload, {
        headers: candidateHeaders,
        withCredentials: USE_CREDENTIALS,
      });

      const updatedProfile = extractProfileObject(response.data) || extractSingleBus(response.data) || { id, ...payload };
      return normalizeProfile(updatedProfile, 0);
    } catch (error) {
      lastError = error;
      const statusCode = error?.response?.status;
      const isUnauthorized = statusCode === 401 || statusCode === 403;
      if (!isUnauthorized) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Failed to update bus attendant.');
};

export const archiveBusAttendant = async (id) => {
  return updateBusAttendant(id, { is_archived: true });
};

export const unarchiveBusAttendant = async (id) => {
  return updateBusAttendant(id, { is_archived: false });
};

export const fetchQueues = async (params = {}) => {
  const response = await requestWithQueueEndpointFallback((endpoint) =>
    axios.get(`${API_URL}/${endpoint}/`, {
      params,
      headers: getAuthHeaders(),
    })
  );

  const rawQueues = extractQueueArray(response.data);

  return rawQueues
    .map((queueItem, index) => normalizeQueueRoute(queueItem, index))
    .filter((queueRoute) => queueRoute.origin || queueRoute.destination);
};

export const fetchQueueDestinations = async (params = {}) => {
  const response = await requestWithQueueEndpointFallback((endpoint) =>
    axios.get(`${API_URL}/${endpoint}/`, {
      params,
      headers: getAuthHeaders(),
    })
  );

  const rawQueues = extractQueueArray(response.data);

  return rawQueues
    .map((queueItem, index) => normalizeQueueDestination(queueItem, index))
    .filter((destinationItem) => destinationItem.destinationName);
};

const mapQueueDestinationPayload = (destinationData = {}, options = { partial: false }) => {
  const payload = {};
  const { partial } = options;

  const assignMappedValue = (targetKey, sourceKeys, transform = (value) => value) => {
    for (const sourceKey of sourceKeys) {
      if (Object.prototype.hasOwnProperty.call(destinationData, sourceKey) && destinationData[sourceKey] !== undefined) {
        payload[targetKey] = transform(destinationData[sourceKey]);
        return;
      }
    }

    if (!partial) {
      payload[targetKey] = transform('');
    }
  };

  assignMappedValue('destination', ['destination', 'destinationName', 'name', 'title'], (value) => String(value || '').trim());
  assignMappedValue('destination_name', ['destination_name', 'destinationName', 'destination', 'name', 'title'], (value) => String(value || '').trim());
  assignMappedValue('origin', ['origin'], (value) => String(value || '').trim());
  assignMappedValue('route_name', ['route_name', 'route'], (value) => String(value || '').trim());

  return payload;
};

export const createQueueDestination = async (destinationData) => {
  const response = await requestWithQueueEndpointFallback((endpoint) =>
    axios.post(`${API_URL}/${endpoint}/`, mapQueueDestinationPayload(destinationData, { partial: false }), {
      headers: getAuthHeaders(),
    })
  );

  const createdQueue = extractSingleBus(response.data);
  return normalizeQueueDestination(createdQueue || destinationData, 0);
};

export const updateQueueDestination = async (id, destinationData) => {
  const response = await requestWithQueueEndpointFallback((endpoint) =>
    axios.put(`${API_URL}/${endpoint}/${id}`, mapQueueDestinationPayload(destinationData, { partial: true }), {
      headers: getAuthHeaders(),
    })
  );

  const updatedQueue = extractSingleBus(response.data);
  return normalizeQueueDestination(updatedQueue || { id, ...destinationData }, 0);
};

export const deleteQueueDestination = async (id) => {
  const response = await requestWithQueueEndpointFallback((endpoint) =>
    axios.delete(`${API_URL}/${endpoint}/${id}`, {
      headers: getAuthHeaders(),
    })
  );
  return response.data;
};

const mapGeofencePayload = (routeData = {}, options = { partial: false }) => {
  const payload = {};
  const { partial } = options;

  const assignMappedValue = (targetKey, sourceKeys, transform = (value) => value) => {
    for (const sourceKey of sourceKeys) {
      if (Object.prototype.hasOwnProperty.call(routeData, sourceKey) && routeData[sourceKey] !== undefined) {
        payload[targetKey] = transform(routeData[sourceKey]);
        return;
      }
    }

    if (!partial) {
      payload[targetKey] = transform('');
    }
  };

  assignMappedValue('latitude', ['latitude', 'lat', 'originLat', 'origin_lat'], (value) => Number(value || 0));
  assignMappedValue('longitude', ['longitude', 'lng', 'lon', 'originLng', 'origin_lng'], (value) => Number(value || 0));
  assignMappedValue('radius', ['radius', 'radius_m', 'radiusMeters'], (value) => Number(value || 0));
  assignMappedValue('queue_id', ['queueId', 'queue_id', 'destinationId', 'destination_id'], (value) => String(value || '').trim());
  assignMappedValue('destination_name', ['destinationName', 'destination_name', 'destination'], (value) => String(value || '').trim());

  return payload;
};

export const fetchRouteGeofences = async (params = {}) => {
  const response = await requestWithGeofenceEndpointFallback((endpoint) =>
    axios.get(`${API_URL}/${endpoint}/`, {
      params,
      headers: getAuthHeaders(),
    })
  );

  const rawGeofences = extractQueueArray(response.data);

  return rawGeofences.map((geofenceItem, index) => normalizeGeofenceRoute(geofenceItem, index));
};

export const fetchOriginGeofenceConfig = async () => {
  const response = await requestWithEndpointFallback(ORIGIN_CONFIG_ENDPOINTS, (endpoint) =>
    axios.get(`${API_URL}/${endpoint}/`, {
      headers: getAuthHeaders(),
    })
  );

  const normalized = normalizeOriginGeofenceConfig(extractSingleBus(response.data) || response.data);

  if (!normalized) {
    throw new Error('Origin geofence config is missing latitude, longitude, or radius.');
  }

  return normalized;
};

export const createRouteGeofence = async (routeData) => {
  const response = await requestWithGeofenceEndpointFallback((endpoint) =>
    axios.post(`${API_URL}/${endpoint}/`, mapGeofencePayload(routeData, { partial: false }), {
      headers: getAuthHeaders(),
    })
  );

  const createdGeofence = extractSingleBus(response.data);
  return normalizeGeofenceRoute(createdGeofence || routeData, 0);
};

export const updateRouteGeofence = async (id, routeData) => {
  const response = await requestWithGeofenceEndpointFallback((endpoint) =>
    axios.put(`${API_URL}/${endpoint}/${id}`, mapGeofencePayload(routeData, { partial: true }), {
      headers: getAuthHeaders(),
    })
  );

  const updatedGeofence = extractSingleBus(response.data);
  return normalizeGeofenceRoute(updatedGeofence || { id, ...routeData }, 0);
};

export const deleteRouteGeofence = async (id) => {
  const response = await requestWithGeofenceEndpointFallback((endpoint) =>
    axios.delete(`${API_URL}/${endpoint}/${id}`, {
      headers: getAuthHeaders(),
    })
  );
  return response.data;
};

// --- BUS FUNCTIONS (Add these to fix the Buses page crash) ---
export const fetchBuses = async (params = {}) => {
  const response = await requestWithBusEndpointFallback((endpoint) =>
    axios.get(`${API_URL}/${endpoint}/`, {
      params,
      headers: getAuthHeaders(),
    })
  );

  const rawBuses = extractBusArray(response.data);
  return rawBuses.map((bus, index) => normalizeBus(bus, index));
};

export const createBus = async (busData) => {
  const payload = mapBusToApiPayload(busData, { partial: false });
  const response = await requestBusWithStatusAliasFallback(
    (resolvedPayload) => requestWithBusEndpointFallback((endpoint) =>
      axios.post(`${API_URL}/${endpoint}/`, resolvedPayload, {
        headers: getAuthHeaders(),
      })
    ),
    payload
  );

  const createdBus = extractSingleBus(response.data);
  return normalizeBus(createdBus || busData, 0);
};

export const updateBus = async (id, busData) => {
  const payload = mapBusToApiPayload(busData, { partial: true });
  const response = await requestBusWithStatusAliasFallback(
    (resolvedPayload) => requestWithBusEndpointFallback((endpoint) =>
      axios.put(`${API_URL}/${endpoint}/${id}`, resolvedPayload, {
        headers: getAuthHeaders(),
      })
    ),
    payload
  );

  const updatedBus = extractSingleBus(response.data);
  return normalizeBus(updatedBus || { id, ...busData }, 0);
};

export const deleteBus = async (id) => {
  const response = await requestWithBusEndpointFallback((endpoint) =>
    axios.delete(`${API_URL}/${endpoint}/${id}`, {
      headers: getAuthHeaders(),
    })
  );
  return response.data;
};