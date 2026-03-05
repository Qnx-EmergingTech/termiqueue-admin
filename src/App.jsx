import './App.css';
import './styles/Header.scss';
import './styles/Body.scss';
import { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Header from './components/Header';
import SkeletonLoader from './components/SkeletonLoader';

const Dashboard = lazy(() => import('./components/Dashboard'));
const Buses = lazy(() => import('./components/Buses'));
const BusAttendants = lazy(() => import('./components/BusAttendants'));
const RoutesManagement = lazy(() => import('./components/RoutesManagement'));
const ActivityLogs = lazy(() => import('./components/ActivityLogs'));
const LearningGuidePage = lazy(() => import('./components/LearningGuidePage'));
const NotFound = lazy(() => import('./components/NotFound'));
const Login = lazy(() => import('./components/Login'));

function AppContent() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    // Check current URL on mount and when it changes
    const checkURL = () => {
      const pathname = window.location.pathname;
      
      if (pathname === '/requests') {
        setCurrentPage('dashboard');
      } else if (pathname === '/buses') {
        setCurrentPage('buses');
      } else if (pathname === '/bus-attendants') {
        setCurrentPage('bus-attendants');
      } else if (pathname === '/routes') {
        setCurrentPage('routes');
      } else if (pathname === '/activity-logs') {
        setCurrentPage('activity-logs');
      } else if (pathname === '/learning-guide') {
        setCurrentPage('learning-guide');
      } else if (pathname === '/' || pathname === '') {
        setCurrentPage('dashboard');
      } else {
        setCurrentPage('notfound');
      }
    };

    checkURL();

    // Handle browser back/forward buttons
    window.addEventListener('popstate', checkURL);
    return () => window.removeEventListener('popstate', checkURL);
  }, []);

  const handleNavigation = (page) => {
    setCurrentPage(page);
    // Update URL without page reload
    if (page === 'buses') {
      window.history.pushState({}, '', '/buses');
    } else if (page === 'bus-attendants') {
      window.history.pushState({}, '', '/bus-attendants');
    } else if (page === 'routes') {
      window.history.pushState({}, '', '/routes');
    } else if (page === 'activity-logs') {
      window.history.pushState({}, '', '/activity-logs');
    } else if (page === 'learning-guide') {
      window.history.pushState({}, '', '/learning-guide');
    } else {
      window.history.pushState({}, '', '/');
    }
  };

  // Show loading state while checking authentication
  if (loading) {
    return <SkeletonLoader fullPage />;
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<SkeletonLoader fullPage />}>
        <Login />
      </Suspense>
    );
  }

  // Show app content if authenticated
  return (
    <div>
      <Header setCurrentPage={handleNavigation} currentPage={currentPage} />
      <Suspense fallback={<SkeletonLoader />}>
        {currentPage === 'dashboard' && <Dashboard />}
        {currentPage === 'buses' && <Buses />}
        {currentPage === 'bus-attendants' && <BusAttendants />}
        {currentPage === 'routes' && <RoutesManagement />}
        {currentPage === 'activity-logs' && <ActivityLogs />}
        {currentPage === 'learning-guide' && <LearningGuidePage />}
        {currentPage === 'notfound' && <NotFound />}
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
