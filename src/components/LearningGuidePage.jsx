import '../styles/Body.scss';
import '../styles/LearningGuide.scss';
import {
  MdAccountTree,
  MdStorage,
  MdTimeline,
  MdPlayCircle,
  MdChecklist,
  MdViewCarousel,
  MdExtension,
  MdFunctions,
  MdDashboard,
  MdDirectionsBus,
  MdAltRoute,
  MdSecurity,
} from 'react-icons/md';

function LearningGuidePage() {
  return (
    <main className="content learning-page">
      <section className="learning-hero card-block">
        <h1>QNext Learning Guide</h1>
        <p>
          Made for visual learners: scan the maps, follow the arrows, then do the click-by-click missions.
        </p>
        <div className="pill-row">
          <span className="pill">See first, read less</span>
          <span className="pill">Page map + data map</span>
          <span className="pill">15–20 minute missions</span>
        </div>
      </section>

      <section className="card-block">
        <h2><MdViewCarousel /> 3-Page Visual Map</h2>
        <div className="page-map-grid">
          <article>
            <h3><MdDirectionsBus /> Buses</h3>
            <p>Create, archive, unarchive, and manage bus records.</p>
            <div className="mini-label">Think: data editor</div>
          </article>
          <article>
            <h3><MdAltRoute /> Routes</h3>
            <p>Manage route geofence origins, queue destinations, and map radius previews.</p>
            <div className="mini-label">Think: geofence + destinations</div>
          </article>
          <article>
            <h3><MdDashboard /> Dashboard</h3>
            <p>Turns bus data into charts and PDF reports.</p>
            <div className="mini-label">Think: insights screen</div>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdExtension /> Component Cards (What + Why)</h2>
        <div className="component-card-grid">
          <article>
            <h3>App / AppContent</h3>
            <p><strong>What:</strong> page routing + auth gate.</p>
            <p><strong>Why:</strong> central controller for the whole app screen.</p>
            <p><strong>Used by:</strong> started from main entry.</p>
          </article>
          <article>
            <h3>AuthProvider / useAuth</h3>
            <p><strong>What:</strong> global login state + login/logout actions.</p>
            <p><strong>Why:</strong> avoid passing auth props manually to each page.</p>
            <p><strong>Used by:</strong> App, Header, Login.</p>
          </article>
          <article>
            <h3>Header</h3>
            <p><strong>What:</strong> sidebar navigation and logout button.</p>
            <p><strong>Why:</strong> one shared menu for all pages.</p>
            <p><strong>Used by:</strong> authenticated app layout.</p>
          </article>
          <article>
            <h3>Buses</h3>
            <p><strong>What:</strong> bus table, add modal, archive lifecycle.</p>
            <p><strong>Why:</strong> admin can manage bus records safely.</p>
            <p><strong>Used by:</strong> Buses route/page.</p>
          </article>
          <article>
            <h3>RoutesManagement</h3>
            <p><strong>What:</strong> route geofence CRUD + destination linking + map preview.</p>
            <p><strong>Why:</strong> central route creation and origin management.</p>
            <p><strong>Used by:</strong> Routes route/page.</p>
          </article>
          <article>
            <h3>Dashboard</h3>
            <p><strong>What:</strong> charts + KPI cards + PDF reporting.</p>
            <p><strong>Why:</strong> operational insights and exportable report.</p>
            <p><strong>Used by:</strong> Dashboard route/page.</p>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdAccountTree /> Runtime Flow (Arrow View)</h2>
        <div className="flow-grid">
          <div className="flow-node">main.jsx<br />starts app</div>
          <div className="flow-arrow">→</div>
          <div className="flow-node">App.jsx<br />routes pages</div>
          <div className="flow-arrow">→</div>
          <div className="flow-node">AuthContext<br />checks admin</div>
          <div className="flow-arrow">→</div>
          <div className="flow-node">Page UI<br />Buses / Routes / Dashboard</div>
        </div>
      </section>

      <section className="card-block">
        <h2><MdStorage /> Data Path Visual</h2>
        <div className="flow-strip">
          <span className="strip-node">JSON seed</span>
          <span className="strip-arrow">→</span>
          <span className="strip-node">React state</span>
          <span className="strip-arrow">→</span>
          <span className="strip-node">localStorage</span>
          <span className="strip-arrow">→</span>
          <span className="strip-node">UI refresh stays</span>
        </div>
        <div className="source-grid">
          <article>
            <h3><MdDirectionsBus /> Buses</h3>
            <ul>
              <li>Starts from: <strong>src/data/busesData.json</strong></li>
              <li>Saves to: <strong>qnext_admin_buses</strong></li>
              <li>Archive key: <strong>qnext_admin_archived_buses</strong></li>
            </ul>
          </article>

          <article>
            <h3><MdAltRoute /> Routes</h3>
            <ul>
              <li>Loads route geofence + queue destination APIs</li>
              <li>Falls back to local cache when APIs are unavailable</li>
              <li>Supports global origin + custom per-route origin mode</li>
            </ul>
          </article>

          <article>
            <h3><MdDashboard /> Dashboard</h3>
            <ul>
              <li>Reads buses data only</li>
              <li>Builds week/month/year charts</li>
              <li>Generates preview-first PDF report</li>
            </ul>
          </article>

          <article>
            <h3><MdSecurity /> Authentication</h3>
            <ul>
              <li>Firebase login watches session state</li>
              <li>Checks <strong>users/{'{uid}'}.isAdmin</strong></li>
              <li>Non-admin users are auto signed out</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdTimeline /> Core Action Flows</h2>
        <div className="action-flow-grid">
          <article>
            <h3>Add Bus</h3>
            <p>Form → save → appears in table → affects dashboard charts.</p>
          </article>
          <article>
            <h3>Archive Bus</h3>
            <p>Moves from Active list to Archived list (safer than instant delete).</p>
          </article>
          <article>
            <h3>Create Route</h3>
            <p>Set origin geofence + destination, then save route record.</p>
          </article>
          <article>
            <h3>Generate Report</h3>
            <p>Builds PDF → preview modal opens → you choose download.</p>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdFunctions /> Function Cards (Why + Where Used)</h2>
        <div className="function-card-grid">
          <article>
            <h3>login(email, password)</h3>
            <p>Why: signs in and checks admin role.</p>
            <p>Used in: Login submit action.</p>
          </article>
          <article>
            <h3>logout()</h3>
            <p>Why: clears session safely.</p>
            <p>Used in: Header logout button.</p>
          </article>
          <article>
            <h3>handleSubmit (Buses)</h3>
            <p>Why: creates a new bus from form values.</p>
            <p>Used in: Add Bus modal form submit.</p>
          </article>
          <article>
            <h3>archiveBusIds / unarchiveBusIds</h3>
            <p>Why: two-step safe deletion lifecycle.</p>
            <p>Used in: row actions and batch actions.</p>
          </article>
          <article>
            <h3>loadData (Routes)</h3>
            <p>Why: loads routes, destinations, buses, and origin config with fallbacks.</p>
            <p>Used in: Routes page startup and refresh paths.</p>
          </article>
          <article>
            <h3>fetchDashboardBuses / fetchRouteGeofences</h3>
            <p>Why: hide endpoint differences and normalization logic.</p>
            <p>Used in: Dashboard and Routes load effects.</p>
          </article>
          <article>
            <h3>handleGenerateReport</h3>
            <p>Why: builds PDF from current analytics data.</p>
            <p>Used in: Dashboard report button.</p>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdPlayCircle /> Click-by-Click Missions (Visual Learner Path)</h2>
        <div className="mission-grid">
          <article>
            <h3>Mission 1: Persistence</h3>
            <ol>
              <li>Go to Buses</li>
              <li>Add one bus</li>
              <li>Refresh page</li>
            </ol>
            <p className="mission-result">You should still see the bus.</p>
          </article>
          <article>
            <h3>Mission 2: Safe Delete Flow</h3>
            <ol>
              <li>Archive a bus</li>
              <li>Switch to Archived view</li>
              <li>Unarchive it back</li>
            </ol>
            <p className="mission-result">You learn active ↔ archived lifecycle.</p>
          </article>
          <article>
            <h3>Mission 3: Route Setup</h3>
            <ol>
              <li>Open Routes</li>
              <li>Create one route with destination</li>
              <li>Open details and verify map/radius</li>
            </ol>
            <p className="mission-result">You learn route + destination management flow.</p>
          </article>
          <article>
            <h3>Mission 4: Reporting</h3>
            <ol>
              <li>Open Dashboard</li>
              <li>Generate report</li>
              <li>Preview then download PDF</li>
            </ol>
            <p className="mission-result">You see data → chart → report flow.</p>
          </article>
        </div>
      </section>

      <section className="card-block">
        <h2><MdChecklist /> Study Order (When You Open Code)</h2>
        <div className="study-list">
          <div><strong>1.</strong> App + auth flow: <strong>src/App.jsx</strong>, <strong>src/context/AuthContext.jsx</strong></div>
          <div><strong>2.</strong> Buses lifecycle: <strong>src/components/Buses.jsx</strong>, <strong>src/data/busesData.js</strong></div>
          <div><strong>3.</strong> Routes management: <strong>src/components/RoutesManagement.jsx</strong>, <strong>src/services/api.js</strong></div>
          <div><strong>4.</strong> Dashboard analytics/report: <strong>src/components/Dashboard.jsx</strong></div>
        </div>
      </section>
    </main>
  );
}

export default LearningGuidePage;
