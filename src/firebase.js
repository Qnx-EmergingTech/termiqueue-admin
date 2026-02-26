import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// 1. Validation check for essential keys
export const firebaseInitialized = !!(
  firebaseConfig.apiKey && 
  firebaseConfig.projectId && 
  firebaseConfig.appId
);

// Declare variables
let app = null;
let db = null;
let auth = null;

// 2. Conditional Initialization
if (firebaseInitialized) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (error) {
    console.error("Firebase initialization error:", error);
  }
} else {
  console.warn("Firebase keys are missing. Firebase features will be disabled.");
}

export { db, auth, app };