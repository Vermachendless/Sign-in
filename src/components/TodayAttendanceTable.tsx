import React, { useState } from 'react';
import {
  Users,
  CheckCircle2,
  LogOut,
  Clock,
  TrendingUp,
  Search,
  Filter,
  Wifi,
  Building,
  RefreshCw,
} from 'lucide-react';
import { AdminDashboardSummary } from '../types/index.ts';

interface TodayAttendanceTableProps {
  summary: AdminDashboardSummary | null;
  loading: boolean;
  onRefresh: () => void;
}

export const TodayAttendanceTable: React.FC<TodayAttendanceTableProps> = ({
  summary,
  loading,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  if (!summary && loading) {
    return (
      <div className="py-16 text-center text-brand-muted bg-white rounded-2xl border border-brand-border">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-yellow" />
        <p className="text-sm font-semibold text-brand-black">Aggregating today's attendance data...</p>
      </div>
    );
  }

  if (!summary) return null;

  const filteredRecords = summary.todayRecords.filter((rec) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      `${rec.firstName} ${rec.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rec.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rec.department && rec.department.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || rec.attendanceStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* 5 Today Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Active Staff */}
        <div className="bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand-muted">Active Staff</span>
            <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-brand-black">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-brand-black">{summary.activeStaffCount}</div>
          <p className="text-[11px] text-brand-muted mt-0.5">Total eligible today</p>
        </div>

        {/* Checked In */}
        <div className="bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-600">Checked In</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-800">{summary.checkedInCount}</div>
          <p className="text-[11px] text-brand-muted mt-0.5">Currently working</p>
        </div>

        {/* Checked Out */}
        <div className="bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-600">Checked Out</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <LogOut className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-800">{summary.checkedOutCount}</div>
          <p className="text-[11px] text-brand-muted mt-0.5">Completed shift</p>
        </div>

        {/* Not Checked In */}
        <div className="bg-white rounded-2xl border border-brand-border p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-600">Not Checked In</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-800">{summary.notCheckedInCount}</div>
          <p className="text-[11px] text-brand-muted mt-0.5">Awaiting check-in</p>
        </div>

        {/* Attendance Rate */}
        <div className="bg-white rounded-2xl border border-brand-border border-l-4 border-l-brand-yellow p-4 sm:p-5 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-black">Attendance Rate</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
              <TrendingUp className="w-4 h-4 text-brand-yellow" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-brand-black">{summary.attendancePercentage}%</div>
          <p className="text-[11px] text-brand-muted mt-0.5">Today's turnout</p>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
        {/* Table Header & Controls */}
        <div className="p-5 border-b border-brand-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-brand-black flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-brand-yellow" />
              Today's Attendance Roster ({summary.date})
            </h3>
            <p className="text-xs text-brand-muted mt-0.5">
              Live attendance statuses for all active staff in {summary.companyTimezone}.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="refresh-today-attendance-btn"
              onClick={onRefresh}
              disabled={loading}
              className="p-2 rounded-xl text-brand-black hover:bg-neutral-100 border border-brand-border transition cursor-pointer"
              title="Refresh Today's Attendance"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-brand-yellow' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="p-4 bg-brand-bg border-b border-brand-border grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
            <input
              id="today-search-input"
              type="text"
              placeholder="Search staff name, email, department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-brand-border rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-brand-muted shrink-0" />
            <select
              id="today-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full py-2 px-3 text-xs bg-white border border-brand-border rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            >
              <option value="ALL">All Statuses</option>
              <option value="CHECKED_IN">Checked In (Active)</option>
              <option value="CHECKED_OUT">Checked Out (Completed)</option>
              <option value="NOT_CHECKED_IN">Not Checked In</option>
            </select>
          </div>
        </div>

        {/* Attendance List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-brand-bg border-b border-brand-border text-brand-black font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Check-In</th>
                <th className="py-3 px-4">Check-Out</th>
                <th className="py-3 px-4">Working Duration</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-brand-muted">
                    No attendance records found for today matching your filter.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  let statusBadgeClass = 'bg-neutral-100 text-neutral-800 border-neutral-200';
                  let statusLabel = 'Not Checked In';

                  if (rec.attendanceStatus === 'CHECKED_IN') {
                    statusBadgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
                    statusLabel = 'Checked In';
                  } else if (rec.attendanceStatus === 'CHECKED_OUT') {
                    statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                    statusLabel = 'Checked Out';
                  }

                  return (
                    <tr key={rec.staffId} className="hover:bg-amber-50/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-brand-black text-sm">
                          {rec.firstName} {rec.lastName}
                        </div>
                        <div className="text-brand-muted">{rec.email}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        {rec.department ? (
                          <span className="inline-flex items-center gap-1 bg-brand-bg text-brand-black border border-brand-border px-2 py-0.5 rounded-md">
                            <Building className="w-3 h-3 text-brand-muted" />
                            {rec.department}
                          </span>
                        ) : (
                          <span className="text-brand-muted">General</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-medium text-neutral-800">
                        {rec.formattedCheckIn}
                      </td>

                      <td className="py-3.5 px-4 font-medium text-neutral-800">
                        {rec.formattedCheckOut}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-brand-black">
                        {rec.workingDuration || '--'}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-semibold border ${statusBadgeClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-brand-muted">
                        {rec.checkInVerificationMethod ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-brand-black font-medium">
                              <Wifi className="w-3 h-3 text-brand-yellow" />
                              {rec.checkInVerificationMethod}
                            </span>
                            {rec.maskedCheckInIp && (
                              <span className="font-mono text-[10px] text-brand-muted">
                                IP: {rec.maskedCheckInIp}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-brand-muted">--</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
