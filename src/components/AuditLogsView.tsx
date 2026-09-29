import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Search,
  RefreshCw,
  Filter,
  Shield,
  Clock,
  User as UserIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Globe,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { AuditLog } from '../types/index.ts';

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedAction, setSelectedAction] = useState('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', targetPage.toString());
      params.set('limit', '15');
      if (selectedAction !== 'ALL') {
        params.set('action', selectedAction);
      }
      if (search.trim()) {
        params.set('search', search.trim());
      }

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`);
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        setLogs(json.data.logs || []);
        setTotal(json.data.total || 0);
        setPage(json.data.page || 1);
        setTotalPages(json.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAction, search]);

  useEffect(() => {
    fetchLogs(page);
  }, [fetchLogs, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs(1);
  };

  const formatTimestamp = (isoString?: string | null) => {
    if (!isoString) return '--';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  };

  const getActionBadge = (action: string) => {
    if (action.includes('OFFICE_IP')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
          <Globe className="w-3 h-3 text-amber-700" />
          {action}
        </span>
      );
    }
    if (action.includes('STAFF_ACTIVATED') || action.includes('STAFF_CREATED')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
          {action}
        </span>
      );
    }
    if (action.includes('DEACTIVATED') || action.includes('REMOVED')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-900 border border-rose-300">
          <AlertTriangle className="w-3 h-3 text-rose-700" />
          {action}
        </span>
      );
    }
    if (action.includes('LOGIN') || action.includes('LOGOUT')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-900 border border-blue-300">
          <Shield className="w-3 h-3 text-blue-700" />
          {action}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-100 text-neutral-800 border border-neutral-300">
        <Clock className="w-3 h-3 text-neutral-600" />
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6" id="audit-logs-page-view">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow mb-2 border border-brand-yellow/30">
              <ClipboardList className="w-3.5 h-3.5 text-brand-yellow" />
              Security &amp; Governance • Immutable Audit Trail
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-brand-black tracking-tight">
              System Audit Logs
            </h1>
            <p className="mt-1 text-sm text-brand-muted max-w-2xl">
              Chronological, tamper-evident audit records of administrative operations, network IP configuration updates, staff lifecycle events, and security access decisions.
            </p>
          </div>

          <button
            id="refresh-audit-logs-btn"
            onClick={() => fetchLogs(page)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-brand-black bg-brand-bg hover:bg-neutral-200/80 border border-brand-border rounded-xl transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Logs</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-brand-border p-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-brand-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by action, user, email, or IP address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-brand-bg border border-brand-border rounded-xl text-brand-black focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={selectedAction}
                onChange={(e) => {
                  setSelectedAction(e.target.value);
                  setPage(1);
                }}
                className="pl-8 pr-8 py-2 text-xs bg-brand-bg border border-brand-border rounded-xl text-brand-black font-medium focus:outline-hidden focus:ring-2 focus:ring-brand-yellow cursor-pointer"
              >
                <option value="ALL">All Actions</option>
                <option value="OFFICE_IP_ADDED">Office IP Added</option>
                <option value="OFFICE_IP_REMOVED">Office IP Removed</option>
                <option value="STAFF_CREATED">Staff Created</option>
                <option value="STAFF_UPDATED">Staff Updated</option>
                <option value="STAFF_ACTIVATED">Staff Activated</option>
                <option value="STAFF_DEACTIVATED">Staff Deactivated</option>
                <option value="USER_LOGIN">User Login</option>
                <option value="USER_LOGOUT">User Logout</option>
                <option value="ATTENDANCE_REPORT_EXPORTED">Report Exported</option>
              </select>
            </div>

            <button
              type="submit"
              className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Search
            </button>
          </div>
        </form>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-brand-border flex items-center justify-between">
          <div className="text-xs font-bold text-brand-black">
            Audit Records <span className="font-normal text-brand-muted">({total} total events)</span>
          </div>
          <div className="text-xs text-brand-muted">
            Page {page} of {totalPages}
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="py-16 text-center text-xs text-brand-muted">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-yellow" />
            Loading audit logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-xs text-brand-muted">
            <ClipboardList className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
            <p className="font-semibold text-brand-black text-sm">No Audit Logs Found</p>
            <p className="mt-1 text-brand-muted">Try adjusting your search criteria or action filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-neutral-700 uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Target / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  let parsedMetadata: Record<string, unknown> | null = null;
                  if (log.metadata) {
                    try {
                      parsedMetadata = JSON.parse(log.metadata);
                    } catch {
                      // ignore
                    }
                  }

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-neutral-50/70 transition">
                        <td className="py-3.5 px-4 font-mono text-neutral-700 whitespace-nowrap">
                          {formatTimestamp(log.createdAt)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {getActionBadge(log.action)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {log.actorName ? (
                            <div>
                              <div className="font-semibold text-brand-black">{log.actorName}</div>
                              <div className="text-[11px] text-brand-muted">{log.actorEmail} &bull; {log.actorRole}</div>
                            </div>
                          ) : (
                            <span className="text-neutral-400 italic">System / Anonymous</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-neutral-600 whitespace-nowrap">
                          {log.ipAddress || '--'}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-neutral-700 truncate max-w-xs">
                              {log.targetUserName ? `Target: ${log.targetUserName}` : log.metadata ? (parsedMetadata ? Object.keys(parsedMetadata).join(', ') : 'Details available') : '--'}
                            </span>
                            {log.metadata && (
                              <button
                                onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                                className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-brand-black p-1 rounded hover:bg-neutral-100 transition cursor-pointer"
                                title="Toggle JSON metadata"
                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && log.metadata && (
                        <tr className="bg-neutral-900 text-white">
                          <td colSpan={5} className="p-4 font-mono text-xs">
                            <div className="text-[11px] text-brand-yellow mb-1 font-semibold">Event Metadata JSON:</div>
                            <pre className="overflow-x-auto whitespace-pre-wrap bg-neutral-950 p-3 rounded-lg border border-neutral-800 text-[11px] text-neutral-200">
                              {JSON.stringify(parsedMetadata || log.metadata, null, 2)}
                            </pre>
                            {log.userAgent && (
                              <div className="mt-2 text-[10px] text-neutral-400">
                                User-Agent: {log.userAgent}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-brand-border flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-border text-xs font-semibold text-brand-black hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>

          <span className="text-xs text-brand-muted">
            Page <strong className="text-brand-black">{page}</strong> of {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-brand-border text-xs font-semibold text-brand-black hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
