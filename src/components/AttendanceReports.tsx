import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Calendar,
  Filter,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  FileSpreadsheet,
  Building,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  AttendanceReportResponse,
  AttendanceReportQuery,
  DatePreset,
  StaffListItem,
} from '../types/index.ts';

export const AttendanceReports: React.FC = () => {
  // Preset & Filter State
  const [preset, setPreset] = useState<DatePreset>('this_month');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedAccountStatus, setSelectedAccountStatus] = useState<string>('ALL');

  // Pagination & Sorting State
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);
  const [sortField, setSortField] = useState<string>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Dynamic Options
  const [departments, setDepartments] = useState<string[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffListItem[]>([]);

  // Report Data & Request States
  const [reportData, setReportData] = useState<AttendanceReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch departments & staff directory for dropdown options on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [deptRes, staffRes] = await Promise.all([
          fetch('/api/admin/reports/departments'),
          fetch('/api/admin/staff'),
        ]);

        if (deptRes.ok) {
          const deptJson = await deptRes.json();
          if (deptJson.success && deptJson.data?.departments) {
            setDepartments(deptJson.data.departments);
          }
        }

        if (staffRes.ok) {
          const staffJson = await staffRes.json();
          if (staffJson.success && staffJson.data?.staff) {
            setStaffMembers(staffJson.data.staff);
          }
        }
      } catch (err) {
        console.error('Failed to load report filter options:', err);
      }
    };

    fetchMetadata();
  }, []);

  // Fetch report data
  const fetchReport = useCallback(
    async (targetPage = page, targetLimit = limit) => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const params = new URLSearchParams();

        if (preset !== 'custom') {
          params.set('preset', preset);
        } else {
          if (startDate) params.set('startDate', startDate);
          if (endDate) params.set('endDate', endDate);
        }

        if (selectedStaffId !== 'all') params.set('staffId', selectedStaffId);
        if (selectedDepartment !== 'all') params.set('department', selectedDepartment);
        if (selectedStatus !== 'ALL') params.set('attendanceStatus', selectedStatus);
        if (selectedAccountStatus !== 'ALL') params.set('accountStatus', selectedAccountStatus);

        params.set('page', String(targetPage));
        params.set('limit', String(targetLimit));
        params.set('sort', sortField);
        params.set('order', sortOrder);

        const res = await fetch(`/api/admin/reports/attendance?${params.toString()}`);
        const json = await res.json();

        if (res.ok && json.success && json.data) {
          setReportData(json.data);
          // Sync dates if returned from server preset
          if (preset !== 'custom' && json.data.filters) {
            setStartDate(json.data.filters.startDate);
            setEndDate(json.data.filters.endDate);
          }
        } else {
          setErrorMessage(json.message || 'Failed to generate attendance report.');
        }
      } catch (err) {
        console.error('Report fetch error:', err);
        setErrorMessage('A network error occurred while generating the report.');
      } finally {
        setLoading(false);
      }
    },
    [preset, startDate, endDate, selectedStaffId, selectedDepartment, selectedStatus, selectedAccountStatus, sortField, sortOrder, page, limit]
  );

  // Trigger initial report on component load
  useEffect(() => {
    fetchReport(1, limit);
  }, []);

  // Handle Preset Button Click
  const handlePresetChange = (newPreset: DatePreset) => {
    setPreset(newPreset);
    setPage(1);
  };

  // Submit Filter Search
  const handleGenerateClick = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchReport(1, limit);
  };

  // Handle Page Change
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchReport(newPage, limit);
  };

  // Handle Limit Change
  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
    fetchReport(1, newLimit);
  };

  // Handle Column Sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Build query string for export endpoints
  const getExportParams = (): string => {
    const params = new URLSearchParams();
    if (preset !== 'custom') {
      params.set('preset', preset);
    } else {
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
    }
    if (selectedStaffId !== 'all') params.set('staffId', selectedStaffId);
    if (selectedDepartment !== 'all') params.set('department', selectedDepartment);
    if (selectedStatus !== 'ALL') params.set('attendanceStatus', selectedStatus);
    if (selectedAccountStatus !== 'ALL') params.set('accountStatus', selectedAccountStatus);
    params.set('sort', sortField);
    params.set('order', sortOrder);
    return params.toString();
  };

  // Export CSV Handler
  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const exportUrl = `/api/admin/reports/attendance/export.csv?${getExportParams()}`;
      const res = await fetch(exportUrl);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || 'Failed to download CSV');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = 'attendance-report.csv';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
      alert(err instanceof Error ? err.message : 'CSV export failed.');
    } finally {
      setExportingCsv(false);
    }
  };

  // Export Excel Handler
  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const exportUrl = `/api/admin/reports/attendance/export.xlsx?${getExportParams()}`;
      const res = await fetch(exportUrl);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || 'Failed to download Excel workbook');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = 'attendance-report.xls';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Excel export failed:', err);
      alert(err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setExportingExcel(false);
    }
  };

  const summary = reportData?.summary;
  const records = reportData?.records || [];
  const pagination = reportData?.pagination;

  return (
    <div className="space-y-6">
      {/* Top Controls & Filter Panel */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-brand-border">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow border border-brand-yellow/30 mb-1.5">
              <FileText className="w-3.5 h-3.5 text-brand-yellow" />
              Phase 5 Attendance Analytics &amp; Reporting
            </div>
            <h2 className="text-xl font-bold text-brand-black tracking-tight">Attendance Reports &amp; Exports</h2>
            <p className="text-xs text-brand-muted">
              Query historic staff attendance, aggregate shift metrics, and export compliant audit spreadsheets.
            </p>
          </div>

          {/* Export Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              id="btn-export-csv"
              onClick={handleExportCsv}
              disabled={exportingCsv || loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-brand-black bg-white hover:bg-neutral-100 border border-brand-border transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              title="Download CSV report matching current filters"
            >
              {exportingCsv ? (
                <RefreshCw className="w-4 h-4 animate-spin text-brand-yellow" />
              ) : (
                <Download className="w-4 h-4 text-brand-black" />
              )}
              <span>Export CSV</span>
            </button>

            <button
              id="btn-export-excel"
              onClick={handleExportExcel}
              disabled={exportingExcel || loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-brand-black bg-brand-yellow hover:bg-brand-yellow-hover border border-brand-yellow/40 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              title="Download Excel spreadsheet matching current filters"
            >
              {exportingExcel ? (
                <RefreshCw className="w-4 h-4 animate-spin text-brand-black" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 text-brand-black" />
              )}
              <span>Export Excel</span>
            </button>
          </div>
        </div>

        {/* Date Preset Selector */}
        <div className="pt-5">
          <label className="block text-xs font-semibold text-brand-black mb-2">Period Preset</label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'this_week', label: 'This Week' },
              { id: 'last_week', label: 'Last Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'last_month', label: 'Last Month' },
              { id: 'custom', label: 'Custom Period' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                id={`preset-${p.id}`}
                onClick={() => handlePresetChange(p.id as DatePreset)}
                className={`px-3.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                  preset === p.id
                    ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                    : 'bg-brand-bg text-brand-black hover:bg-neutral-200/80 border border-brand-border font-medium'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Input Form */}
        <form onSubmit={handleGenerateClick} className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Custom Date Inputs (if custom preset or display) */}
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Start Date</label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-brand-muted" />
              <input
                type="date"
                id="filter-start-date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPreset('custom');
                }}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">End Date</label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-brand-muted" />
              <input
                type="date"
                id="filter-end-date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPreset('custom');
                }}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
          </div>

          {/* Department Filter */}
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Department</label>
            <div className="relative">
              <Building className="w-4 h-4 absolute left-3 top-2.5 text-brand-muted" />
              <select
                id="filter-department"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Staff Member Filter */}
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Staff Member</label>
            <div className="relative">
              <Users className="w-4 h-4 absolute left-3 top-2.5 text-brand-muted" />
              <select
                id="filter-staff-id"
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              >
                <option value="all">All Staff Members</option>
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} ({s.department || 'General'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Attendance Status Filter */}
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Attendance Status</label>
            <select
              id="filter-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            >
              <option value="ALL">All Records</option>
              <option value="CHECKED_OUT">Completed Shifts (Checked Out)</option>
              <option value="CHECKED_IN">Incomplete Shifts (Checked In Only)</option>
              <option value="PRESENT">Present</option>
            </select>
          </div>

          {/* Account Status Filter */}
          <div>
            <label className="block text-xs font-medium text-brand-black mb-1">Account Status</label>
            <select
              id="filter-account-status"
              value={selectedAccountStatus}
              onChange={(e) => setSelectedAccountStatus(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Staff Only</option>
              <option value="SUSPENDED">Suspended Staff</option>
            </select>
          </div>

          {/* Submit Query Action */}
          <div className="sm:col-span-2 lg:col-span-2 flex items-end">
            <button
              type="submit"
              id="btn-generate-report"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-brand-black hover:bg-neutral-900 transition-colors shadow-xs disabled:opacity-50 cursor-pointer h-[38px]"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-brand-yellow" />
              ) : (
                <Search className="w-4 h-4 text-brand-yellow" />
              )}
              <span>Generate Report</span>
            </button>
          </div>
        </form>
      </div>

      {/* Error Message Banner */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-rose-900">Query Validation Error</h4>
            <p className="text-xs text-rose-700 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Summary Statistics Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <Users className="w-3.5 h-3.5 text-brand-muted" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Staff In Scope</span>
            </div>
            <div className="text-xl font-bold text-brand-black">{summary.totalActiveStaff}</div>
            <div className="text-[11px] text-brand-muted mt-0.5">Active accounts</div>
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <Calendar className="w-3.5 h-3.5 text-brand-muted" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Days in Range</span>
            </div>
            <div className="text-xl font-bold text-brand-black">{summary.daysInPeriod}</div>
            <div className="text-[11px] text-brand-muted mt-0.5">{summary.startDate} to {summary.endDate}</div>
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <FileText className="w-3.5 h-3.5 text-brand-yellow" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Total Records</span>
            </div>
            <div className="text-xl font-bold text-brand-black">{summary.totalRecords}</div>
            <div className="text-[11px] text-brand-muted mt-0.5">{summary.uniqueStaffAttended} unique staff</div>
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Completed Shifts</span>
            </div>
            <div className="text-xl font-bold text-emerald-800">{summary.completedShifts}</div>
            <div className="text-[11px] text-brand-muted mt-0.5">{summary.incompleteShifts} in-progress</div>
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <Clock className="w-3.5 h-3.5 text-brand-yellow" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Avg Shift Duration</span>
            </div>
            <div className="text-xl font-bold text-brand-black">{summary.averageWorkingDurationFormatted}</div>
            <div className="text-[11px] text-brand-muted mt-0.5">Total: {summary.totalWorkingFormatted}</div>
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-4 shadow-xs">
            <div className="flex items-center gap-2 text-brand-muted mb-1">
              <Filter className="w-3.5 h-3.5 text-brand-black" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Attendance Rate</span>
            </div>
            <div className="text-xl font-bold text-brand-black">{summary.attendanceRate}%</div>
            <div className="text-[11px] text-brand-muted mt-0.5 truncate" title={summary.attendanceRateDescription}>
              {summary.attendanceRateDescription}
            </div>
          </div>
        </div>
      )}

      {/* Attendance Report Data Table */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-brand-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-brand-bg">
          <div>
            <h3 className="text-sm font-bold text-brand-black">Attendance Log Entries</h3>
            <p className="text-xs text-brand-muted">
              {pagination ? `Showing page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total records)` : 'Loading records...'}
            </p>
          </div>

          {/* Rows per page selector */}
          <div className="flex items-center gap-2 text-xs text-brand-black font-medium">
            <span>Show:</span>
            <select
              value={limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              className="px-2.5 py-1 rounded-lg border border-brand-border bg-white text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-brand-yellow text-brand-black"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <span>entries</span>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-brand-bg text-brand-black font-semibold border-b border-brand-border uppercase tracking-wider text-[11px]">
              <tr>
                <th
                  onClick={() => handleSort('date')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Date</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('staffName')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Staff Member</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('department')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none hidden md:table-cell"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Department</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('checkIn')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Check-In</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('checkOut')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Check-Out</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('workingDuration')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Duration</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('status')}
                  className="px-5 py-3.5 cursor-pointer hover:bg-neutral-200/50 select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Status</span>
                    <ArrowUpDown className="w-3 h-3 text-brand-muted" />
                  </div>
                </th>
                <th className="px-5 py-3.5 hidden lg:table-cell">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-brand-muted">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-yellow mb-2" />
                    <p className="font-medium">Querying attendance records...</p>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-brand-muted">
                    <FileText className="w-8 h-8 mx-auto text-neutral-300 mb-2" />
                    <p className="font-semibold text-brand-black">No attendance records found</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      No check-in logs match the selected period, department, and filter constraints.
                    </p>
                  </td>
                </tr>
              ) : (
                records.map((r) => {
                  const isCheckedOut = r.status === 'CHECKED_OUT' || !!r.checkOut;
                  return (
                    <tr key={r.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap font-medium text-brand-black">
                        {r.date}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="font-semibold text-brand-black">{r.staffName}</div>
                        <div className="text-[11px] text-brand-muted">{r.email}</div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-neutral-800 hidden md:table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-brand-bg text-brand-black border border-brand-border">
                          {r.department || 'General'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-neutral-800">
                        {r.formattedCheckIn}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-neutral-800">
                        {r.formattedCheckOut}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="font-semibold text-brand-black">{r.workingDuration}</span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {isCheckedOut ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                            Checked Out
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                            <Clock className="w-3 h-3 text-amber-700" />
                            Checked In
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-[11px] text-brand-muted hidden lg:table-cell">
                        <div>{r.verificationMethod || 'OFFICE_IP'}</div>
                        {r.maskedIp && <div className="text-brand-muted font-mono text-[10px]">{r.maskedIp}</div>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation Footer */}
        {pagination && pagination.totalPages > 1 && (
          <div className="px-6 py-4 bg-white border-t border-brand-border flex items-center justify-between">
            <div className="text-xs text-brand-muted">
              Showing page <span className="font-semibold text-brand-black">{pagination.page}</span> of{' '}
              <span className="font-semibold text-brand-black">{pagination.totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-prev-page"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevPage || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-border text-xs font-semibold text-brand-black hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              <button
                id="btn-next-page"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage || loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-border text-xs font-semibold text-brand-black hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-white cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
