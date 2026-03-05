import { useEffect, useMemo, useState } from 'react';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import TableSkeletonRows from './TableSkeletonRows';
import { fetchTripHistoryById, fetchTripHistoryLogs } from '../services/activityLogsService';

function ActivityLogs() {
  const [tripLogs, setTripLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('latestUpdated');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const formatDateTime = (timestamp) => {
    const parsed = Number(timestamp);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return '-';
    }

    return new Date(parsed).toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const normalizeErrorMessage = (err, fallbackMessage) => {
    const validationDetails = err?.response?.data?.detail;

    if (Array.isArray(validationDetails) && validationDetails.length > 0) {
      return validationDetails
        .map((item) => {
          const location = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : 'field';
          return `${location}: ${item?.msg || 'invalid value'}`;
        })
        .join(' | ');
    }

    return err?.response?.data?.message || err?.response?.data?.detail || err?.message || fallbackMessage;
  };

  useEffect(() => {
    let isMounted = true;

    const loadTripLogs = async () => {
      setLoading(true);
      setError('');

      try {
        const result = await fetchTripHistoryLogs();

        if (!isMounted) {
          return;
        }

        setTripLogs(Array.isArray(result?.logs) ? result.logs : []);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setTripLogs([]);
        setError(normalizeErrorMessage(err, 'Failed to load activity logs.'));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadTripLogs();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredLogs = useMemo(() => {
    const query = String(searchQuery || '').trim().toLowerCase();
    if (!query) {
      return tripLogs;
    }

    return tripLogs.filter((trip) => {
      const searchable = [
        trip.busNumber,
        trip.plateNumber,
        trip.attendantName,
        trip.route,
        trip.status,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return searchable.includes(query);
    });
  }, [tripLogs, searchQuery]);

  const sortedLogs = useMemo(() => {
    const sortable = [...filteredLogs];

    sortable.sort((leftTrip, rightTrip) => {
      if (sortBy === 'latestUpdated' || sortBy === 'departureTime' || sortBy === 'arrivalTime' || sortBy === 'usersCount') {
        const leftValue = Number(leftTrip?.[sortBy] || 0);
        const rightValue = Number(rightTrip?.[sortBy] || 0);
        return sortOrder === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }

      const leftValue = String(leftTrip?.[sortBy] || '').toLowerCase();
      const rightValue = String(rightTrip?.[sortBy] || '').toLowerCase();

      if (leftValue < rightValue) {
        return sortOrder === 'asc' ? -1 : 1;
      }
      if (leftValue > rightValue) {
        return sortOrder === 'asc' ? 1 : -1;
      }

      return 0;
    });

    return sortable;
  }, [filteredLogs, sortBy, sortOrder]);

  useEffect(() => {
    const maxPages = Math.max(1, Math.ceil(sortedLogs.length / itemsPerPage));
    if (currentPage > maxPages) {
      setCurrentPage(maxPages);
    }
  }, [sortedLogs.length, currentPage, itemsPerPage]);

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / itemsPerPage));
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedLogs.slice(indexOfFirstItem, indexOfLastItem);

  const openTripDetails = async (trip) => {
    setSelectedTrip(trip);
    setShowDetailsModal(true);
    setDetailsLoading(true);
    setDetailsError('');

    try {
      const tripDetails = await fetchTripHistoryById(trip.id);
      setSelectedTrip((previousTrip) => {
        if (!previousTrip || String(previousTrip.id) !== String(trip.id)) {
          return previousTrip;
        }

        return {
          ...previousTrip,
          ...tripDetails,
          users: Array.isArray(tripDetails?.users) ? tripDetails.users : previousTrip.users,
          usersCount: Number.isFinite(Number(tripDetails?.usersCount))
            ? Number(tripDetails.usersCount)
            : (Array.isArray(tripDetails?.users) ? tripDetails.users.length : previousTrip.usersCount),
        };
      });
    } catch (err) {
      setDetailsError(normalizeErrorMessage(err, 'Failed to load users for this trip.'));
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeTripDetails = () => {
    setSelectedTrip(null);
    setShowDetailsModal(false);
    setDetailsLoading(false);
    setDetailsError('');
  };

  return (
    <main className="content">
      <div className="requests-container">
        <div className="requests-header">
          <div className="header-content">
            <div>
              <h1>Activity Logs</h1>
              <p className="subtitle">Track trip history and view users per trip</p>
            </div>
          </div>
        </div>

        <div className="search-sort-controls">
          <div className="search-sort-group">
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search by bus number, attendant, plate, route, or status..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setCurrentPage(1);
                }}
                className="search-input"
              />
            </div>

            <div className="sort-controls">
              <label htmlFor="activityLogsSortBy">Sort by:</label>
              <select
                id="activityLogsSortBy"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value);
                  setCurrentPage(1);
                }}
                className="sort-select"
              >
                <option value="latestUpdated">Latest Updated</option>
                <option value="departureTime">Departure Time</option>
                <option value="arrivalTime">Arrival Time</option>
                <option value="busNumber">Bus Number</option>
                <option value="attendantName">Bus Attendant</option>
                <option value="route">Route</option>
                <option value="status">Status</option>
                <option value="usersCount">Users Count</option>
              </select>

              <button
                type="button"
                onClick={() => setSortOrder((previous) => (previous === 'asc' ? 'desc' : 'asc'))}
                className="sort-order-btn"
                title={`Currently sorting ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
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
              <col style={{ width: '12%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Bus Number</th>
                <th>Bus Attendant</th>
                <th>Route</th>
                <th>Departure</th>
                <th>Arrival</th>
                <th>Status</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows rows={6} columns={7} />
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>
                    {searchQuery ? 'No trips match your search.' : 'No trip history found.'}
                  </td>
                </tr>
              ) : (
                currentItems.map((trip) => (
                  <tr
                    key={trip.id}
                    className="clickable-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => openTripDetails(trip)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openTripDetails(trip);
                      }
                    }}
                  >
                    <td>{trip.busNumber || '-'}</td>
                    <td>{trip.attendantName || '-'}</td>
                    <td>{trip.route || '-'}</td>
                    <td>{formatDateTime(trip.departureTime)}</td>
                    <td>{formatDateTime(trip.arrivalTime)}</td>
                    <td>{trip.status || '-'}</td>
                    <td>{trip.usersCount || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedLogs.length > 0 && (
          <div className="pagination">
            <button
              type="button"
              onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>

            <div className="page-numbers">
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  onClick={() => setCurrentPage(pageNumber)}
                  className={`page-number ${currentPage === pageNumber ? 'active' : ''}`}
                >
                  {pageNumber}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={currentPage === totalPages}
              className="pagination-btn"
            >
              Next
            </button>
          </div>
        )}

        {sortedLogs.length > 0 && (
          <div className="table-info">
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, sortedLogs.length)} of {sortedLogs.length} trips
          </div>
        )}
      </div>

      {showDetailsModal && selectedTrip && (
        <div className="modal-overlay" onClick={closeTripDetails}>
          <div className="modal-content activity-log-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Trip Details</h2>
              <button className="close-btn" onClick={closeTripDetails}>&times;</button>
            </div>

            <div className="modal-body">
              <div className="bus-info-grid">
                <div className="info-section">
                  <h3>Trip Information</h3>

                  <div className="info-row">
                    <span className="info-label">Bus Number:</span>
                    <span className="info-value">{selectedTrip.busNumber || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Bus Attendant:</span>
                    <span className="info-value">{selectedTrip.attendantName || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Bus Plate Number:</span>
                    <span className="info-value">{selectedTrip.plateNumber || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Route:</span>
                    <span className="info-value">{selectedTrip.route || '-'}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Departure:</span>
                    <span className="info-value">{formatDateTime(selectedTrip.departureTime)}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Arrival:</span>
                    <span className="info-value">{formatDateTime(selectedTrip.arrivalTime)}</span>
                  </div>

                  <div className="info-row">
                    <span className="info-label">Status:</span>
                    <span className="info-value">{selectedTrip.status || '-'}</span>
                  </div>
                </div>

                <div className="info-section">
                  <h3>Users on this Trip ({selectedTrip.usersCount || 0})</h3>

                  {detailsLoading && (
                    <p className="info-note">Loading users...</p>
                  )}

                  {detailsError && (
                    <p className="info-note" style={{ marginTop: detailsLoading ? '0.5rem' : 0 }}>
                      {detailsError}
                    </p>
                  )}

                  {!detailsLoading && Array.isArray(selectedTrip.users) && selectedTrip.users.length > 0 ? (
                    <div className="activity-users-list">
                      {selectedTrip.users.map((tripUser) => (
                        <div className="activity-user-item" key={`${selectedTrip.id}-${tripUser.id}`}>
                          <div className="info-row">
                            <span className="info-label">Name:</span>
                            <span className="info-value">{tripUser.name || '-'}</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Username:</span>
                            <span className="info-value">{tripUser.username || '-'}</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Email:</span>
                            <span className="info-value">{tripUser.email || '-'}</span>
                          </div>
                          <div className="info-row">
                            <span className="info-label">Boarded At:</span>
                            <span className="info-value">{formatDateTime(tripUser.boardedAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="info-note">No users were recorded for this trip.</p>
                  )}
                </div>
              </div>

              <div className="modal-actions-row bus-modal-actions">
                <button
                  type="button"
                  className="bus-action-btn secondary"
                  onClick={closeTripDetails}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default ActivityLogs;
