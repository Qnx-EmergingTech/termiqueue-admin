import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer } from 'react-leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import TableSkeletonRows from './TableSkeletonRows';
import ConfirmationModal from './ConfirmationModal';
import {
  createQueueDestination,
  createRouteGeofence,
  deleteRouteGeofence,
  fetchBuses,
  fetchOriginGeofenceConfig,
  fetchQueueDestinations,
  fetchRouteGeofences,
  updateRouteGeofence,
} from '../services/api';

const LOCAL_ROUTES_KEY = 'routesManagement.localRoutes';
const LOCAL_DESTINATIONS_KEY = 'routesManagement.localDestinations';

const originMarkerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function OriginMapPreview({ latitude, longitude, radius, label, compact = false }) {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  const parsedRadius = Number(radius);
  const hasValidCoordinates = Number.isFinite(parsedLatitude) && Number.isFinite(parsedLongitude);
  const hasValidRadius = Number.isFinite(parsedRadius) && parsedRadius > 0;
  const mapZoom = hasValidRadius
    ? parsedRadius > 3000
      ? 12
      : parsedRadius > 1500
        ? 13
        : parsedRadius > 700
          ? 14
          : 15
    : 15;

  if (!hasValidCoordinates) {
    return (
      <p className="info-note origin-map-empty">
        Enter valid latitude and longitude to preview the origin on the map.
      </p>
    );
  }

  const mapCenter = [parsedLatitude, parsedLongitude];

  return (
    <div className={`origin-map-preview ${compact ? 'compact' : ''}`}>
      <div className="origin-map-canvas-wrap">
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          className="origin-map-canvas"
          key={`${parsedLatitude}-${parsedLongitude}-${parsedRadius}`}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={mapCenter} icon={originMarkerIcon} />
          {hasValidRadius && (
            <Circle
              center={mapCenter}
              radius={parsedRadius}
              pathOptions={{ color: '#096B72', fillColor: '#096B72', fillOpacity: 0.15 }}
            />
          )}
        </MapContainer>
      </div>
      <p className="origin-map-caption">
        {label || 'Origin'} · {parsedLatitude.toFixed(6)}, {parsedLongitude.toFixed(6)}{hasValidRadius ? ` · Radius ${parsedRadius.toFixed(2)} m` : ''}
      </p>
    </div>
  );
}

function RoutesManagement() {
  const [routes, setRoutes] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [globalOrigin, setGlobalOrigin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [showModal, setShowModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({
    open: false,
    routeId: '',
    sourceType: 'geofence',
  });
  const [routeForm, setRouteForm] = useState({
    id: '',
    sourceType: 'geofence',
    useGlobalOrigin: true,
    latitude: '',
    longitude: '',
    radius: '',
    destinationMode: 'existing',
    queueId: '',
    destinationName: '',
    newDestinationName: '',
  });

  const isNetworkError = (err) => !err?.response && String(err?.message || '').toLowerCase().includes('network error');

  const readLocalJson = (key, fallbackValue) => {
    try {
      const rawValue = localStorage.getItem(key);
      if (!rawValue) {
        return fallbackValue;
      }

      const parsedValue = JSON.parse(rawValue);
      return parsedValue ?? fallbackValue;
    } catch {
      return fallbackValue;
    }
  };

  const writeLocalJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore local storage write failures.
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

  const buildFallbackDestinationsFromBuses = (buses) => {
    const uniqueDestinations = new Map();

    (Array.isArray(buses) ? buses : []).forEach((busItem, index) => {
      const routeParts = splitRoute(busItem.route);
      const destinationName = String(busItem.registeredDestination || routeParts.destination || '').trim();

      if (!destinationName) {
        return;
      }

      const key = destinationName.toLowerCase();
      if (uniqueDestinations.has(key)) {
        return;
      }

      uniqueDestinations.set(key, {
        id: `fallback-destination-${index + 1}`,
        destinationName,
        route: busItem.route || '',
        origin: routeParts.origin,
        destination: destinationName,
      });
    });

    return Array.from(uniqueDestinations.values());
  };

  const applyGlobalOriginToRoutes = (routeItems, originConfig) => {
    if (!originConfig) {
      return Array.isArray(routeItems) ? routeItems : [];
    }

    return (Array.isArray(routeItems) ? routeItems : []).map((routeItem) => {
      const hasOwnGeofence =
        Number.isFinite(Number(routeItem?.latitude)) &&
        Number.isFinite(Number(routeItem?.longitude)) &&
        Number(routeItem?.radius) > 0;

      if (hasOwnGeofence && routeItem?.sourceType !== 'queue-only') {
        return {
          ...routeItem,
          originLabel: routeItem.originLabel || originConfig.label || 'Pinned Origin',
          originSource: routeItem.originSource || 'custom',
        };
      }

      return {
        ...routeItem,
        originLabel: originConfig.label || routeItem.originLabel || 'Pinned Origin',
        latitude: originConfig.latitude,
        longitude: originConfig.longitude,
        radius: originConfig.radius,
        originSource: 'global-config',
      };
    });
  };

  const buildQueueOnlyRoutes = (destinationItems, originConfig) => {
    return (Array.isArray(destinationItems) ? destinationItems : []).map((destinationItem, index) => {
      const queueId = String(destinationItem.id || '').trim();
      const timestamp = Number(destinationItem?.updatedAt || destinationItem?.raw?.updated_at || destinationItem?.raw?.created_at || Date.now());

      return {
        id: `queue-only-${queueId || index + 1}`,
        sourceType: 'queue-only',
        queueId,
        originLabel: originConfig?.label || 'Pinned Origin',
        destinationName: destinationItem.destinationName || destinationItem.destination || 'N/A',
        latitude: originConfig?.latitude ?? null,
        longitude: originConfig?.longitude ?? null,
        radius: originConfig?.radius ?? null,
        updatedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
      };
    });
  };

  const getErrorMessage = (err, fallbackMessage) => {
    const validationDetails = err?.response?.data?.detail;

    if (Array.isArray(validationDetails) && validationDetails.length > 0) {
      return validationDetails
        .map((item) => {
          const location = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : 'field';
          return `${location}: ${item?.msg || 'invalid value'}`;
        })
        .join(' | ');
    }

    if (!err?.response && String(err?.message || '').toLowerCase().includes('network error')) {
      return 'Network error: unable to reach API. Check VITE_API_URL, backend status, and CORS configuration.';
    }

    return err?.response?.data?.message || err?.response?.data?.detail || err?.message || fallbackMessage;
  };

  const loadData = async () => {
    setLoading(true);
    setError('');

    const [routesResult, destinationsResult, busesResult, originConfigResult] = await Promise.allSettled([
      fetchRouteGeofences(),
      fetchQueueDestinations(),
      fetchBuses(),
      fetchOriginGeofenceConfig(),
    ]);

    const localRoutes = readLocalJson(LOCAL_ROUTES_KEY, []);
    const localDestinations = readLocalJson(LOCAL_DESTINATIONS_KEY, []);

    const fetchedRoutes = routesResult.status === 'fulfilled' ? routesResult.value : null;
    const fetchedDestinations = destinationsResult.status === 'fulfilled' ? destinationsResult.value : null;
    const fetchedBuses = busesResult.status === 'fulfilled' ? busesResult.value : [];
    const fetchedOriginConfig = originConfigResult.status === 'fulfilled' ? originConfigResult.value : null;

    const routesToUse = Array.isArray(fetchedRoutes) && fetchedRoutes.length > 0
      ? fetchedRoutes
      : localRoutes;
    const destinationsToUse = Array.isArray(fetchedDestinations) && fetchedDestinations.length > 0
      ? fetchedDestinations
      : (localDestinations.length > 0 ? localDestinations : buildFallbackDestinationsFromBuses(fetchedBuses));

    const queueOnlyRoutes = buildQueueOnlyRoutes(destinationsToUse, fetchedOriginConfig);
    const finalRoutes = Array.isArray(routesToUse) && routesToUse.length > 0 ? routesToUse : queueOnlyRoutes;
    const normalizedRoutes = applyGlobalOriginToRoutes(finalRoutes, fetchedOriginConfig);

    setRoutes(Array.isArray(normalizedRoutes) ? normalizedRoutes : []);
    setDestinations(Array.isArray(destinationsToUse) ? destinationsToUse : []);
    setGlobalOrigin(fetchedOriginConfig);

    if (routesResult.status === 'fulfilled') {
      writeLocalJson(LOCAL_ROUTES_KEY, Array.isArray(routesResult.value) ? routesResult.value : []);
    }

    if (destinationsResult.status === 'fulfilled') {
      writeLocalJson(LOCAL_DESTINATIONS_KEY, Array.isArray(destinationsResult.value) ? destinationsResult.value : []);
    } else if (Array.isArray(destinationsToUse) && destinationsToUse.length > 0) {
      writeLocalJson(LOCAL_DESTINATIONS_KEY, destinationsToUse);
    }

    const routeNetworkFailure = routesResult.status === 'rejected' && isNetworkError(routesResult.reason);
    const destinationNetworkFailure = destinationsResult.status === 'rejected' && isNetworkError(destinationsResult.reason);
    const originNetworkFailure = originConfigResult.status === 'rejected' && isNetworkError(originConfigResult.reason);
    const hasNetworkFailure = destinationNetworkFailure || (routeNetworkFailure && originNetworkFailure);

    if (hasNetworkFailure) {
      const hasUsableRouteData = Array.isArray(routesToUse) && routesToUse.length > 0;
      const hasUsableDestinationData = Array.isArray(destinationsToUse) && destinationsToUse.length > 0;
      const hasRouteApiFailure = routeNetworkFailure && originNetworkFailure;

      const networkMessages = [];

      if (hasRouteApiFailure) {
        networkMessages.push(
          hasUsableRouteData
            ? 'Route APIs are currently unreachable. Showing cached route data.'
            : 'Route APIs are currently unreachable. No route records available yet.'
        );
      }

      if (destinationNetworkFailure && !hasUsableDestinationData) {
        networkMessages.push('Destination API is currently unreachable and no cached destination records are available yet.');
      }

      if (networkMessages.length > 0) {
        setError(networkMessages.join(' '));
      }
    } else if ((Array.isArray(routesToUse) ? routesToUse.length : 0) === 0 && queueOnlyRoutes.length > 0) {
      setError('No geofence route records yet. Showing queue destinations only; click Edit to configure latitude, longitude, and radius.');
    }

    if (routesResult.status === 'rejected' && destinationsResult.status === 'rejected' && !hasNetworkFailure) {
      setError(getErrorMessage(routesResult.reason || destinationsResult.reason, 'Failed to load routes data.'));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    writeLocalJson(LOCAL_ROUTES_KEY, Array.isArray(routes) ? routes : []);
  }, [routes]);

  useEffect(() => {
    writeLocalJson(LOCAL_DESTINATIONS_KEY, Array.isArray(destinations) ? destinations : []);
  }, [destinations]);

  const destinationLookup = useMemo(() => {
    const lookup = new Map();

    destinations.forEach((destinationItem) => {
      const destinationId = String(destinationItem.id || '').trim();
      if (!destinationId) {
        return;
      }

      lookup.set(destinationId, destinationItem.destinationName || destinationItem.destination || 'N/A');
    });

    return lookup;
  }, [destinations]);

  const filteredRoutes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    if (!query) {
      return routes;
    }

    return routes.filter((routeItem) => {
      const destinationName = destinationLookup.get(String(routeItem.queueId || '').trim()) || routeItem.destinationName || 'N/A';
      const searchableContent = [
        routeItem.originLabel || globalOrigin?.label || '',
        destinationName,
        routeItem.latitude,
        routeItem.longitude,
        routeItem.radius,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return searchableContent.includes(query);
    });
  }, [routes, searchQuery, destinationLookup, globalOrigin]);

  const sortedRoutes = useMemo(() => {
    const sortableRoutes = [...filteredRoutes];

    sortableRoutes.sort((leftItem, rightItem) => {
      if (sortBy === 'updatedAt') {
        const leftValue = Number(leftItem?.updatedAt || 0);
        const rightValue = Number(rightItem?.updatedAt || 0);
        return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }

      if (sortBy === 'latitude' || sortBy === 'longitude' || sortBy === 'radius') {
        const leftValue = Number(leftItem?.[sortBy] || 0);
        const rightValue = Number(rightItem?.[sortBy] || 0);
        return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }

      if (sortBy === 'destinationName') {
        const leftValue = String(destinationLookup.get(String(leftItem?.queueId || '').trim()) || leftItem?.destinationName || '').toLowerCase();
        const rightValue = String(destinationLookup.get(String(rightItem?.queueId || '').trim()) || rightItem?.destinationName || '').toLowerCase();

        if (leftValue < rightValue) {
          return sortOrder === 'asc' ? -1 : 1;
        }

        if (leftValue > rightValue) {
          return sortOrder === 'asc' ? 1 : -1;
        }

        return 0;
      }

      return 0;
    });

    return sortableRoutes;
  }, [filteredRoutes, sortBy, sortOrder, destinationLookup]);

  useEffect(() => {
    const maxPages = Math.max(1, Math.ceil(sortedRoutes.length / itemsPerPage));

    if (currentPage > maxPages) {
      setCurrentPage(maxPages);
    }
  }, [sortedRoutes.length, currentPage, itemsPerPage]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedRoutes.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.max(1, Math.ceil(sortedRoutes.length / itemsPerPage));

  const openCreateModal = () => {
    setIsEditing(false);
    setRouteForm({
      id: '',
      sourceType: 'geofence',
      useGlobalOrigin: Boolean(globalOrigin),
      latitude: globalOrigin ? String(globalOrigin.latitude) : '',
      longitude: globalOrigin ? String(globalOrigin.longitude) : '',
      radius: globalOrigin ? String(globalOrigin.radius) : '',
      destinationMode: 'existing',
      queueId: '',
      destinationName: '',
      newDestinationName: '',
    });
    setShowModal(true);
  };

  const openDetailsModal = (routeItem) => {
    setSelectedRoute(routeItem);
    setShowDetailsModal(true);
  };

  const closeDetailsModal = () => {
    if (saving) {
      return;
    }

    setShowDetailsModal(false);
    setSelectedRoute(null);
  };

  const openEditModal = (routeItem) => {
    setIsEditing(true);

    const queueId = String(routeItem.queueId || '').trim();
    const destinationName = destinationLookup.get(queueId) || routeItem.destinationName || '';
    const useGlobalOriginByDefault = Boolean(globalOrigin) && String(routeItem.originSource || '') !== 'custom';

    setRouteForm({
      id: String(routeItem.id || ''),
      sourceType: String(routeItem.sourceType || 'geofence'),
      useGlobalOrigin: useGlobalOriginByDefault,
      latitude: useGlobalOriginByDefault ? String(globalOrigin.latitude) : String(routeItem.latitude ?? ''),
      longitude: useGlobalOriginByDefault ? String(globalOrigin.longitude) : String(routeItem.longitude ?? ''),
      radius: useGlobalOriginByDefault ? String(globalOrigin.radius) : String(routeItem.radius ?? ''),
      destinationMode: queueId ? 'existing' : 'new',
      queueId,
      destinationName,
      newDestinationName: queueId ? '' : destinationName,
    });

    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }

    setShowModal(false);
  };

  const handleOriginModeChange = (shouldUseGlobal) => {
    setRouteForm((prevForm) => ({
      ...prevForm,
      useGlobalOrigin: shouldUseGlobal,
      latitude: shouldUseGlobal && globalOrigin ? String(globalOrigin.latitude) : prevForm.latitude,
      longitude: shouldUseGlobal && globalOrigin ? String(globalOrigin.longitude) : prevForm.longitude,
      radius: shouldUseGlobal && globalOrigin ? String(globalOrigin.radius) : prevForm.radius,
    }));
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;

    setRouteForm((prevForm) => {
      if (name === 'destinationMode') {
        return {
          ...prevForm,
          destinationMode: value,
          queueId: '',
          destinationName: '',
          newDestinationName: '',
        };
      }

      if (name === 'queueId') {
        const selectedDestination = destinations.find((destinationItem) => String(destinationItem.id) === String(value));
        return {
          ...prevForm,
          queueId: value,
          destinationName: selectedDestination?.destinationName || selectedDestination?.destination || '',
        };
      }

      return {
        ...prevForm,
        [name]: value,
      };
    });
  };

  const handleSaveRoute = async (event) => {
    event.preventDefault();

    const hasGlobalOrigin = Boolean(
      Number.isFinite(Number(globalOrigin?.latitude)) &&
      Number.isFinite(Number(globalOrigin?.longitude)) &&
      Number.isFinite(Number(globalOrigin?.radius)) &&
      Number(globalOrigin?.radius) > 0
    );

    const shouldUseGlobalOrigin = hasGlobalOrigin && Boolean(routeForm.useGlobalOrigin);
    const latitude = shouldUseGlobalOrigin ? Number(globalOrigin.latitude) : Number(routeForm.latitude);
    const longitude = shouldUseGlobalOrigin ? Number(globalOrigin.longitude) : Number(routeForm.longitude);
    const radius = shouldUseGlobalOrigin ? Number(globalOrigin.radius) : Number(routeForm.radius);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Latitude and longitude must be valid numbers.');
      return;
    }

    if (!Number.isFinite(radius) || radius <= 0) {
      setError('Radius must be greater than 0.');
      return;
    }

    if (routeForm.destinationMode === 'existing' && !routeForm.queueId) {
      setError('Please select an existing destination.');
      return;
    }

    if (routeForm.destinationMode === 'new' && !routeForm.newDestinationName.trim()) {
      setError('Please enter a destination name.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let queueId = String(routeForm.queueId || '').trim();
      let destinationName = String(routeForm.destinationName || '').trim();

      if (routeForm.destinationMode === 'new') {
        try {
          const createdDestination = await createQueueDestination({
            destinationName: routeForm.newDestinationName.trim(),
            destination: routeForm.newDestinationName.trim(),
          });

          queueId = String(createdDestination.id || '').trim();
          destinationName = String(createdDestination.destinationName || routeForm.newDestinationName || '').trim();
        } catch (destinationError) {
          if (!isNetworkError(destinationError)) {
            throw destinationError;
          }

          const localDestination = {
            id: `local-destination-${Date.now()}`,
            destinationName: routeForm.newDestinationName.trim(),
            route: '',
            origin: '',
            destination: routeForm.newDestinationName.trim(),
          };
          queueId = localDestination.id;
          destinationName = localDestination.destinationName;
          setDestinations((prevDestinations) => {
            const nextDestinations = [localDestination, ...prevDestinations];
            writeLocalJson(LOCAL_DESTINATIONS_KEY, nextDestinations);
            return nextDestinations;
          });
          setError('Queue API unavailable. Saved destination locally.');
        }
      }

      const payload = {
        latitude,
        longitude,
        radius,
        queueId,
        destinationName,
      };

      const resolvedOriginLabel = shouldUseGlobalOrigin
        ? (globalOrigin?.label || 'Pinned Origin')
        : (routeForm.originLabel || globalOrigin?.label || 'Custom Origin');

      if (isEditing) {
        let updatedRoute;

        if (routeForm.sourceType === 'queue-only') {
          try {
            updatedRoute = await createRouteGeofence(payload);
          } catch (routeError) {
            if (!isNetworkError(routeError)) {
              throw routeError;
            }

            updatedRoute = {
              id: `local-route-${Date.now()}`,
              sourceType: 'geofence',
              originSource: shouldUseGlobalOrigin ? 'global-config' : 'custom',
              originLabel: resolvedOriginLabel,
              latitude,
              longitude,
              radius,
              queueId,
              destinationName,
              updatedAt: Date.now(),
            };
            setError('Geofence API unavailable. Saved route locally.');
          }

          setRoutes((prevRoutes) => {
            const withoutQueueOnlyRow = prevRoutes.filter((routeItem) => String(routeItem.id) !== String(routeForm.id));
            return [updatedRoute, ...withoutQueueOnlyRow];
          });
        } else {
          try {
            updatedRoute = await updateRouteGeofence(routeForm.id, payload);
          } catch (routeError) {
            if (!isNetworkError(routeError)) {
              throw routeError;
            }

            updatedRoute = {
              id: routeForm.id,
              sourceType: 'geofence',
              originSource: shouldUseGlobalOrigin ? 'global-config' : 'custom',
              originLabel: resolvedOriginLabel,
              latitude,
              longitude,
              radius,
              queueId,
              destinationName,
              updatedAt: Date.now(),
            };
            setError('Geofence API unavailable. Saved route locally.');
          }

          setRoutes((prevRoutes) => prevRoutes.map((routeItem) => (
            String(routeItem.id) === String(updatedRoute.id)
              ? updatedRoute
              : routeItem
          )));
        }
      } else {
        let createdRoute;

        try {
          createdRoute = await createRouteGeofence(payload);
        } catch (routeError) {
          if (!isNetworkError(routeError)) {
            throw routeError;
          }

          createdRoute = {
            id: `local-route-${Date.now()}`,
            sourceType: 'geofence',
            originSource: shouldUseGlobalOrigin ? 'global-config' : 'custom',
            originLabel: resolvedOriginLabel,
            latitude,
            longitude,
            radius,
            queueId,
            destinationName,
            updatedAt: Date.now(),
          };
          setError('Geofence API unavailable. Saved route locally.');
        }

        setRoutes((prevRoutes) => [createdRoute, ...prevRoutes]);
      }

      if (routeForm.destinationMode === 'new') {
        await loadData();
      }

      closeModal();
    } catch (err) {
      setError(getErrorMessage(err, isEditing ? 'Failed to update route.' : 'Failed to create route.'));
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteRoute = (routeId, sourceType = 'geofence') => {
    if (sourceType === 'queue-only') {
      setError('This row is destination-only. Configure geofence first, or delete the destination from Queue records.');
      return;
    }

    setDeleteConfirmModal({
      open: true,
      routeId: String(routeId || ''),
      sourceType,
    });
  };

  const closeDeleteConfirmation = () => {
    if (saving) {
      return;
    }

    setDeleteConfirmModal({
      open: false,
      routeId: '',
      sourceType: 'geofence',
    });
  };

  const confirmDeleteRoute = async () => {
    const routeId = String(deleteConfirmModal.routeId || '').trim();
    closeDeleteConfirmation();

    if (!routeId) {
      return;
    }

    try {
      setError('');
      try {
        await deleteRouteGeofence(routeId);
      } catch (deleteError) {
        if (!isNetworkError(deleteError)) {
          throw deleteError;
        }

        setError('Geofence API unavailable. Deleted route locally.');
      }

      setRoutes((prevRoutes) => prevRoutes.filter((routeItem) => String(routeItem.id) !== String(routeId)));
      if (selectedRoute && String(selectedRoute.id) === String(routeId)) {
        closeDetailsModal();
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete route.'));
    }
  };

  const handleSortChange = (event) => {
    setSortBy(event.target.value);
    setCurrentPage(1);
  };

  const handleSortOrderToggle = () => {
    setSortOrder((previousSortOrder) => (previousSortOrder === 'asc' ? 'desc' : 'asc'));
    setCurrentPage(1);
  };

  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
    setCurrentPage(1);
  };

  const paginate = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  return (
    <main className="content">
      <ConfirmationModal
        open={deleteConfirmModal.open}
        title="Confirm Route Delete"
        message="Delete this route?"
        note="This will remove the geofence route record from the current list."
        confirmLabel="Delete Route"
        confirmVariant="danger"
        onCancel={closeDeleteConfirmation}
        onConfirm={confirmDeleteRoute}
      />

      <div className="requests-container">
        <div className="requests-header">
          <div className="header-content">
            <div>
              <h1>Route Creation Management</h1>
              <p className="subtitle">Manage route origins (geofence) and destinations (queue)</p>
            </div>
          </div>
        </div>

        <div className="search-sort-controls">
          <div className="search-sort-group">
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search by destination, latitude, longitude, or radius..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="search-input"
              />
            </div>

            <div className="sort-controls">
              <label htmlFor="routesSortBy">Sort by:</label>
              <select
                id="routesSortBy"
                value={sortBy}
                onChange={handleSortChange}
                className="sort-select"
              >
                <option value="updatedAt">Latest Updated</option>
                <option value="destinationName">Destination</option>
                <option value="latitude">Latitude</option>
                <option value="longitude">Longitude</option>
                <option value="radius">Radius</option>
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
            <button className="add-bus-btn" onClick={openCreateModal}>
              + Create Route
            </button>
          </div>
        </div>

        {error && (
          <div className="dashboard-warning-banner" role="alert" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {globalOrigin && (
          <div className="dashboard-info-banner" role="status" style={{ marginBottom: '1rem' }}>
            Origin: {globalOrigin.label || 'Pinned Origin'} · {Number(globalOrigin.latitude).toFixed(6)}, {Number(globalOrigin.longitude).toFixed(6)} · Radius {Number(globalOrigin.radius).toFixed(2)} m
          </div>
        )}

        <div className="table-container">
          <table className="requests-table">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Radius</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows rows={6} columns={6} />
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>
                    No routes found.
                  </td>
                </tr>
              ) : (
                currentItems.map((routeItem) => {
                  const originLabel = routeItem.originLabel || globalOrigin?.label || 'Pinned Origin';
                  const destinationName = destinationLookup.get(String(routeItem.queueId || '').trim()) || routeItem.destinationName || 'N/A';
                  const hasGeofence = Number.isFinite(Number(routeItem.latitude)) && Number.isFinite(Number(routeItem.longitude)) && Number(routeItem.radius) > 0;

                  return (
                    <tr key={routeItem.id} onClick={() => openDetailsModal(routeItem)} className="clickable-row">
                      <td>{hasGeofence ? Number(routeItem.latitude).toFixed(6) : 'Not set'}</td>
                      <td>{hasGeofence ? Number(routeItem.longitude).toFixed(6) : 'Not set'}</td>
                      <td>{hasGeofence ? `${Number(routeItem.radius).toFixed(2)} m` : 'Not set'}</td>
                      <td>{originLabel}</td>
                      <td>{destinationName}</td>
                      <td>{new Date(routeItem.updatedAt || Date.now()).toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {sortedRoutes.length > 0 && (
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

        {sortedRoutes.length > 0 && (
          <div className="table-info">
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, sortedRoutes.length)} of {sortedRoutes.length} routes
          </div>
        )}
      </div>

      {showDetailsModal && selectedRoute && (
        <div className="modal-overlay" onClick={closeDetailsModal}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Route Details</h2>
              <button className="close-btn" onClick={closeDetailsModal}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="bus-info-grid">
                <div className="info-section">
                  <h3>Origin (Global Geofence)</h3>
                  <div className="info-row">
                    <span className="info-label">Label:</span>
                    <span className="info-value">{selectedRoute.originLabel || globalOrigin?.label || 'Pinned Origin'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Latitude:</span>
                    <span className="info-value">
                      {Number.isFinite(Number(selectedRoute.latitude)) ? Number(selectedRoute.latitude).toFixed(6) : 'Not set'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Longitude:</span>
                    <span className="info-value">
                      {Number.isFinite(Number(selectedRoute.longitude)) ? Number(selectedRoute.longitude).toFixed(6) : 'Not set'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Radius:</span>
                    <span className="info-value">
                      {Number.isFinite(Number(selectedRoute.radius)) && Number(selectedRoute.radius) > 0
                        ? `${Number(selectedRoute.radius).toFixed(2)} m`
                        : 'Not set'}
                    </span>
                  </div>

                  <OriginMapPreview
                    latitude={selectedRoute.latitude}
                    longitude={selectedRoute.longitude}
                    radius={selectedRoute.radius}
                    label={selectedRoute.originLabel || globalOrigin?.label || 'Origin'}
                  />
                </div>

                <div className="info-section">
                  <h3>Destination (Queue)</h3>
                  <div className="info-row">
                    <span className="info-label">Destination:</span>
                    <span className="info-value">
                      {destinationLookup.get(String(selectedRoute.queueId || '').trim()) || selectedRoute.destinationName || 'N/A'}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Queue ID:</span>
                    <span className="info-value">{selectedRoute.queueId || 'N/A'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Last Updated:</span>
                    <span className="info-value">{new Date(selectedRoute.updatedAt || Date.now()).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="modal-actions-row">
                <button
                  type="button"
                  className="table-action-btn restore primary-cta-btn"
                  onClick={() => {
                    const routeToEdit = selectedRoute;
                    closeDetailsModal();
                    openEditModal(routeToEdit);
                  }}
                >
                  Edit Route
                </button>
                <button
                  type="button"
                  className="table-action-btn delete"
                  onClick={() => requestDeleteRoute(selectedRoute.id, selectedRoute.sourceType)}
                >
                  Delete Route
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content add-bus-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{isEditing ? 'Edit Route' : 'Create Route'}</h2>
              <button className="close-btn" onClick={closeModal}>&times;</button>
            </div>

            <form onSubmit={handleSaveRoute} className="modal-body">
              <div className="form-grid">
                <div className="form-section">
                  <h3>Origin (Geofence)</h3>

                  {globalOrigin && (
                    <div className="form-group origin-mode-control">
                      <label>Origin Mode</label>
                      <div className="view-toggle-group">
                        <button
                          type="button"
                          className={`view-toggle-btn ${routeForm.useGlobalOrigin ? 'active' : ''}`}
                          onClick={() => handleOriginModeChange(true)}
                        >
                          Use Global Origin
                        </button>
                        <button
                          type="button"
                          className={`view-toggle-btn ${!routeForm.useGlobalOrigin ? 'active' : ''}`}
                          onClick={() => handleOriginModeChange(false)}
                        >
                          Custom Origin
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="origin-map-top">
                    <OriginMapPreview
                      latitude={routeForm.latitude}
                      longitude={routeForm.longitude}
                      radius={routeForm.radius}
                      label={routeForm.useGlobalOrigin ? (globalOrigin?.label || 'Origin') : 'Custom Origin'}
                      compact
                    />
                  </div>

                  {globalOrigin && Boolean(routeForm.useGlobalOrigin) && (
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '0.9rem' }}>
                      Origin is currently locked to config geofence.
                    </p>
                  )}

                  <div className="origin-coordinates-row">
                    <div className="form-group">
                      <label htmlFor="latitude">Latitude *</label>
                      <input
                        type="number"
                        id="latitude"
                        name="latitude"
                        step="any"
                        value={routeForm.latitude}
                        onChange={handleFormChange}
                        placeholder="e.g., 14.5995"
                        disabled={Boolean(globalOrigin) && Boolean(routeForm.useGlobalOrigin)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="longitude">Longitude *</label>
                      <input
                        type="number"
                        id="longitude"
                        name="longitude"
                        step="any"
                        value={routeForm.longitude}
                        onChange={handleFormChange}
                        placeholder="e.g., 120.9842"
                        disabled={Boolean(globalOrigin) && Boolean(routeForm.useGlobalOrigin)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="radius">Radius (meters) *</label>
                    <input
                      type="number"
                      id="radius"
                      name="radius"
                      min="1"
                      step="any"
                      value={routeForm.radius}
                      onChange={handleFormChange}
                      placeholder="e.g., 150"
                      disabled={Boolean(globalOrigin) && Boolean(routeForm.useGlobalOrigin)}
                      required
                    />
                  </div>
                </div>

                <div className="form-section">
                  <h3>Destination (Queue)</h3>

                  <div className="form-group">
                    <label htmlFor="destinationMode">Destination Source *</label>
                    <select
                      id="destinationMode"
                      name="destinationMode"
                      value={routeForm.destinationMode}
                      onChange={handleFormChange}
                      required
                    >
                      <option value="existing">Select Existing Destination</option>
                      <option value="new">Create New Destination</option>
                    </select>
                  </div>

                  {routeForm.destinationMode === 'existing' ? (
                    <div className="form-group">
                      <label htmlFor="queueId">Existing Destination *</label>
                      <select
                        id="queueId"
                        name="queueId"
                        value={routeForm.queueId}
                        onChange={handleFormChange}
                        required
                      >
                        <option value="">Select destination</option>
                        {destinations.map((destinationItem) => (
                          <option key={destinationItem.id} value={destinationItem.id}>
                            {destinationItem.destinationName}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="form-group">
                      <label htmlFor="newDestinationName">New Destination Name *</label>
                      <input
                        type="text"
                        id="newDestinationName"
                        name="newDestinationName"
                        value={routeForm.newDestinationName}
                        onChange={handleFormChange}
                        placeholder="e.g., Bonifacio Global City"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit" disabled={saving}>
                  {saving ? 'Saving...' : isEditing ? 'Save Route' : 'Create Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

export default RoutesManagement;
