import { createUserWithEmailAndPassword, fetchSignInMethodsForEmail, getAuth, signOut, updateProfile } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';
import { app, firebaseInitialized } from '../firebase';

const PROVISIONING_APP_NAME = 'qnext-bus-attendant-provisioning';

const getProvisioningAuth = () => {
  if (!firebaseInitialized || !app) {
    return null;
  }

  const existingApp = getApps().find((candidateApp) => candidateApp.name === PROVISIONING_APP_NAME);
  const provisioningApp = existingApp || initializeApp(app.options, PROVISIONING_APP_NAME);
  return getAuth(provisioningApp);
};

export const provisionBusAttendantAuthUser = async ({ email, password, displayName }) => {
  const auth = getProvisioningAuth();
  if (!auth) {
    return { provisioned: false, reason: 'firebase-not-configured' };
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');

  if (!normalizedEmail || !normalizedPassword) {
    return { provisioned: false, reason: 'missing-credentials' };
  }

  try {
    const signInMethods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
    if (Array.isArray(signInMethods) && signInMethods.length > 0) {
      return { provisioned: true, existed: true };
    }
  } catch {
    // Continue to creation attempt; some environments may block method lookup.
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, normalizedPassword);

    if (String(displayName || '').trim()) {
      await updateProfile(userCredential.user, { displayName: String(displayName).trim() });
    }

    await signOut(auth);

    return {
      provisioned: true,
      existed: false,
      uid: userCredential.user.uid,
    };
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/email-already-in-use') {
      return { provisioned: true, existed: true };
    }

    return {
      provisioned: false,
      reason: code || 'provisioning-failed',
      message: String(error?.message || ''),
    };
  }
};
