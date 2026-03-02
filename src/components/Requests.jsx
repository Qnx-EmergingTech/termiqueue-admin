import { useEffect, useState } from 'react';
import '../styles/Body.scss';
import '../styles/Requests.scss';
import { MdCheckCircle, MdClose, MdHighlightOff } from 'react-icons/md';
import TableSkeletonRows from './TableSkeletonRows';
import SuccessModal from './SuccessModal';
import {
  fetchActivationRequests,
  getRequestsTempData,
  updateActivationRequestStatus,
} from '../services/requestsService';

function Requests() {
  const [requests, setRequests] = useState(() => getRequestsTempData());
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successModal, setSuccessModal] = useState({
    open: false,
    title: '',
    message: '',
    detail: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  useEffect(() => {
    let isMounted = true;

    const loadRequests = async () => {
      try {
        const sourceRequests = await fetchActivationRequests();
        if (isMounted && Array.isArray(sourceRequests)) {
          setRequests(sourceRequests);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadRequests();

    return () => {
      isMounted = false;
    };
  }, []);

  const pendingRequests = requests.filter((request) => String(request.status).toLowerCase() === 'pending');

  const sortedPendingRequests = [...pendingRequests].sort((leftRequest, rightRequest) => {
    const leftTime = Number(leftRequest.requestedAt || 0);
    const rightTime = Number(rightRequest.requestedAt || 0);
    return rightTime - leftTime;
  });

  useEffect(() => {
    const recalculatedTotalPages = Math.max(1, Math.ceil(pendingRequests.length / itemsPerPage));

    if (currentPage > recalculatedTotalPages) {
      setCurrentPage(recalculatedTotalPages);
    }
  }, [pendingRequests.length, currentPage, itemsPerPage]);

  // Calculate pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = sortedPendingRequests.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.max(1, Math.ceil(pendingRequests.length / itemsPerPage));
  const currentPageRequestIds = currentItems.map((request) => request.id);
  const hasCurrentItems = currentPageRequestIds.length > 0;
  const isAllCurrentPageSelected = hasCurrentItems && currentPageRequestIds.every((id) => selectedRequestIds.includes(id));

  // Change page
  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  const handleToggleSelectRequest = (requestId) => {
    setSelectedRequestIds((previousSelectedRequestIds) => (
      previousSelectedRequestIds.includes(requestId)
        ? previousSelectedRequestIds.filter((id) => id !== requestId)
        : [...previousSelectedRequestIds, requestId]
    ));
  };

  const handleToggleSelectAllCurrent = () => {
    if (!hasCurrentItems) {
      return;
    }

    setSelectedRequestIds((previousSelectedRequestIds) => {
      if (isAllCurrentPageSelected) {
        return previousSelectedRequestIds.filter((id) => !currentPageRequestIds.includes(id));
      }

      const selectedSet = new Set(previousSelectedRequestIds);
      currentPageRequestIds.forEach((id) => selectedSet.add(id));
      return Array.from(selectedSet);
    });
  };

  // Get status color class
  const getStatusClass = (status) => {
    switch (String(status).toLowerCase()) {
      case 'approved': return 'status-completed';
      case 'pending': return 'status-pending';
      case 'rejected': return 'status-rejected';
      default: return '';
    }
  };

  const handleRowClick = (request) => {
    setSelectedRequest(request);
    setActionError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedRequest(null);
    setActionError('');
  };

  const handleStatusAction = async (nextStatus) => {
    if (!selectedRequest) {
      return;
    }

    setActionLoading(true);
    setActionError('');

    const previousStatus = selectedRequest.status;

    setRequests((previousRequests) => previousRequests.map((request) => (
      request.id === selectedRequest.id
        ? { ...request, status: nextStatus }
        : request
    )));

    setSelectedRequest((previousRequest) => (
      previousRequest ? { ...previousRequest, status: nextStatus } : previousRequest
    ));

    const didPersist = await updateActivationRequestStatus(selectedRequest.id, nextStatus);

    if (!didPersist) {
      setRequests((previousRequests) => previousRequests.map((request) => (
        request.id === selectedRequest.id
          ? { ...request, status: previousStatus }
          : request
      )));

      setSelectedRequest((previousRequest) => (
        previousRequest ? { ...previousRequest, status: previousStatus } : previousRequest
      ));

      setActionError('Unable to update status right now. Please try again.');
      setActionLoading(false);
      return;
    }

    setActionLoading(false);
    setSuccessModal({
      open: true,
      title: nextStatus === 'Approved' ? 'Request Approved' : 'Request Rejected',
      message: `The request for ${selectedRequest.fullName} was marked as ${nextStatus}.`,
      detail: '',
    });
    closeModal();
  };

  const handleBatchStatusAction = async (nextStatus) => {
    if (selectedRequestIds.length === 0) {
      return;
    }

    setBatchActionLoading(true);
    setActionError('');

    const idsToUpdate = new Set(selectedRequestIds);
    const previousStatusById = {};

    requests.forEach((request) => {
      if (idsToUpdate.has(request.id)) {
        previousStatusById[request.id] = request.status;
      }
    });

    setRequests((previousRequests) => previousRequests.map((request) => (
      idsToUpdate.has(request.id)
        ? { ...request, status: nextStatus }
        : request
    )));

    const updateResults = await Promise.all(selectedRequestIds.map(async (requestId) => {
      const didPersist = await updateActivationRequestStatus(requestId, nextStatus);
      return { requestId, didPersist };
    }));

    const failedIds = updateResults
      .filter((result) => !result.didPersist)
      .map((result) => result.requestId);

    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds);

      setRequests((previousRequests) => previousRequests.map((request) => (
        failedSet.has(request.id)
          ? { ...request, status: previousStatusById[request.id] || request.status }
          : request
      )));

      setActionError(`Unable to update ${failedIds.length} request(s). Please try again.`);
    } else {
      setSuccessModal({
        open: true,
        title: nextStatus === 'Approved' ? 'Batch Approved' : 'Batch Rejected',
        message: `${selectedRequestIds.length} requests were marked as ${nextStatus}.`,
        detail: '',
      });
    }

    setSelectedRequestIds([]);
    setBatchActionLoading(false);
  };

  const formatRequestedDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <main className="content">
      <SuccessModal
        open={successModal.open}
        title={successModal.title}
        message={successModal.message}
        detail={successModal.detail}
        onClose={() => setSuccessModal({ open: false, title: '', message: '', detail: '' })}
      />

      <div className="requests-container">
        <div className="requests-header">
          <h1>Requests</h1>
          <p className="subtitle">Review pending bus attendant account activation requests</p>

          {selectedRequestIds.length > 0 && (
            <div className="batch-actions-bar">
              <span>{selectedRequestIds.length} selected</span>
              <button
                type="button"
                className="table-action-btn archive"
                onClick={() => handleBatchStatusAction('Approved')}
                disabled={batchActionLoading}
              >
                Approve Selected
              </button>
              <button
                type="button"
                className="table-action-btn delete"
                onClick={() => handleBatchStatusAction('Rejected')}
                disabled={batchActionLoading}
              >
                Reject Selected
              </button>
            </div>
          )}
        </div>

        <div className="table-container">
          <table className="requests-table">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '6%' }} />
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
                <th>Request ID</th>
                <th>Full Name</th>
                <th>Bus Company</th>
                <th>Route</th>
                <th>Plate Number</th>
                <th>Capacity</th>
                <th className="center-col">Status</th>
                <th>Email</th>
                <th className="center-col">Requested At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows rows={6} columns={10} />
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '2rem' }}>
                    No pending activation requests.
                  </td>
                </tr>
              ) : (
                currentItems.map((request) => (
                  <tr key={request.id} onClick={() => handleRowClick(request)} className="clickable-row">
                    <td className="center-col" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="table-checkbox"
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={() => handleToggleSelectRequest(request.id)}
                      />
                    </td>
                    <td className="bus-number">{request.id}</td>
                    <td className="title-cell">{request.fullName}</td>
                    <td>{request.busCompany}</td>
                    <td>{request.route}</td>
                    <td>{request.plateNumber}</td>
                    <td className="center-col">{request.capacity}</td>
                    <td className="center-col">
                      <span className={`status-badge ${getStatusClass(request.status)}`}>
                        {request.status}
                      </span>
                    </td>
                    <td>{request.email}</td>
                    <td className="center-col">{formatRequestedDate(request.requestedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pendingRequests.length > 0 && (
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

        {pendingRequests.length > 0 && (
          <div className="table-info">
            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, pendingRequests.length)} of {pendingRequests.length} pending requests
          </div>
        )}
      </div>

      {showModal && selectedRequest && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content activation-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header activation-modal-header">
              <h2>Approve this bus attendant?</h2>
              <button className="close-btn" onClick={closeModal} aria-label="Close">
                <MdClose />
              </button>
            </div>

            <div className="modal-body activation-modal-body">
              <div className="bus-photo-section activation-photo-section">
                <div className="bus-photo-placeholder activation-photo-placeholder">
                  {selectedRequest.busPhoto ? (
                    <img src={selectedRequest.busPhoto} alt={`Bus ${selectedRequest.plateNumber}`} />
                  ) : (
                    <div className="no-photo">
                      <span>📷</span>
                      <p>No bus photo uploaded</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="activation-request-card">
                <h3>{selectedRequest.fullName}</h3>
                <div className="activation-request-meta">
                  <span>Bus plate number • {selectedRequest.plateNumber}</span>
                </div>

                <div className="activation-divider" />

                <div className="activation-detail-row">
                  <span className="detail-label">Request ID:</span>
                  <span className="detail-value">{selectedRequest.id}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Bus Company:</span>
                  <span className="detail-value">{selectedRequest.busCompany}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Route:</span>
                  <span className="detail-value">{selectedRequest.route}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Plate Number:</span>
                  <span className="detail-value">{selectedRequest.plateNumber}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Capacity:</span>
                  <span className="detail-value">{selectedRequest.capacity}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Email:</span>
                  <span className="detail-value">{selectedRequest.email}</span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Current Status:</span>
                  <span className={`status-badge ${getStatusClass(selectedRequest.status)}`}>
                    {selectedRequest.status}
                  </span>
                </div>
                <div className="activation-detail-row">
                  <span className="detail-label">Requested At:</span>
                  <span className="detail-value">{formatRequestedDate(selectedRequest.requestedAt)}</span>
                </div>
              </div>

              {actionError && <p className="activation-action-error">{actionError}</p>}

              <div className="activation-actions">
                <button
                  type="button"
                  className="activation-btn approve-btn"
                  onClick={() => handleStatusAction('Approved')}
                  disabled={actionLoading}
                >
                  <MdCheckCircle />
                  Approve
                </button>
                <button
                  type="button"
                  className="activation-btn reject-btn"
                  onClick={() => handleStatusAction('Rejected')}
                  disabled={actionLoading}
                >
                  <MdHighlightOff />
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Requests;