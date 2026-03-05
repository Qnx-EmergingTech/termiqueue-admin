import { useEffect, useMemo, useState } from 'react';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import TableSkeletonRows from './TableSkeletonRows';
import SuccessModal from './SuccessModal';
import ConfirmationModal from './ConfirmationModal';
import {
  archiveBusAttendant,
  claimBus,
  createBusAttendant,
  fetchAttendantMyBusAssignments,
  fetchBusAttendants,
  fetchBuses,
  unarchiveBusAttendant,
  updateBusAttendant,
} from '../services/api';
import {
  cleanupBusAttendantDataOnce,
  setBusAttendantArchivedInFirebase,
  syncBusAttendantToFirebase,
} from '../services/busAttendantFirebaseSyncService';
import { provisionBusAttendantAuthUser } from '../services/busAttendantAuthProvisioningService';

const EMPTY_FORM = {
  first_name: '',
  middle_name: '',
  last_name: '',
  email: '',
  birthdate: '',
  assignedBusId: '',
};

function BusAttendants() {
  const [attendants, setAttendants] = useState([]);
  const [buses, setBuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('latestUpdated');
  const [sortOrder, setSortOrder] = useState('desc');
  const [viewMode, setViewMode] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedAttendant, setSelectedAttendant] = useState(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [archiveConfirmModal, setArchiveConfirmModal] = useState({
    open: false,
    attendantId: '',
    archive: true,
  });

  const [successModal, setSuccessModal] = useState({
    open: false,
    title: '',
    message: '',
    detail: '',
    autoCloseMs: 5000,
  });

  const [createConfirmModal, setCreateConfirmModal] = useState({
    open: false,
    payload: null,
    generatedUsername: '',
    generatedPassword: '',
  });

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

    return 0;
  };

  const formatAccountCreated = (attendant) => {
    const timestamp = normalizeTimestamp(
      attendant?.created_at ||
      attendant?.raw?.created_at
    );

    if (!timestamp) {
      return '-';
    }

    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return '-';
    }
  };

  const getRequestErrorMessage = (err, fallbackMessage) => {
    const validationDetails = err?.response?.data?.detail;
    const statusCode = err?.response?.status;
    const method = String(err?.config?.method || '').toUpperCase();
    const url = err?.config?.url;

    if (Array.isArray(validationDetails) && validationDetails.length > 0) {
      return validationDetails
        .map((item) => {
          const location = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : 'field';
          return `${location}: ${item?.msg || 'invalid value'}`;
        })
        .join(' | ');
    }

    const rawMessage =
      err?.response?.data?.message ||
      err?.response?.data?.detail ||
      err?.message ||
      fallbackMessage;

    if (statusCode || url) {
      const requestLabel = [method, url].filter(Boolean).join(' ');
      const statusLabel = statusCode ? `[${statusCode}] ` : '';
      return `${statusLabel}${requestLabel ? `${requestLabel} - ` : ''}${rawMessage}`;
    }

    return rawMessage;
  };

  const syncAttendantProfile = async (profile) => {
    try {
      const syncResult = await syncBusAttendantToFirebase(profile);

      if (!syncResult?.synced) {
        const reason = String(syncResult?.reason || 'unknown');
        const warning = reason === 'firebase-not-configured'
          ? 'Saved locally/API, but Firebase is not configured in this environment.'
          : 'Saved locally/API, but Firebase profile sync did not complete.';
        setError((previous) => previous || warning);
        return { synced: false, warning, userId: '', profileId: '' };
      }

      return {
        synced: true,
        warning: '',
        userId: String(syncResult?.userId || '').trim(),
        profileId: String(syncResult?.profileId || '').trim(),
      };
    } catch (syncError) {
      console.error('Failed to sync bus attendant profile to Firebase:', syncError);
      const warning = 'Saved to API/local data, but Firebase profile sync failed.';
      setError((previous) => previous || warning);
      return { synced: false, warning, userId: '', profileId: '' };
    }
  };

  const getAttendantIdentityKeys = (attendant) => {
    const normalizedEmail = String(attendant?.email || attendant?.raw?.email || '').trim().toLowerCase();
    const normalizedUsername = String(
      attendant?.username_lower || attendant?.username || attendant?.raw?.username_lower || attendant?.raw?.username || ''
    ).trim().toLowerCase();
    const normalizedId = String(attendant?.id || attendant?.uid || attendant?.user_id || '').trim().toLowerCase();

    return [normalizedEmail, normalizedUsername, normalizedId].filter(Boolean);
  };

  const matchesAttendantIdentity = (leftAttendant, rightAttendant) => {
    const leftKeys = getAttendantIdentityKeys(leftAttendant);
    const rightKeys = new Set(getAttendantIdentityKeys(rightAttendant));
    return leftKeys.some((key) => rightKeys.has(key));
  };

  const toLowerId = (value) => String(value || '').trim().toLowerCase();
  const toLowerText = (value) => String(value || '').trim().toLowerCase();

  const createBusLookup = (busList) => {
    const lookup = new Map();
    (Array.isArray(busList) ? busList : []).forEach((bus) => {
      const keys = [
        bus?.id,
        bus?.bus_id,
        bus?.busId,
        bus?.busNumber,
        bus?.bus_number,
        bus?.plateNumber,
        bus?.plate_number,
      ];

      keys.forEach((key) => {
        const normalized = toLowerId(key);
        if (normalized) {
          lookup.set(normalized, bus);
        }
      });
    });

    return lookup;
  };

  const enrichAttendant = (attendant, busList, busLookup, myBusMatch) => {
    const lookup = busLookup || createBusLookup(busList);
    const normalizedBusList = Array.isArray(busList) ? busList : [];

    const getBusKeys = (busItem) => {
      return [
        busItem?.id,
        busItem?.bus_id,
        busItem?.busId,
        busItem?.busNumber,
        busItem?.bus_number,
        busItem?.plateNumber,
        busItem?.plate_number,
      ].map((value) => toLowerId(value)).filter(Boolean);
    };

    const findUniqueBusForCandidate = (candidateValue) => {
      const normalizedCandidate = toLowerId(candidateValue);
      if (!normalizedCandidate) {
        return null;
      }

      const directFromLookup = lookup.get(normalizedCandidate) || null;
      const explicitMatches = normalizedBusList.filter((busItem) => getBusKeys(busItem).includes(normalizedCandidate));

      if (explicitMatches.length === 1) {
        return explicitMatches[0];
      }

      if (explicitMatches.length > 1) {
        return null;
      }

      return directFromLookup;
    };
    const assignedBusCandidates = [
      myBusMatch?.busId,
      myBusMatch?.busNumber,
      myBusMatch?.busPlateNumber,
      attendant?.assignedBusId,
      attendant?.assigned_bus_id,
      attendant?.assignedBusNumber,
      attendant?.assigned_bus_number,
      attendant?.assignedBusPlateNumber,
      attendant?.assigned_bus_plate_number,
      attendant?.bus_number,
      attendant?.plate_number,
      attendant?.bus_id,
      attendant?.busId,
      attendant?.raw?.assignedBusId,
      attendant?.raw?.assigned_bus_id,
      attendant?.raw?.assignedBusNumber,
      attendant?.raw?.assigned_bus_number,
      attendant?.raw?.assignedBusPlateNumber,
      attendant?.raw?.assigned_bus_plate_number,
      attendant?.raw?.bus_number,
      attendant?.raw?.plate_number,
      attendant?.raw?.bus_id,
      attendant?.raw?.busId,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    let assignedBus = null;
    for (const candidate of assignedBusCandidates) {
      assignedBus = findUniqueBusForCandidate(candidate);
      if (assignedBus) {
        break;
      }
    }

    if (!assignedBus) {
      const attendantIdentifiers = new Set([
        attendant?.id,
        attendant?.uid,
        attendant?.user_id,
        attendant?.username,
        attendant?.username_lower,
        attendant?.raw?.id,
        attendant?.raw?.uid,
        attendant?.raw?.user_id,
        attendant?.raw?.username,
        attendant?.raw?.username_lower,
      ].map((value) => toLowerId(value)).filter(Boolean));

      const matchedByAttendantId = normalizedBusList.filter((bus) => {
        const busAttendantId = toLowerId(bus?.attendantId || bus?.attendant_id);
        return busAttendantId && attendantIdentifiers.has(busAttendantId);
      });

      assignedBus = matchedByAttendantId.length === 1 ? matchedByAttendantId[0] : null;
    }

    if (!assignedBus) {
      const attendantNameCandidates = [
        attendant?.full_name,
        attendant?.fullName,
        attendant?.name,
        `${String(attendant?.first_name || '').trim()} ${String(attendant?.last_name || '').trim()}`,
        `${String(attendant?.raw?.first_name || '').trim()} ${String(attendant?.raw?.last_name || '').trim()}`,
      ]
        .map((value) => toLowerText(value))
        .filter(Boolean);

      if (attendantNameCandidates.length > 0) {
        const matchedByName = normalizedBusList.filter((bus) => {
          const busAttendantName = toLowerText(bus?.busAttendant || bus?.attendant_name || bus?.bus_attendant);
          return busAttendantName && attendantNameCandidates.some((nameCandidate) => nameCandidate === busAttendantName);
        });

        assignedBus = matchedByName.length === 1 ? matchedByName[0] : null;
      }
    }

    const getBusNumber = (busItem) => String(
      busItem?.busNumber || busItem?.bus_number || busItem?.busNo || busItem?.code || ''
    ).trim();

    const getBusPlateNumber = (busItem) => String(
      busItem?.plateNumber || busItem?.plate_number || busItem?.plateNo || ''
    ).trim();

    const resolvedAssignedBusId = String(
      assignedBus?.id || assignedBus?.bus_id || assignedBusCandidates[0] || attendant?.assignedBusId || ''
    ).trim();

    const fallbackAssignedBusNumber = String(
      myBusMatch?.busNumber ||
      attendant?.assignedBusNumber ||
      attendant?.assigned_bus_number ||
      attendant?.bus_number ||
      attendant?.raw?.assignedBusNumber ||
      attendant?.raw?.assigned_bus_number ||
      attendant?.raw?.bus_number ||
      ''
    ).trim();

    const fallbackAssignedBusPlateNumber = String(
      myBusMatch?.busPlateNumber ||
      attendant?.assignedBusPlateNumber ||
      attendant?.assigned_bus_plate_number ||
      attendant?.plate_number ||
      attendant?.raw?.assignedBusPlateNumber ||
      attendant?.raw?.assigned_bus_plate_number ||
      attendant?.raw?.plate_number ||
      ''
    ).trim();

    return {
      ...attendant,
      assignedBusId: resolvedAssignedBusId,
      assignedBusNumber: getBusNumber(assignedBus) || fallbackAssignedBusNumber || '-',
      assignedBusPlateNumber: getBusPlateNumber(assignedBus) || fallbackAssignedBusPlateNumber || '-',
      latestUpdated: normalizeTimestamp(
        attendant.updatedAt ||
        attendant.updated_at ||
        attendant.lastUpdated ||
        attendant.last_updated ||
        attendant.createdAt ||
        attendant.created_at ||
        attendant.raw?.updatedAt ||
        attendant.raw?.updated_at ||
        attendant.raw?.createdAt ||
        attendant.raw?.created_at
      ),
      is_archived: Boolean(attendant.is_archived || attendant.raw?.is_archived || attendant.raw?.archived),
    };
  };

  const createMyBusLookup = (assignments) => {
    const lookup = new Map();

    (Array.isArray(assignments) ? assignments : []).forEach((assignment) => {
      const keys = [
        String(assignment?.attendantId || '').trim().toLowerCase(),
        String(assignment?.email || '').trim().toLowerCase(),
        String(assignment?.username || '').trim().toLowerCase(),
      ].filter(Boolean);

      keys.forEach((key) => {
        if (!lookup.has(key)) {
          lookup.set(key, assignment);
        }
      });
    });

    return lookup;
  };

  const getMyBusMatchForAttendant = (attendant, myBusLookup) => {
    if (!myBusLookup || myBusLookup.size === 0) {
      return null;
    }

    const keys = getAttendantIdentityKeys(attendant);
    for (const key of keys) {
      const match = myBusLookup.get(String(key || '').toLowerCase());
      if (match) {
        return match;
      }
    }

    return null;
  };

  const buildEnrichedAttendants = (profiles, busList, myBusAssignments = []) => {
    const lookup = createBusLookup(busList);
    const myBusLookup = createMyBusLookup(myBusAssignments);

    return (Array.isArray(profiles) ? profiles : []).map((attendant) => {
      const myBusMatch = getMyBusMatchForAttendant(attendant, myBusLookup);
      return enrichAttendant(attendant, busList, lookup, myBusMatch);
    });
  };

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      try {
        await cleanupBusAttendantDataOnce();
      } catch (cleanupError) {
        console.warn('Legacy bus attendant cleanup skipped:', cleanupError);
      }

      const [profiles, busList, myBusAssignments] = await Promise.all([
        fetchBusAttendants(),
        fetchBuses().catch(() => []),
        fetchAttendantMyBusAssignments().catch(() => []),
      ]);

      const normalizedBuses = Array.isArray(busList) ? busList : [];
      setBuses(normalizedBuses);
      setAttendants(buildEnrichedAttendants(profiles, normalizedBuses, myBusAssignments));
    } catch (err) {
      setError(getRequestErrorMessage(err, 'Failed to load bus attendants.'));
      setAttendants([]);
      setBuses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const makeGeneratedUsername = (firstName, middleName, lastName) => {
    const normalizedFirst = String(firstName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedMiddle = String(middleName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedLast = String(lastName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const middleInitial = normalizedMiddle ? normalizedMiddle.charAt(0) : '';
    const baseCore = `${normalizedFirst}${middleInitial}${normalizedLast}` || `attendant${Date.now().toString().slice(-6)}`;
    const base = baseCore.slice(0, 16);
    const existing = new Set(
      attendants
        .map((attendant) => String(attendant.username || attendant.username_lower || '').toLowerCase())
        .filter(Boolean)
    );

    const dateSuffix = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    let candidate = `${base}${dateSuffix.slice(-4)}`;
    let attempts = 0;

    while (existing.has(candidate.toLowerCase()) && attempts < 40) {
      const numericSuffix = String(1000 + Math.floor(Math.random() * 9000));
      candidate = `${base}${numericSuffix}`;
      attempts += 1;
    }

    return candidate;
  };

  const makeGeneratedPassword = () => {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowercase = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*()-_=+[]{}';
    const allChars = `${uppercase}${lowercase}${digits}${symbols}`;

    const randomChar = (source) => source.charAt(Math.floor(Math.random() * source.length));

    const required = [
      randomChar(uppercase),
      randomChar(lowercase),
      randomChar(digits),
      randomChar(symbols),
    ];

    while (required.length < 14) {
      required.push(randomChar(allChars));
    }

    for (let index = required.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = required[index];
      required[index] = required[swapIndex];
      required[swapIndex] = temp;
    }

    return required.join('');
  };

  const activeAttendants = useMemo(
    () => attendants.filter((attendant) => !attendant.is_archived),
    [attendants]
  );

  const archivedAttendants = useMemo(
    () => attendants.filter((attendant) => attendant.is_archived),
    [attendants]
  );

  const sourceAttendants = viewMode === 'archived' ? archivedAttendants : activeAttendants;

  const filteredAttendants = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    if (!query) {
      return sourceAttendants;
    }

    return sourceAttendants.filter((attendant) => {
      const searchableValues = [
        attendant.first_name,
        attendant.last_name,
        attendant.username,
        attendant.email,
        attendant.assignedBusNumber,
        attendant.assignedBusPlateNumber,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return searchableValues.includes(query);
    });
  }, [sourceAttendants, searchQuery]);

  const sortedAttendants = useMemo(() => {
    const sortable = [...filteredAttendants];

    sortable.sort((leftItem, rightItem) => {
      if (sortBy === 'latestUpdated') {
        const leftValue = Number(leftItem?.latestUpdated || 0);
        const rightValue = Number(rightItem?.latestUpdated || 0);
        return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }

      const leftValue = String(leftItem?.[sortBy] || '').toLowerCase();
      const rightValue = String(rightItem?.[sortBy] || '').toLowerCase();

      if (leftValue < rightValue) {
        return sortOrder === 'asc' ? -1 : 1;
      }

      if (leftValue > rightValue) {
        return sortOrder === 'asc' ? 1 : -1;
      }

      return 0;
    });

    return sortable;
  }, [filteredAttendants, sortBy, sortOrder]);

  useEffect(() => {
    const maxPages = Math.max(1, Math.ceil(sortedAttendants.length / itemsPerPage));
    if (currentPage > maxPages) {
      setCurrentPage(maxPages);
    }
  }, [sortedAttendants.length, currentPage, itemsPerPage]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedAttendants.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.max(1, Math.ceil(sortedAttendants.length / itemsPerPage));

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setCurrentPage(1);
  };

  const handleSortChange = (event) => {
    setSortBy(event.target.value);
    setCurrentPage(1);
  };

  const handleSortOrderToggle = () => {
    setSortOrder((previousSortOrder) => (previousSortOrder === 'asc' ? 'desc' : 'asc'));
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    setCurrentPage(1);
    setSearchQuery('');
  };

  const paginate = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const openAddModal = () => {
    setAddForm(EMPTY_FORM);
    setShowAddModal(true);
    setError('');
  };

  const closeAddModal = () => {
    if (addSubmitting) {
      return;
    }

    setShowAddModal(false);
    setAddForm(EMPTY_FORM);
  };

  const handleAddInputChange = (event) => {
    const { name, value } = event.target;
    setAddForm((previous) => ({ ...previous, [name]: value }));
  };

  const isAtLeast18YearsOld = (birthdateValue) => {
    const rawBirthdate = String(birthdateValue || '').trim();
    if (!rawBirthdate) {
      return false;
    }

    const parsedBirthdate = new Date(rawBirthdate);
    if (Number.isNaN(parsedBirthdate.getTime())) {
      return false;
    }

    const now = new Date();
    let age = now.getUTCFullYear() - parsedBirthdate.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - parsedBirthdate.getUTCMonth();

    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < parsedBirthdate.getUTCDate())) {
      age -= 1;
    }

    return age >= 18;
  };

  const handleAddAttendant = async (event) => {
    event.preventDefault();
    setError('');

    const normalizedEmail = String(addForm.email || '').trim().toLowerCase();
    const emailExists = attendants.some(
      (attendant) => String(attendant.email || '').trim().toLowerCase() === normalizedEmail
    );

    if (emailExists) {
      setError('Email already exists. Please use a unique email address.');
      return;
    }

    if (!isAtLeast18YearsOld(addForm.birthdate)) {
      setError('Birthdate is invalid. Bus attendants must be at least 18 years old.');
      return;
    }

    const generatedUsername = makeGeneratedUsername(addForm.first_name, addForm.middle_name, addForm.last_name);
    const generatedPassword = makeGeneratedPassword();

    setCreateConfirmModal({
      open: true,
      payload: {
      first_name: addForm.first_name,
      middle_name: addForm.middle_name,
      last_name: addForm.last_name,
      email: addForm.email,
      birthdate: addForm.birthdate,
      assignedBusId: addForm.assignedBusId,
      username: generatedUsername,
      username_lower: generatedUsername.toLowerCase(),
      password: generatedPassword,
      user_type: 'bus_attendant',
      is_privileged: true,
      in_queue: false,
      is_archived: false,
      },
      generatedUsername,
      generatedPassword,
    });
  };

  const closeCreateConfirmation = () => {
    setCreateConfirmModal({
      open: false,
      payload: null,
      generatedUsername: '',
      generatedPassword: '',
    });
  };

  const confirmCreateAttendant = async () => {
    if (!createConfirmModal.payload || addSubmitting) {
      return;
    }

    const payload = createConfirmModal.payload;
    const generatedUsername = createConfirmModal.generatedUsername;
    const generatedPassword = createConfirmModal.generatedPassword;
    setAddSubmitting(true);
    setError('');

    try {
      const createdAttendant = await createBusAttendant(payload);

      if (payload.assignedBusId) {
        try {
          await claimBus(payload.assignedBusId, {
            profile_id: createdAttendant?.id,
            user_id: createdAttendant?.id,
            attendant_id: createdAttendant?.id,
            username: payload.username,
            email: payload.email,
            attendant_name: `${payload.first_name} ${payload.last_name}`.trim(),
          });
        } catch (claimError) {
          console.warn('Failed to claim bus for new attendant:', claimError);
          setError((previous) => previous || 'Attendant created, but bus assignment claim failed.');
        }
      }

      const authProvisionResult = await provisionBusAttendantAuthUser({
        email: payload.email,
        password: generatedPassword,
        displayName: `${payload.first_name} ${payload.last_name}`,
      });

      let authWarning = '';
      if (!authProvisionResult?.provisioned) {
        authWarning = 'Profile saved, but Firebase Authentication user was not created.';
        setError((previous) => previous || authWarning);
      }

      const syncStatus = await syncAttendantProfile({ ...payload, ...createdAttendant });
      const [freshProfiles, freshBuses, myBusAssignments] = await Promise.all([
        fetchBusAttendants(),
        fetchBuses().catch(() => buses),
        fetchAttendantMyBusAssignments().catch(() => []),
      ]);

      const canonicalCreatedAttendant = {
        ...payload,
        ...createdAttendant,
        id: syncStatus?.userId || createdAttendant?.id,
        updatedAt: Date.now(),
      };

      const normalizedBuses = Array.isArray(freshBuses) ? freshBuses : buses;
      const hasCreated = Array.isArray(freshProfiles)
        ? freshProfiles.some((profile) => matchesAttendantIdentity(profile, canonicalCreatedAttendant))
        : false;

      const withNewFallback = hasCreated
        ? freshProfiles
        : [
          ...freshProfiles,
          canonicalCreatedAttendant,
        ];

      setBuses(normalizedBuses);
      setAttendants(buildEnrichedAttendants(withNewFallback, normalizedBuses, myBusAssignments));
      setSortBy('latestUpdated');
      setSortOrder('desc');
      setCurrentPage(1);
      closeCreateConfirmation();
      setShowAddModal(false);
      setAddForm(EMPTY_FORM);

      setSuccessModal({
        open: true,
        title: 'Bus Attendant Added',
        message: `${payload.first_name} ${payload.last_name} has been added successfully.`,
        detail: [
          `Username: ${generatedUsername} | Password: ${generatedPassword}`,
          authProvisionResult?.provisioned
            ? (authProvisionResult?.existed ? 'Firebase Auth: existing account reused.' : 'Firebase Auth: account created.')
            : authWarning,
          syncStatus?.warning,
        ].filter(Boolean).join(' | '),
        autoCloseMs: 0,
      });
    } catch (err) {
      const requestMessage = getRequestErrorMessage(err, 'Failed to add bus attendant.');
      const normalizedMessage = String(requestMessage || '').toLowerCase();

      if (normalizedMessage.includes('profile already completed')) {
        try {
          const [freshProfiles, freshBuses, myBusAssignments] = await Promise.all([
            fetchBusAttendants(),
            fetchBuses().catch(() => buses),
            fetchAttendantMyBusAssignments().catch(() => []),
          ]);

          const normalizedBuses = Array.isArray(freshBuses) ? freshBuses : buses;
          const enrichedAttendants = buildEnrichedAttendants(freshProfiles, normalizedBuses, myBusAssignments);
          const existingProfile = enrichedAttendants.find(
            (attendant) => String(attendant.email || '').trim().toLowerCase() === String(payload.email || '').trim().toLowerCase()
          );

          setBuses(normalizedBuses);
          setAttendants(enrichedAttendants);
          closeCreateConfirmation();
          setShowAddModal(false);
          setAddForm(EMPTY_FORM);

          if (existingProfile) {
            setSuccessModal({
              open: true,
              title: 'Profile Already Exists',
              message: `${existingProfile.first_name || payload.first_name} ${existingProfile.last_name || payload.last_name} already has a completed profile.`,
              detail: `Existing username: ${existingProfile.username || 'N/A'}`,
              autoCloseMs: 5000,
            });
            return;
          }
        } catch {
          // Fall through to default error below if refresh fails.
        }
      }

      setError(requestMessage);
    } finally {
      setAddSubmitting(false);
    }
  };

  const openDetailsModal = (attendant) => {
    setSelectedAttendant(attendant);
    setEditForm({
      first_name: attendant.first_name || '',
      last_name: attendant.last_name || '',
      email: attendant.email || '',
      assignedBusId: attendant.assignedBusId || '',
    });
    setIsEditingDetails(false);
    setShowDetailsModal(true);
    setError('');
  };

  const closeDetailsModal = () => {
    if (editSubmitting) {
      return;
    }

    setShowDetailsModal(false);
    setSelectedAttendant(null);
    setIsEditingDetails(false);
    setEditForm(EMPTY_FORM);
  };

  const handleEditInputChange = (event) => {
    const { name, value } = event.target;
    setEditForm((previous) => ({ ...previous, [name]: value }));
  };

  const replaceAttendantInState = (updatedAttendant) => {
    const enrichedUpdatedAttendant = enrichAttendant(updatedAttendant, buses);

    setAttendants((previousAttendants) => previousAttendants.map((attendant) => (
      String(attendant.id) === String(updatedAttendant.id)
        ? {
          ...attendant,
          ...enrichedUpdatedAttendant,
          latestUpdated: normalizeTimestamp(enrichedUpdatedAttendant.updatedAt || Date.now()),
          updatedAt: normalizeTimestamp(enrichedUpdatedAttendant.updatedAt || Date.now()),
        }
        : attendant
    )));

    setSelectedAttendant((previousSelected) => {
      if (!previousSelected || String(previousSelected.id) !== String(updatedAttendant.id)) {
        return previousSelected;
      }

      return {
        ...previousSelected,
        ...enrichedUpdatedAttendant,
      };
    });
  };

  const handleSaveDetails = async () => {
    if (!selectedAttendant) {
      return;
    }

    setEditSubmitting(true);
    setError('');

    try {
      const assignmentChanged = String(editForm.assignedBusId || '').trim() !== String(selectedAttendant.assignedBusId || '').trim();

      const updatedAttendant = await updateBusAttendant(selectedAttendant.id, {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        email: editForm.email,
        assignedBusId: editForm.assignedBusId,
      });

      if (assignmentChanged && editForm.assignedBusId) {
        try {
          await claimBus(editForm.assignedBusId, {
            profile_id: selectedAttendant.id,
            user_id: selectedAttendant.id,
            attendant_id: selectedAttendant.id,
            username: updatedAttendant?.username || selectedAttendant?.username,
            email: editForm.email || selectedAttendant?.email,
            attendant_name: `${editForm.first_name} ${editForm.last_name}`.trim(),
          });
        } catch (claimError) {
          console.warn('Failed to claim bus on attendant update:', claimError);
          setError((previous) => previous || 'Details saved, but bus assignment claim failed.');
        }
      }

      const syncStatus = await syncAttendantProfile(updatedAttendant);

      replaceAttendantInState(updatedAttendant);
      setIsEditingDetails(false);
      setSuccessModal({
        open: true,
        title: 'Details Updated',
        message: 'Bus attendant details were saved successfully.',
        detail: syncStatus?.warning || '',
        autoCloseMs: 5000,
      });
    } catch (err) {
      setError(getRequestErrorMessage(err, 'Failed to update bus attendant details.'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const requestArchiveConfirmation = (attendantId, archive) => {
    setArchiveConfirmModal({
      open: true,
      attendantId: String(attendantId || ''),
      archive,
    });
  };

  const closeArchiveConfirmation = () => {
    setArchiveConfirmModal({
      open: false,
      attendantId: '',
      archive: true,
    });
  };

  const handleConfirmArchiveAction = async () => {
    const attendantId = archiveConfirmModal.attendantId;
    const shouldArchive = archiveConfirmModal.archive;

    closeArchiveConfirmation();
    if (!attendantId) {
      return;
    }

    setError('');
    try {
      const updatedAttendant = shouldArchive
        ? await archiveBusAttendant(attendantId)
        : await unarchiveBusAttendant(attendantId);

      let archiveSyncWarning = '';
      try {
        const syncResult = await setBusAttendantArchivedInFirebase(updatedAttendant, shouldArchive);
        if (!syncResult?.synced) {
          const reason = String(syncResult?.reason || 'unknown');
          archiveSyncWarning = reason === 'firebase-not-configured'
            ? 'Firebase is not configured, so archive state was saved locally/API only.'
            : 'Archive state was saved locally/API, but Firebase sync did not complete.';
          setError((previous) => previous || archiveSyncWarning);
        }
      } catch (syncError) {
        console.error('Failed to sync archive state to Firebase:', syncError);
        archiveSyncWarning = 'Saved to API/local data, but Firebase archive sync failed.';
        setError((previous) => previous || archiveSyncWarning);
      }

      replaceAttendantInState(updatedAttendant);

      setSuccessModal({
        open: true,
        title: shouldArchive ? 'Bus Attendant Archived' : 'Bus Attendant Restored',
        message: shouldArchive
          ? 'The bus attendant was moved to archived.'
          : 'The bus attendant is active again.',
        detail: archiveSyncWarning,
        autoCloseMs: 5000,
      });

      if (selectedAttendant && String(selectedAttendant.id) === String(attendantId) && shouldArchive && viewMode !== 'archived') {
        closeDetailsModal();
      }
    } catch (err) {
      setError(getRequestErrorMessage(err, shouldArchive ? 'Failed to archive bus attendant.' : 'Failed to restore bus attendant.'));
    }
  };

  const visibleBusOptions = useMemo(
    () => buses.filter((bus) => String(bus.status || '').toLowerCase() !== 'offline'),
    [buses]
  );

  return (
    <main className="content">
      <SuccessModal
        open={successModal.open}
        title={successModal.title}
        message={successModal.message}
        detail={successModal.detail}
        autoCloseMs={successModal.autoCloseMs}
        onClose={() => setSuccessModal({ open: false, title: '', message: '', detail: '', autoCloseMs: 5000 })}
      />

      <ConfirmationModal
        open={createConfirmModal.open}
        title="Confirm Bus Attendant Creation"
        message={`Create account for ${createConfirmModal.payload?.first_name || ''} ${createConfirmModal.payload?.last_name || ''}?`}
        note="A username and password have been generated and will be shown after successful creation."
        confirmLabel={addSubmitting ? 'Adding...' : 'Create Account'}
        confirmDisabled={addSubmitting}
        cancelDisabled={addSubmitting}
        closeDisabled={addSubmitting}
        onCancel={closeCreateConfirmation}
        onConfirm={confirmCreateAttendant}
      />

      <ConfirmationModal
        open={archiveConfirmModal.open}
        title={archiveConfirmModal.archive ? 'Confirm Archive' : 'Confirm Restore'}
        message={archiveConfirmModal.archive
          ? 'Archive this bus attendant account?'
          : 'Restore this bus attendant account to active list?'}
        note={archiveConfirmModal.archive
          ? 'Archived attendants are hidden from active list.'
          : 'Restored attendants will appear in active list.'}
        confirmLabel={archiveConfirmModal.archive ? 'Confirm Archive' : 'Confirm Restore'}
        confirmVariant={archiveConfirmModal.archive ? 'danger' : 'primary'}
        onCancel={closeArchiveConfirmation}
        onConfirm={handleConfirmArchiveAction}
      />

      <div className="requests-container">
        <div className="requests-header">
          <div className="header-content">
            <div>
              <h1>Bus Attendants</h1>
              <p className="subtitle">Create accounts, update details, and archive attendants</p>
            </div>
          </div>
        </div>

        <div className="search-sort-controls">
          <div className="search-sort-group">
            <div className="search-bar">
              <input
                type="text"
                placeholder={viewMode === 'archived'
                  ? 'Search archived attendants by name, username, email, bus number, or plate...'
                  : 'Search active attendants by name, username, email, bus number, or plate...'}
                value={searchQuery}
                onChange={handleSearchChange}
                className="search-input"
              />
            </div>

            <div className="sort-controls">
              <label htmlFor="busAttendantSortBy">Sort by:</label>
              <select
                id="busAttendantSortBy"
                value={sortBy}
                onChange={handleSortChange}
                className="sort-select"
              >
                <option value="latestUpdated">Latest Updated</option>
                <option value="first_name">First Name</option>
                <option value="last_name">Last Name</option>
                <option value="username">Username</option>
                <option value="email">Email</option>
                <option value="assignedBusNumber">Bus Number</option>
              </select>

              <button
                type="button"
                onClick={handleSortOrderToggle}
                className="sort-order-btn"
                title={`Currently sorting ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>

          <div className="bus-actions-toolbar">
            <div className="view-toggle-group">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'active' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('active')}
              >
                Active ({activeAttendants.length})
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'archived' ? 'active' : ''}`}
                onClick={() => handleViewModeChange('archived')}
              >
                Archived ({archivedAttendants.length})
              </button>
            </div>

            {viewMode === 'active' && (
              <button type="button" className="add-bus-btn" onClick={openAddModal}>
                + Add Bus Attendant
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="dashboard-warning-banner" role="alert" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div className="table-container">
          <table className="requests-table">
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Bus Number</th>
                <th>Bus Plate Number</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows rows={6} columns={6} />
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                    {searchQuery ? 'No attendants match your search.' : `No ${viewMode} bus attendants found.`}
                  </td>
                </tr>
              ) : (
                currentItems.map((attendant) => (
                  <tr
                    key={`${attendant.id}-${attendant.username || 'attendant'}`}
                    className="clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetailsModal(attendant)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDetailsModal(attendant);
                      }
                    }}
                  >
                    <td>{attendant.first_name || '-'}</td>
                    <td>{attendant.last_name || '-'}</td>
                    <td>{attendant.username || '-'}</td>
                    <td>{attendant.email || '-'}</td>
                    <td>{attendant.assignedBusNumber || '-'}</td>
                    <td>{attendant.assignedBusPlateNumber || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedAttendants.length > 0 && (
          <div className="pagination">
            <button
              onClick={() => paginate(currentPage - 1)}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>

            <div className="page-numbers">
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  key={pageNumber}
                  onClick={() => paginate(pageNumber)}
                  className={`page-number ${currentPage === pageNumber ? 'active' : ''}`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>

            <button
              onClick={() => paginate(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="pagination-btn"
            >
              Next
            </button>
          </div>
        )}

        {sortedAttendants.length > 0 && (
          <div className="table-info">
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, sortedAttendants.length)} of {sortedAttendants.length} {viewMode} bus attendants
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-content add-bus-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Bus Attendant</h2>
              <button className="close-btn" onClick={closeAddModal}>&times;</button>
            </div>

            <form className="modal-body" onSubmit={handleAddAttendant}>
              <div className="form-grid">
                <div className="form-section">
                  <h3>Attendant Details</h3>

                  <div className="form-group">
                    <label htmlFor="first_name">First Name *</label>
                    <input
                      id="first_name"
                      name="first_name"
                      type="text"
                      value={addForm.first_name}
                      onChange={handleAddInputChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="middle_name">Middle Name</label>
                    <input
                      id="middle_name"
                      name="middle_name"
                      type="text"
                      value={addForm.middle_name}
                      onChange={handleAddInputChange}
                      placeholder="Optional"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="last_name">Last Name *</label>
                    <input
                      id="last_name"
                      name="last_name"
                      type="text"
                      value={addForm.last_name}
                      onChange={handleAddInputChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="email">Email *</label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      value={addForm.email}
                      onChange={handleAddInputChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="birthdate">Birthdate *</label>
                    <input
                      id="birthdate"
                      name="birthdate"
                      type="date"
                      value={addForm.birthdate}
                      onChange={handleAddInputChange}
                      required
                    />
                  </div>

                  <p className="info-note">
                    Username and password are generated automatically after creating this account.
                  </p>

                  <div className="form-group">
                    <label htmlFor="assignedBusId">Assigned Bus</label>
                    <select
                      id="assignedBusId"
                      name="assignedBusId"
                      value={addForm.assignedBusId}
                      onChange={handleAddInputChange}
                    >
                      <option value="">Unassigned</option>
                      {visibleBusOptions.map((bus) => (
                        <option key={bus.id} value={bus.id}>
                          {String(bus.busNumber || bus.bus_number || 'N/A')} ({String(bus.plateNumber || bus.plate_number || 'N/A')})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={closeAddModal} disabled={addSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit" disabled={addSubmitting}>
                  {addSubmitting ? 'Adding...' : 'Add Attendant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetailsModal && selectedAttendant && (
        <div className="modal-overlay" onClick={closeDetailsModal}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Bus Attendant Details</h2>
              <button className="close-btn" onClick={closeDetailsModal}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="bus-info-grid">
                <div className="info-section">
                  <h3>Profile</h3>

                  <div className="info-row">
                    <span className="info-label">Username:</span>
                    <span className="info-value">{selectedAttendant.username || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">First Name:</span>
                    {isEditingDetails ? (
                      <input
                        className="inline-edit-input"
                        name="first_name"
                        value={editForm.first_name}
                        onChange={handleEditInputChange}
                      />
                    ) : (
                      <span className="info-value">{selectedAttendant.first_name || '-'}</span>
                    )}
                  </div>

                  <div className="info-row">
                    <span className="info-label">Last Name:</span>
                    {isEditingDetails ? (
                      <input
                        className="inline-edit-input"
                        name="last_name"
                        value={editForm.last_name}
                        onChange={handleEditInputChange}
                      />
                    ) : (
                      <span className="info-value">{selectedAttendant.last_name || '-'}</span>
                    )}
                  </div>

                  <div className="info-row">
                    <span className="info-label">Email:</span>
                    {isEditingDetails ? (
                      <input
                        className="inline-edit-input"
                        type="email"
                        name="email"
                        value={editForm.email}
                        onChange={handleEditInputChange}
                      />
                    ) : (
                      <span className="info-value">{selectedAttendant.email || '-'}</span>
                    )}
                  </div>

                  <div className="info-row">
                    <span className="info-label">Account Created:</span>
                    <span className="info-value">{formatAccountCreated(selectedAttendant)}</span>
                  </div>
                </div>

                <div className="info-section">
                  <h3>Assignment</h3>

                  <div className="info-row">
                    <span className="info-label">Bus Number:</span>
                    <span className="info-value">{selectedAttendant.assignedBusNumber || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Bus Plate Number:</span>
                    <span className="info-value">{selectedAttendant.assignedBusPlateNumber || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Assigned Bus:</span>
                    {isEditingDetails ? (
                      <select
                        className="inline-edit-input"
                        name="assignedBusId"
                        value={editForm.assignedBusId}
                        onChange={handleEditInputChange}
                      >
                        <option value="">Unassigned</option>
                        {visibleBusOptions.map((bus) => (
                          <option key={`edit-attendant-bus-${bus.id}`} value={bus.id}>
                            {bus.busNumber} ({bus.plateNumber})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="info-value">
                        {selectedAttendant.assignedBusId ? selectedAttendant.assignedBusId : 'Unassigned'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-actions-row bus-modal-actions">
                {isEditingDetails ? (
                  <>
                    <button
                      type="button"
                      className="bus-action-btn primary"
                      onClick={handleSaveDetails}
                      disabled={editSubmitting}
                    >
                      {editSubmitting ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      className="bus-action-btn secondary"
                      onClick={() => {
                        setIsEditingDetails(false);
                        setEditForm({
                          first_name: selectedAttendant.first_name || '',
                          last_name: selectedAttendant.last_name || '',
                          email: selectedAttendant.email || '',
                          assignedBusId: selectedAttendant.assignedBusId || '',
                        });
                      }}
                      disabled={editSubmitting}
                    >
                      Cancel Edit
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="bus-action-btn primary"
                    onClick={() => setIsEditingDetails(true)}
                  >
                    Edit Details
                  </button>
                )}

                {selectedAttendant.is_archived ? (
                  <button
                    type="button"
                    className="bus-action-btn secondary"
                    onClick={() => requestArchiveConfirmation(selectedAttendant.id, false)}
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bus-action-btn danger"
                    onClick={() => requestArchiveConfirmation(selectedAttendant.id, true)}
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default BusAttendants;