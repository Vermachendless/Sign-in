import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Ticket,
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Mail,
  Phone,
  Calendar,
  Clock,
  Ban,
  Eye,
  UserRoundCheck,
  Building2,
  FileText,
} from 'lucide-react';
import {
  VisitorVisitRecord,
  VisitorVisitStatus,
  VisitorVisitsSummary,
  AccessPassRecord,
  UserRole,
} from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { CreateVisitorModal } from './CreateVisitorModal.tsx';
import { VisitorAccessCardModal } from './VisitorAccessCardModal.tsx';

interface VisitorsManagementProps {
  isStaffView?: boolean;
}

export const VisitorsManagement: React.FC<VisitorsManagementProps> = ({ isStaffView = false }) => {
  const { user } = useAuth();

  const [visits, setVisits] = useState<VisitorVisitRecord[]>([]);
  const [summary, setSummary] = useState<VisitorVisitsSummary>({
    total: 0,
    today: 0,
    upcoming: 0,
    accessIssued: 0,
    pending: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<'ALL' | 'TODAY'>('ALL');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingCardVisit, setViewingCardVisit] = useState<VisitorVisitRecord | null>(null);
  const [viewingPass, setViewingPass] = useState<AccessPassRecord | null>(null);

  // Row operation state
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (dateFilter === 'TODAY') {
        const todayIso = new Date().toISOString().split('T')[0];
        params.set('date', todayIso);
      }

      const res = await fetch(`/api/visitor-visits?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to fetch visitor invitations.');
      }

      setVisits(json.data.visits || []);
      if (json.data.summary) {
        setSummary(json.data.summary);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error retrieving visitor invitations.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, dateFilter]);

  useEffect(() => {
    fetchVisits();
  }, [fetchVisits]);

  // Generate visitor access pass
  const handleGenerateAccess = async (visit: VisitorVisitRecord) => {
    setProcessingId(visit.id);
    setError(null);
    try {
      const res = await fetch(`/api/visitor-visits/${visit.id}/access-pass`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to generate visitor access pass.');
      }

      const updatedVisit: VisitorVisitRecord = json.data.visit;
      const pass: AccessPassRecord = json.data.pass;

      setViewingCardVisit(updatedVisit);
      setViewingPass(pass);

      fetchVisits();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating visitor access pass.');
    } finally {
      setProcessingId(null);
    }
  };

  // Revoke visitor access pass
  const handleRevokeAccess = async (visitId: string) => {
    setProcessingId(visitId);
    setError(null);
    try {
      const res = await fetch(`/api/visitor-visits/${visitId}/revoke-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Visitor access pass revoked by host' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to revoke visitor access.');
      }

      if (viewingCardVisit?.id === visitId) {
        setViewingCardVisit(null);
        setViewingPass(null);
      }

      fetchVisits();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error revoking visitor access.');
    } finally {
      setProcessingId(null);
    }
  };

  // Cancel visitor invitation
  const handleCancelVisit = async (visit: VisitorVisitRecord) => {
    if (!confirm(`Cancel visit invitation for "${visit.visitorFullName}"? Any active access pass will be immediately revoked.`)) {
      return;
    }

    setProcessingId(visit.id);
    setError(null);
    try {
      const res = await fetch(`/api/visitor-visits/${visit.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by host staff member' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to cancel visitor invitation.');
      }

      fetchVisits();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cancelling visitor invitation.');
    } finally {
      setProcessingId(null);
    }
  };

  // View existing card
  const handleViewCard = (visit: VisitorVisitRecord) => {
    if (!visit.accessPass) return;
    setViewingCardVisit(visit);
    setViewingPass(visit.accessPass);
  };

  return (
    <div className="space-y-6">
      {/* Title & Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
              <UserRoundCheck className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-brand-black">
              {isStaffView ? 'My Visitor Access' : 'Visitor Management & Access'}
            </h1>
          </div>
          <p className="text-xs text-brand-muted">
            {isStaffView
              ? 'Invite and manage secure office access passes for your upcoming guests and visitors.'
              : 'Enterprise directory and security governance for all visitor invitations and access credentials.'}
          </p>
        </div>

        <button
          id="open-create-visitor-btn"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black rounded-xl transition flex items-center gap-2 cursor-pointer shadow-xs shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Visitor</span>
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 bg-white rounded-2xl border border-brand-border shadow-xs">
          <span className="text-[10px] uppercase font-semibold text-brand-muted block mb-1">
            Total Visits
          </span>
          <span className="text-xl font-extrabold text-brand-black">{summary.total}</span>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-brand-border shadow-xs">
          <span className="text-[10px] uppercase font-semibold text-amber-600 block mb-1">
            Today's Visitors
          </span>
          <span className="text-xl font-extrabold text-amber-700">{summary.today}</span>
        </div>

        <div className="p-3.5 bg-white rounded-2xl border border-brand-border shadow-xs">
          <span className="text-[10px] uppercase font-semibold text-blue-600 block mb-1">
            Upcoming
          </span>
          <span className="text-xl font-extrabold text-blue-700">{summary.upcoming}</span>
        </div>

        <div className="p-3.5 bg-emerald-50/70 rounded-2xl border border-emerald-200 shadow-xs">
          <span className="text-[10px] uppercase font-semibold text-emerald-800 block mb-1">
            Access Issued
          </span>
          <span className="text-xl font-extrabold text-emerald-900">{summary.accessIssued}</span>
        </div>

        <div className="p-3.5 bg-rose-50/70 rounded-2xl border border-rose-200 shadow-xs col-span-2 sm:col-span-1">
          <span className="text-[10px] uppercase font-semibold text-rose-800 block mb-1">
            Cancelled
          </span>
          <span className="text-xl font-extrabold text-rose-900">{summary.cancelled}</span>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="p-4 bg-white rounded-2xl border border-brand-border shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
          <input
            id="visitor-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isStaffView
                ? 'Search your visitors by name, email, or purpose...'
                : 'Search by visitor name, email, purpose, or host staff...'
            }
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {/* Date Filter */}
          <div className="flex items-center rounded-xl border border-brand-border overflow-hidden bg-neutral-50 text-xs">
            <button
              onClick={() => setDateFilter('ALL')}
              className={`px-3 py-1.5 font-semibold transition cursor-pointer ${
                dateFilter === 'ALL'
                  ? 'bg-white text-brand-black shadow-xs'
                  : 'text-neutral-500 hover:text-brand-black'
              }`}
            >
              All Dates
            </button>
            <button
              onClick={() => setDateFilter('TODAY')}
              className={`px-3 py-1.5 font-semibold transition cursor-pointer ${
                dateFilter === 'TODAY'
                  ? 'bg-white text-brand-black shadow-xs'
                  : 'text-neutral-500 hover:text-brand-black'
              }`}
            >
              Today
            </button>
          </div>

          {/* Status Dropdown */}
          <select
            id="visitor-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-xl border border-brand-border bg-white text-neutral-700 font-medium focus:border-brand-black outline-hidden cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value={VisitorVisitStatus.PENDING}>Pending Access</option>
            <option value={VisitorVisitStatus.ACCESS_ISSUED}>Access Active</option>
            <option value={VisitorVisitStatus.CANCELLED}>Cancelled</option>
            <option value={VisitorVisitStatus.EXPIRED}>Expired</option>
          </select>
        </div>
      </div>

      {/* Visitors List / Table */}
      <div className="bg-white border border-brand-border rounded-2xl shadow-xs overflow-hidden divide-y divide-brand-border">
        {loading ? (
          <div className="p-12 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
            <span>Loading visitor invitations...</span>
          </div>
        ) : visits.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 space-y-2">
            <UserRoundCheck className="w-10 h-10 text-neutral-300 mx-auto" />
            <p className="text-sm font-semibold text-brand-black">No visitor invitations found</p>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              {search || statusFilter !== 'ALL' || dateFilter !== 'ALL'
                ? 'Try adjusting your search criteria or filter pills.'
                : isStaffView
                ? 'Click Invite Visitor above to generate a secure visit code for your guest.'
                : 'No visitor invitations recorded across the organization yet.'}
            </p>
          </div>
        ) : (
          visits.map((visit) => {
            const isProcessing = processingId === visit.id;
            const isCancelled = visit.status === VisitorVisitStatus.CANCELLED;
            const isExpired = visit.status === VisitorVisitStatus.EXPIRED;
            const hasPass = !!visit.accessPassId && !!visit.accessPass;

            return (
              <div
                key={visit.id}
                className="p-4 hover:bg-neutral-50/70 transition flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
              >
                {/* Main Visitor & Schedule Info */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-brand-black">
                      {visit.visitorFullName}
                    </span>

                    {/* Status Pill */}
                    {visit.status === VisitorVisitStatus.ACCESS_ISSUED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Access Active
                      </span>
                    )}
                    {visit.status === VisitorVisitStatus.PENDING && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                        Pending Access Pass
                      </span>
                    )}
                    {visit.status === VisitorVisitStatus.CANCELLED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                        Cancelled
                      </span>
                    )}
                    {visit.status === VisitorVisitStatus.EXPIRED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-300">
                        Expired
                      </span>
                    )}

                    {/* Access code tag */}
                    {visit.accessPass && (
                      <span className="font-mono text-[11px] text-amber-950 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 font-bold">
                        {visit.accessPass.displayCode}
                      </span>
                    )}
                  </div>

                  {/* Host, Purpose & Schedule Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-neutral-600 text-[11px] pt-1">
                    <div>
                      <span className="text-neutral-400 block text-[10px] font-semibold">VISITING HOST</span>
                      <span className="font-semibold text-neutral-800">
                        {visit.hostStaffName || 'Staff Member'}
                      </span>
                      {visit.hostStaffDepartment && (
                        <span className="text-neutral-500 block text-[10px]">{visit.hostStaffDepartment}</span>
                      )}
                    </div>

                    <div>
                      <span className="text-neutral-400 block text-[10px] font-semibold">SCHEDULE &amp; TIME</span>
                      <span className="font-medium text-neutral-800 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-amber-500" /> {visit.formattedDate}
                      </span>
                      <span className="font-mono text-[10px] text-neutral-600 block">
                        {visit.formattedTimeRange}
                      </span>
                    </div>

                    <div>
                      <span className="text-neutral-400 block text-[10px] font-semibold">PURPOSE / CONTACT</span>
                      <span className="font-medium text-neutral-800 truncate block">
                        {visit.purpose || 'General Office Visit'}
                      </span>
                      {visit.visitorEmail && (
                        <span className="text-neutral-500 text-[10px] truncate block">{visit.visitorEmail}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  {/* Generate Access Button */}
                  {visit.status === VisitorVisitStatus.PENDING && !isExpired && (
                    <button
                      id={`generate-access-btn-${visit.id}`}
                      onClick={() => handleGenerateAccess(visit)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-xs font-semibold bg-neutral-900 text-brand-yellow hover:bg-neutral-800 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                      title="Issue QR Visitor Pass"
                    >
                      {isProcessing ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Ticket className="w-3 h-3" />
                      )}
                      <span>Generate Access</span>
                    </button>
                  )}

                  {/* View Card Button */}
                  {hasPass && (
                    <button
                      id={`view-card-btn-${visit.id}`}
                      onClick={() => handleViewCard(visit)}
                      className="px-3 py-1.5 text-xs font-semibold bg-white border border-brand-border text-brand-black hover:bg-neutral-100 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                      title="View Access Pass"
                    >
                      <Eye className="w-3.5 h-3.5 text-neutral-600" />
                      <span>Access Pass</span>
                    </button>
                  )}

                  {/* Revoke Access Button */}
                  {hasPass && visit.accessPass?.status === 'ACTIVE' && (
                    <button
                      id={`revoke-access-btn-${visit.id}`}
                      onClick={() => handleRevokeAccess(visit.id)}
                      disabled={isProcessing}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                      title="Revoke Visitor Access"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  )}

                  {/* Cancel Visit Button */}
                  {!isCancelled && (
                    <button
                      id={`cancel-visit-btn-${visit.id}`}
                      onClick={() => handleCancelVisit(visit)}
                      disabled={isProcessing}
                      className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                      title="Cancel Invitation"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Visitor Invitation Modal */}
      <CreateVisitorModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(newVisit, generatedPass) => {
          setShowCreateModal(false);
          fetchVisits();
          if (generatedPass) {
            setViewingCardVisit(newVisit);
            setViewingPass(generatedPass);
          }
        }}
      />

      {/* Printable Visitor Access Card Modal */}
      <VisitorAccessCardModal
        isOpen={!!viewingCardVisit && !!viewingPass}
        visit={viewingCardVisit}
        pass={viewingPass}
        onClose={() => {
          setViewingCardVisit(null);
          setViewingPass(null);
        }}
        onRevoke={(visitId) => handleRevokeAccess(visitId)}
      />
    </div>
  );
};
