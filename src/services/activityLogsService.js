import axios from 'axios';
import { collection, getDocs } from 'firebase/firestore';
import mockTripLogs from '../data/activityLogsMockData.json';
import { db, firebaseInitialized } from '../firebase';
import { fetchBuses as fetchBusesFromApi } from './api';

const API_URL = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const USE_CREDENTIALS = String(import.meta.env.VITE_API_WITH_CREDENTIALS || '').trim().toLowerCase() === 'true';

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

const TRIPS_ALL_ENDPOINTS = [
  'profiles/me/trips/all',
  'profiles/me/trips/all/',
];

const TRIP_DETAILS_ENDPOINTS = (tripId) => [
  `profiles/me/trips/${encodeURIComponent(String(tripId || '').trim())}`,
  `profiles/me/trips/${encodeURIComponent(String(tripId || '').trim())}/`,
];

const getStoredAccessToken = () => {
  for (const key of ACCESS_TOKEN_STORAGE_KEYS) {
    const token = String(localStorage.getItem(key) || '').trim();
    if (token) {
      return token;
    }
  }

  return '';
};

const getAuthHeaders = () => {
  const token = getStoredAccessToken();
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

const extractArrayPayload = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }

  if (Array.isArray(payload?.data?.results)) {
    return payload.data.results;
  }

  if (Array.isArray(payload?.data?.trips)) {
    return payload.data.trips;
  }

  if (Array.isArray(payload?.data?.history)) {
    return payload.data.history;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.results)) {
    return payload.results;
  }

  if (Array.isArray(payload?.logs)) {
    return payload.logs;
  }

  if (Array.isArray(payload?.trips)) {
    return payload.trips;
  }

  if (Array.isArray(payload?.history)) {
    return payload.history;
  }

  if (Array.isArray(payload?.trip_history)) {
    return payload.trip_history;
  }

  if (Array.isArray(payload?.tripHistory)) {
    return payload.tripHistory;
  }

  if (Array.isArray(payload?.result?.trips)) {
    return payload.result.trips;
  }

  if (Array.isArray(payload?.result?.history)) {
    return payload.result.history;
  }

  if (Array.isArray(payload?.response?.trips)) {
    return payload.response.trips;
  }

  if (Array.isArray(payload?.response?.history)) {
    return payload.response.history;
  }

  const isTripLikeItem = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    return Boolean(
      value.trip_id ||
      value.tripId ||
      value.id ||
      value.bus_number ||
      value.departure_time ||
      value.started_at
    );
  };

  const findTripArray = (source, depth = 0) => {
    if (!source || typeof source !== 'object' || depth > 4) {
      return null;
    }

    if (Array.isArray(source)) {
      if (source.length > 0 && source.every(isTripLikeItem)) {
        return source;
      }

      for (const item of source) {
        const found = findTripArray(item, depth + 1);
        if (Array.isArray(found)) {
          return found;
        }
      }

      return null;
    }

    const values = Object.values(source);
    for (const value of values) {
      const found = findTripArray(value, depth + 1);
      if (Array.isArray(found)) {
        return found;
      }
    }

    return null;
  };

  const deepMatch = findTripArray(payload);
  if (Array.isArray(deepMatch)) {
    return deepMatch;
  }

  return [];
};

const extractObjectPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.trip && typeof payload.trip === 'object') {
    return payload.trip;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.result && typeof payload.result === 'object') {
    return payload.result;
  }

  return payload;
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
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const buildRouteLabel = (tripItem) => {
  const directRoute = String(tripItem?.route || tripItem?.route_name || '').trim();
  if (directRoute) {
    return directRoute;
  }

  const origin = String(tripItem?.origin || tripItem?.from || '').trim();
  const destination = String(tripItem?.destination || tripItem?.to || '').trim();

  if (origin || destination) {
    return [origin, destination].filter(Boolean).join(' - ');
  }

  return '-';
};

const normalizeTripUser = (userItem, index) => ({
  id: String(userItem?.id || userItem?.user_id || userItem?.uid || `trip-user-${index + 1}`),
  name: String(
    userItem?.name ||
      userItem?.full_name ||
      `${String(userItem?.first_name || '').trim()} ${String(userItem?.last_name || '').trim()}`.trim() ||
      'Unknown User'
  ),
  email: String(userItem?.email || '-'),
  username: String(userItem?.username || userItem?.username_lower || '-'),
  boardedAt: normalizeTimestamp(userItem?.boarded_at || userItem?.boardedAt || userItem?.timestamp || userItem?.created_at),
});

const normalizeTripLog = (tripItem, index) => {
  const users = extractArrayPayload(
    tripItem?.users ||
      tripItem?.passengers ||
      tripItem?.riders ||
      tripItem?.trip_users ||
      tripItem?.manifest ||
      []
  ).map(normalizeTripUser);

  const departureTime = normalizeTimestamp(
    tripItem?.departureTime ||
      tripItem?.departure_time ||
      tripItem?.departed_at ||
      tripItem?.started_at ||
      tripItem?.created_at
  );

  const arrivalTime = normalizeTimestamp(
    tripItem?.arrivalTime ||
      tripItem?.arrival_time ||
      tripItem?.arrived_at ||
      tripItem?.ended_at ||
      tripItem?.updated_at
  );

  const status = String(tripItem?.status || tripItem?.trip_status || '').trim();
  const latestUpdated = normalizeTimestamp(
    tripItem?.updated_at ||
      tripItem?.updatedAt ||
      tripItem?.arrived_at ||
      tripItem?.arrival_time ||
      tripItem?.ended_at ||
      tripItem?.departed_at ||
      tripItem?.departure_time ||
      tripItem?.started_at ||
      tripItem?.created_at
  );

  return {
    id: String(tripItem?.id || tripItem?.trip_id || tripItem?.tripId || `trip-${index + 1}`),
    busNumber: String(tripItem?.busNumber || tripItem?.bus_number || tripItem?.bus?.busNumber || tripItem?.bus?.bus_number || '-'),
    plateNumber: String(tripItem?.plateNumber || tripItem?.plate_number || tripItem?.bus?.plateNumber || tripItem?.bus?.plate_number || '-'),
    route: buildRouteLabel(tripItem),
    busId: String(tripItem?.bus_id || tripItem?.busId || tripItem?.bus?.id || '').trim(),
    departureTime,
    arrivalTime,
    status: status || (arrivalTime > 0 ? 'Completed' : 'In Progress'),
    attendantName: String(
      tripItem?.attendant_name ||
      tripItem?.attendantName ||
      tripItem?.bus_attendant ||
      tripItem?.busAttendant ||
      tripItem?.bus?.attendant_name ||
      tripItem?.bus?.busAttendant ||
      ''
    ).trim(),
    latestUpdated,
    users,
    usersCount: users.length,
    raw: tripItem,
  };
};

const normalizeTripLogs = (tripList) => (
  Array.isArray(tripList)
    ? tripList.map(normalizeTripLog).sort((leftTrip, rightTrip) => (rightTrip.departureTime || 0) - (leftTrip.departureTime || 0))
    : []
);

const buildAttendantLookupFromBuses = (buses) => {
  const lookup = new Map();

  (Array.isArray(buses) ? buses : []).forEach((busItem) => {
    const attendantName = String(
      busItem?.attendant_name ||
      busItem?.attendantName ||
      busItem?.busAttendant ||
      busItem?.raw?.attendant_name ||
      ''
    ).trim();

    if (!attendantName) {
      return;
    }

    [
      busItem?.id,
      busItem?.bus_id,
      busItem?.busId,
      busItem?.busNumber,
      busItem?.bus_number,
      busItem?.plateNumber,
      busItem?.plate_number,
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .forEach((key) => {
        lookup.set(key, attendantName);
      });
  });

  return lookup;
};

const getBusAttendantLookup = async () => {
  try {
    const busesFromApi = await fetchBusesFromApi();
    const apiLookup = buildAttendantLookupFromBuses(busesFromApi);
    if (apiLookup.size > 0) {
      return apiLookup;
    }
  } catch {
    // Continue to Firebase fallback.
  }

  if (!firebaseInitialized || !db) {
    return new Map();
  }

  try {
    const snapshot = await getDocs(collection(db, 'buses'));
    const busesFromFirestore = snapshot.docs.map((docItem) => ({ id: docItem.id, ...(docItem.data() || {}) }));
    return buildAttendantLookupFromBuses(busesFromFirestore);
  } catch {
    return new Map();
  }
};

const enrichTripsWithAttendants = async (tripLogs) => {
  const logs = Array.isArray(tripLogs) ? tripLogs : [];
  if (logs.length === 0) {
    return logs;
  }

  const attendantLookup = await getBusAttendantLookup();
  if (attendantLookup.size === 0) {
    return logs.map((trip) => ({
      ...trip,
      attendantName: String(trip?.attendantName || '').trim() || '-',
    }));
  }

  return logs.map((trip) => {
    const resolvedAttendant = [
      trip?.attendantName,
      attendantLookup.get(String(trip?.busId || '').trim().toLowerCase()),
      attendantLookup.get(String(trip?.busNumber || '').trim().toLowerCase()),
      attendantLookup.get(String(trip?.plateNumber || '').trim().toLowerCase()),
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '-';

    return {
      ...trip,
      attendantName: resolvedAttendant,
    };
  });
};

const getFirestoreTripsLogs = async () => {
  if (!firebaseInitialized || !db) {
    return [];
  }

  const snapshot = await getDocs(collection(db, 'trips'));
  const groupedTrips = new Map();

  snapshot.docs.forEach((docItem, index) => {
    const rawTrip = docItem.data() || {};
    const departedAt = normalizeTimestamp(rawTrip.departed_at || rawTrip.departure_time || rawTrip.started_at || rawTrip.created_at);
    const arrivedAt = normalizeTimestamp(rawTrip.arrived_at || rawTrip.arrival_time || rawTrip.ended_at || rawTrip.updated_at);

    const explicitTripId = String(rawTrip.trip_id || rawTrip.tripId || '').trim();
    const busId = String(rawTrip.bus_id || rawTrip.busId || '').trim();
    const queueId = String(rawTrip.queue_id || rawTrip.queueId || '').trim();
    const tripGroupKey = explicitTripId || `${busId || 'bus'}::${queueId || 'queue'}::${departedAt || normalizeTimestamp(rawTrip.created_at) || index + 1}`;

    const existingTrip = groupedTrips.get(tripGroupKey);
    const routeLabel = [String(rawTrip.origin || '').trim(), String(rawTrip.destination || '').trim()]
      .filter(Boolean)
      .join(' - ');

    if (!existingTrip) {
      groupedTrips.set(tripGroupKey, {
        id: tripGroupKey,
        busNumber: String(rawTrip.bus_number || rawTrip.busNumber || '-'),
        plateNumber: String(rawTrip.plate_number || rawTrip.plateNumber || '-'),
        route: routeLabel || '-',
        departureTime: departedAt,
        arrivalTime: arrivedAt,
        status: String(rawTrip.status || rawTrip.trip_status || (arrivedAt > 0 ? 'Completed' : 'In Progress')),
        users: [],
        usersCount: 0,
        raw: rawTrip,
      });
    } else {
      existingTrip.departureTime = Math.max(Number(existingTrip.departureTime || 0), Number(departedAt || 0));
      existingTrip.arrivalTime = Math.max(Number(existingTrip.arrivalTime || 0), Number(arrivedAt || 0));
      if (!existingTrip.plateNumber || existingTrip.plateNumber === '-') {
        existingTrip.plateNumber = String(rawTrip.plate_number || rawTrip.plateNumber || existingTrip.plateNumber || '-');
      }
    }

    const groupedTrip = groupedTrips.get(tripGroupKey);
    const userId = String(rawTrip.user_id || rawTrip.userId || rawTrip.uid || '').trim() || `trip-user-${docItem.id}`;
    if (!groupedTrip.users.some((tripUser) => String(tripUser.id) === userId)) {
      groupedTrip.users.push({
        id: userId,
        name: userId,
        email: String(rawTrip.user_email || rawTrip.email || '-'),
        username: String(rawTrip.username || rawTrip.user_username || userId || '-'),
        boardedAt: normalizeTimestamp(rawTrip.boarded_at || rawTrip.boardedAt || rawTrip.created_at),
      });
    }

    groupedTrip.usersCount = groupedTrip.users.length;
  });

  return Array.from(groupedTrips.values())
    .sort((leftTrip, rightTrip) => Number(rightTrip.departureTime || 0) - Number(leftTrip.departureTime || 0));
};

export const fetchTripHistoryLogs = async (params = {}) => {
  let lastError = null;

  if (API_URL) {
    for (const endpoint of TRIPS_ALL_ENDPOINTS) {
      try {
        const response = await axios.get(`${API_URL}/${endpoint}`, {
          params,
          headers: getAuthHeaders(),
          withCredentials: USE_CREDENTIALS,
        });

        const logs = normalizeTripLogs(extractArrayPayload(response.data));
        if (logs.length > 0) {
          const enrichedLogs = await enrichTripsWithAttendants(logs);
          return { logs: enrichedLogs, warning: '' };
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  try {
    const firebaseLogs = await getFirestoreTripsLogs();
    if (firebaseLogs.length > 0) {
      const enrichedLogs = await enrichTripsWithAttendants(firebaseLogs);
      return {
        logs: enrichedLogs,
        warning: API_URL
          ? 'Showing trip history from Firebase because /profiles/me/trips/all returned no records for this account.'
          : 'Using Firebase trip history data.',
      };
    }
  } catch (firebaseError) {
    if (!lastError) {
      lastError = firebaseError;
    }
  }

  return {
    logs: await enrichTripsWithAttendants(normalizeTripLogs(mockTripLogs)),
    warning: lastError
      ? 'Showing local activity logs because no trip history was returned from API/Firebase.'
      : 'Showing local activity logs.',
  };
};

export const fetchTripHistoryById = async (tripId) => {
  const normalizedTripId = String(tripId || '').trim();
  if (!normalizedTripId) {
    throw new Error('Missing trip ID for trip details request.');
  }

  if (!API_URL) {
    const fallbackTrip = normalizeTripLogs(mockTripLogs).find((trip) => String(trip.id) === normalizedTripId);
    if (fallbackTrip) {
      return fallbackTrip;
    }

    throw new Error('Trip details unavailable.');
  }

  let lastError = null;

  for (const endpoint of TRIP_DETAILS_ENDPOINTS(normalizedTripId)) {
    try {
      const response = await axios.get(`${API_URL}/${endpoint}`, {
        headers: getAuthHeaders(),
        withCredentials: USE_CREDENTIALS,
      });

      const normalizedTrip = normalizeTripLog(extractObjectPayload(response.data), 0);
      const enrichedTripList = await enrichTripsWithAttendants([normalizedTrip]);
      return enrichedTripList[0] || normalizedTrip;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const firebaseTrips = await getFirestoreTripsLogs();
    const firebaseTripMatch = firebaseTrips.find((trip) => String(trip.id) === normalizedTripId);
    if (firebaseTripMatch) {
      return firebaseTripMatch;
    }
  } catch {
    // Ignore Firebase fallback errors and continue to final fallback.
  }

  const fallbackTrip = normalizeTripLogs(mockTripLogs).find((trip) => String(trip.id) === normalizedTripId);
  if (fallbackTrip) {
    const enrichedTripList = await enrichTripsWithAttendants([fallbackTrip]);
    return enrichedTripList[0] || fallbackTrip;
  }

  throw lastError || new Error('Failed to fetch trip details.');
};
