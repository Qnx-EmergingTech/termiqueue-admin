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
} from 'recharts';
import { MdDirectionsBus, MdTraffic, MdPeople, MdTimer } from 'react-icons/md';
import { fetchDashboardBuses } from '../services/dashboardService';
import { fetchTripHistoryLogs } from '../services/activityLogsService';

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

const DEFAULT_REPORT_SECTIONS = REPORT_SECTION_OPTIONS.reduce((sectionState, sectionItem) => ({
  ...sectionState,
  [sectionItem.key]: true,
}), {});

const filterItemsByRange = (items, getTimestamp, fromDate, toDate) => {
  const fromTimestamp = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
  const toTimestamp = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemTimestamp = Number(getTimestamp(item));
    if (!Number.isFinite(itemTimestamp) || itemTimestamp <= 0) {
      return false;
    }

    if (Number.isFinite(fromTimestamp) && itemTimestamp < fromTimestamp) {
      return false;
    }

    if (Number.isFinite(toTimestamp) && itemTimestamp > toTimestamp) {
      return false;
    }

    return true;
  });
};

const buildBusAnalytics = (busRecords) => {
  const statusCounts = {
    Active: 0,
    Maintenance: 0,
    Inactive: 0,
  };

  const routeCounts = new Map();
  const companyMetrics = new Map();
  const weeklyMetrics = new Map();
  const monthlyMetrics = new Map();
  const yearlyMetrics = new Map();

  const weekDayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  weekDayOrder.forEach((day) => {
    weeklyMetrics.set(day, {
      label: day,
      buses: 0,
      qnext: 0,
      traditional: 0,
    });
  });

  let totalCapacity = 0;
  let totalQnextRiders = 0;

  (Array.isArray(busRecords) ? busRecords : []).forEach((bus) => {
    const normalizedStatus = bus.status === 'Active' || bus.status === 'Maintenance' || bus.status === 'Inactive'
      ? bus.status
      : 'Inactive';

    statusCounts[normalizedStatus] += 1;
    routeCounts.set(bus.route, (routeCounts.get(bus.route) || 0) + 1);

    const existingCompanyMetrics = companyMetrics.get(bus.busCompany) || {
      label: bus.busCompany,
      buses: 0,
      qnext: 0,
      traditional: 0,
    };

    existingCompanyMetrics.buses += 1;
    const busCapacity = Math.max(0, Number(bus.capacity || 0));
    const boardedFromQnextRaw = Number(bus.qnextBoarded || 0);
    const boardedFromQnext = Math.min(busCapacity, Math.max(0, boardedFromQnextRaw));
    const traditionalQueueCount = Math.max(0, busCapacity - boardedFromQnext);
    totalQnextRiders += boardedFromQnext;

    existingCompanyMetrics.qnext += boardedFromQnext;
    existingCompanyMetrics.traditional += traditionalQueueCount;
    companyMetrics.set(bus.busCompany, existingCompanyMetrics);

    totalCapacity += busCapacity;

    const weekDayName = new Date(bus.lastUpdated).toLocaleDateString('en-US', { weekday: 'long' });
    const monthName = new Date(bus.lastUpdated).toLocaleDateString('en-US', { month: 'short' });
    const yearLabel = String(new Date(bus.lastUpdated).getFullYear());

    const weekDayData = weeklyMetrics.get(weekDayName) || {
      label: weekDayName,
      buses: 0,
      qnext: 0,
      traditional: 0,
    };

    weekDayData.buses += 1;
    weekDayData.qnext += boardedFromQnext;
    weekDayData.traditional += traditionalQueueCount;
    weeklyMetrics.set(weekDayName, weekDayData);

    const monthData = monthlyMetrics.get(monthName) || {
      label: monthName,
      buses: 0,
      qnext: 0,
      traditional: 0,
    };
    monthData.buses += 1;
    monthData.qnext += boardedFromQnext;
    monthData.traditional += traditionalQueueCount;
    monthlyMetrics.set(monthName, monthData);

    const yearData = yearlyMetrics.get(yearLabel) || {
      label: yearLabel,
      buses: 0,
      qnext: 0,
      traditional: 0,
    };
    yearData.buses += 1;
    yearData.qnext += boardedFromQnext;
    yearData.traditional += traditionalQueueCount;
    yearlyMetrics.set(yearLabel, yearData);
  });

  const routeData = Array.from(routeCounts.entries())
    .map(([route, busesCount]) => ({ label: route, buses: busesCount }))
    .sort((leftRoute, rightRoute) => rightRoute.buses - leftRoute.buses);

  const companyData = Array.from(companyMetrics.values())
    .sort((leftCompany, rightCompany) => rightCompany.buses - leftCompany.buses);

  const weeklyData = weekDayOrder.map((day) => weeklyMetrics.get(day));
  const monthlyData = monthOrder.map((month) => {
    const monthData = monthlyMetrics.get(month);
    return monthData || { label: month, buses: 0, qnext: 0, traditional: 0 };
  });
  const yearlyData = Array.from(yearlyMetrics.values()).sort((leftYear, rightYear) => Number(leftYear.label) - Number(rightYear.label));

  const delayedBuses = statusCounts.Maintenance + statusCounts.Inactive;
  const totalBuses = Array.isArray(busRecords) ? busRecords.length : 0;

  return {
    totalBuses,
    activeBuses: statusCounts.Active,
    delayedBuses,
    uniqueRoutes: routeCounts.size,
    avgCapacity: totalBuses > 0 ? Math.round(totalCapacity / totalBuses) : 0,
    avgQnextRiders: totalBuses > 0 ? Number((totalQnextRiders / totalBuses).toFixed(1)) : 0,
    maintenanceBuses: statusCounts.Maintenance,
    inactiveBuses: statusCounts.Inactive,
    weeklyData,
    monthlyData,
    yearlyData,
    routeData,
    companyData,
  };
};

const buildDemandQualityMetrics = (tripRecords, busRecords) => {
  const totalTrips = Array.isArray(tripRecords) ? tripRecords.length : 0;
  const totalRiders = (Array.isArray(tripRecords) ? tripRecords : []).reduce((sum, tripItem) => sum + Number(tripItem?.usersCount || 0), 0);
  const qnextRidersFromBuses = (Array.isArray(busRecords) ? busRecords : []).reduce((sum, busItem) => sum + Math.max(0, Number(busItem?.qnextBoarded || 0)), 0);
  const totalCapacityFromBuses = (Array.isArray(busRecords) ? busRecords : []).reduce((sum, busItem) => sum + Math.max(0, Number(busItem?.capacity || 0)), 0);

  const avgRidersPerTrip = totalTrips > 0 ? Number((totalRiders / totalTrips).toFixed(1)) : 0;
  const qnextCapacityShare = totalCapacityFromBuses > 0
    ? Number(((qnextRidersFromBuses / totalCapacityFromBuses) * 100).toFixed(1))
    : 0;

  const lowDemandTrips = (Array.isArray(tripRecords) ? tripRecords : []).filter((tripItem) => Number(tripItem?.usersCount || 0) < 5).length;
  const highDemandTrips = (Array.isArray(tripRecords) ? tripRecords : []).filter((tripItem) => Number(tripItem?.usersCount || 0) >= 20).length;

  return {
    totalTrips,
    totalRiders,
    avgRidersPerTrip,
    qnextCapacityShare,
    lowDemandTrips,
    highDemandTrips,
  };
};

const buildServiceReliabilityMetrics = (tripRecords, delayedBusesCount) => {
  const now = Date.now();
  const completedTrips = (Array.isArray(tripRecords) ? tripRecords : []).filter((tripItem) => {
    const normalizedStatus = String(tripItem?.status || '').toLowerCase();
    return normalizedStatus.includes('complete') || normalizedStatus.includes('arrived');
  });

  const inProgressTrips = (Array.isArray(tripRecords) ? tripRecords : []).filter((tripItem) => {
    const normalizedStatus = String(tripItem?.status || '').toLowerCase();
    return normalizedStatus.includes('progress') || normalizedStatus.includes('ongoing');
  });

  const longRunningTrips = inProgressTrips.filter((tripItem) => {
    const departureTime = Number(tripItem?.departureTime || 0);
    return Number.isFinite(departureTime) && departureTime > 0 && (now - departureTime) > (2 * 60 * 60 * 1000);
  }).length;

  const totalTrips = Array.isArray(tripRecords) ? tripRecords.length : 0;
  const completionRate = totalTrips > 0
    ? Number(((completedTrips.length / totalTrips) * 100).toFixed(1))
    : 0;

  const durationMinutes = completedTrips
    .map((tripItem) => {
      const arrivalTime = Number(tripItem?.arrivalTime || 0);
      const departureTime = Number(tripItem?.departureTime || 0);
      if (!Number.isFinite(arrivalTime) || !Number.isFinite(departureTime) || arrivalTime <= departureTime) {
        return null;
      }

      return Math.round((arrivalTime - departureTime) / 60000);
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const avgTripDurationMinutes = durationMinutes.length > 0
    ? Math.round(durationMinutes.reduce((sum, value) => sum + value, 0) / durationMinutes.length)
    : 0;

  return {
    completionRate,
    completedTrips: completedTrips.length,
    inProgressTrips: inProgressTrips.length,
    longRunningTrips,
    avgTripDurationMinutes,
    delayedBuses: delayedBusesCount,
  };
};

const buildAttendantPerformanceMetrics = (tripRecords) => {
  const attendantMap = new Map();

  (Array.isArray(tripRecords) ? tripRecords : []).forEach((tripItem) => {
    const attendantName = String(tripItem?.attendantName || '').trim() || 'Unassigned';
    const existingMetrics = attendantMap.get(attendantName) || {
      attendantName,
      trips: 0,
      riders: 0,
      completed: 0,
    };

    existingMetrics.trips += 1;
    existingMetrics.riders += Number(tripItem?.usersCount || 0);

    const normalizedStatus = String(tripItem?.status || '').toLowerCase();
    if (normalizedStatus.includes('complete') || normalizedStatus.includes('arrived')) {
      existingMetrics.completed += 1;
    }

    attendantMap.set(attendantName, existingMetrics);
  });

  return Array.from(attendantMap.values())
    .map((metricItem) => ({
      ...metricItem,
      avgRidersPerTrip: metricItem.trips > 0 ? Number((metricItem.riders / metricItem.trips).toFixed(1)) : 0,
      completionRate: metricItem.trips > 0 ? Number(((metricItem.completed / metricItem.trips) * 100).toFixed(1)) : 0,
    }))
    .sort((leftItem, rightItem) => rightItem.trips - leftItem.trips)
    .slice(0, 6);
};

const buildExceptions = (busRecords, longRunningTripsCount) => {
  const items = [];
  const records = Array.isArray(busRecords) ? busRecords : [];

  const missingAttendantBuses = records.filter((busItem) => {
    const attendantValue = String(busItem?.busAttendant || busItem?.attendant_name || '').trim();
    return !attendantValue;
  }).length;

  if (missingAttendantBuses > 0) {
    items.push({ severity: 'warning', message: `${missingAttendantBuses} bus(es) have no assigned attendant.` });
  }

  const zeroCapacityBuses = records.filter((busItem) => Number(busItem?.capacity || 0) <= 0).length;
  if (zeroCapacityBuses > 0) {
    items.push({ severity: 'critical', message: `${zeroCapacityBuses} bus(es) have invalid or zero capacity.` });
  }

  const inactiveWithBoarding = records.filter((busItem) => {
    const status = String(busItem?.status || '').toLowerCase();
    const boarded = Number(busItem?.qnextBoarded || 0);
    return (status.includes('inactive') || status.includes('maintenance')) && boarded > 0;
  }).length;

  if (inactiveWithBoarding > 0) {
    items.push({ severity: 'warning', message: `${inactiveWithBoarding} inactive/maintenance bus(es) still have boarding counts.` });
  }

  if (longRunningTripsCount > 0) {
    items.push({ severity: 'critical', message: `${longRunningTripsCount} trip(s) have been in progress for more than 2 hours.` });
  }

  if (items.length === 0) {
    items.push({ severity: 'good', message: 'No major operational exceptions detected for the selected range.' });
  }

  return items;
};

const formatDateInputValue = (dateValue) => {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return '';
  }

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  const day = String(dateValue.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInputValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const parsedDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
};

const stripDatePickerTitles = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const removeTitles = () => {
    const nodes = document.querySelectorAll(
      '.react-datepicker__day[title], .react-datepicker__day-name[title], .react-datepicker__current-month[title]'
    );

    nodes.forEach((node) => {
      node.removeAttribute('title');
    });
  };

  window.requestAnimationFrame(removeTitles);
};


const getDateRangePreset = (presetKey) => {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);

  if (presetKey === 'today') {
    return {
      from: formatDateInputValue(from),
      to: formatDateInputValue(to),
    };
  }

  if (presetKey === 'last7') {
    from.setDate(from.getDate() - 6);
    return {
      from: formatDateInputValue(from),
      to: formatDateInputValue(to),
    };
  }

  if (presetKey === 'last30') {
    from.setDate(from.getDate() - 29);
    return {
      from: formatDateInputValue(from),
      to: formatDateInputValue(to),
    };
  }

  if (presetKey === 'thisMonth') {
    const startOfMonth = new Date(to.getFullYear(), to.getMonth(), 1);
    return {
      from: formatDateInputValue(startOfMonth),
      to: formatDateInputValue(to),
    };
  }

  return { from: '', to: '' };
};

function Dashboard() {
  const [leftView, setLeftView] = useState('weekly');
  const [rightView, setRightView] = useState('weekly');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [reportPreviewUrl, setReportPreviewUrl] = useState('');
  const [reportFileName, setReportFileName] = useState('dashboard-analytics-report.pdf');
  const [dashboardWarning, setDashboardWarning] = useState('');
  const [buses, setBuses] = useState([]);
  const [tripLogs, setTripLogs] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [reportSections, setReportSections] = useState(DEFAULT_REPORT_SECTIONS);

  useEffect(() => {
    let isMounted = true;

    const loadDashboardData = async () => {
      setIsLoading(true);

      try {
        const [busesResult, tripsResult] = await Promise.allSettled([
          fetchDashboardBuses(),
          fetchTripHistoryLogs(),
        ]);

        if (!isMounted) {
          return;
        }

        if (busesResult.status === 'fulfilled' && busesResult.value && Array.isArray(busesResult.value.buses)) {
          setBuses(busesResult.value.buses);
          setDashboardWarning(busesResult.value.warning || '');
        } else {
          setBuses([]);
          setDashboardWarning('Unable to load dashboard buses right now.');
        }

        if (tripsResult.status === 'fulfilled' && tripsResult.value) {
          setTripLogs(Array.isArray(tripsResult.value.logs) ? tripsResult.value.logs : []);
        } else {
          setTripLogs([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    if (reportPreviewUrl) {
      URL.revokeObjectURL(reportPreviewUrl);
    }
  }, [reportPreviewUrl]);

  const filteredBuses = useMemo(() => {
    return filterItemsByRange(buses, (bus) => bus?.lastUpdated, dateFrom, dateTo);
  }, [buses, dateFrom, dateTo]);

  const filteredTripLogs = useMemo(() => {
    return filterItemsByRange(
      tripLogs,
      (tripItem) => tripItem?.latestUpdated || tripItem?.departureTime || tripItem?.arrivalTime,
      dateFrom,
      dateTo
    );
  }, [tripLogs, dateFrom, dateTo]);

  const analytics = useMemo(() => {
    return buildBusAnalytics(filteredBuses);
  }, [filteredBuses]);

  const leftChartData = leftView === 'weekly'
    ? analytics.weeklyData
    : leftView === 'monthly'
      ? analytics.monthlyData
      : analytics.yearlyData;

  const leftPanelTitle = leftView === 'weekly'
    ? 'Total bus per week'
    : leftView === 'monthly'
      ? 'Total bus per month'
      : 'Total bus per year';

  const rightChartData = rightView === 'weekly'
    ? analytics.weeklyData
    : rightView === 'monthly'
      ? analytics.monthlyData
      : analytics.yearlyData;

  const rightPanelTitle = rightView === 'weekly'
    ? 'Traditional Queue vs QNExT per week'
    : rightView === 'monthly'
      ? 'Traditional Queue vs QNExT per month'
      : 'Traditional Queue vs QNExT per year';

  const companyStatusMixData = analytics.companyData.slice(0, 6);
  const topRouteVolumeData = analytics.routeData.slice(0, 6);

  const demandQuality = useMemo(() => buildDemandQualityMetrics(filteredTripLogs, filteredBuses), [filteredTripLogs, filteredBuses]);

  const serviceReliability = useMemo(
    () => buildServiceReliabilityMetrics(filteredTripLogs, analytics.delayedBuses),
    [filteredTripLogs, analytics.delayedBuses]
  );

  const attendantPerformance = useMemo(
    () => buildAttendantPerformanceMetrics(filteredTripLogs),
    [filteredTripLogs]
  );

  const exceptionsPanel = useMemo(
    () => buildExceptions(filteredBuses, serviceReliability.longRunningTrips),
    [filteredBuses, serviceReliability.longRunningTrips]
  );

  const reportFilteredBuses = useMemo(
    () => filterItemsByRange(buses, (bus) => bus?.lastUpdated, reportDateFrom, reportDateTo),
    [buses, reportDateFrom, reportDateTo]
  );

  const reportFilteredTrips = useMemo(
    () => filterItemsByRange(
      tripLogs,
      (tripItem) => tripItem?.latestUpdated || tripItem?.departureTime || tripItem?.arrivalTime,
      reportDateFrom,
      reportDateTo
    ),
    [tripLogs, reportDateFrom, reportDateTo]
  );

  const reportAnalytics = useMemo(() => buildBusAnalytics(reportFilteredBuses), [reportFilteredBuses]);
  const reportDemandQuality = useMemo(
    () => buildDemandQualityMetrics(reportFilteredTrips, reportFilteredBuses),
    [reportFilteredTrips, reportFilteredBuses]
  );
  const reportServiceReliability = useMemo(
    () => buildServiceReliabilityMetrics(reportFilteredTrips, reportAnalytics.delayedBuses),
    [reportFilteredTrips, reportAnalytics.delayedBuses]
  );
  const reportAttendantPerformance = useMemo(
    () => buildAttendantPerformanceMetrics(reportFilteredTrips),
    [reportFilteredTrips]
  );
  const reportExceptions = useMemo(
    () => buildExceptions(reportFilteredBuses, reportServiceReliability.longRunningTrips),
    [reportFilteredBuses, reportServiceReliability.longRunningTrips]
  );
  const reportCompanyStatusMixData = reportAnalytics.companyData.slice(0, 6);
  const reportTopRouteVolumeData = reportAnalytics.routeData.slice(0, 6);

  const formatReportDate = (timestamp) => new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCloseReportPreview = () => {
    if (reportPreviewUrl) {
      URL.revokeObjectURL(reportPreviewUrl);
    }

    setReportPreviewUrl('');
  };

  const handleDownloadPreviewPdf = () => {
    if (!reportPreviewUrl) {
      return;
    }

    const downloadLink = document.createElement('a');
    downloadLink.href = reportPreviewUrl;
    downloadLink.download = reportFileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const handlePrintPreviewPdf = () => {
    if (!reportPreviewUrl) {
      return;
    }

    const printWindow = window.open(reportPreviewUrl, '_blank');
    if (!printWindow) {
      return;
    }

    printWindow.addEventListener('load', () => {
      printWindow.print();
    });
  };

  const handleBackToReportBuilder = () => {
    if (reportPreviewUrl) {
      URL.revokeObjectURL(reportPreviewUrl);
    }

    setReportPreviewUrl('');
    setShowReportBuilder(true);
  };

  const handleOpenReportBuilder = () => {
    setReportDateFrom(dateFrom);
    setReportDateTo(dateTo);
    setShowReportBuilder(true);
  };

  const applyDashboardPreset = (presetKey) => {
    const rangeValue = getDateRangePreset(presetKey);
    setDateFrom(rangeValue.from);
    setDateTo(rangeValue.to);
  };

  const applyReportPreset = (presetKey) => {
    const rangeValue = getDateRangePreset(presetKey);
    setReportDateFrom(rangeValue.from);
    setReportDateTo(rangeValue.to);
  };

  const handleToggleReportSection = (sectionKey) => {
    setReportSections((previousSections) => ({
      ...previousSections,
      [sectionKey]: !previousSections[sectionKey],
    }));
  };

  const selectedSectionCount = Object.values(reportSections).filter(Boolean).length;

  const handleGenerateReport = () => {
    if (selectedSectionCount === 0) {
      return;
    }

    setIsGeneratingReport(true);

    try {
      const reportDate = new Date();
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const selectedSections = reportSections;

      doc.setFontSize(18);
      doc.text('QNext Admin - Dashboard Analytics Report', 40, 42);

      doc.setFontSize(10);
      doc.text(`Generated: ${reportDate.toLocaleString()}`, 40, 60);
      doc.text(`Date range: ${reportDateFrom || 'All'} to ${reportDateTo || 'All'}`, 40, 74);
      doc.text(`Total records analyzed: ${reportFilteredBuses.length}`, 40, 88);

      let nextTableStartY = 104;

      const appendTable = (tableOptions) => {
        autoTable(doc, {
          startY: nextTableStartY,
          styles: { fontSize: 9 },
          headStyles: { fillColor: [9, 107, 114] },
          ...tableOptions,
        });

        nextTableStartY = doc.lastAutoTable.finalY + 16;
      };

      if (selectedSections.kpiSummary) {
        appendTable({
          head: [['KPI', 'Value']],
          body: [
            ['Total Records', reportAnalytics.totalBuses],
            ['Active Buses', reportAnalytics.activeBuses],
            ['Average QNExT Riders', reportAnalytics.avgQnextRiders],
            ['Average Capacity', reportAnalytics.avgCapacity],
          ],
          styles: { fontSize: 10 },
        });
      }

      if (selectedSections.weeklyBusesTrend) {
        appendTable({
          head: [['Weekly Buses', 'Total']],
          body: reportAnalytics.weeklyData.map((item) => [item.label, item.buses]),
        });
      }

      if (selectedSections.weeklyQueueMix) {
        appendTable({
          head: [['Weekly Queue Mix', 'Traditional Queue', 'QNExT']],
          body: reportAnalytics.weeklyData.map((item) => [item.label, item.traditional, item.qnext]),
        });
      }

      if (selectedSections.companyMix) {
        appendTable({
          head: [['Company', 'Traditional Queue', 'QNExT', 'Total Buses']],
          body: reportCompanyStatusMixData.map((item) => [item.label, item.traditional, item.qnext, item.buses]),
        });
      }

      if (selectedSections.demandQuality) {
        appendTable({
          head: [['Demand Quality', 'Value']],
          body: [
            ['Total Trips', reportDemandQuality.totalTrips],
            ['Total Riders', reportDemandQuality.totalRiders],
            ['Avg Riders per Trip', reportDemandQuality.avgRidersPerTrip],
            ['QNExT Capacity Share', `${reportDemandQuality.qnextCapacityShare}%`],
            ['Low-demand Trips (<5 riders)', reportDemandQuality.lowDemandTrips],
            ['High-demand Trips (>=20 riders)', reportDemandQuality.highDemandTrips],
          ],
        });
      }

      if (selectedSections.serviceReliability) {
        appendTable({
          head: [['Service Reliability', 'Value']],
          body: [
            ['Completion Rate', `${reportServiceReliability.completionRate}%`],
            ['Completed Trips', reportServiceReliability.completedTrips],
            ['In-progress Trips', reportServiceReliability.inProgressTrips],
            ['Avg Trip Duration (min)', reportServiceReliability.avgTripDurationMinutes],
            ['Long-running Trips (>2h)', reportServiceReliability.longRunningTrips],
            ['Delayed Buses', reportServiceReliability.delayedBuses],
          ],
        });
      }

      if (selectedSections.attendantPerformance) {
        appendTable({
          head: [['Attendant', 'Trips', 'Avg Riders', 'Completion Rate']],
          body: reportAttendantPerformance.map((item) => [
            item.attendantName,
            item.trips,
            item.avgRidersPerTrip,
            `${item.completionRate}%`,
          ]),
        });
      }

      if (selectedSections.exceptionsPanel) {
        appendTable({
          head: [['Severity', 'Exception']],
          body: reportExceptions.map((item) => [String(item.severity || '').toUpperCase(), item.message]),
        });
      }

      if (selectedSections.topRoutes) {
        appendTable({
          head: [['Route', 'Assigned Buses']],
          body: reportTopRouteVolumeData.map((item) => [item.label, item.buses]),
        });
      }

      if (selectedSections.detailedBusRecords) {
        appendTable({
          head: [['Bus Number', 'Company', 'Route', 'Status', 'Capacity', 'Last Updated']],
          body: [...reportFilteredBuses]
            .sort((leftBus, rightBus) => Number(rightBus.lastUpdated || 0) - Number(leftBus.lastUpdated || 0))
            .map((bus) => [
              bus.busNumber || 'N/A',
              bus.busCompany || 'N/A',
              bus.route || 'N/A',
              bus.status || 'N/A',
              Number(bus.capacity || 0),
              formatReportDate(bus.lastUpdated || Date.now()),
            ]),
          styles: { fontSize: 8 },
        });
      }

      const fileDate = reportDate.toISOString().slice(0, 10);
      const nextFileName = `dashboard-analytics-report-${fileDate}.pdf`;
      const reportBlob = doc.output('blob');
      const nextPreviewUrl = URL.createObjectURL(reportBlob);

      if (reportPreviewUrl) {
        URL.revokeObjectURL(reportPreviewUrl);
      }

      setReportFileName(nextFileName);
      setReportPreviewUrl(nextPreviewUrl);
      setShowReportBuilder(false);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <main className="content">
      <div className="dashboard-v2">
        <div className="dashboard-toolbar">
          <h1>Dashboard Analytics</h1>
          <button
            type="button"
            className="report-btn"
            onClick={handleOpenReportBuilder}
            disabled={isGeneratingReport || isLoading}
          >
            {isGeneratingReport ? 'Generating PDF...' : 'Build Custom Report'}
          </button>
        </div>

        <div className="dashboard-filters">
          <div className="dashboard-filter-item">
            <label htmlFor="dashboard-date-from">From</label>
            <DatePicker
              id="dashboard-date-from"
              selected={parseDateInputValue(dateFrom)}
              onChange={(selectedDate) => setDateFrom(formatDateInputValue(selectedDate))}
              maxDate={parseDateInputValue(dateTo)}
              dateFormat="MMM dd, yyyy"
              placeholderText="Select start date"
              className="dashboard-date-picker-input"
              wrapperClassName="dashboard-date-picker-wrap"
              popperClassName="dashboard-date-popper"
              showPopperArrow={false}
              calendarClassName="dashboard-date-calendar"
              popperPlacement="bottom-start"
              onCalendarOpen={stripDatePickerTitles}
              onMonthChange={stripDatePickerTitles}
              onYearChange={stripDatePickerTitles}
              showMonthDropdown
              showYearDropdown
              scrollableYearDropdown
              yearDropdownItemNumber={36}
              dropdownMode="select"
            />
          </div>
          <div className="dashboard-filter-item">
            <label htmlFor="dashboard-date-to">To</label>
            <DatePicker
              id="dashboard-date-to"
              selected={parseDateInputValue(dateTo)}
              onChange={(selectedDate) => setDateTo(formatDateInputValue(selectedDate))}
              minDate={parseDateInputValue(dateFrom)}
              dateFormat="MMM dd, yyyy"
              placeholderText="Select end date"
              className="dashboard-date-picker-input"
              wrapperClassName="dashboard-date-picker-wrap"
              popperClassName="dashboard-date-popper"
              showPopperArrow={false}
              calendarClassName="dashboard-date-calendar"
              popperPlacement="bottom-start"
              onCalendarOpen={stripDatePickerTitles}
              onMonthChange={stripDatePickerTitles}
              onYearChange={stripDatePickerTitles}
              showMonthDropdown
              showYearDropdown
              scrollableYearDropdown
              yearDropdownItemNumber={36}
              dropdownMode="select"
            />
          </div>
          <button
            type="button"
            className="report-secondary-btn dashboard-range-reset-btn"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
            disabled={!dateFrom && !dateTo}
          >
            Reset Range
          </button>
        </div>

        <div className="date-range-presets">
          <button type="button" className="date-preset-btn" onClick={() => applyDashboardPreset('today')}>Today</button>
          <button type="button" className="date-preset-btn" onClick={() => applyDashboardPreset('last7')}>Last 7 Days</button>
          <button type="button" className="date-preset-btn" onClick={() => applyDashboardPreset('last30')}>Last 30 Days</button>
          <button type="button" className="date-preset-btn" onClick={() => applyDashboardPreset('thisMonth')}>This Month</button>
        </div>

        {dashboardWarning && (
          <div className="dashboard-warning-banner" role="alert">
            {dashboardWarning}
          </div>
        )}

        {!isLoading && filteredBuses.length === 0 && (
          <div className="dashboard-info-banner" role="status">
            No records found for the selected date range.
          </div>
        )}

        {isLoading ? (
          <>
            <div className="dashboard-kpis dashboard-kpis-loading">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="kpi-card kpi-card-skeleton">
                  <div className="skeleton-block skeleton-kpi-label" />
                  <div className="skeleton-block skeleton-kpi-value" />
                </div>
              ))}
            </div>

            <div className="dashboard-charts-grid">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="chart-container dashboard-panel dashboard-panel-skeleton">
                  <div className="skeleton-block skeleton-panel-title" />
                  <div className="skeleton-block skeleton-chart" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
        <div className="dashboard-kpis">
          <div className="kpi-card">
            <div>
              <h3>Total Records</h3>
              <p className="kpi-value">{analytics.totalBuses}</p>
            </div>
            <span className="kpi-icon"><MdDirectionsBus /></span>
          </div>

          <div className="kpi-card">
            <div>
              <h3>Average Capacity</h3>
              <p className="kpi-value">{analytics.avgCapacity}</p>
            </div>
            <span className="kpi-icon"><MdTimer /></span>
          </div>

          <div className="kpi-card">
            <div>
              <h3>Active Buses</h3>
              <p className="kpi-value">{analytics.activeBuses}</p>
            </div>
            <span className="kpi-icon"><MdTraffic /></span>
          </div>

          <div className="kpi-card">
            <div>
              <h3>Avg QNExT Riders</h3>
              <p className="kpi-value">{analytics.avgQnextRiders}</p>
            </div>
            <span className="kpi-icon"><MdPeople /></span>
          </div>
        </div>

        <div className="dashboard-charts-grid">
          <div className="chart-container dashboard-panel">
            <div className="panel-header">
              <h2>{leftPanelTitle}</h2>
              <select value={leftView} onChange={(event) => setLeftView(event.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <ResponsiveContainer width="100%" height={290}>
              <LineChart data={leftChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="buses"
                  stroke="#096B72"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container dashboard-panel">
            <div className="panel-header">
              <h2>{rightPanelTitle}</h2>
              <select value={rightView} onChange={(event) => setRightView(event.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <ResponsiveContainer width="100%" height={290}>
              <AreaChart data={rightChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="traditional" name="Traditional Queue" stroke="#E3655B" fill="#E3655B" fillOpacity={0.16} />
                <Area type="monotone" dataKey="qnext" name="QNExT" stroke="#096B72" fill="#096B72" fillOpacity={0.22} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dashboard-insights-grid">
          <div className="dashboard-panel dashboard-insight-panel">
            <div className="panel-header">
              <h2>Demand Quality</h2>
            </div>
            <div className="dashboard-metric-list">
              <div className="dashboard-metric-row"><span>Total Trips</span><strong>{demandQuality.totalTrips}</strong></div>
              <div className="dashboard-metric-row"><span>Total Riders</span><strong>{demandQuality.totalRiders}</strong></div>
              <div className="dashboard-metric-row"><span>Avg Riders / Trip</span><strong>{demandQuality.avgRidersPerTrip}</strong></div>
              <div className="dashboard-metric-row"><span>QNExT Capacity Share</span><strong>{demandQuality.qnextCapacityShare}%</strong></div>
              <div className="dashboard-metric-row"><span>Low-demand Trips (&lt;5)</span><strong>{demandQuality.lowDemandTrips}</strong></div>
              <div className="dashboard-metric-row"><span>High-demand Trips (&gt;=20)</span><strong>{demandQuality.highDemandTrips}</strong></div>
            </div>
          </div>

          <div className="dashboard-panel dashboard-insight-panel">
            <div className="panel-header">
              <h2>Service Reliability</h2>
            </div>
            <div className="dashboard-metric-list">
              <div className="dashboard-metric-row"><span>Completion Rate</span><strong>{serviceReliability.completionRate}%</strong></div>
              <div className="dashboard-metric-row"><span>Completed Trips</span><strong>{serviceReliability.completedTrips}</strong></div>
              <div className="dashboard-metric-row"><span>In Progress Trips</span><strong>{serviceReliability.inProgressTrips}</strong></div>
              <div className="dashboard-metric-row"><span>Avg Trip Duration</span><strong>{serviceReliability.avgTripDurationMinutes} min</strong></div>
              <div className="dashboard-metric-row"><span>Long-running (&gt;2h)</span><strong>{serviceReliability.longRunningTrips}</strong></div>
              <div className="dashboard-metric-row"><span>Delayed Buses</span><strong>{serviceReliability.delayedBuses}</strong></div>
            </div>
          </div>

          <div className="dashboard-panel dashboard-insight-panel">
            <div className="panel-header">
              <h2>Attendant Performance (Top 6)</h2>
            </div>
            {attendantPerformance.length > 0 ? (
              <div className="dashboard-mini-table-wrap">
                <table className="dashboard-mini-table">
                  <thead>
                    <tr>
                      <th>Attendant</th>
                      <th>Trips</th>
                      <th>Avg Riders</th>
                      <th>Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendantPerformance.map((attendantItem) => (
                      <tr key={attendantItem.attendantName}>
                        <td>{attendantItem.attendantName}</td>
                        <td>{attendantItem.trips}</td>
                        <td>{attendantItem.avgRidersPerTrip}</td>
                        <td>{attendantItem.completionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="dashboard-empty-note">No attendant performance data in the selected range.</p>
            )}
          </div>

          <div className="dashboard-panel dashboard-insight-panel">
            <div className="panel-header">
              <h2>Exceptions Panel</h2>
            </div>
            <ul className="dashboard-exceptions-list">
              {exceptionsPanel.map((exceptionItem, index) => (
                <li key={`${exceptionItem.message}-${index}`} className={`exception-${exceptionItem.severity}`}>
                  {exceptionItem.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
          </>
        )}
      </div>

      {showReportBuilder && (
        <div className="dashboard-report-builder-overlay" onClick={() => setShowReportBuilder(false)}>
          <div className="dashboard-report-builder-modal dashboard-report-builder" onClick={(event) => event.stopPropagation()}>
            <div className="dashboard-report-builder-header">
              <h2>Custom Report Builder</h2>
              <button type="button" className="dashboard-report-builder-close-btn" onClick={() => setShowReportBuilder(false)}>
                ×
              </button>
            </div>

            <div className="dashboard-report-builder-body">
              <div className="dashboard-filters">
                <div className="dashboard-filter-item">
                  <label htmlFor="report-date-from">From</label>
                  <DatePicker
                    id="report-date-from"
                    selected={parseDateInputValue(reportDateFrom)}
                    onChange={(selectedDate) => setReportDateFrom(formatDateInputValue(selectedDate))}
                    maxDate={parseDateInputValue(reportDateTo)}
                    dateFormat="MMM dd, yyyy"
                    placeholderText="Select start date"
                    className="dashboard-date-picker-input"
                    wrapperClassName="dashboard-date-picker-wrap"
                    popperClassName="dashboard-date-popper"
                    showPopperArrow={false}
                    calendarClassName="dashboard-date-calendar"
                    popperPlacement="bottom-start"
                    onCalendarOpen={stripDatePickerTitles}
                    onMonthChange={stripDatePickerTitles}
                    onYearChange={stripDatePickerTitles}
                    showMonthDropdown
                    showYearDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={36}
                    dropdownMode="select"
                  />
                </div>

                <div className="dashboard-filter-item">
                  <label htmlFor="report-date-to">To</label>
                  <DatePicker
                    id="report-date-to"
                    selected={parseDateInputValue(reportDateTo)}
                    onChange={(selectedDate) => setReportDateTo(formatDateInputValue(selectedDate))}
                    minDate={parseDateInputValue(reportDateFrom)}
                    dateFormat="MMM dd, yyyy"
                    placeholderText="Select end date"
                    className="dashboard-date-picker-input"
                    wrapperClassName="dashboard-date-picker-wrap"
                    popperClassName="dashboard-date-popper"
                    showPopperArrow={false}
                    calendarClassName="dashboard-date-calendar"
                    popperPlacement="bottom-start"
                    onCalendarOpen={stripDatePickerTitles}
                    onMonthChange={stripDatePickerTitles}
                    onYearChange={stripDatePickerTitles}
                    showMonthDropdown
                    showYearDropdown
                    scrollableYearDropdown
                    yearDropdownItemNumber={36}
                    dropdownMode="select"
                  />
                </div>
              </div>

              <div className="date-range-presets">
                <button type="button" className="date-preset-btn" onClick={() => applyReportPreset('today')}>Today</button>
                <button type="button" className="date-preset-btn" onClick={() => applyReportPreset('last7')}>Last 7 Days</button>
                <button type="button" className="date-preset-btn" onClick={() => applyReportPreset('last30')}>Last 30 Days</button>
                <button type="button" className="date-preset-btn" onClick={() => applyReportPreset('thisMonth')}>This Month</button>
              </div>

              <div className="report-sections-grid">
                {REPORT_SECTION_OPTIONS.map((sectionItem) => (
                  <label key={sectionItem.key} className="report-section-option">
                    <input
                      type="checkbox"
                      checked={Boolean(reportSections[sectionItem.key])}
                      onChange={() => handleToggleReportSection(sectionItem.key)}
                    />
                    <span>{sectionItem.label}</span>
                  </label>
                ))}
              </div>

              <p className="dashboard-empty-note" style={{ marginTop: '0.9rem' }}>
                Selected sections: {selectedSectionCount} · Records in range: {reportFilteredBuses.length}
              </p>

              <div className="dashboard-report-builder-actions">
                <button
                  type="button"
                  className="report-secondary-btn"
                  onClick={() => {
                    setReportDateFrom('');
                    setReportDateTo('');
                    setReportSections(DEFAULT_REPORT_SECTIONS);
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="report-btn"
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport || selectedSectionCount === 0 || reportFilteredBuses.length === 0}
                >
                  {isGeneratingReport ? 'Generating PDF...' : 'Generate & Preview'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportPreviewUrl && (
        <div className="dashboard-report-modal-overlay" onClick={handleCloseReportPreview}>
          <div className="dashboard-report-modal" onClick={(event) => event.stopPropagation()}>
            <div className="dashboard-report-modal-header">
              <h2>Report Preview</h2>
              <button type="button" className="report-close-btn" onClick={handleCloseReportPreview}>
                ×
              </button>
            </div>

            <div className="dashboard-report-modal-body">
              <iframe title="Dashboard Report Preview" src={reportPreviewUrl} className="dashboard-report-preview" />
            </div>

            <div className="dashboard-report-modal-actions">
              <button type="button" className="report-secondary-btn" onClick={handleBackToReportBuilder}>
                Back to Builder
              </button>
              <button type="button" className="report-secondary-btn" onClick={handleCloseReportPreview}>
                Close
              </button>
              <button type="button" className="report-secondary-btn" onClick={handlePrintPreviewPdf}>
                Print
              </button>
              <button type="button" className="report-btn" onClick={handleDownloadPreviewPdf}>
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Dashboard;