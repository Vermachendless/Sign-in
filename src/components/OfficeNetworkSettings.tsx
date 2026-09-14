import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  ArrowRight,
  Globe,
  Info,
  Check,
} from 'lucide-react';
import { OfficeNetworkConfig } from '../types/index.ts';

export const OfficeNetworkSettings: React.FC = () => {
  const [config, setConfig] = useState<OfficeNetworkConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/office-network');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || `Failed to fetch office network settings (${res.status})`);
      }
      setConfig(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load office network configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleAddIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIp.trim()) return;

    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/admin/office-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: newIp.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to add IP address');
      }
      setConfig(json.data);
      setNewIp('');
      setSuccessMessage(json.data.message || 'IP address added to approved office network list.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error adding IP address');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddCurrentIp = async () => {
    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/admin/office-network/add-current', {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to add current IP');
      }
      setConfig(json.data);
      setSuccessMessage(json.data.message || 'Current IP address added to approved office network list.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error adding current IP');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveIp = async (ipToRemove: string) => {
    if (!confirm(`Are you sure you want to remove IP "${ipToRemove}" from approved office networks?`)) {
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/admin/office-network/${encodeURIComponent(ipToRemove)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to remove IP address');
      }
      setConfig(json.data);
      setSuccessMessage(json.data.message || `IP ${ipToRemove} removed from approved office networks.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error removing IP address');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6" id="superadmin-office-network-section">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow mb-2 border border-brand-yellow/30">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-yellow" />
              Office Network Governance • Super Admin Authority
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-brand-black tracking-tight">
              Attendance Access &amp; Approved Office Networks
            </h2>
            <p className="mt-1 text-sm text-brand-muted max-w-2xl">
              Configure authorized public IP addresses for physical office Wi-Fi and Ethernet connections.
              Staff check-in requests originating outside these IPs are rejected automatically with strict fail-closed security.
            </p>
          </div>

          <button
            id="refresh-office-network-btn"
            onClick={fetchSettings}
            disabled={loading || actionLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-brand-black bg-brand-bg hover:bg-neutral-200/80 border border-brand-border rounded-xl transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh State</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div
          id="office-network-error-banner"
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3 shadow-xs"
        >
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-900">Action Failed</p>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {successMessage && (
        <div
          id="office-network-success-banner"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start gap-3 shadow-xs"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-emerald-900">Success</p>
            <p className="text-xs text-emerald-700 mt-0.5">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Two Column Layout: Current Connection & Add IP Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Server-Detected Public IP & Status */}
        <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-base font-bold text-brand-black flex items-center gap-2">
                <Globe className="w-5 h-5 text-brand-yellow" />
                Current Server-Detected IP
              </h3>
              {config?.isCurrentIpApproved ? (
                <span
                  id="current-ip-status-badge"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Approved Network
                </span>
              ) : (
                <span
                  id="current-ip-status-badge"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Not Approved
                </span>
              )}
            </div>

            <p className="text-xs text-brand-muted mb-4">
              The public IP address evaluated by the backend server for your current administrative connection.
            </p>

            <div className="p-4 rounded-xl bg-brand-bg border border-brand-border mb-4">
              <div className="text-xs text-brand-muted font-medium mb-1">Detected IP Address</div>
              <div className="font-mono text-lg font-bold text-brand-black break-all" id="detected-ip-value">
                {config?.currentDetectedIp || (loading ? 'Detecting...' : 'Unknown')}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-brand-muted">
                <span>Evaluation Rule: <strong className="text-brand-black font-semibold">{config?.ruleType || 'NONE'}</strong></span>
                <span>•</span>
                <span>Proxy Hops: <strong className="text-brand-black font-semibold">{config?.proxyHopCount ?? 0}</strong></span>
              </div>
            </div>
          </div>

          <button
            id="add-current-ip-btn"
            onClick={handleAddCurrentIp}
            disabled={actionLoading || loading || !config?.currentDetectedIp || config?.isCurrentIpApproved}
            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
              config?.isCurrentIpApproved
                ? 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
                : 'bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black shadow-xs'
            }`}
          >
            {config?.isCurrentIpApproved ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Current IP Already Approved</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Add Current IP to Approved Office List</span>
              </>
            )}
          </button>
        </div>

        {/* Card 2: Add Custom IP Form */}
        <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-brand-black flex items-center gap-2 mb-1">
              <Plus className="w-5 h-5 text-brand-yellow" />
              Add Approved Office IP
            </h3>
            <p className="text-xs text-brand-muted mb-4">
              Manually authorize a corporate public IP address. Supports standard IPv4 and IPv6 notations.
            </p>

            <form onSubmit={handleAddIp} className="space-y-4" id="add-office-ip-form">
              <div>
                <label htmlFor="new-office-ip-input" className="block text-xs font-semibold text-brand-black mb-1.5">
                  Public IP Address (IPv4 or IPv6)
                </label>
                <input
                  id="new-office-ip-input"
                  type="text"
                  placeholder="e.g. 102.129.144.1 or 2a00:1450:..."
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  disabled={actionLoading}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-white text-brand-black text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow transition"
                />
                <p className="text-[11px] text-brand-muted mt-1.5">
                  Enter your company ISP&apos;s static public IP address. Never enter private local IPs (e.g. 192.168.x.x).
                </p>
              </div>

              <button
                id="submit-add-office-ip-btn"
                type="submit"
                disabled={actionLoading || !newIp.trim()}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-neutral-900 hover:bg-neutral-800 text-white transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 shadow-xs"
              >
                <Plus className="w-4 h-4 text-brand-yellow" />
                <span>{actionLoading ? 'Saving to Database...' : 'Authorize Office IP'}</span>
              </button>
            </form>
          </div>

          <div className="mt-4 p-3 rounded-xl bg-brand-bg border border-brand-border text-[11px] text-brand-muted flex items-center gap-2">
            <Info className="w-4 h-4 text-brand-yellow shrink-0" />
            <span>Persisted directly in <code className="text-neutral-800 font-mono">system_settings.approvedOfficeIPs</code> and audited immediately.</span>
          </div>
        </div>
      </div>

      {/* Card 3: Approved Office Network IP List */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-bold text-brand-black flex items-center gap-2">
              <Wifi className="w-5 h-5 text-brand-yellow" />
              Configured Approved Office Networks ({config?.approvedIps?.length || 0})
            </h3>
            <p className="text-xs text-brand-muted">
              Staff devices connecting from any of these IPs are authorized to register attendance check-ins.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-brand-muted">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-yellow" />
            Loading office network configuration...
          </div>
        ) : !config?.approvedIps || config.approvedIps.length === 0 ? (
          <div
            id="empty-office-ips-warning"
            className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-center"
          >
            <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <h4 className="text-sm font-bold">No Approved Office IPs Configured</h4>
            <p className="text-xs text-amber-700 mt-1 max-w-md mx-auto">
              With no office IPs configured, staff attendance check-ins will strictly fail closed. Add your office public IP above or use &quot;Add Current IP&quot; to authorize staff check-in.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-brand-border border border-brand-border rounded-xl overflow-hidden">
            {config.approvedIps.map((ip) => {
              const isCurrent = config.currentDetectedIp === ip;
              const isDb = config.dbIps.includes(ip);
              const isEnv = config.envIps.includes(ip);

              return (
                <div
                  key={ip}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50/60 transition"
                  id={`approved-ip-row-${ip.replace(/[^a-zA-Z0-9]/g, '-')}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-neutral-900 text-brand-yellow shrink-0">
                      <Wifi className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-brand-black">{ip}</span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-brand-yellow/30 text-brand-black border border-brand-yellow/50">
                            Your Current IP
                          </span>
                        )}
                        {isDb && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
                            Database (Editable)
                          </span>
                        )}
                        {isEnv && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            Environment Config
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-brand-muted mt-0.5">
                        {isDb ? 'Managed via Super Admin dashboard' : 'Injected via deployment environment'}
                      </p>
                    </div>
                  </div>

                  {isDb ? (
                    <button
                      id={`remove-ip-btn-${ip.replace(/[^a-zA-Z0-9]/g, '-')}`}
                      onClick={() => handleRemoveIp(ip)}
                      disabled={actionLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-brand-muted italic">Read-only from deployment</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Card 4: Technical Architecture & Audit Security Overview */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs">
        <h3 className="text-base font-bold text-brand-black flex items-center gap-2 mb-3">
          <Server className="w-5 h-5 text-brand-yellow" />
          Security Architecture &amp; Tamper-Proof Guarantees
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
            <strong className="block text-brand-black font-semibold mb-1">Fail-Closed Verification</strong>
            <p className="text-brand-muted">
              If zero office IPs are configured or if incoming client IP does not match, check-in returns HTTP 403 <code className="text-neutral-800 font-mono">OFFICE_ACCESS_REQUIRED</code>.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
            <strong className="block text-brand-black font-semibold mb-1">Server-Authoritative IP</strong>
            <p className="text-brand-muted">
              Client devices cannot submit an arbitrary IP. The backend evaluates the leftmost IP in <code className="text-neutral-800 font-mono">X-Forwarded-For</code> or TCP remote socket.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
            <strong className="block text-brand-black font-semibold mb-1">Comprehensive Audit Trail</strong>
            <p className="text-brand-muted">
              Every addition and removal is logged to the immutable SQLite audit table with Super Admin user ID, timestamp, and client IP.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
