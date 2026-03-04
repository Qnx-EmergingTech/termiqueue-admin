import axios from 'axios';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db, firebaseInitialized } from '../firebase';

const API_URL = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const BUS_ENDPOINTS = ['buses', 'busses'];
export const API_SESSION_EXPIRED_EVENT = 'auth:session-expired';
const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_STARTED_AT_KEY = 'sessionStartedAt';
let authInterceptorRegistered = false;

if (!API_URL) {
  throw new Error('Missing VITE_API_URL. Set it in your environment before running the app.');
}

const clearApiAuthStorage = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem(SESSION_STARTED_AT_KEY);
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
        localStorage.getItem('accessToken')
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
  const accessToken = localStorage.getItem('accessToken');

  if (!accessToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
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

  if (normalized === 'in_transit') {
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

  if (
    normalized === 'active' ||
    normalized === 'available' ||
    normalized === 'offline' ||
    normalized === 'in_transit' ||
    normalized === 'arrived'
  ) {
    return normalized;
  }

  if (normalized === 'in transit') {
    return 'in_transit';
  }

  if (normalized === 'inactive' || normalized === 'maintenance' || normalized === 'archived') {
    return 'offline';
  }

  return 'available';
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

const shouldFallbackBusEndpoint = (error) => {
  const statusCode = error?.response?.status;
  return statusCode === 404;
};

const requestWithBusEndpointFallback = async (requestBuilder) => {
  let lastError = null;

  for (let index = 0; index < BUS_ENDPOINTS.length; index += 1) {
    const endpoint = BUS_ENDPOINTS[index];

    try {
      return await requestBuilder(endpoint);
    } catch (error) {
      lastError = error;
      const isLastEndpoint = index === BUS_ENDPOINTS.length - 1;

      if (isLastEndpoint || !shouldFallbackBusEndpoint(error)) {
        throw error;
      }
    }
  }

  throw lastError;
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
  });

  const rawPayload = response.data || {};
  const responseData =
    rawPayload?.data && typeof rawPayload.data === 'object' && !Array.isArray(rawPayload.data)
      ? rawPayload.data
      : rawPayload;
  const accessToken = String(
    getFirstDefinedValue(
      responseData,
      ['access_token', 'accessToken', 'token', 'id_token', 'idToken'],
      getFirstDefinedValue(rawPayload, ['access_token', 'accessToken', 'token', 'id_token', 'idToken'], '')
    ) || ''
  );
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
  const accessToken = localStorage.getItem('accessToken');
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
    if (savedUser) {
      return savedUser;
    }

    return null;
  }

  if (isMaxSessionAgeExceeded(accessToken)) {
    clearApiAuthStorage();
    return null;
  }

  if (isTokenExpired(accessToken)) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
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
  const response = await requestWithBusEndpointFallback((endpoint) =>
    axios.post(`${API_URL}/${endpoint}/`, mapBusToApiPayload(busData, { partial: false }), {
      headers: getAuthHeaders(),
    })
  );

  const createdBus = extractSingleBus(response.data);
  return normalizeBus(createdBus || busData, 0);
};

export const updateBus = async (id, busData) => {
  const response = await requestWithBusEndpointFallback((endpoint) =>
    axios.put(`${API_URL}/${endpoint}/${id}`, mapBusToApiPayload(busData, { partial: true }), {
      headers: getAuthHeaders(),
    })
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