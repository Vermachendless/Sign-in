import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut,
  Calendar,
  History,
  Briefcase,
  Mail,
  RefreshCw,
  Hourglass,
} from 'lucide-react';
import {
  TodayAttendanceData,
  AttendanceHistoryItem,
  AttendanceDailyState,
} from '../types/index.ts';
import { AppRoute } from './Sidebar.tsx';

interface StaffDashboardProps {
  currentRoute?: AppRoute;
  onNavigate?: (route: AppRoute) => void;
}

export const StaffDashboard: React.FC<StaffDashboardProps> = ({ currentRoute }) => {
  const { user } = useAuth();

  const [todayData, setTodayData] = useState<TodayAttendanceData | null>(null);
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Update live clock every second in Africa/Lagos timezone
  useEffect(() => {
    const updateTime = () => {
      try {
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Africa/Lagos',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(new Date());
        setCurrentTime(formatted);
      } catch {
        setCurrentTime(new Date().toLocaleTimeString());
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch today's attendance state and personal history from server
  const loadAttendanceData = useCallback(async () => {
    try {
      setLoading(true);

      const [todayRes, historyRes] = await Promise.all([
        fetch('/api/attendance/today'),
        fetch('/api/attendance/my-history?limit=15'),
      ]);

      if (todayRes.ok) {
        const todayJson = await todayRes.json();
        if (todayJson.success && todayJson.data) {
          setTodayData(todayJson.data);
        }
      }

      if (historyRes.ok) {
        const historyJson = await historyRes.json();
        if (historyJson.success && historyJson.data?.history) {
          setHistory(historyJson.data.history);
        }
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Could not connect to the attendance service. Please check your connection.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttendanceData();
  }, [loadAttendanceData]);

  // Scroll to attendance history section when requested via sidebar
  useEffect(() => {
    if (currentRoute === 'my-attendance') {
      const el = document.getElementById('staff-my-attendance-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [currentRoute]);

  // Handle Check-In Action
  const handleCheckIn = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setFeedback({
          type: 'success',
          message: 'You have checked in successfully for today!',
        });
        await loadAttendanceData();
      } else {
        const errorMsg =
          data.error?.code === 'OFFICE_ACCESS_REQUIRED' || res.status === 403
            ? 'Office network required: Check-in is only available when connected to an authorized office network.'
            : data.message || data.error?.message || 'Check-in failed. Please try again.';
        setFeedback({
          type: 'error',
          message: errorMsg,
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Network error occurred while submitting check-in.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Check-Out Action
  const handleCheckOut = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const durationText = data.data?.formattedDuration ? ` (${data.data.formattedDuration})` : '';
        setFeedback({
          type: 'success',
          message: `You have checked out successfully! Total working time${durationText}.`,
        });
        await loadAttendanceData();
      } else {
        const errorMsg =
          data.error?.code === 'OFFICE_ACCESS_REQUIRED' || res.status === 403
            ? 'Office network required: Check-out is only available when connected to an authorized office network.'
            : data.message || data.error?.message || 'Check-out failed. Please try again.';
        setFeedback({
          type: 'error',
          message: errorMsg,
        });
      }
    } catch {
      setFeedback({
        type: 'error',
        message: 'Network error occurred while submitting check-out.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Helper to format ISO time string
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  };

  // Helper to format date string
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '--';
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
        return new Intl.DateTimeFormat('en-US', {
          timeZone: 'Africa/Lagos',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(d);
      }
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  if (!user) return null;

  const attendanceState: AttendanceDailyState = todayData?.state || 'NOT_CHECKED_IN';
  const attendanceRecord = todayData?.attendance;

  // Compute Greeting based on hour
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
              Staff Portal &bull; Verified Identity
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-brand-black tracking-tight">
              {getGreeting()}, {user.firstName}
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              Department: <span className="font-semibold text-brand-black">{user.department || 'General Staff'}</span> &bull; {user.email}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-brand-bg border border-brand-border p-3.5 rounded-xl text-xs text-brand-black">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-yellow shrink-0" />
              <div>
                <div className="font-medium text-brand-muted text-[11px]">Office Time (Africa/Lagos)</div>
                <div className="font-mono font-bold text-brand-black text-sm">{currentTime || 'Loading clock...'}</div>
              </div>
            </div>
            <button
              id="refresh-staff-data-btn"
              onClick={loadAttendanceData}
              disabled={loading || actionLoading}
              title="Refresh Attendance Status"
              className="p-2 rounded-lg bg-white border border-brand-border hover:bg-neutral-100 text-brand-black transition cursor-pointer self-end sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Inline Feedback Alerts */}
      {feedback && (
        <div
          id="attendance-feedback-alert"
          className={`p-4 rounded-xl mb-6 text-sm flex items-start gap-3 border transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold">{feedback.type === 'success' ? 'Success' : 'Attendance Notice'}</p>
            <p className="mt-0.5 text-xs sm:text-sm opacity-90">{feedback.message}</p>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold px-2 py-1 rounded hover:bg-black/5 cursor-pointer opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Main Attendance Action Card (2 Columns on Large Screens) */}
        <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-7 shadow-xs lg:col-span-2 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-brand-border mb-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700">
                  <Calendar className="w-4 h-4 text-brand-yellow" />
                </div>
                <h2 className="text-lg font-bold text-brand-black">Today&apos;s Attendance</h2>
              </div>
              <div>
                {attendanceState === 'NOT_CHECKED_IN' && (
                  <span
                    id="attendance-status-badge"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-200"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Not Checked In
                  </span>
                )}
                {attendanceState === 'CHECKED_IN' && (
                  <span
                    id="attendance-status-badge"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-200"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                    Checked In
                  </span>
                )}
                {attendanceState === 'CHECKED_OUT' && (
                  <span
                    id="attendance-status-badge"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-neutral-900 text-brand-yellow border border-neutral-700"
                  >
                    <span className="w-2 h-2 rounded-full bg-brand-yellow" />
                    Checked Out
                  </span>
                )}
              </div>
            </div>

            {/* Attendance Status & Time Display */}
            {loading && !todayData ? (
              <div className="py-8 flex flex-col items-center justify-center text-brand-muted">
                <RefreshCw className="w-6 h-6 animate-spin mb-2 text-brand-yellow" />
                <p className="text-xs">Loading attendance status...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {/* Checked In Time */}
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1">
                    Checked In
                  </div>
                  <div id="display-checkin-time" className="text-xl sm:text-2xl font-bold font-mono text-brand-black">
                    {attendanceRecord?.checkIn ? formatTime(attendanceRecord.checkIn) : '--:--'}
                  </div>
                  <div className="text-[11px] text-brand-muted mt-1">
                    {attendanceRecord?.checkIn ? 'Check-in recorded' : 'Awaiting check-in'}
                  </div>
                </div>

                {/* Checked Out Time */}
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1">
                    Checked Out
                  </div>
                  <div id="display-checkout-time" className="text-xl sm:text-2xl font-bold font-mono text-brand-black">
                    {attendanceRecord?.checkOut ? formatTime(attendanceRecord.checkOut) : '--:--'}
                  </div>
                  <div className="text-[11px] text-brand-muted mt-1">
                    {attendanceRecord?.checkOut
                      ? 'Check-out recorded'
                      : attendanceState === 'CHECKED_IN'
                      ? 'Active working session'
                      : 'Not checked in'}
                  </div>
                </div>

                {/* Working Duration */}
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1">
                    Working Time
                  </div>
                  <div id="display-working-duration" className="text-xl sm:text-2xl font-bold font-mono text-brand-black">
                    {todayData?.formattedDuration || attendanceRecord?.workingDuration || (attendanceState === 'CHECKED_IN' ? 'In Progress' : '--')}
                  </div>
                  <div className="text-[11px] text-brand-muted mt-1">
                    {attendanceState === 'CHECKED_OUT'
                      ? 'Completed shift'
                      : attendanceState === 'CHECKED_IN'
                      ? 'Timer running'
                      : '0h 0m total'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons Section */}
          <div className="pt-4 border-t border-brand-border">
            {attendanceState === 'NOT_CHECKED_IN' && (
              <div>
                <button
                  id="btn-check-in"
                  onClick={handleCheckIn}
                  disabled={actionLoading || loading}
                  className="w-full py-4 px-6 rounded-xl bg-brand-yellow hover:bg-brand-yellow-hover active:bg-amber-600 text-brand-black font-bold text-base shadow-sm hover:shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? (
                    <RefreshCw className="w-5 h-5 animate-spin text-brand-black" />
                  ) : (
                    <LogIn className="w-5 h-5 text-brand-black" />
                  )}
                  <span>{actionLoading ? 'Recording Check-In...' : 'CHECK IN NOW'}</span>
                </button>
                <p className="text-xs text-brand-muted text-center mt-2.5">
                  Your check-in timestamp will be recorded using the server clock.
                </p>
              </div>
            )}

            {attendanceState === 'CHECKED_IN' && (
              <div>
                <button
                  id="btn-check-out"
                  onClick={handleCheckOut}
                  disabled={actionLoading || loading}
                  className="w-full py-4 px-6 rounded-xl bg-brand-black hover:bg-neutral-900 active:bg-neutral-950 text-white font-bold text-base shadow-sm hover:shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading ? (
                    <RefreshCw className="w-5 h-5 animate-spin text-brand-yellow" />
                  ) : (
                    <LogOut className="w-5 h-5 text-brand-yellow" />
                  )}
                  <span>{actionLoading ? 'Recording Check-Out...' : 'CHECK OUT'}</span>
                </button>
                <p className="text-xs text-brand-muted text-center mt-2.5">
                  Ready to wrap up? Clicking Check Out will finalize your daily working duration.
                </p>
              </div>
            )}

            {attendanceState === 'CHECKED_OUT' && (
              <div
                id="attendance-completed-card"
                className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-sm">Attendance Completed Today</div>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      You worked <span className="font-bold">{todayData?.formattedDuration || attendanceRecord?.workingDuration || '8h'}</span> today. Have a restful evening!
                    </p>
                  </div>
                </div>
                <div className="text-right hidden sm:block">
                  <span className="text-[11px] font-semibold uppercase px-2 py-1 rounded bg-emerald-200/70 text-emerald-900">
                    Closed Session
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Staff Identity & Info Sidebar */}
        <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-brand-black mb-4 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-brand-black" />
              Staff Profile
            </h3>
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block mb-0.5">Full Name</span>
                <span className="font-bold text-brand-black text-sm">
                  {user.firstName} {user.lastName}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block mb-0.5">Work Email</span>
                <span className="font-medium text-brand-black flex items-center gap-1.5 truncate">
                  <Mail className="w-3.5 h-3.5 text-brand-muted shrink-0" />
                  {user.email}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
                <span className="text-brand-muted block mb-0.5">Department &amp; Role</span>
                <div className="flex justify-between items-center mt-1">
                  <span className="font-semibold text-brand-black">{user.department || 'General Staff'}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-900 text-brand-yellow border border-brand-yellow/30">
                    {user.role}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-brand-border text-xs text-brand-muted flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-brand-yellow" />
            <span>Daily attendance limit: 1 session / day</span>
          </div>
        </div>
      </div>

      {/* Recent Attendance History Table */}
      <div id="staff-my-attendance-section" className="bg-white rounded-2xl border border-brand-border p-6 sm:p-7 shadow-xs scroll-mt-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-brand-black" />
            <h2 className="text-lg font-bold text-brand-black">Recent Attendance History</h2>
          </div>
          <span className="text-xs text-brand-muted">Showing your last {history.length} attendance records</span>
        </div>

        {loading && history.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-brand-muted">
            <RefreshCw className="w-6 h-6 animate-spin mb-2 text-brand-yellow" />
            <p className="text-xs">Loading attendance history...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-brand-muted bg-brand-bg rounded-xl border border-dashed border-brand-border">
            <Calendar className="w-8 h-8 text-brand-muted mx-auto mb-2" />
            <p className="font-medium text-sm text-brand-black">No attendance records found</p>
            <p className="text-xs text-brand-muted mt-1">
              Your daily check-in and check-out records will be logged here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 sm:mx-0">
            <table id="staff-attendance-history-table" className="w-full text-left text-xs border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold text-brand-black uppercase tracking-wider bg-brand-bg">
                  <th className="py-3 px-4 rounded-l-lg">Date</th>
                  <th className="py-3 px-4">Check In</th>
                  <th className="py-3 px-4">Check Out</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 rounded-r-lg">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {history.map((record) => (
                  <tr key={record.id} className="hover:bg-amber-50/50 transition">
                    <td className="py-3.5 px-4 font-semibold text-brand-black">
                      {formatDate(record.date)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-800">
                      {record.formattedCheckIn || formatTime(record.checkIn)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-800">
                      {record.formattedCheckOut || formatTime(record.checkOut)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-black">
                      {record.formattedDuration || record.workingDuration || '--'}
                    </td>
                    <td className="py-3.5 px-4">
                      {record.checkOut ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200">
                          Completed
                        </span>
                      ) : record.checkIn ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-neutral-100 text-neutral-800 border border-neutral-200">
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
