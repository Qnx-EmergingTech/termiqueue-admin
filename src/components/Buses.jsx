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
  // --- 1. State Management ---
  const [buses, setBuses] = useState([]);
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

  const [successModal, setSuccessModal] = useState({ open: false, title: '', message: '', detail: '' });
  const [archiveConfirmModal, setArchiveConfirmModal] = useState({ open: false, busIds: [] });
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ open: false, busIds: [] });
  const [saveConfirmModal, setSaveConfirmModal] = useState({ open: false });

  const [newBus, setNewBus] = useState({
    busNumber: '', route: '', busCompany: '', status: 'Available',
    plateNumber: '', capacity: '', busCompanyEmail: '', busCompanyContact: '',
    registeredDestination: '', busAttendant: ''
  });

  // --- 2. Helper Functions ---
  const getRequestErrorMessage = (err, fallbackMessage) => {
    const validationDetails = err?.response?.data?.detail;
    if (Array.isArray(validationDetails) && validationDetails.length > 0) {
      return validationDetails
        .map((item) => {
          const location = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : 'field';
          return `${location}: ${item?.msg || 'invalid value'}`;
        })
        .join(' | ');
    }
    return err?.response?.data?.message || err?.message || fallbackMessage;
  };

  const parseRouteParts = (routeText, fallbackDestination = '') => {
    const normalizedRoute = String(routeText || '').trim();
    if (!normalizedRoute) return { origin: '', destination: fallbackDestination };
    const parts = normalizedRoute.split('-').map(p => p.trim()).filter(Boolean);
    return {
      origin: parts[0] || '',
      destination: parts.length > 1 ? parts.slice(1).join(' - ') : fallbackDestination,
    };
  };

  // --- 3. Data Loading ---
  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLoading(true);
      try {
        const [apiBuses, routes] = await Promise.all([fetchBuses(), fetchQueues()]);
        if (!isMounted) return;

        setBuses(apiBuses.filter(b => b.status !== 'Offline'));
        setArchivedBuses(apiBuses.filter(b => b.status === 'Offline'));
        setQueueRoutes(Array.isArray(routes) ? routes : []);
      } catch (err) {
        if (!isMounted) return;
        setError(getRequestErrorMessage(err, 'Failed to load data.'));
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  // --- 4. Handlers & Submit ---
  const handleSaveBusDetails = async () => {
    if (!editingBus) return;
    try {
      setLoading(true);
      const payload = {
        ...editingBus,
        capacity: parseInt(editingBus.capacity, 10),
      };

      const updatedBusFromApi = await updateBus(selectedBus.id, payload);
      const mergedBus = { ...payload, ...updatedBusFromApi };

      // Update Local State
      setBuses(prev => prev.map(b => b.id === mergedBus.id ? mergedBus : b));
      
      // Firebase Sync
      await syncBusToFirebase(mergedBus);

      setSuccessModal({ open: true, title: 'Updated', message: 'Bus updated successfully.' });
      setIsEditingDetails(false);
      setSaveConfirmModal({ open: false });
    } catch (err) {
      alert(getRequestErrorMessage(err, 'Update failed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const payload = { ...newBus, capacity: parseInt(newBus.capacity, 10) };
      const createdBus = await createBus(payload);
      
      setBuses(prev => [createdBus, ...prev]);
      await syncBusToFirebase(createdBus);

      setSuccessModal({ open: true, title: 'Added', message: 'New bus added.' });
      setShowAddModal(false);
    } catch (err) {
      alert(getRequestErrorMessage(err, 'Creation failed.'));
    } finally {
      setLoading(false);
    }
  };

  // ... (Filtering, Sorting, and Pagination Logic continues) ...

  return (
    <main className="content">
      {/* Modals and Table UI would go here */}
      <h1>Buses Management</h1>
      {loading ? <TableSkeletonRows /> : <div>{/* Render your Table */}</div>}
    </main>
  );
}

export default Buses;