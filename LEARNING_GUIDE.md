<<<<<<< HEAD
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
=======
# QNext Admin Learning Guide (Visual + Beginner)

This guide explains:

1. how the code works,
2. why each component/function exists,
3. where each one is used.

Read this like a map, not like a textbook.

---

## 1) Visual App Map (Start Here)

```
main.jsx
	↓
App.jsx
	↓
AuthProvider (AuthContext.jsx)
	↓
AppContent chooses page
	├─ Dashboard.jsx
	├─ Requests.jsx
	├─ Buses.jsx
	└─ LearningGuidePage.jsx
```

Simple meaning:
- `main.jsx` starts the app.
- `App.jsx` controls navigation + auth gate.
- Page components show the actual screens.

---

## 2) Visual Data Map

```
JSON seed files
	 ↓
Service/Data helpers
	 ↓
Component state (useState)
	 ↓
UI table/charts
	 ↓
localStorage or Firebase write
```

### Data sources in this project
- Buses seed: `src/data/busesData.json`
- Requests seed: `src/data/activationRequestsData.json`
- Active buses key: `qnext_admin_buses`
- Archived buses key: `qnext_admin_archived_buses`

---

## 3) Component Cards (What + Why + Used By)

## `App` and routing components

### `App` (`src/App.jsx`)
- **What it does:** Wraps app with `AuthProvider`.
- **Why it exists:** So every screen can access auth state.
- **Used by:** root render from `main.jsx`.

### `AppContent` (`src/App.jsx`)
- **What it does:** Chooses which page to render (`dashboard`, `requests`, `buses`, `learning-guide`).
- **Why it exists:** Central place for URL/path and page switching.
- **Used by:** rendered inside `App`.

### `Header` (`src/components/Header.jsx`)
- **What it does:** Sidebar nav + logout button + user info.
- **Why it exists:** Shared navigation UI.
- **Used by:** `AppContent` when user is authenticated.

### `Login` (`src/components/Login.jsx`)
- **What it does:** Accepts email/password and calls `login(...)`.
- **Why it exists:** Authentication entry screen.
- **Used by:** `AppContent` when `isAuthenticated` is false.

### `NotFound` (`src/components/NotFound.jsx`)
- **What it does:** Shows 404 view.
- **Why it exists:** Handles unknown URLs safely.
- **Used by:** `AppContent` when path is not recognized.

### `SkeletonLoader` (`src/components/SkeletonLoader.jsx`)
- **What it does:** Placeholder loading UI.
- **Why it exists:** Better loading experience than blank screen.
- **Used by:** `AppContent` and lazy-loaded pages.

---

## `AuthContext` components

### `AuthProvider` (`src/context/AuthContext.jsx`)
- **What it does:** Stores global auth state (`user`, `loading`, `isAuthenticated`).
- **Why it exists:** Prevents passing auth props manually through many components.
- **Used by:** wraps whole app in `App`.

### `useAuth` (`src/context/AuthContext.jsx`)
- **What it does:** Hook to read auth values and actions.
- **Why it exists:** Easy access to `login`/`logout` anywhere.
- **Used by:** `Header`, `Login`, `AppContent`.

---

## Page components

### `Buses` (`src/components/Buses.jsx`)
- **What it does:** Bus table + add bus modal + archive lifecycle + batch actions.
- **Why it exists:** Main CRUD-like management screen for buses.
- **Used by:** `AppContent` when current page is `buses`.

### `Requests` (`src/components/Requests.jsx`)
- **What it does:** Shows pending activation requests, modal review, approve/reject (single + batch).
- **Why it exists:** Admin workflow for request decisions.
- **Used by:** `AppContent` when current page is `requests`.

### `Dashboard` (`src/components/Dashboard.jsx`)
- **What it does:** Computes analytics from buses and renders charts + PDF report flow.
- **Why it exists:** Gives admin insights and reporting output.
- **Used by:** `AppContent` when current page is `dashboard`.

### `LearningGuidePage` (`src/components/LearningGuidePage.jsx`)
- **What it does:** Visual guide page for understanding the system.
- **Why it exists:** Built for onboarding and self-learning.
- **Used by:** `AppContent` when current page is `learning-guide`.

---

## 4) Function Cards (Why each key function exists)

## `src/context/AuthContext.jsx`

### `login(email, password)`
- **Why this exists:** sign-in and admin validation.
- **How used:** called by `Login` form submit.
- **Flow:** Firebase Auth sign-in → Firestore `users/{uid}` check → allow or sign out.

### `logout()`
- **Why this exists:** consistent logout behavior.
- **How used:** called by `Header` logout button.
- **Flow:** `signOut(auth)` → clear user state.

### `onAuthStateChanged(...)` effect
- **Why this exists:** keeps session state in sync when page reloads.
- **How used:** runs automatically in provider `useEffect`.
- **Flow:** detects current auth user → validates admin role.

---

## `src/data/busesData.js`

### `getBusesData()`
- **Why this exists:** one safe read entry for active buses.
- **How used:** `Buses` and dashboard service read from here in local mode.

### `saveBusesData(buses)`
- **Why this exists:** one safe write entry for active buses.
- **How used:** `Buses` writes after state changes.

### `getArchivedBusesData()` / `saveArchivedBusesData()`
- **Why this exists:** archive data is kept separate from active data.
- **How used:** `Buses` archived view and archive actions.

---

## `src/services/dashboardService.js`

### `getDashboardTempBuses()`
- **Why this exists:** quick local fallback source.
- **How used:** `Dashboard` initial state.

### `fetchBusesFromFirebase()`
- **Why this exists:** pull live buses from Firestore.
- **How used:** called inside `fetchDashboardBuses()` when firebase mode is active.

### `fetchDashboardBuses()`
- **Why this exists:** one function that hides local vs firebase complexity.
- **How used:** `Dashboard` data loader effect.

---

## `src/services/requestsService.js`

### `getRequestsTempData()`
- **Why this exists:** local starter data for requests.
- **How used:** `Requests` initial state and fallback path.

### `fetchActivationRequests()`
- **Why this exists:** one source-switch function for requests.
- **How used:** `Requests` load effect.

### `updateActivationRequestStatus(requestId, status)`
- **Why this exists:** shared update logic for approve/reject.
- **How used:** called by `Requests` single and batch status actions.

---

## `src/components/Buses.jsx` (key functions)

### `archiveBusIds(ids)`
- **Why this exists:** safe first step before permanent deletion.
- **How used:** row archive button + batch archive action.

### `unarchiveBusIds(ids)`
- **Why this exists:** restore mistakenly archived buses.
- **How used:** archived row action + batch unarchive action.

### `deleteArchivedBusIds(ids)`
- **Why this exists:** final cleanup only after archive step.
- **How used:** archived delete actions.

### `handleSubmit(event)`
- **Why this exists:** create new bus from modal form.
- **How used:** add-bus form submit.

### `handleToggleSelectBus(id)` / `handleToggleSelectAllCurrent()`
- **Why this exists:** checkbox selection logic for batch actions.
- **How used:** table row checkbox + table header checkbox.

---

## `src/components/Requests.jsx` (key functions)

### `handleStatusAction(nextStatus)`
- **Why this exists:** approve/reject a single selected request.
- **How used:** modal action buttons.
- **Note:** does optimistic UI update then rollback on failure.

### `handleBatchStatusAction(nextStatus)`
- **Why this exists:** approve/reject many requests at once.
- **How used:** batch action bar when rows are checked.

### `handleToggleSelectRequest(id)` / `handleToggleSelectAllCurrent()`
- **Why this exists:** shared row/header selection behavior.
- **How used:** checkboxes in requests table.

---

## `src/components/Dashboard.jsx` (key functions)

### `useMemo(...)` analytics builder
- **Why this exists:** expensive chart data calculations should not rerun unnecessarily.
- **How used:** all KPI cards and chart datasets come from this object.

### `handleGenerateReport()`
- **Why this exists:** create PDF analytics report from current data.
- **How used:** “Preview Report (PDF)” button.

### `handleDownloadPreviewPdf()`
- **Why this exists:** explicit user-controlled download from preview.
- **How used:** report preview modal download button.

---

## 5) "When I click X, what function runs?" cheat sheet

- Click **Sign In** → `Login.handleSubmit` → `login(...)`
- Click **Logout** → `Header.handleLogout` → `logout()`
- Click **Add Bus** submit → `Buses.handleSubmit`
- Click **Archive** bus → `Buses.archiveBusIds`
- Click **Unarchive** bus → `Buses.unarchiveBusIds`
- Click **Delete Archived** → `Buses.deleteArchivedBusIds`
- Click **Approve/Reject** request modal → `Requests.handleStatusAction`
- Click **Batch Approve/Reject** → `Requests.handleBatchStatusAction`
- Click **Preview Report (PDF)** → `Dashboard.handleGenerateReport`
- Click **Download PDF** in preview → `Dashboard.handleDownloadPreviewPdf`

---

## 6) Visual beginner study path (30 minutes)

### Mission A (10 min): Buses lifecycle
1. Open Buses page.
2. Add a bus.
3. Archive it.
4. Switch to archived view.
5. Unarchive it.

✅ You learned local persistence + safe deletion flow.

### Mission B (10 min): Requests workflow
1. Open Requests page.
2. Select 2 rows.
3. Use batch approve/reject.

✅ You learned optimistic UI + batch actions.

### Mission C (10 min): Dashboard reporting
1. Open Dashboard.
2. Switch weekly/monthly/yearly selectors.
3. Generate report preview.
4. Download PDF.

✅ You learned derived analytics + export flow.

---

## 7) If things look wrong

### JSON edits not showing?
Clear browser cache keys then reload:
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)

```javascript
localStorage.removeItem('qnext_admin_buses');
localStorage.removeItem('qnext_admin_archived_buses');
location.reload();
```

<<<<<<< HEAD
### API-backed screens failing?
Check `.env` and backend availability for:
- `VITE_API_URL`
- auth/API CORS setup

### Firebase sync missing?
Set required `VITE_FIREBASE_*` values and restart dev server.
=======
### Firebase updates not happening?
Check environment variables:
- `VITE_DASHBOARD_DATA_SOURCE`
- `VITE_REQUESTS_DATA_SOURCE`

Use `firebase` if you want real Firestore reads/writes.

---

## 8) Next step (optional)

If you want, the next guide can be:

**“Line-by-line walkthrough of `Buses.jsx`”** with screenshots/diagrams style notes.
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)
