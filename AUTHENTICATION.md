# Authentication Implementation Guide

## Overview

This project uses **Firebase Authentication** and **Firestore** for admin access control.

Authentication is considered valid only when:

1. User signs in successfully via Firebase Auth (Email/Password), and
2. User has a Firestore document at `users/{uid}` with `isAdmin: true`.

## File Structure

```
src/
├── firebase.js                     # Firebase app/auth/firestore initialization
├── context/
│   └── AuthContext.jsx             # Auth state + admin guard
├── services/
│   ├── authService.js              # Admin login helper
│   └── api.js                      # Optional backend API client
├── components/
│   └── Login.jsx                   # Login form component
└── styles/
    └── Login.scss                  # Login page styles
```

## Required Environment Variables

Create `.env` from `.env.example` and set:

```env
VITE_AUTH_PROVIDER=firebase
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`VITE_API_URL` is only required when using API auth mode (`VITE_AUTH_PROVIDER=api`).

### Auth Mode Selection

- `VITE_AUTH_PROVIDER=firebase` (default):
  - Uses Firebase Auth + Firestore admin check.
- `VITE_AUTH_PROVIDER=api`:
  - Uses `loginAPI`/`logoutAPI`/`getCurrentUser` from `src/services/api.js`.
  - Requires a reachable backend at `VITE_API_URL`.

### API `/profiles` Mode Notes

When `VITE_AUTH_PROVIDER=api`, this app authenticates against backend endpoints:

- `POST /profiles/login`
- `GET /profiles/me`

Important behavior:

- The login form accepts **Username or Email**, but `loginAPI` sends the first field as `username` to `/profiles/login`.
- Password is **not** stored in Firestore profile documents. Password validation is handled by the backend auth service.
- Profile role data can be stored under `/profiles` fields such as `user_type`, `role`, `user_role`, `account_type`, etc., which are normalized by `src/services/api.js`.
## Firebase Project Setup

### 1) Enable Auth Provider

- Firebase Console → Authentication → Sign-in method
- Enable **Email/Password**

### 2) Create/Import Admin User

- Add the user in Firebase Authentication (email + password)

### 3) Add Admin Record in Firestore

- Firestore collection: `users`
- Document ID: exact Firebase Auth user UID
- Required field:

```json
{
  "isAdmin": true
}
```

Optional profile fields (if used by UI):

```json
{
  "isAdmin": true,
  "name": "Admin User",
  "role": "Administrator"
}
```

## How Auth Works

1. App subscribes to `onAuthStateChanged` in `AuthContext`.
2. When a Firebase user exists, app loads `users/{uid}` from Firestore.
3. If `isAdmin === true`, user is accepted and app is unlocked.
4. If not admin, app signs the user out immediately.

## Accessing Auth State in Components

```jsx
import { useAuth } from '../context/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, loading, login, logout } = useAuth();

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {isAuthenticated ? <p>Welcome, {user.name || user.email}!</p> : <p>Please sign in.</p>}
    </div>
  );
}
```

## Troubleshooting

### "Login failed"

- Verify email/password user exists in Firebase Auth.
- Verify `VITE_AUTH_PROVIDER=firebase` if you are not using backend API auth.

### "Access Denied: You are not an Admin"

- Verify Firestore document exists at `users/{uid}`.
- Verify `isAdmin` is exactly boolean `true`.

### App logs in then immediately logs out

- Usually means missing or invalid admin document in Firestore.

### Login works only after changing port

- This is usually not a port issue itself.
- Most common cause is running the wrong auth mode:
  - `VITE_AUTH_PROVIDER=api` without a working API backend.
- Confirm your `.env` has:

```env
VITE_AUTH_PROVIDER=firebase
VITE_API_URL=
```

### Firebase config/runtime error

- Verify all `VITE_FIREBASE_*` values exist in `.env`.
- Restart dev server after changing env values.
