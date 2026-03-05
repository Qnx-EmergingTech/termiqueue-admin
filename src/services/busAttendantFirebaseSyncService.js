import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db, firebaseInitialized } from '../firebase';

const PROFILES_COLLECTION = 'profiles';
const USERS_COLLECTION = 'users';
const CLEANUP_FLAG_KEY = 'qnext.busAttendants.cleanup.data.done';

const normalizeString = (value) => String(value || '').trim();

const normalizeUsernameLower = (profile) => {
  const direct = normalizeString(profile?.username_lower).toLowerCase();
  if (direct) {
    return direct;
  }

  return normalizeString(profile?.username).toLowerCase();
};

const mapProfileToFirebasePayload = (profile) => {
  const firstName = normalizeString(profile?.first_name);
  const middleName = normalizeString(profile?.middle_name);
  const lastName = normalizeString(profile?.last_name);
  const fullName = normalizeString(`${firstName} ${lastName}`);

  return {
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    full_name: fullName,
    email: normalizeString(profile?.email).toLowerCase(),
    username: normalizeString(profile?.username),
    username_lower: normalizeUsernameLower(profile),
    user_type: normalizeString(profile?.user_type || 'bus_attendant') || 'bus_attendant',
    assigned_bus_id: normalizeString(profile?.assignedBusId || profile?.assigned_bus_id),
    is_archived: Boolean(profile?.is_archived),
    is_privileged: Boolean(profile?.is_privileged),
    in_queue: Boolean(profile?.in_queue),
    birthdate: normalizeString(profile?.birthdate),
  };
};

const toDeterministicDocId = (profile) => {
  const explicitId = normalizeString(profile?.id);
  if (explicitId && !explicitId.startsWith('local-attendant-')) {
    return explicitId;
  }

  const usernameLower = normalizeUsernameLower(profile).replace(/[^a-z0-9._-]/g, '');
  if (usernameLower) {
    return `attendant_${usernameLower}`;
  }

  const email = normalizeString(profile?.email).toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  if (email) {
    return `attendant_${email.replace('@', '_at_')}`;
  }

  return `attendant_${Date.now()}`;
};

const findExistingDoc = async (collectionName, profile) => {
  const explicitId = normalizeString(profile?.id);
  if (explicitId && !explicitId.startsWith('local-attendant-')) {
    const explicitRef = doc(db, collectionName, explicitId);
    const explicitSnapshot = await getDoc(explicitRef);
    return {
      ref: explicitRef,
      exists: explicitSnapshot.exists(),
    };
  }

  const email = normalizeString(profile?.email).toLowerCase();
  if (email) {
    const emailSnapshot = await getDocs(
      query(collection(db, collectionName), where('email', '==', email))
    );
    if (!emailSnapshot.empty) {
      return {
        ref: emailSnapshot.docs[0].ref,
        exists: true,
      };
    }
  }

  const usernameLower = normalizeUsernameLower(profile);
  if (usernameLower) {
    const usernameSnapshot = await getDocs(
      query(collection(db, collectionName), where('username_lower', '==', usernameLower))
    );
    if (!usernameSnapshot.empty) {
      return {
        ref: usernameSnapshot.docs[0].ref,
        exists: true,
      };
    }
  }

  return {
    ref: doc(db, collectionName, toDeterministicDocId(profile)),
    exists: false,
  };
};

export const syncBusAttendantToFirebase = async (profile) => {
  if (!firebaseInitialized || !db) {
    return { synced: false, reason: 'firebase-not-configured' };
  }

  const payload = mapProfileToFirebasePayload(profile);
  const profileTarget = await findExistingDoc(PROFILES_COLLECTION, profile);
  const userRef = doc(db, USERS_COLLECTION, profileTarget.ref.id);

  await setDoc(
    profileTarget.ref,
    {
      ...payload,
      updated_at: serverTimestamp(),
      ...(profileTarget.exists ? {} : { created_at: serverTimestamp() }),
    },
    { merge: true }
  );

  await setDoc(
    userRef,
    {
      ...payload,
      isAdmin: false,
      updated_at: serverTimestamp(),
      ...(profileTarget.exists ? {} : { created_at: serverTimestamp() }),
    },
    { merge: true }
  );

  return { synced: true, profileId: profileTarget.ref.id, userId: userRef.id };
};

export const setBusAttendantArchivedInFirebase = async (profile, isArchived) => {
  if (!firebaseInitialized || !db) {
    return { synced: false, reason: 'firebase-not-configured' };
  }

  const profileTarget = await findExistingDoc(PROFILES_COLLECTION, profile);
  const userRef = doc(db, USERS_COLLECTION, profileTarget.ref.id);

  await setDoc(
    profileTarget.ref,
    {
      is_archived: Boolean(isArchived),
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );

  await setDoc(
    userRef,
    {
      is_archived: Boolean(isArchived),
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );

  return { synced: true, profileId: profileTarget.ref.id, userId: userRef.id };
};

const isBusAttendantProfile = (raw) => {
  const userType = String(raw?.user_type || raw?.role || raw?.user_role || '').trim().toLowerCase();
  return userType === 'bus_attendant' || userType.includes('attendant');
};

const normalizeTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const getIdentityKey = (raw) => {
  const email = normalizeString(raw?.email).toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  const usernameLower = normalizeString(raw?.username_lower || raw?.username).toLowerCase();
  if (usernameLower) {
    return `username:${usernameLower}`;
  }

  return '';
};

const mergeNonEmpty = (base, incoming) => {
  const merged = { ...base };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (typeof value === 'string' && !value.trim()) {
      return;
    }

    merged[key] = value;
  });

  return merged;
};

export const cleanupLegacyBusAttendantIdFields = async () => {
  if (!firebaseInitialized || !db) {
    return { cleaned: 0, skipped: true, reason: 'firebase-not-configured' };
  }

  const [profilesSnapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, PROFILES_COLLECTION)),
    getDocs(collection(db, USERS_COLLECTION)),
  ]);

  const targets = [
    ...profilesSnapshot.docs.map((item) => ({ ref: item.ref, data: item.data() || {} })),
    ...usersSnapshot.docs.map((item) => ({ ref: item.ref, data: item.data() || {} })),
  ].filter((item) => isBusAttendantProfile(item.data) && Object.prototype.hasOwnProperty.call(item.data, 'id'));

  let cleaned = 0;

  for (const target of targets) {
    try {
      await updateDoc(target.ref, {
        id: deleteField(),
        updated_at: serverTimestamp(),
      });
      cleaned += 1;
    } catch {
      // Ignore per-document cleanup errors so remaining docs can still be processed.
    }
  }

  return { cleaned, skipped: false };
};

export const dedupeBusAttendantDocs = async () => {
  if (!firebaseInitialized || !db) {
    return { deduped: 0, removed: 0, skipped: true, reason: 'firebase-not-configured' };
  }

  const dedupeCollection = async (collectionName) => {
    const snapshot = await getDocs(collection(db, collectionName));
    const groups = new Map();

    snapshot.docs.forEach((docSnapshot) => {
      const raw = docSnapshot.data() || {};
      if (!isBusAttendantProfile(raw)) {
        return;
      }

      const identityKey = getIdentityKey(raw);
      if (!identityKey) {
        return;
      }

      const current = groups.get(identityKey) || [];
      current.push({
        ref: docSnapshot.ref,
        id: docSnapshot.id,
        raw,
        updatedAt: Math.max(
          normalizeTimestamp(raw?.updated_at),
          normalizeTimestamp(raw?.updatedAt),
          normalizeTimestamp(raw?.created_at),
          normalizeTimestamp(raw?.createdAt)
        ),
      });
      groups.set(identityKey, current);
    });

    let deduped = 0;
    let removed = 0;

    for (const items of groups.values()) {
      if (!Array.isArray(items) || items.length <= 1) {
        continue;
      }

      const sorted = [...items].sort((left, right) => right.updatedAt - left.updatedAt);
      const canonical = sorted[0];
      const duplicates = sorted.slice(1);

      const mergedPayload = duplicates.reduce((accumulator, current) => {
        return mergeNonEmpty(accumulator, current.raw);
      }, canonical.raw);

      await setDoc(
        canonical.ref,
        {
          ...mergedPayload,
          updated_at: serverTimestamp(),
        },
        { merge: true }
      );

      for (const duplicate of duplicates) {
        try {
          await deleteDoc(duplicate.ref);
          removed += 1;
        } catch {
          // Ignore per-document deletion failure to continue cleanup.
        }
      }

      deduped += 1;
    }

    return { deduped, removed };
  };

  const [profileResult, userResult] = await Promise.all([
    dedupeCollection(PROFILES_COLLECTION),
    dedupeCollection(USERS_COLLECTION),
  ]);

  return {
    deduped: Number(profileResult?.deduped || 0) + Number(userResult?.deduped || 0),
    removed: Number(profileResult?.removed || 0) + Number(userResult?.removed || 0),
    skipped: false,
  };
};

export const cleanupBusAttendantData = async () => {
  const [legacyResult, dedupeResult] = await Promise.all([
    cleanupLegacyBusAttendantIdFields(),
    dedupeBusAttendantDocs(),
  ]);

  return {
    cleaned: Number(legacyResult?.cleaned || 0),
    deduped: Number(dedupeResult?.deduped || 0),
    removed: Number(dedupeResult?.removed || 0),
    skipped: Boolean(legacyResult?.skipped && dedupeResult?.skipped),
  };
};

export const cleanupBusAttendantDataOnce = async () => {
  if (typeof window === 'undefined') {
    return { cleaned: 0, deduped: 0, removed: 0, skipped: true, reason: 'no-window' };
  }

  if (window.localStorage.getItem(CLEANUP_FLAG_KEY) === '1') {
    return { cleaned: 0, deduped: 0, removed: 0, skipped: true, reason: 'already-cleaned' };
  }

  const result = await cleanupBusAttendantData();
  if (!result?.skipped) {
    window.localStorage.setItem(CLEANUP_FLAG_KEY, '1');
  }

  return result;
};
