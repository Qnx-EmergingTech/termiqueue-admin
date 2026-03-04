import { useState } from 'react';
import '../styles/Header.scss';
import qnextLogo from '../assets/qnext.svg';
import { MdDashboard, MdLogout, MdDirectionsBus, MdPeople, MdAltRoute } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';
import ConfirmationModal from './ConfirmationModal';


function Header({ setCurrentPage, currentPage }) {
  const { logout } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  return (
    <header className="sidebar">
      <ConfirmationModal
        open={showLogoutConfirm}
        title="Confirm Logout"
        message="Are you sure you want to logout?"
        note="You can sign back in anytime."
        confirmLabel="Logout"
        confirmVariant="danger"
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleConfirmLogout}
      />

      <nav>
        <div className='logo'>
          <img src={qnextLogo} alt="QNext Logo" />
        </div>
        <ul>
          <li>
            <button className={currentPage === 'dashboard' ? 'active' : ''} onClick={() => setCurrentPage('dashboard')}>
              <MdDashboard /> Dashboard
            </button>
          </li>
          <li>
            <button className={currentPage === 'buses' ? 'active' : ''} onClick={() => setCurrentPage('buses')}>
              <MdDirectionsBus /> Buses
            </button>
          </li>
          <li>
            <button className={currentPage === 'bus-attendants' ? 'active' : ''} onClick={() => setCurrentPage('bus-attendants')}>
              <MdPeople /> Bus Attendants
            </button>
          </li>
          <li>
            <button className={currentPage === 'routes' ? 'active' : ''} onClick={() => setCurrentPage('routes')}>
              <MdAltRoute /> Routes
            </button>
          </li>
        </ul>
        <div className="user-section">
          <button className="logout-btn" onClick={() => setShowLogoutConfirm(true)}>
            <MdLogout /> Logout
          </button>
        </div>
      </nav>
    </header>
  );
}

export default Header;