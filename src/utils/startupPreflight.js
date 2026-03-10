const STORAGE_SCHEMA_KEY = 'qnext_admin_storage_schema_version';
const STORAGE_SCHEMA_VERSION = '2026-03-05.1';

const LEGACY_STORAGE_KEYS = [
  'qnext_admin_buses',
  'qnext_admin_attendants',
  'routesManagement.localRoutes',
  'routesManagement.localDestinations',
  'routesManagement.globalOrigin',
  'qnext.busAttendants.cleanup.data.done',
];

const normalizeAuthProvider = (value) => String(value || '').trim().toLowerCase() || 'firebase';

const isNonEmpty = (value) => String(value || '').trim().length > 0;

const ensureLocalStorageSchema = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { resetApplied: false };
  }

  const previousVersion = String(window.localStorage.getItem(STORAGE_SCHEMA_KEY) || '').trim();
  if (previousVersion === STORAGE_SCHEMA_VERSION) {
    return { resetApplied: false };
  }

  LEGACY_STORAGE_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
  window.localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);

  return { resetApplied: previousVersion.length > 0 || previousVersion !== STORAGE_SCHEMA_VERSION };
};

export const getStartupPreflightReport = () => {
  const issues = [];
  const warnings = [];

  const authProvider = normalizeAuthProvider(import.meta.env.VITE_AUTH_PROVIDER);
  const apiUrl = String(import.meta.env.VITE_API_URL || '').trim();

  const requiredFirebaseKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ];

  const missingFirebaseKeys = requiredFirebaseKeys.filter((key) => !isNonEmpty(import.meta.env[key]));

  if (!['firebase', 'api'].includes(authProvider)) {
    issues.push(`VITE_AUTH_PROVIDER must be either "firebase" or "api" (current: "${authProvider || 'unset'}").`);
  }

  if (authProvider === 'firebase' && missingFirebaseKeys.length > 0) {
    issues.push(`Firebase mode requires these env vars: ${missingFirebaseKeys.join(', ')}.`);
  }

  if (authProvider === 'api' && !apiUrl) {
    issues.push('API mode requires VITE_API_URL to be set.');
  }

  if (authProvider === 'firebase' && apiUrl) {
    warnings.push('VITE_API_URL is set while VITE_AUTH_PROVIDER is firebase. If backend data APIs are not fully available yet, leave VITE_API_URL empty for the smoothest first-run experience.');
  }

  const storageResult = ensureLocalStorageSchema();
  if (storageResult.resetApplied) {
    warnings.push('Local app cache was reset to match the latest data schema after update.');
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    authProvider,
    apiUrlConfigured: Boolean(apiUrl),
  };
};
