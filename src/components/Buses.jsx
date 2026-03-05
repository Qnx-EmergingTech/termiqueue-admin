import { useState, useEffect, useMemo } from 'react';
import { MdChevronRight } from 'react-icons/md';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import TableSkeletonRows from './TableSkeletonRows';
import { createBus, deleteBus, fetchBuses, fetchQueues, updateBus } from '../services/api';
import { syncBusToFirebase } from '../services/busFirebaseSyncService';
import SuccessModal from './SuccessModal';
import ConfirmationModal from './ConfirmationModal';

function Buses() {
  const [buses, setBuses] = useState([]); // Use empty array [] when API is ready
  const [archivedBuses, setArchivedBuses] = useState([]);
  const [selectedBusIds, setSelectedBusIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [selectedBus, setSelectedBus] = useState(null);
  const [editingBus, setEditingBus] = useState(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('active');
  const [sortBy, setSortBy] = useState('lastUpdated');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [queueRoutes, setQueueRoutes] = useState([]);
  const [queueRoutesError, setQueueRoutesError] = useState(null);
  const [successModal, setSuccessModal] = useState({
    open: false,
    title: '',
    message: '',
    detail: '',
  });
  const [archiveConfirmModal, setArchiveConfirmModal] = useState({
    open: false,
    busIds: [],
  });
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    open: false,
    busIds: [],
  });
  const [saveConfirmModal, setSaveConfirmModal] = useState({
    open: false,
  });
  const [newBus, setNewBus] = useState({
    busNumber: '',
    route: '',
    busCompany: '',
    status: 'Available',
    plateNumber: '',
    capacity: '',
    busCompanyEmail: '',
    busCompanyContact: '',
    registeredDestination: ''
  });

  const parseRouteParts = (routeText, fallbackDestination = '') => {
    const normalizedRoute = String(routeText || '').trim();
    const normalizedFallbackDestination = String(fallbackDestination || '').trim();

    if (!normalizedRoute) {
      return { origin: '', destination: normalizedFallbackDestination };
    }

    const parts = normalizedRoute.split('-').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      return {
        origin: parts[0] || '',
        destination: normalizedFallbackDestination,
      };
    }

    return {
      origin: parts[0],
      destination: parts.slice(1).join(' - ') || normalizedFallbackDestination,
    };
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

  useEffect(() => {
    let isMounted = true;

    const loadInitialBuses = async () => {
      setLoading(true);
      setError(null);

      try {
        const apiBuses = await fetchBuses();

        if (!isMounted) {
          return;
        }

        const activeBuses = apiBuses.filter((bus) => bus.status !== 'Offline');
        const archivedFromApi = apiBuses.filter((bus) => bus.status === 'Offline');

        setBuses(activeBuses);
        setArchivedBuses(archivedFromApi);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        console.error('Error loading buses from API:', err);
        setError(getRequestErrorMessage(err, 'Failed to load buses from API.'));
        setBuses([]);
        setArchivedBuses([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadInitialBuses();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadQueueRoutes = async () => {
      try {
        const routes = await fetchQueues();

        if (!isMounted) {
          return;
        }

        setQueueRoutes(Array.isArray(routes) ? routes : []);
        setQueueRoutesError(null);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        console.warn('Unable to load routes from /queues:', err);
        setQueueRoutes([]);
        setQueueRoutesError(getRequestErrorMessage(err, 'Failed to load routes from queues endpoint.'));
      }
    };

    loadQueueRoutes();

    return () => {
      isMounted = false;
    };
  }, []);

  const routeOptions = useMemo(() => {
    const seen = new Set();

    const queueBasedOptions = queueRoutes
      .map((routeItem) => {
        const origin = String(routeItem?.origin || '').trim();
        const destination = String(routeItem?.destination || '').trim();

        if (!origin || !destination) {
          return null;
        }

        return {
          origin,
          destination,
          label: `${origin} → ${destination}`,
        };
      })
      .filter(Boolean);

    const busBasedOptions = [...buses, ...archivedBuses]
      .map((busItem) => {
        const routeParts = parseRouteParts(busItem?.route, busItem?.registeredDestination);
        if (!routeParts.origin || !routeParts.destination) {
          return null;
        }

        return {
          origin: routeParts.origin,
          destination: routeParts.destination,
          label: `${routeParts.origin} → ${routeParts.destination}`,
        };
      })
      .filter(Boolean);

    return [...queueBasedOptions, ...busBasedOptions]
      .map((routeOption) => {
        const key = `${routeOption.origin}::${routeOption.destination}`.toLowerCase();
        if (seen.has(key)) {
          return null;
        }

        seen.add(key);
        return routeOption;
      })
      .filter(Boolean);
  }, [queueRoutes, buses, archivedBuses]);

  const originOptions = useMemo(() => {
    const uniqueOrigins = new Set(routeOptions.map((option) => option.origin));
    return Array.from(uniqueOrigins).sort((left, right) => left.localeCompare(right));
  }, [routeOptions]);

  const destinationOptions = useMemo(() => {
    if (!newBus.route) {
      return [];
    }

    const destinations = new Set(
      routeOptions
        .filter((option) => option.origin === newBus.route)
        .map((option) => option.destination)
    );

    return Array.from(destinations).sort((left, right) => left.localeCompare(right));
  }, [routeOptions, newBus.route]);

  const editDestinationOptions = useMemo(() => {
    if (!editingBus?.route) {
      return [];
    }

    const destinations = new Set(
      routeOptions
        .filter((option) => option.origin === editingBus.route)
        .map((option) => option.destination)
    );

    return Array.from(destinations).sort((left, right) => left.localeCompare(right));
  }, [routeOptions, editingBus?.route]);

  // Filter buses based on search query
  const sourceBuses = viewMode === 'active' ? buses : archivedBuses;

  const filteredBuses = sourceBuses.filter(bus => {
    const query = searchQuery.toLowerCase();
    return (
      bus.busNumber.toLowerCase().includes(query) ||
      bus.route.toLowerCase().includes(query) ||
      bus.busCompany.toLowerCase().includes(query) ||
      bus.plateNumber.toLowerCase().includes(query) ||
      bus.status.toLowerCase().includes(query)
    );
  });

  // Sort buses
  const sortedBuses = [...filteredBuses].sort((a, b) => {
    let aValue, bValue;

    switch (sortBy) {
      case 'busNumber':
        aValue = a.busNumber;
        bValue = b.busNumber;
        break;
      case 'route':
        aValue = a.route;
        bValue = b.route;
        break;
      case 'busCompany':
        aValue = a.busCompany;
        bValue = b.busCompany;
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      case 'capacity':
        aValue = a.capacity;
        bValue = b.capacity;
        break;
      case 'lastUpdated':
      default:
        aValue = a.lastUpdated;
        bValue = b.lastUpdated;
        break;
    }

    if (sortBy === 'capacity' || sortBy === 'lastUpdated') {
      // Numeric comparison
      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    } else {
      // String comparison
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    }
  });

  // Calculate pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedBuses.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.max(1, Math.ceil(sortedBuses.length / itemsPerPage));

  // Change page
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  // Reset to first page when search or sort changes
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleViewModeChange = (nextMode) => {
    setViewMode(nextMode);
    setCurrentPage(1);
    setSelectedBusIds([]);
  };

  const handleSortChange = (e) => {
    setSortBy(e.target.value);
    setCurrentPage(1);
  };

  const handleSortOrderToggle = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    setCurrentPage(1);
  };

  const renderRouteWithChevron = (routeValue) => {
    const routeText = String(routeValue || '').trim();

    if (!routeText) {
      return <span className="route-fallback">N/A</span>;
    }

    const routeParts = routeText.split('-').map((part) => part.trim()).filter(Boolean);

    if (routeParts.length < 2) {
      return <span className="route-single">{routeText}</span>;
    }

    const origin = routeParts[0];
    const destination = routeParts.slice(1).join(' - ');

    return (
      <span className="route-display" title={`${origin} → ${destination}`}>
        <span className="route-origin">{origin}</span>
        <MdChevronRight className="route-chevron" aria-hidden="true" />
        <span className="route-destination">{destination}</span>
      </span>
    );
  };

  const archiveBusIds = async (busIds) => {
    if (!Array.isArray(busIds) || busIds.length === 0) {
      return;
    }

    const idsToArchive = new Set(busIds);
    const busesToArchive = buses.filter((bus) => idsToArchive.has(bus.id));

    if (busesToArchive.length === 0) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await Promise.all(
        busesToArchive.map((bus) => updateBus(bus.id, { status: 'offline' }))
      );

      const archivedEntries = busesToArchive.map((bus) => ({
        ...bus,
        previousStatus: bus.status,
        status: 'Offline',
        archivedAt: Date.now(),
        lastUpdated: Date.now(),
      }));

      setArchivedBuses((previousArchivedBuses) => [...archivedEntries, ...previousArchivedBuses]);
      setBuses((previousBuses) => previousBuses.filter((bus) => !idsToArchive.has(bus.id)));
      setSelectedBusIds((previousSelectedBusIds) => previousSelectedBusIds.filter((id) => !idsToArchive.has(id)));

      setSuccessModal({
        open: true,
        title: 'Bus Archived',
        message: idsToArchive.size > 1
          ? `${idsToArchive.size} buses were moved to Offline.`
          : 'Bus was moved to Offline.',
        detail: 'You can restore it anytime from the Offline tab.',
      });

      if (selectedBus && idsToArchive.has(selectedBus.id)) {
        closeModal();
      }
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Failed to archive buses');
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const deleteArchivedBusIds = async (busIds) => {
    if (!Array.isArray(busIds) || busIds.length === 0) {
      return;
    }

    const idsToDelete = new Set(busIds);

    const busesToDelete = archivedBuses.filter((bus) => idsToDelete.has(bus.id));

    try {
      setLoading(true);
      setError(null);

      await Promise.all(
        busesToDelete.map((bus) => deleteBus(bus.id))
      );

      setArchivedBuses((previousArchivedBuses) => previousArchivedBuses.filter((bus) => !idsToDelete.has(bus.id)));
      setSelectedBusIds((previousSelectedBusIds) => previousSelectedBusIds.filter((id) => !idsToDelete.has(id)));

      if (selectedBus && idsToDelete.has(selectedBus.id)) {
        closeModal();
      }
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Failed to delete archived buses');
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const unarchiveBusIds = async (busIds) => {
    if (!Array.isArray(busIds) || busIds.length === 0) {
      return;
    }

    const idsToRestore = new Set(busIds);
    const busesToRestore = archivedBuses.filter((bus) => idsToRestore.has(bus.id));

    if (busesToRestore.length === 0) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await Promise.all(
        busesToRestore.map((bus) => updateBus(bus.id, { status: 'active' }))
      );

      const restoredBuses = busesToRestore.map((bus) => {
        const { previousStatus, archivedAt, ...restBus } = bus;

        return {
          ...restBus,
          status: 'Active',
          lastUpdated: Date.now(),
        };
      });

      setBuses((previousBuses) => [...restoredBuses, ...previousBuses]);
      setArchivedBuses((previousArchivedBuses) => previousArchivedBuses.filter((bus) => !idsToRestore.has(bus.id)));
      setSelectedBusIds((previousSelectedBusIds) => previousSelectedBusIds.filter((id) => !idsToRestore.has(id)));

      setSuccessModal({
        open: true,
        title: 'Bus Restored',
        message: idsToRestore.size > 1
          ? `${idsToRestore.size} buses were restored to active lists.`
          : 'Bus was restored to active lists.',
        detail: '',
      });

      if (selectedBus && idsToRestore.has(selectedBus.id)) {
        closeModal();
      }
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Failed to unarchive buses');
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const requestArchiveConfirmation = (busIds) => {
    if (!Array.isArray(busIds) || busIds.length === 0) {
      return;
    }

    setArchiveConfirmModal({
      open: true,
      busIds: Array.from(new Set(busIds)),
    });
  };

  const closeArchiveConfirmation = () => {
    setArchiveConfirmModal({
      open: false,
      busIds: [],
    });
  };

  const confirmArchive = async () => {
    const idsToArchive = archiveConfirmModal.busIds;
    closeArchiveConfirmation();
    await archiveBusIds(idsToArchive);
  };

  const handleArchiveBus = async (busId) => {
    requestArchiveConfirmation([busId]);
  };

  const handleBatchArchive = async () => {
    requestArchiveConfirmation(selectedBusIds);
  };

  const requestDeleteConfirmation = (busIds) => {
    if (!Array.isArray(busIds) || busIds.length === 0) {
      return;
    }

    setDeleteConfirmModal({
      open: true,
      busIds: Array.from(new Set(busIds)),
    });
  };

  const closeDeleteConfirmation = () => {
    setDeleteConfirmModal({
      open: false,
      busIds: [],
    });
  };

  const confirmDeleteArchived = async () => {
    const idsToDelete = deleteConfirmModal.busIds;
    closeDeleteConfirmation();
    await deleteArchivedBusIds(idsToDelete);
  };

  const handleDeleteArchivedBus = async (busId) => {
    requestDeleteConfirmation([busId]);
  };

  const handleUnarchiveBus = async (busId) => {
    await unarchiveBusIds([busId]);
  };

  const handleBatchDeleteArchived = async () => {
    requestDeleteConfirmation(selectedBusIds);
  };

  const handleBatchUnarchive = async () => {
    await unarchiveBusIds(selectedBusIds);
  };

  const currentPageBusIds = currentItems.map((bus) => bus.id);
  const hasCurrentItems = currentPageBusIds.length > 0;
  const isAllCurrentPageSelected = hasCurrentItems && currentPageBusIds.every((id) => selectedBusIds.includes(id));

  const handleToggleSelectBus = (busId) => {
    setSelectedBusIds((previousSelectedBusIds) => (
      previousSelectedBusIds.includes(busId)
        ? previousSelectedBusIds.filter((id) => id !== busId)
        : [...previousSelectedBusIds, busId]
    ));
  };

  const handleToggleSelectAllCurrent = () => {
    if (!hasCurrentItems) {
      return;
    }

    setSelectedBusIds((previousSelectedBusIds) => {
      if (isAllCurrentPageSelected) {
        return previousSelectedBusIds.filter((id) => !currentPageBusIds.includes(id));
      }

      const selectedSet = new Set(previousSelectedBusIds);
      currentPageBusIds.forEach((id) => selectedSet.add(id));
      return Array.from(selectedSet);
    });
  };

  // Handle row click
  const handleRowClick = (bus) => {
    const routeParts = parseRouteParts(bus.route, bus.registeredDestination);

    setSelectedBus(bus);
    setEditingBus({
      ...bus,
      route: routeParts.origin,
      registeredDestination: routeParts.destination,
      capacity: String(bus.capacity ?? ''),
    });
    setIsEditingDetails(false);
    setShowModal(true);
  };

  // Close modal
  const closeModal = () => {
    setShowModal(false);
    setSelectedBus(null);
    setEditingBus(null);
    setIsEditingDetails(false);
    setSaveConfirmModal({ open: false });
  };

  const openSaveConfirmation = () => {
    if (!editingBus) {
      return;
    }

    if (!editingBus.busNumber || !editingBus.route || !editingBus.busCompany ||
      !editingBus.plateNumber || !editingBus.capacity ||
      !editingBus.busCompanyEmail || !editingBus.busCompanyContact ||
      !editingBus.registeredDestination) {
      alert('Please fill in all required fields before saving.');
      return;
    }

    setSaveConfirmModal({ open: true });
  };

  const closeSaveConfirmation = () => {
    setSaveConfirmModal({ open: false });
  };

  const handleEditDetailsInputChange = (event) => {
    const { name, value } = event.target;

    setEditingBus((previousBus) => {
      if (name === 'route') {
        return {
          ...previousBus,
          route: value,
          registeredDestination: '',
        };
      }

      return {
        ...previousBus,
        [name]: value,
      };
    });
  };

  const applyUpdatedBusToCollections = (updatedBus) => {
    setBuses((previousBuses) => {
      const withoutUpdated = previousBuses.filter((bus) => bus.id !== updatedBus.id);
      if (updatedBus.status === 'Offline') {
        return withoutUpdated;
      }

      return [updatedBus, ...withoutUpdated];
    });

    setArchivedBuses((previousArchivedBuses) => {
      const withoutUpdated = previousArchivedBuses.filter((bus) => bus.id !== updatedBus.id);
      if (updatedBus.status === 'Offline') {
        return [updatedBus, ...withoutUpdated];
      }

      return withoutUpdated;
    });
  };

  const handleSaveBusDetails = async () => {
    if (!editingBus) {
      return;
    }

    if (!editingBus.busNumber || !editingBus.route || !editingBus.busCompany ||
      !editingBus.plateNumber || !editingBus.capacity ||
      !editingBus.busCompanyEmail || !editingBus.busCompanyContact ||
      !editingBus.registeredDestination) {
      alert('Please fill in all required fields before saving.');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = {
        busNumber: editingBus.busNumber,
        route: editingBus.route,
        busCompany: editingBus.busCompany,
        status: editingBus.status,
        plateNumber: editingBus.plateNumber,
        capacity: parseInt(editingBus.capacity, 10),
        busCompanyEmail: editingBus.busCompanyEmail,
        busCompanyContact: editingBus.busCompanyContact,
        registeredDestination: editingBus.registeredDestination,
        busPhoto: editingBus.busPhoto,
      };

      const updatedBusFromApi = await updateBus(selectedBus.id, payload);
      const mergedUpdatedBus = {
        ...payload,
        ...updatedBusFromApi,
        id: updatedBusFromApi?.id || selectedBus.id,
        lastUpdated: updatedBusFromApi?.lastUpdated || Date.now(),
      };

      applyUpdatedBusToCollections(mergedUpdatedBus);
      setSelectedBus(mergedUpdatedBus);
      setEditingBus({
        ...mergedUpdatedBus,
        capacity: String(mergedUpdatedBus.capacity ?? ''),
      });
      setIsEditingDetails(false);

      let firebaseSkipped = false;
      try {
        const syncResult = await syncBusToFirebase(mergedUpdatedBus);
        if (syncResult?.reason === 'firebase-not-configured') {
          firebaseSkipped = true;
          setError('Saved to API, but Firebase sync is disabled. Add VITE_FIREBASE_* values in .env and restart the app.');
          console.warn('Firebase is not configured (.env missing VITE_FIREBASE_*), skipping Firestore sync.');
        }
      } catch (firebaseError) {
        console.error('Firebase sync failed after API update:', firebaseError);
      }

      setSuccessModal({
        open: true,
        title: 'Bus Updated',
        message: 'Bus details were updated successfully.',
        detail: firebaseSkipped ? 'Saved to API. Firebase sync is currently disabled.' : '',
      });
      closeSaveConfirmation();
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Failed to update bus details.');
      setError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  // Open add bus modal
  const openAddModal = () => {
    setShowAddModal(true);
  };

  // Close add bus modal
  const closeAddModal = () => {
    setShowAddModal(false);
    setNewBus({
      busNumber: '',
      route: '',
      busCompany: '',
      status: 'Available',
      plateNumber: '',
      capacity: '',
      busCompanyEmail: '',
      busCompanyContact: '',
      registeredDestination: ''
    });
  };

  // Handle input change in add bus form
  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setNewBus((prev) => {
      if (name === 'route') {
        return {
          ...prev,
          route: value,
          registeredDestination: '',
        };
      }

      return {
        ...prev,
        [name]: value,
      };
    });
  };

  // Handle form submit
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate required fields
    if (!newBus.busNumber || !newBus.route || !newBus.busCompany ||
      !newBus.plateNumber || !newBus.capacity ||
      !newBus.busCompanyEmail || !newBus.busCompanyContact ||
      !newBus.registeredDestination) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const newBusData = {
        busNumber: newBus.busNumber,
        route: newBus.route,
        busCompany: newBus.busCompany,
        status: newBus.status,
        plateNumber: newBus.plateNumber,
        capacity: parseInt(newBus.capacity, 10),
        busCompanyEmail: newBus.busCompanyEmail,
        busCompanyContact: newBus.busCompanyContact,
        registeredDestination: newBus.registeredDestination,
      };
      const createdBusFromApi = await createBus(newBusData);
      const mergedCreatedBus = {
        ...newBusData,
        ...createdBusFromApi,
        id: createdBusFromApi?.id || createdBusFromApi?.busId || Date.now(),
        lastUpdated: createdBusFromApi?.lastUpdated || Date.now(),
      };

      applyUpdatedBusToCollections(mergedCreatedBus);
      closeAddModal();

      let firebaseSkipped = false;
      try {
        const syncResult = await syncBusToFirebase(mergedCreatedBus);
        if (syncResult?.reason === 'firebase-not-configured') {
          firebaseSkipped = true;
          setError('Saved to API, but Firebase sync is disabled. Add VITE_FIREBASE_* values in .env and restart the app.');
          console.warn('Firebase is not configured (.env missing VITE_FIREBASE_*), skipping Firestore sync.');
        }
      } catch (firebaseError) {
        console.error('Firebase sync failed after create:', firebaseError);
      }

      setSuccessModal({
        open: true,
        title: 'Bus Added',
        message: `Bus ${newBus.busNumber} was added successfully.`,
        detail: firebaseSkipped ? 'Saved to API. Firebase sync is currently disabled.' : '',
      });
    } catch (err) {
      const message = getRequestErrorMessage(err, 'Failed to add bus. Please try again.');
      setError(message);
      alert(message);
      console.error('Error adding bus:', err);
    } finally {
      setLoading(false);
    }
  };

  // Get status color class
  const getStatusClass = (status) => {
    switch (status) {
      case 'Active': return 'status-completed';
      case 'Available': return 'status-pending';
      case 'In Transit': return 'status-in-progress';
      case 'Arrived': return 'status-completed';
      case 'Maintenance': return 'status-in-progress';
      case 'Inactive': return 'status-pending';
      case 'Offline': return 'status-archived';
      default: return '';
    }
  };

  const isArchivedView = viewMode === 'archived';

  return (
    <main className="content">
      <SuccessModal
        open={successModal.open}
        title={successModal.title}
        message={successModal.message}
        detail={successModal.detail}
        onClose={() => setSuccessModal({ open: false, title: '', message: '', detail: '' })}
      />

      <ConfirmationModal
        open={archiveConfirmModal.open}
        title="Confirm Archive"
        message={archiveConfirmModal.busIds.length > 1
          ? `Are you sure you want to archive ${archiveConfirmModal.busIds.length} buses and move them to Offline?`
          : 'Are you sure you want to archive this bus and move it to Offline?'}
        note="You can restore archived buses later from the Offline tab."
        confirmLabel="Confirm Archive"
        onCancel={closeArchiveConfirmation}
        onConfirm={confirmArchive}
      />

      <ConfirmationModal
        open={deleteConfirmModal.open}
        title="Confirm Permanent Delete"
        message={deleteConfirmModal.busIds.length > 1
          ? `Delete ${deleteConfirmModal.busIds.length} archived buses permanently?`
          : 'Delete this archived bus permanently?'}
        note="This action cannot be undone."
        confirmLabel="Delete Permanently"
        confirmVariant="danger"
        onCancel={closeDeleteConfirmation}
        onConfirm={confirmDeleteArchived}
      />

      <ConfirmationModal
        open={saveConfirmModal.open}
        title="Confirm Bus Update"
        message="Save the changes you made to this bus?"
        note="This will update bus details."
        confirmLabel="Confirm Save"
        onCancel={closeSaveConfirmation}
        onConfirm={handleSaveBusDetails}
      />

      <div className="requests-container">
        <div className="requests-header">
          <div className="header-content">
            <div>
              <h1>Buses</h1>
              <p className="subtitle">Manage active buses, move buses offline, and permanently delete offline entries</p>
            </div>
          </div>
        </div>

        {/* Search and Sort Controls */}
        <div className="search-sort-controls">
          <div className="search-sort-group">

            <div className="search-bar">
              <input
                type="text"
                placeholder={isArchivedView
                  ? 'Search offline buses by number, route, company, plate, or status...'
                  : 'Search by bus number, route, company, plate, or status...'}
                value={searchQuery}
                onChange={handleSearchChange}
                className="search-input"
              />
            </div>

            <div className="sort-controls">
              <label htmlFor="sortBy">Sort by:</label>
              <select
                id="sortBy"
                value={sortBy}
                onChange={handleSortChange}
                className="sort-select"
              >
                <option value="lastUpdated">Last Updated</option>
                <option value="busNumber">Bus Number</option>
                <option value="route">Route</option>
                <option value="busCompany">Company</option>
                <option value="status">Status</option>
                <option value="capacity">Capacity</option>
              </select>

              <button
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
                className={`view-toggle-btn ${!isArchivedView ? 'active' : ''}`}
                onClick={() => handleViewModeChange('active')}
              >
                Active ({buses.length})
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${isArchivedView ? 'active' : ''}`}
                onClick={() => handleViewModeChange('archived')}
              >
                Offline ({archivedBuses.length})
              </button>
            </div>

            {!isArchivedView && (
              <button className="add-bus-btn" onClick={openAddModal}>
                + Add New Bus
              </button>
            )}

            {selectedBusIds.length > 0 && (
              <div className="batch-actions-bar">
                <span>{selectedBusIds.length} selected</span>
                {isArchivedView ? (
                  <>
                    <button type="button" className="table-action-btn restore" onClick={handleBatchUnarchive}>
                      Unarchive Selected
                    </button>
                    <button type="button" className="table-action-btn delete" onClick={handleBatchDeleteArchived}>
                      Delete Permanently
                    </button>
                  </>
                ) : (
                  <button type="button" className="table-action-btn archive" onClick={handleBatchArchive}>
                    Archive Selected
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="error-message" style={{
            padding: '1rem',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            borderRadius: '6px',
            marginBottom: '1rem'
          }}>
            {error}
          </div>
        )}

        <div className="table-container">
          <table className="requests-table">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="center-col">
                  <input
                    type="checkbox"
                    className="table-checkbox"
                    checked={isAllCurrentPageSelected}
                    onChange={handleToggleSelectAllCurrent}
                    disabled={!hasCurrentItems}
                  />
                </th>
                <th>Bus Number</th>
                <th>Route</th>
                <th>Bus Company</th>
                <th className="center-col">Status</th>
                <th>Plate Number</th>
                <th className="center-col">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows rows={6} columns={7} />
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>
                    {searchQuery
                      ? 'No buses found matching your search.'
                      : isArchivedView
                        ? 'No offline buses yet.'
                        : 'No active buses yet.'}
                  </td>
                </tr>
              ) : (
                currentItems.map((bus) => (
                  <tr key={bus.id} onClick={() => handleRowClick(bus)} className="clickable-row">
                    <td className="center-col" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="table-checkbox"
                        checked={selectedBusIds.includes(bus.id)}
                        onChange={() => handleToggleSelectBus(bus.id)}
                      />
                    </td>
                    <td className="bus-number">{bus.busNumber}</td>
                    <td>{renderRouteWithChevron(bus.route)}</td>
                    <td>{bus.busCompany}</td>
                    <td className="center-col">
                      <span className={`status-badge ${getStatusClass(bus.status)}`}>
                        {bus.status}
                      </span>
                    </td>
                    <td>{bus.plateNumber}</td>
                    <td className="center-col">{bus.capacity}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedBuses.length > 0 && (
          <div className="pagination">
            <button
              onClick={() => paginate(currentPage - 1)}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>

            <div className="page-numbers">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((number) => (
                <button
                  key={number}
                  onClick={() => paginate(number)}
                  className={`page-number ${currentPage === number ? 'active' : ''}`}
                >
                  {number}
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

        {sortedBuses.length > 0 && (
          <div className="table-info">
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, sortedBuses.length)} of {sortedBuses.length} {isArchivedView ? 'offline' : 'active'} buses
            {searchQuery && ` (filtered from ${sourceBuses.length} total)`}
          </div>
        )}
      </div>

      {/* Add Bus Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={closeAddModal}>
          <div className="modal-content add-bus-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Bus</h2>
              <button className="close-btn" onClick={closeAddModal}>&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-grid">
                <div className="form-section">
                  <h3>Bus Information</h3>

                  <div className="form-group">
                    <label htmlFor="busNumber">Bus Number *</label>
                    <input
                      type="text"
                      id="busNumber"
                      name="busNumber"
                      value={newBus.busNumber}
                      onChange={handleInputChange}
                      placeholder="e.g., OA-116"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="plateNumber">Plate Number *</label>
                    <input
                      type="text"
                      id="plateNumber"
                      name="plateNumber"
                      value={newBus.plateNumber}
                      onChange={handleInputChange}
                      placeholder="e.g., ABC-123"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="capacity">Capacity *</label>
                    <input
                      type="number"
                      id="capacity"
                      name="capacity"
                      value={newBus.capacity}
                      onChange={handleInputChange}
                      placeholder="e.g., 45"
                      min="1"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="status">Status *</label>
                    <select
                      id="status"
                      name="status"
                      value={newBus.status}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="Available">Available</option>
                      <option value="Active">Active</option>
                      <option value="Offline">Offline</option>
                    </select>
                  </div>

                </div>

                <div className="form-section">
                  <h3>Route Information</h3>

                  <div className="form-group">
                    <label htmlFor="route">Origin *</label>
                    <select
                      id="route"
                      name="route"
                      value={newBus.route}
                      onChange={handleInputChange}
                      required
                    >
                      <option value="">Select origin</option>
                      {originOptions.map((origin) => (
                        <option key={origin} value={origin}>
                          {origin}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="registeredDestination">Registered Destination *</label>
                    <select
                      id="registeredDestination"
                      name="registeredDestination"
                      value={newBus.registeredDestination}
                      onChange={handleInputChange}
                      disabled={!newBus.route}
                      required
                    >
                      <option value="">{newBus.route ? 'Select destination' : 'Select origin first'}</option>
                      {destinationOptions.map((destination) => (
                        <option key={`${newBus.route}-${destination}`} value={destination}>
                          {destination}
                        </option>
                      ))}
                    </select>
                  </div>

                  {queueRoutesError && routeOptions.length === 0 && (
                    <p className="info-note" style={{ color: '#b91c1c' }}>
                      Unable to load route list from queues. Please check API connectivity.
                    </p>
                  )}
                </div>

                <div className="form-section">
                  <h3>Bus Company</h3>

                  <div className="form-group">
                    <label htmlFor="busCompany">Company Name *</label>
                    <input
                      type="text"
                      id="busCompany"
                      name="busCompany"
                      value={newBus.busCompany}
                      onChange={handleInputChange}
                      placeholder="e.g., JAM Transit"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="busCompanyEmail">Company Email *</label>
                    <input
                      type="email"
                      id="busCompanyEmail"
                      name="busCompanyEmail"
                      value={newBus.busCompanyEmail}
                      onChange={handleInputChange}
                      placeholder="e.g., operations@company.com.ph"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="busCompanyContact">Company Contact *</label>
                    <input
                      type="tel"
                      id="busCompanyContact"
                      name="busCompanyContact"
                      value={newBus.busCompanyContact}
                      onChange={handleInputChange}
                      placeholder="e.g., +63 917 123 4567"
                      required
                    />
                  </div>
                </div>

              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={closeAddModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit">
                  Add Bus
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bus Details Modal */}
      {showModal && selectedBus && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Bus Details</h2>
              <button className="close-btn" onClick={closeModal}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="bus-info-grid">
                <div className="info-section">
                  <h3>Bus Information</h3>
                  <div className="info-row">
                    <span className="info-label">Assigned Attendant:</span>
                    <span className="info-value">{selectedBus.busAttendant || 'N/A'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Bus Number:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" name="busNumber" value={editingBus?.busNumber || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">{selectedBus.busNumber}</span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Plate Number:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" name="plateNumber" value={editingBus?.plateNumber || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">{selectedBus.plateNumber}</span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Capacity:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" type="number" min="1" name="capacity" value={editingBus?.capacity || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">{selectedBus.capacity} passengers</span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Status:</span>
                    {isEditingDetails ? (
                      <select className="inline-edit-input" name="status" value={editingBus?.status || 'Available'} onChange={handleEditDetailsInputChange}>
                        <option value="Available">Available</option>
                        <option value="Active">Active</option>
                        <option value="Offline">Offline</option>
                      </select>
                    ) : (
                      <span className={`status-badge ${getStatusClass(selectedBus.status)}`}>
                        {selectedBus.status}
                      </span>
                    )}
                  </div>
                </div>

                <div className="info-section">
                  <h3>Route Information</h3>
                  <div className="info-row">
                    <span className="info-label">{isEditingDetails ? 'Origin:' : 'Current Route:'}</span>
                    {isEditingDetails ? (
                      <select className="inline-edit-input" name="route" value={editingBus?.route || ''} onChange={handleEditDetailsInputChange}>
                        <option value="">Select origin</option>
                        {originOptions.map((origin) => (
                          <option key={`edit-origin-${origin}`} value={origin}>
                            {origin}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="info-value">{renderRouteWithChevron(selectedBus.route)}</span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Registered Destination:</span>
                    {isEditingDetails ? (
                      <select
                        className="inline-edit-input"
                        name="registeredDestination"
                        value={editingBus?.registeredDestination || ''}
                        onChange={handleEditDetailsInputChange}
                        disabled={!editingBus?.route}
                      >
                        <option value="">{editingBus?.route ? 'Select destination' : 'Select origin first'}</option>
                        {editDestinationOptions.map((destination) => (
                          <option key={`edit-destination-${editingBus?.route}-${destination}`} value={destination}>
                            {destination}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="info-value">{selectedBus.registeredDestination}</span>
                    )}
                  </div>
                </div>

                <div className="info-section">
                  <h3>Bus Company</h3>
                  <div className="info-row">
                    <span className="info-label">Company Name:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" name="busCompany" value={editingBus?.busCompany || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">{selectedBus.busCompany}</span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Email:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" type="email" name="busCompanyEmail" value={editingBus?.busCompanyEmail || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">
                        <a href={`mailto:${selectedBus.busCompanyEmail}`}>{selectedBus.busCompanyEmail}</a>
                      </span>
                    )}
                  </div>
                  <div className="info-row">
                    <span className="info-label">Contact Number:</span>
                    {isEditingDetails ? (
                      <input className="inline-edit-input" name="busCompanyContact" value={editingBus?.busCompanyContact || ''} onChange={handleEditDetailsInputChange} />
                    ) : (
                      <span className="info-value">
                        <a href={`tel:${selectedBus.busCompanyContact}`}>{selectedBus.busCompanyContact}</a>
                      </span>
                    )}
                  </div>
                </div>

              </div>

              <div className="modal-actions-row bus-modal-actions">
                {isEditingDetails ? (
                  <>
                    <button type="button" className="bus-action-btn primary" onClick={openSaveConfirmation}>
                      Save Changes
                    </button>
                    <button
                      type="button"
                      className="bus-action-btn secondary"
                      onClick={() => {
                        closeSaveConfirmation();
                        setIsEditingDetails(false);
                        const routeParts = parseRouteParts(selectedBus.route, selectedBus.registeredDestination);
                        setEditingBus({
                          ...selectedBus,
                          route: routeParts.origin,
                          registeredDestination: routeParts.destination,
                          capacity: String(selectedBus.capacity ?? ''),
                        });
                      }}
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

                {selectedBus.status === 'Offline' ? (
                  <>
                    <button
                      type="button"
                      className="bus-action-btn secondary"
                      onClick={() => handleUnarchiveBus(selectedBus.id)}
                    >
                      Unarchive
                    </button>
                    <button
                      type="button"
                      className="bus-action-btn danger"
                      onClick={() => handleDeleteArchivedBus(selectedBus.id)}
                    >
                      Delete Permanently
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="bus-action-btn danger"
                    onClick={() => handleArchiveBus(selectedBus.id)}
                  >
                    Archive Bus
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

export default Buses;