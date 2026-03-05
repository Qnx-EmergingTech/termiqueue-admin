import '../styles/ConfirmationModal.scss';

function ConfirmationModal({
  open,
  title,
  message,
  note = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  confirmDisabled = false,
  cancelDisabled = false,
  closeDisabled = false,
  onConfirm,
  onCancel,
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-modal-overlay" onClick={closeDisabled ? undefined : onCancel}>
      <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-modal-header">
          <h2>{title}</h2>
          <button type="button" className="confirm-close-btn" onClick={onCancel} disabled={closeDisabled}>&times;</button>
        </div>

        <div className="confirm-modal-body">
          <p className="confirm-message">{message}</p>
          {note && <p className="confirm-note">{note}</p>}

          <div className="confirm-modal-actions">
            <button type="button" className="confirm-btn cancel" onClick={onCancel} disabled={cancelDisabled}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`confirm-btn ${confirmVariant === 'danger' ? 'danger' : 'primary'}`}
              onClick={onConfirm}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfirmationModal;
