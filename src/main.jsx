import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { firebaseInitialized } from './firebase';

// Log status to console to debug the white screen
console.log('Firebase Initialized:', firebaseInitialized);

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("Failed to find the root element. Ensure index.html has <div id='root'></div>");
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}