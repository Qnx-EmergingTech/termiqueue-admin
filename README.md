# QNext Admin

A modern admin dashboard application built with React, Vite, and SCSS. Features a responsive interface with data visualization using Recharts.

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v20 or higher recommended)
- **npm** package manager
- **Git** for version control

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd qnext-admin
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including React, Vite, and SCSS tools.

### 3. Configure Environment Variables

Copy the example env file and set your Firebase project values:

```bash
cp .env.example .env
```

For Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Required values in `.env`:

- `VITE_AUTH_PROVIDER` (`firebase` by default)
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

> `VITE_API_URL` is optional and only used when `VITE_AUTH_PROVIDER=api`.
> For most developers pulling this repo, keep `VITE_AUTH_PROVIDER=firebase`.

### Demo Data Files (JSON)

If you are testing locally with temporary data, edit these JSON files:

- `src/data/busesData.json` — bus records used by Buses and Dashboard charts
<<<<<<< HEAD
=======
- `src/data/activationRequestsData.json` — account activation requests used by Requests page
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)
- `src/data/authMockData.json` — mock login user profile and auth error message

If changes do not appear right away, clear this local storage key in the browser and refresh:

- `qnext_admin_buses`

#### Reset Demo Data (Quick)

Open browser DevTools Console and run:

```javascript
localStorage.removeItem('qnext_admin_buses');
location.reload();
```

This resets buses back to values in `src/data/busesData.json`.

### 4. Run the Development Server

```bash
npm run start
```

This command runs both the SCSS watcher and Vite dev server concurrently. The application will be available at:
- **Local**: check the exact `Local:` URL shown in terminal (`5173`, `5174`, `5175`, etc.)

The page will automatically reload when you make changes.

## Authentication

This application now uses **Firebase Authentication + Firestore admin checks**:

- ✅ **Login/Logout** via Firebase Auth
- ✅ **Protected routes** through auth state in context
- ✅ **Admin-only access** by checking `users/{uid}.isAdmin === true` in Firestore
- ✅ **Persistent sessions** through Firebase auth state

### Firebase Setup Requirements

To sign in successfully, your Firebase project must have:

1. **Authentication enabled** (Email/Password provider)
2. A **Firestore `users` collection**
3. A document for each admin user where:
   - document ID = Firebase Auth user UID
   - field `isAdmin` = `true`

### Auth Mode Notes (important)

- Default repo login path is **Firebase**.
- Keep this in `.env`:
   - `VITE_AUTH_PROVIDER=firebase`
- Only set `VITE_AUTH_PROVIDER=api` if your backend auth endpoints are running and `VITE_API_URL` is set correctly.

📖 See **[AUTHENTICATION.md](AUTHENTICATION.md)** for full Firebase setup and troubleshooting.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Runs SCSS watcher and dev server together (recommended) |
| `npm run dev` | Starts the Vite dev server only |
| `npm run build` | Creates production build in `dist/` folder |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Runs ESLint to check code quality |
| `npm run watch:scss` | Watches and compiles SCSS files to CSS |

## Project Structure

```
qnext-admin/
├── public/              # Static assets
├── src/
│   ├── components/      # React components
│   │   ├── Body.jsx
│   │   ├── BusAttendants.jsx
│   │   ├── Buses.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Header.jsx
│   │   ├── LearningGuidePage.jsx
│   │   ├── Login.jsx
│   │   ├── NotFound.jsx
│   │   └── RoutesManagement.jsx
│   ├── context/         # React Context providers
│   │   └── AuthContext.jsx
│   ├── services/        # API services
│   │   ├── api.js
<<<<<<< HEAD
│   │   ├── authService.js
│   │   ├── dashboardService.js
│   │   └── busFirebaseSyncService.js
=======
│   │   └── authService.js
>>>>>>> 005b8ca (feat: login eye toggle and dashboard updates)
│   ├── utils/           # Utility functions
│   │   └── auth.js
│   ├── firebase.js       # Firebase app/auth/firestore initialization
│   ├── styles/          # Component-specific styles
│   │   ├── Body.scss
│   │   ├── Header.scss
│   │   ├── LearningGuide.scss
│   │   ├── Login.scss
│   │   └── Requests.scss
│   ├── assets/          # Images, fonts, etc.
│   ├── App.jsx          # Main App component
│   ├── App.scss         # Global app styles
│   ├── main.jsx         # Application entry point
│   └── index.scss       # Global styles
├── .env.example         # Environment variables template
├── AUTHENTICATION.md    # Auth setup guide
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
├── eslint.config.js     # ESLint configuration
└── package.json         # Project dependencies

```

## Technologies Used

- **React 18.2** - UI library
- **Vite 7.3** - Build tool and dev server
- **Axios** - HTTP client for API requests
- **SCSS/Sass** - CSS preprocessor for styling
- **Recharts 3.7** - Data visualization library
- **React Icons 5.5** - Icon library
- **ESLint** - Code linting and quality

## Building for Production

```bash
npm run build
```

The optimized production files will be generated in the `dist/` folder. You can preview the production build with:

```bash
npm run preview
```

## Git Workflow

### Working on Features

1. **Create a new branch** for your feature:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit:
   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

3. **Push to GitHub**:
   ```bash
   git push -u origin feature/your-feature-name
   ```

4. **Create a Pull Request** on GitHub to merge into `main`

### Branch Naming Conventions

- `feature/` - New features (e.g., `feature/add-user-auth`)
- `fix/` - Bug fixes (e.g., `fix/header-alignment`)
- `docs/` - Documentation updates
- `refactor/` - Code refactoring

## Troubleshooting

### SCSS not compiling
Ensure you're using `npm start` instead of `npm run dev` to run both the SCSS watcher and dev server.

### Port already in use
If port 5173 is already in use, Vite will automatically try the next available port. Check the terminal output for the actual URL.

### Module not found errors
Try deleting `node_modules/` and running `npm install` again.

### Firebase config errors
Verify `.env` exists and all `VITE_FIREBASE_*` values are set correctly for your Firebase project.

### Access denied after login
Check Firestore `users/{uid}` and ensure `isAdmin` is set to `true` for your authenticated user.

### Login fails for new pullers
Verify `.env` is using Firebase mode:

```env
VITE_AUTH_PROVIDER=firebase
VITE_API_URL=
```

Using `VITE_AUTH_PROVIDER=api` without a live backend auth server will block login.

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Test thoroughly
4. Submit a Pull Request with a clear description of changes

## License

Private project - All rights reserved.
