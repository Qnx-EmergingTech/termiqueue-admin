import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import rawActivationRequests from '../data/activationRequestsData.json';

const REQUESTS_DATA_SOURCE = (import.meta.env.VITE_REQUESTS_DATA_SOURCE || 'local').toLowerCase();
const REQUESTS_COLLECTION = import.meta.env.VITE_REQUESTS_COLLECTION || 'activationRequests';

const normalizeTimestamp = (value) => {
  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
};

const normalizeTempStatus = (value) => {
  const normalizedStatus = String(value || 'Pending').toLowerCase();

  if (normalizedStatus === 'approved') {
    return 'Approved';
  }

  if (normalizedStatus === 'rejected') {
    return 'Rejected';
  }

  return 'Pending';
};

const mapRequestDocument = (docSnapshot) => {
  const request = docSnapshot.data() || {};
  const normalizedStatus = String(request.status || 'Pending').toLowerCase();

  const formattedStatus = normalizedStatus === 'approved'
    ? 'Approved'
    : normalizedStatus === 'rejected'
      ? 'Rejected'
      : 'Pending';

  return {
    id: request.requestId || docSnapshot.id,
    fullName: request.fullName || request.name || 'N/A',
    email: request.email || 'N/A',
    role: request.role || request.userRole || 'User',
    busCompany: request.busCompany || request.company || request.companyName || 'N/A',
    route: request.route || request.registeredRoute || 'N/A',
    plateNumber: request.plateNumber || request.busPlateNumber || 'N/A',
    capacity: Number(request.capacity || request.busCapacity || 0),
    busPhoto: request.busPhoto || request.busPhotoUrl || request.photoUrl || null,
    status: formattedStatus,
    requestedAt: normalizeTimestamp(request.requestedAt || request.createdAt || request.lastUpdated),
  };
};

export const getRequestsTempData = () => rawActivationRequests.map((request) => ({
  ...request,
  capacity: Number(request.capacity || 0),
  status: normalizeTempStatus(request.status),
  requestedAt: normalizeTimestamp(request.requestedAt),
}));

export const fetchRequestsFromFirebase = async () => {
  const snapshot = await getDocs(collection(db, REQUESTS_COLLECTION));
  return snapshot.docs.map(mapRequestDocument);
};

export const fetchActivationRequests = async () => {
  const temporaryData = getRequestsTempData();

  if (REQUESTS_DATA_SOURCE !== 'firebase') {
    return temporaryData;
  }

  try {
    const firebaseRequests = await fetchRequestsFromFirebase();

    if (firebaseRequests.length > 0) {
      return firebaseRequests;
    }
  } catch (error) {
    console.error('Failed to fetch activation requests from Firebase:', error);
  }

  return temporaryData;
};

const resolveFirebaseRequestDocId = async (requestId) => {
  const snapshot = await getDocs(collection(db, REQUESTS_COLLECTION));

  const matchedDoc = snapshot.docs.find((requestDoc) => {
    const requestData = requestDoc.data() || {};
    return requestDoc.id === requestId || requestData.requestId === requestId;
  });

  return matchedDoc ? matchedDoc.id : null;
};

export const updateActivationRequestStatus = async (requestId, status) => {
  if (REQUESTS_DATA_SOURCE !== 'firebase') {
    return true;
  }

  try {
    const firebaseDocId = await resolveFirebaseRequestDocId(requestId);

    if (!firebaseDocId) {
      return false;
    }

    await updateDoc(doc(db, REQUESTS_COLLECTION, firebaseDocId), {
      status,
      updatedAt: Date.now(),
    });

    return true;
  } catch (error) {
    console.error('Failed to update activation request status in Firebase:', error);
    return false;
  }
};
