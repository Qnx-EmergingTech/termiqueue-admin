import '../styles/Body.scss';
import 'react-datepicker/dist/react-datepicker.css';
import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import DatePicker from 'react-datepicker';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { MdDirectionsBus, MdTraffic, MdPeople, MdTimer, MdAltRoute } from 'react-icons/md';
import { fetchDashboardBuses } from '../services/dashboardService';
import { fetchTripHistoryLogs } from '../services/activityLogsService';

// --- CONSTANTS & HELPERS ---
const REPORT_SECTION_OPTIONS = [
  { key: 'kpiSummary', label: 'KPI Summary' },
  { key: 'weeklyBusesTrend', label: 'Weekly Buses Trend' },
  { key: 'weeklyQueueMix', label: 'Weekly Queue Mix' },
  { key: 'companyMix', label: 'Company Queue Mix (Top 6)' },
  { key: 'demandQuality', label: 'Demand Quality' },
  { key: 'serviceReliability', label: 'Service Reliability' },
  { key: 'attendantPerformance', label: 'Attendant Performance (Top 6)' },
  { key: 'exceptionsPanel', label: 'Exceptions Panel' },
  { key: 'topRoutes', label: 'Top Routes' },
  { key: 'detailedBusRecords', label: 'Detailed Bus Records' },
];

const DEFAULT_REPORT_SECTIONS = REPORT_SECTION_OPTIONS.reduce((acc, item) => ({
  ...acc,
  [item.key]: true,
}), {});

const filterItemsByRange = (items, getTimestamp, fromDate, toDate) => {
  const fromTimestamp = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
  const toTimestamp = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemTimestamp = Number(getTimestamp(item));
    if (!Number.isFinite(itemTimestamp) || itemTimestamp <= 0) return false;
    if (fromTimestamp && itemTimestamp < fromTimestamp) return false;
    if (toTimestamp && itemTimestamp > toTimestamp) return false;
    return true;
  });
};

const buildBusAnalytics = (busRecords) => {
  const statusCounts = { Active: 0, Maintenance: 0, Inactive: 0 };
  const routeCounts = new Map();
  const companyMetrics = new Map();
  const weeklyMetrics = new Map();
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekDayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  weekDayOrder.forEach(day => weeklyMetrics.set(day, { label: day, buses: 0, qnext: 0, traditional: 0 }));

  let totalCapacity = 0;
  let totalQnextRiders = 0;

  busRecords.forEach((bus) => {
    const status = ['Active', 'Maintenance', 'Inactive'].includes(bus.status) ? bus.status : 'Inactive';
    statusCounts[status]++;
    routeCounts.set(bus.route, (routeCounts.get(bus.route) || 0) + 1);

    const cap = Math.max(0, Number(bus.capacity || 0));
    const qn = Math.min(cap, Math.max(0, Number(bus.qnextBoarded || 0)));
    totalCapacity += cap;
    totalQnextRiders += qn;

    const comp = bus.busCompany || 'Unknown';
    const existingComp = companyMetrics.get(comp) || { label: comp, buses: 0, qnext: 0, traditional: 0 };
    existingComp.buses++;
    existingComp.qnext += qn;
    existingComp.traditional += Math.max(0, cap - qn);
    companyMetrics.set(comp, existingComp);

    const date = new Date(bus.lastUpdated);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    if (weeklyMetrics.has(dayName)) {
      const d = weeklyMetrics.get(dayName);
      d.buses++;
      d.qnext += qn;
      d.traditional += Math.max(0, cap - qn);
    }
  });

  return {
    totalBuses: busRecords.length,
    activeBuses: statusCounts.Active,
    delayedBuses: statusCounts.Maintenance + statusCounts.Inactive,
    uniqueRoutes: routeCounts.size,
    avgCapacity: busRecords.length ? Math.round(totalCapacity / busRecords.length) : 0,
    avgQnextRiders: busRecords.length ? (totalQnextRiders / busRecords.length).toFixed(1) : 0,
    weeklyData: Array.from(weeklyMetrics.values()),
    companyData: Array.from(companyMetrics.values()).sort((a, b) => b.buses - a.buses),
    routeData: Array.from(routeCounts.entries()).map(([label, buses]) => ({ label, buses })).sort((a,b) => b.buses - a.buses)
  };
};

// --- COMPONENT ---
function Dashboard() {
  const [buses, setBuses] = useState([]);
  const [tripLogs, setTripLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [busesRes, tripsRes] = await Promise.allSettled([
          fetchDashboardBuses(),
          fetchTripHistoryLogs()
        ]);

        if (isMounted) {
          if (busesRes.status === 'fulfilled') setBuses(busesRes.value.buses || []);
          if (tripsRes.status === 'fulfilled') setTripLogs(tripsRes.value.logs || []);
        }
      } catch (err) {
        console.error("Dashboard Load Error:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadData();
    return () => { isMounted = false; };
  }, []);

  const filteredBuses = useMemo(() => 
    filterItemsByRange(buses, (b) => b.lastUpdated, dateFrom, dateTo), 
  [buses, dateFrom, dateTo]);

  const analytics = useMemo(() => buildBusAnalytics(filteredBuses), [filteredBuses]);

  if (isLoading) return <div className="loading">Loading Dashboard...</div>;

  return (
    <div className="dashboard-container">
      <div className="kpi-grid">
        <div className="kpi-card">
          <MdDirectionsBus />
          <h3>{analytics.totalBuses}</h3>
          <p>Total Buses</p>
        </div>
        <div className="kpi-card">
          <MdTimer />
          <h3>{analytics.activeBuses}</h3>
          <p>Active Now</p>
        </div>
      </div>
      {/* ... Add your Chart components here using analytics.weeklyData ... */}
    </div>
  );
}

export default Dashboard;