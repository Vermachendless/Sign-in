import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  ShieldAlert,
  Globe,
  Sliders,
  FileText,
  CheckCircle2,
  Shield,
  Users,
  Clock,
  Layers,
  AlertTriangle,
  Wifi,
  ArrowRight,
} from 'lucide-react';
import { NetworkDiagnosticCard } from './NetworkDiagnosticCard.tsx';
import { TodayAttendanceTable } from './TodayAttendanceTable.tsx';
import { StaffManagement } from './StaffManagement.tsx';
import { AttendanceReports } from './AttendanceReports.tsx';
import { OfficeNetworkSettings } from './OfficeNetworkSettings.tsx';
import { AuditLogsView } from './AuditLogsView.tsx';
import { AdminDashboardSummary } from '../types/index.ts';
import { AppRoute } from './Sidebar.tsx';

type ActiveTab = 'TODAY' | 'STAFF' | 'REPORTS' | 'NETWORK' | 'GOVERNANCE' | 'AUDIT';

interface SuperAdminDashboardProps {
  currentRoute?: AppRoute;
  onNavigate?: (route: AppRoute) => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ currentRoute, onNavigate }) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('TODAY');
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Sync with incoming currentRoute from global sidebar
  useEffect(() => {
    if (!currentRoute) return;
    if (currentRoute === 'audit-logs') {
      setActiveTab('AUDIT');
    } else if (currentRoute === 'office-networks') {
      setActiveTab('NETWORK');
    } else if (currentRoute === 'governance') {
      setActiveTab('GOVERNANCE');
    } else if (currentRoute === 'reports') {
      setActiveTab('REPORTS');
    } else if (currentRoute === 'staff' || currentRoute === 'users-roles') {
      setActiveTab('STAFF');
    } else if (currentRoute === 'today' || currentRoute === 'attendance') {
      setActiveTab('TODAY');
    }
  }, [currentRoute]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (!onNavigate) return;
    if (tab === 'TODAY') onNavigate('today');
    else if (tab === 'STAFF') onNavigate('staff');
    else if (tab === 'REPORTS') onNavigate('reports');
    else if (tab === 'NETWORK') onNavigate('office-networks');
    else if (tab === 'GOVERNANCE') onNavigate('governance');
    else if (tab === 'AUDIT') onNavigate('audit-logs');
  };

  const [testResult, setTestResult] = useState<{
    endpoint: string;
    status: number;
    message: string;
    ok: boolean;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchDashboardSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch('/api/admin/dashboard');
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setSummary(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardSummary();
  }, [fetchDashboardSummary]);

  if (!user) return null;

  const runRbacTest = async (endpoint: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(endpoint);
      const json = await res.json();
      setTestResult({
        endpoint,
        status: res.status,
        message: json.message || (res.ok ? 'Access Authorized' : 'Access Denied'),
        ok: res.ok,
      });
    } catch {
      setTestResult({
        endpoint,
        status: 500,
        message: 'Network error executing RBAC test',
        ok: false,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Super Admin Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow mb-2 border border-brand-yellow/30">
              <ShieldAlert className="w-3.5 h-3.5 text-brand-yellow" />
              Super Admin • Root Governance Authority
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-brand-black tracking-tight">
              Executive Governance Portal
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              Full application control granted to <span className="font-semibold text-brand-black">{user.firstName} {user.lastName}</span> ({user.email})
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center bg-brand-bg p-1 rounded-xl border border-brand-border self-start sm:self-auto">
            <button
              id="superadmin-tab-today"
              onClick={() => handleTabChange('TODAY')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'TODAY'
                  ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                  : 'text-brand-muted hover:text-brand-black font-semibold'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Today Overview</span>
            </button>

            <button
              id="superadmin-tab-staff"
              onClick={() => handleTabChange('STAFF')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'STAFF'
                  ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                  : 'text-brand-muted hover:text-brand-black font-semibold'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Staff Management</span>
            </button>

            <button
              id="superadmin-tab-reports"
              onClick={() => handleTabChange('REPORTS')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'REPORTS'
                  ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                  : 'text-brand-muted hover:text-brand-black font-semibold'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Reports &amp; Exports</span>
            </button>

            <button
              id="superadmin-tab-network"
              onClick={() => handleTabChange('NETWORK')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'NETWORK'
                  ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                  : 'text-brand-muted hover:text-brand-black font-semibold'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Office Networks</span>
            </button>

            <button
              id="superadmin-tab-governance"
              onClick={() => handleTabChange('GOVERNANCE')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs transition cursor-pointer ${
                activeTab === 'GOVERNANCE'
                  ? 'bg-brand-yellow text-brand-black font-bold shadow-xs'
                  : 'text-brand-muted hover:text-brand-black font-semibold'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Governance &amp; RBAC</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'TODAY' && (
        <TodayAttendanceTable
          summary={summary}
          loading={summaryLoading}
          onRefresh={fetchDashboardSummary}
        />
      )}

      {activeTab === 'STAFF' && (
        <StaffManagement onStaffUpdated={fetchDashboardSummary} />
      )}

      {activeTab === 'REPORTS' && (
        <AttendanceReports />
      )}

      {activeTab === 'NETWORK' && (
        <OfficeNetworkSettings />
      )}

      {activeTab === 'AUDIT' && (
        <AuditLogsView />
      )}

      {activeTab === 'GOVERNANCE' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Capabilities */}
            <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs lg:col-span-2">
              <h2 className="text-base font-bold text-brand-black mb-4 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-brand-yellow" />
                Super Administrator Authority
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <Globe className="w-4 h-4 text-brand-yellow" /> Global Bypass Access
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    Super Admins can access attendance dashboards and staff management from any network location.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-yellow" /> Immutable Audit Logs
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    All staff creation, editing, activation, and status transitions are audited chronologically.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-brand-black flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-brand-yellow" /> Office Network &amp; Attendance Access
                    </div>
                    <p className="mt-1 text-xs text-brand-muted">
                      Manage approved public office IPs for staff Wi-Fi check-in. Off-network attempts are blocked with 403.
                    </p>
                  </div>
                  <button
                    id="gov-jump-to-network-btn"
                    onClick={() => handleTabChange('NETWORK')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-900 text-brand-yellow hover:bg-neutral-800 transition cursor-pointer self-start sm:self-auto shrink-0"
                  >
                    <span>Manage Networks</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Live RBAC Verification Tester */}
            <div className="bg-brand-black rounded-2xl p-6 text-white border border-neutral-800 shadow-xs">
              <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <Shield className="w-5 h-5 text-brand-yellow" />
                Super Admin RBAC Verifier
              </h2>
              <p className="text-xs text-neutral-400 mb-4">
                Verify unrestricted server-side API authorization.
              </p>

              <div className="space-y-2">
                <button
                  id="test-superadmin-admin-btn"
                  onClick={() => runRbacTest('/api/auth/test/admin-check')}
                  disabled={testing}
                  className="w-full py-2 px-3 text-left rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs font-semibold text-white border border-neutral-700 transition cursor-pointer flex justify-between items-center"
                >
                  <span>Test Admin Route</span>
                  <span className="text-[10px] text-emerald-400">200 OK</span>
                </button>

                <button
                  id="test-superadmin-super-btn"
                  onClick={() => runRbacTest('/api/auth/test/super-admin-check')}
                  disabled={testing}
                  className="w-full py-2 px-3 text-left rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs font-semibold text-white border border-neutral-700 transition cursor-pointer flex justify-between items-center"
                >
                  <span>Test Super Admin Route</span>
                  <span className="text-[10px] text-emerald-400">200 OK</span>
                </button>
              </div>

              {testResult && (
                <div
                  id="superadmin-rbac-test-result"
                  className={`mt-4 p-3 rounded-lg text-xs border ${
                    testResult.ok
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                      : 'bg-rose-950/80 border-rose-700 text-rose-200'
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    {testResult.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    )}
                    Status: {testResult.status}
                  </div>
                  <p className="mt-1 font-mono text-[11px] break-all">{testResult.endpoint}</p>
                  <p className="mt-0.5 text-xs">{testResult.message}</p>
                </div>
              )}
            </div>
          </div>

          {/* Network Verification Diagnostic Panel (Dev-Only) */}
          <NetworkDiagnosticCard />
        </div>
      )}
    </div>
  );
};
