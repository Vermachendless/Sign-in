import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  Shield,
  ShieldAlert,
  Sliders,
  Globe,
  FileText,
  Wifi,
  Lock,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Server,
} from 'lucide-react';
import { NetworkDiagnosticCard } from './NetworkDiagnosticCard.tsx';
import { UserRole } from '../types/index.ts';

interface GovernanceSettingsViewProps {
  onNavigateToNetworks?: () => void;
}

export const GovernanceSettingsView: React.FC<GovernanceSettingsViewProps> = ({ onNavigateToNetworks }) => {
  const { user } = useAuth();
  const [testResult, setTestResult] = useState<{
    endpoint: string;
    status: number;
    message: string;
    ok: boolean;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  if (!user) return null;

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

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
    <div className="space-y-6" id="governance-settings-view">
      {/* Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow mb-2 border border-brand-yellow/30">
              {isSuperAdmin ? (
                <ShieldAlert className="w-3.5 h-3.5 text-brand-yellow" />
              ) : (
                <Shield className="w-3.5 h-3.5 text-brand-yellow" />
              )}
              {isSuperAdmin ? 'Super Admin • Root Governance & System Authority' : 'Administrator • Operational Governance'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-brand-black tracking-tight">
              {isSuperAdmin ? 'Executive Governance & System Settings' : 'Security & RBAC Diagnostics'}
            </h1>
            <p className="mt-1 text-sm text-brand-muted max-w-2xl">
              {isSuperAdmin
                ? 'Manage system-wide security policies, access boundaries, IP restrictions, and audit integrity.'
                : 'Monitor active operational privilege boundaries, verify server-side access control, and run diagnostics.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Authority Boundaries */}
        <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs lg:col-span-2">
          <h2 className="text-base font-bold text-brand-black mb-4 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-brand-yellow" />
            Active Role Authority &amp; Privilege Boundaries
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {isSuperAdmin ? (
              <>
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <Globe className="w-4 h-4 text-brand-yellow" /> Global Bypass Access
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    Super Admins can access attendance dashboards and staff management from any location.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-yellow" /> Immutable Audit Logs
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    All administrative operations, network IP modifications, and user records are permanently logged.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border sm:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-brand-black flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-brand-yellow" /> Office Network &amp; Attendance Access
                    </div>
                    <p className="mt-1 text-xs text-brand-muted">
                      Manage approved public office IPs for staff Wi-Fi check-in. Off-network attempts fail closed with 403.
                    </p>
                  </div>
                  {onNavigateToNetworks && (
                    <button
                      id="gov-jump-to-network-btn"
                      onClick={onNavigateToNetworks}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-900 text-brand-yellow hover:bg-neutral-800 transition cursor-pointer self-start sm:self-auto shrink-0"
                    >
                      <span>Manage Networks</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-700" /> Staff Management
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    Authorized to view staff lists, create staff accounts, edit details, and suspend/reactivate staff.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
                  <div className="font-semibold text-brand-black flex items-center gap-2">
                    <Lock className="w-4 h-4 text-brand-yellow" /> Super Admin Boundary
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    Cannot elevate permissions, promote users to Super Admin, or alter system-wide IP configurations.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Live RBAC Verification Tester */}
        <div className="bg-brand-black rounded-2xl p-6 text-white border border-neutral-800 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Shield className="w-5 h-5 text-brand-yellow" />
              Live Server RBAC Verifier
            </h2>
            <p className="text-xs text-neutral-400 mb-4">
              Directly verify server-side authorization enforcement against real endpoints.
            </p>

            <div className="space-y-2">
              <button
                id={isSuperAdmin ? 'test-superadmin-admin-btn' : 'test-admin-route-btn'}
                onClick={() => runRbacTest('/api/auth/test/admin-check')}
                disabled={testing}
                className="w-full py-2.5 px-3 text-left rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs font-semibold text-white border border-neutral-700 transition cursor-pointer flex justify-between items-center"
              >
                <span>Test Admin Route</span>
                <span className="text-[10px] text-emerald-400 font-mono">200 OK</span>
              </button>

              <button
                id={isSuperAdmin ? 'test-superadmin-super-btn' : 'test-superadmin-route-btn'}
                onClick={() => runRbacTest('/api/auth/test/super-admin-check')}
                disabled={testing}
                className="w-full py-2.5 px-3 text-left rounded-lg bg-neutral-900 hover:bg-neutral-800 text-xs font-semibold text-white border border-neutral-700 transition cursor-pointer flex justify-between items-center"
              >
                <span>Test Super Admin Route</span>
                <span className={`text-[10px] font-mono ${isSuperAdmin ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isSuperAdmin ? '200 OK' : '403 Forbidden'}
                </span>
              </button>
            </div>

            {testResult && (
              <div
                id={isSuperAdmin ? 'superadmin-rbac-test-result' : 'admin-rbac-test-result'}
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

          <div className="mt-4 pt-3 border-t border-neutral-800 text-[11px] text-neutral-400 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-brand-yellow" />
            <span>Authenticated as {user.role}</span>
          </div>
        </div>
      </div>

      {/* Network Verification Diagnostic Panel */}
      <NetworkDiagnosticCard />
    </div>
  );
};
