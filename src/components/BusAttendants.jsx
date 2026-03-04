 import { useEffect, useMemo, useState } from 'react';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import TableSkeletonRows from './TableSkeletonRows';
import { fetchBusAttendants, fetchBuses } from '../services/api';

function BusAttendants() {
  const [attendants, setAttendants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('first_name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  useEffect(() => {
    let isMounted = true;

    const loadBusAttendants = async () => {
      setLoading(true);
      setError('');

      try {
        const profiles = await fetchBusAttendants();

        let buses = [];
        try {
          buses = await fetchBuses();
        } catch {
          buses = [];
        }

        if (!isMounted) {
          return;
        }

        const busLookup = new Map(
          (Array.isArray(buses) ? buses : []).map((bus) => [String(bus.id || '').trim(), bus])
        );

        const attendantsWithBusInfo = (Array.isArray(profiles) ? profiles : []).map((attendant) => {
          const assignedBusId = String(attendant.assignedBusId || attendant.bus_id || attendant.busId || '').trim();

          const attendantIdentifiers = new Set([
            String(attendant.id || '').trim(),
            String(attendant.uid || '').trim(),
            String(attendant.user_id || '').trim(),
            String(attendant.username || '').trim(),
            String(attendant.username_lower || '').trim(),
            String(attendant.raw?.id || '').trim(),
            String(attendant.raw?.uid || '').trim(),
            String(attendant.raw?.user_id || '').trim(),
            String(attendant.raw?.username || '').trim(),
            String(attendant.raw?.username_lower || '').trim(),
          ].filter(Boolean));

          let assignedBus = assignedBusId ? busLookup.get(assignedBusId) : null;

          if (!assignedBus) {
            assignedBus = (Array.isArray(buses) ? buses : []).find((bus) => {
              const busAttendantId = String(bus.attendantId || bus.attendant_id || '').trim();
              return busAttendantId && attendantIdentifiers.has(busAttendantId);
            }) || null;
          }

          return {
            ...attendant,
            assignedBusNumber: assignedBus?.busNumber || '-',
            assignedBusPlateNumber: assignedBus?.plateNumber || '-',
          };
        });

        setAttendants(attendantsWithBusInfo);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message = err?.response?.data?.message || err?.response?.data?.detail || err?.message || 'Failed to load bus attendants.';
        setError(message);
        setAttendants([]);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBusAttendants();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredAttendants = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    if (!query) {
      return attendants;
    }

    return attendants.filter((attendant) => {
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
  }, [attendants, searchQuery]);

  const sortedAttendants = useMemo(() => {
    const sortable = [...filteredAttendants];

    sortable.sort((leftItem, rightItem) => {
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

  const handleSortChange = (event) => {
    setSortBy(event.target.value);
    setCurrentPage(1);
  };

  const handleSortOrderToggle = () => {
    setSortOrder((previousSortOrder) => (previousSortOrder === 'asc' ? 'desc' : 'asc'));
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
      <div className="requests-container">
        <div className="requests-header">
          <div className="header-content">
            <div>
              <h1>Bus Attendants</h1>
              <p className="subtitle">Profiles with user_type = bus_attendant</p>
            </div>
          </div>
        </div>

        <div className="search-sort-controls">
          <div className="search-sort-group">
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search by first name, last name, username, email, bus number, or bus plate number..."
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
                <option value="first_name">First Name</option>
                <option value="last_name">Last Name</option>
                <option value="username">Username</option>
                <option value="email">Email</option>
                <option value="assignedBusNumber">Bus Number</option>
                <option value="assignedBusPlateNumber">Bus Plate Number</option>
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
        </div>

        {error && (
          <div className="dashboard-warning-banner" role="alert" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div className="table-container">
          <table className="requests-table">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
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
                    No bus attendant profiles found.
                  </td>
                </tr>
              ) : (
                currentItems.map((attendant) => (
                  <tr key={attendant.id}>
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
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, sortedAttendants.length)} of {sortedAttendants.length} bus attendants
          </div>
        )}
      </div>
    </main>
  );
}

export default BusAttendants;
