import '../styles/Header.scss';
import qnextLogo from '../assets/qnext.svg';
import { MdDashboard, MdAssignment, MdLogout, MdDirectionsBus, MdPeople } from 'react-icons/md';
import { useAuth } from '../context/AuthContext';


function Header({ setCurrentPage, currentPage }) {
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <header className="sidebar">
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
            <button className={currentPage === 'requests' ? 'active' : ''} onClick={() => setCurrentPage('requests')}>
              <MdAssignment /> Requests
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
        </ul>
        <div className="user-section">
          <button className="logout-btn" onClick={handleLogout}>
            <MdLogout /> Logout
          </button>
        </div>
      </nav>
    </header>
  );
}

export default Header;