# QNext Admin Learning Guide (Current)

This guide explains:

1. how the app is wired today,
2. what each core page does,
3. where to start when reading code.

---

## 1) Visual App Map

```text
main.jsx
  ↓
App.jsx
  ↓
AuthProvider (AuthContext.jsx)
  ↓
AppContent picks page
  ├─ Dashboard.jsx
  ├─ Buses.jsx
  ├─ BusAttendants.jsx
  ├─ RoutesManagement.jsx
  └─ LearningGuidePage.jsx
```

Simple meaning:
- `main.jsx` boots React.
- `App.jsx` handles auth-gated page selection.
- Sidebar navigation comes from `Header.jsx`.

---

## 2) Data Flow Map

```text
API/JSON source
  ↓
Service normalization (src/services)
  ↓
Component state (useState/useMemo)
  ↓
Table/charts/modals
  ↓
localStorage fallback (when used)
```

### Primary sources now
- Buses seed/fallback: `src/data/busesData.json`
- Auth mock profile data: `src/data/authMockData.json`
- Route + destination + geofence data: backend APIs via `src/services/api.js`

---

## 3) Page Cards (What + Why)

### `Dashboard` (`src/components/Dashboard.jsx`)
- **What:** KPI cards, trends/charts, report generation.
- **Why:** Operations visibility and exportable reporting.

### `Buses` (`src/components/Buses.jsx`)
- **What:** Bus management, add/edit, archive/restore flow.
- **Why:** Core fleet admin lifecycle.

### `BusAttendants` (`src/components/BusAttendants.jsx`)
- **What:** Attendant list and related admin views.
- **Why:** Personnel tracking linked to bus operations.

### `RoutesManagement` (`src/components/RoutesManagement.jsx`)
- **What:** Route geofence and queue destination management with map preview.
- **Why:** Route setup, origin radius configuration, destination linkage.

### `LearningGuidePage` (`src/components/LearningGuidePage.jsx`)
- **What:** In-app onboarding/reference page.
- **Why:** Faster teammate onboarding.

---

## 4) Important Services

### `src/services/api.js`
- Handles API calls, endpoint fallbacks, and payload normalization.
- Includes bus status mapping and compatibility handling.

### `src/services/dashboardService.js`
- Provides dashboard-ready bus data and chart helpers.

### `src/services/busFirebaseSyncService.js`
- Sync bridge for bus records to Firebase when configured.

### `src/context/AuthContext.jsx`
- Owns auth session state and admin access checks.

---

## 5) Key Interactions (Click → Function)

- **Login** → `Login.handleSubmit` → auth context `login(...)`
- **Logout** → `Header.handleLogout` → auth context `logout()`
- **Add Bus** → `Buses.handleSubmit`
- **Archive/Restore Bus** → `Buses.archiveBusIds` / `Buses.unarchiveBusIds`
- **Create/Edit Route** → `RoutesManagement.handleSaveRoute`
- **Delete Route** → `RoutesManagement.handleDeleteRoute`
- **Generate Dashboard Report** → dashboard report handlers

---

## 6) 30-Minute Study Path

### Mission A (10 min): Bus lifecycle
1. Open Buses.
2. Add one bus.
3. Archive and restore it.

### Mission B (10 min): Route lifecycle
1. Open Routes.
2. Create one route with destination.
3. Edit origin/radius and confirm map preview.

### Mission C (10 min): Dashboard flow
1. Open Dashboard.
2. Change chart period selectors.
3. Generate report preview/download.

---

## 7) Troubleshooting Quick Notes

### Changes not showing?
Clear local keys and reload:

```javascript
localStorage.removeItem('qnext_admin_buses');
localStorage.removeItem('qnext_admin_archived_buses');
location.reload();
```

### API-backed screens failing?
Check `.env` and backend availability for:
- `VITE_API_URL`
- auth/API CORS setup

### Firebase sync missing?
Set required `VITE_FIREBASE_*` values and restart dev server.
