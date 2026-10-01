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
  Building,
  Ban,
  ShieldCheck,
  ChevronRight,
  Eye,
} from 'lucide-react';
import {
  EventRecord,
  EventInviteeRecord,
  InviteeStatus,
  EventInviteesSummary,
  AccessPassRecord,
  EventStatus,
} from '../../types/index.ts';
import { AddInviteeModal } from './AddInviteeModal.tsx';
import { InviteeAccessCardModal } from './InviteeAccessCardModal.tsx';

interface EventInviteesSectionProps {
  event: EventRecord;
}

export const EventInviteesSection: React.FC<EventInviteesSectionProps> = ({ event }) => {
  const [invitees, setInvitees] = useState<EventInviteeRecord[]>([]);
  const [summary, setSummary] = useState<EventInviteesSummary>({
    total: 0,
    accessIssued: 0,
    cancelled: 0,
    invited: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingCardInvitee, setViewingCardInvitee] = useState<EventInviteeRecord | null>(null);
  const [viewingPass, setViewingPass] = useState<AccessPassRecord | null>(null);

  // Action loading state per invitee
  const [processingId, setProcessingId] = useState<string | null>(null);

  const isApproved = event.status === EventStatus.APPROVED;

  const fetchInvitees = useCallback(async () => {
    if (!event.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const res = await fetch(`/api/events/${event.id}/invitees?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to fetch invitees.');
      }

      setInvitees(json.data.invitees || []);
      if (json.data.summary) {
        setSummary(json.data.summary);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching invitees.');
    } finally {
      setLoading(false);
    }
  }, [event.id, search, statusFilter]);

  useEffect(() => {
    fetchInvitees();
  }, [fetchInvitees]);

  // Generate individual access pass
  const handleGenerateAccess = async (invitee: EventInviteeRecord) => {
    setProcessingId(invitee.id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/invitees/${invitee.id}/access-pass`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to generate access pass.');
      }

      const updatedInvitee: EventInviteeRecord = json.data.invitee;
      const pass: AccessPassRecord = json.data.pass;

      // Show the generated card immediately so admin can view/print
      setViewingCardInvitee(updatedInvitee);
      setViewingPass(pass);

      fetchInvitees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating access pass.');
    } finally {
      setProcessingId(null);
    }
  };

  // Revoke invitee access
  const handleRevokeAccess = async (inviteeId: string) => {
    setProcessingId(inviteeId);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/invitees/${inviteeId}/revoke-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Access revoked via event invitees dashboard' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to revoke access.');
      }

      if (viewingCardInvitee?.id === inviteeId) {
        setViewingCardInvitee(null);
        setViewingPass(null);
      }

      fetchInvitees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error revoking access.');
    } finally {
      setProcessingId(null);
    }
  };

  // Cancel invitee
  const handleCancelInvitee = async (invitee: EventInviteeRecord) => {
    if (!confirm(`Cancel invitation for "${invitee.fullName}"? Any active access pass will be immediately revoked.`)) {
      return;
    }

    setProcessingId(invitee.id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/invitees/${invitee.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by admin' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to cancel invitee.');
      }

      fetchInvitees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cancelling invitee.');
    } finally {
      setProcessingId(null);
    }
  };

  // View card for invitee who already has access pass
  const handleViewCard = (invitee: EventInviteeRecord) => {
    if (!invitee.accessPass) return;
    setViewingCardInvitee(invitee);
    setViewingPass(invitee.accessPass);
  };

  return (
    <div className="space-y-4">
      {/* Event Approval Check Notice */}
      {!isApproved && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Approval Required for Guest Management</span>
            <p className="text-[11px] text-amber-800 mt-0.5">
              Guest invitees and individual access passes can only be issued once this event is in <strong>APPROVED</strong> status.
            </p>
          </div>
        </div>
      )}

      {/* Summary KPI Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 bg-brand-bg rounded-xl border border-brand-border">
          <span className="text-[10px] uppercase font-semibold text-brand-muted block mb-0.5">
            Total Invitees
          </span>
          <span className="text-lg font-bold text-brand-black">{summary.total}</span>
        </div>

        <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200">
          <span className="text-[10px] uppercase font-semibold text-emerald-800 block mb-0.5">
            Access Issued
          </span>
          <span className="text-lg font-bold text-emerald-900">{summary.accessIssued}</span>
        </div>

        <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200">
          <span className="text-[10px] uppercase font-semibold text-amber-800 block mb-0.5">
            Pending Access
          </span>
          <span className="text-lg font-bold text-amber-900">{summary.invited}</span>
        </div>

        <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-200">
          <span className="text-[10px] uppercase font-semibold text-rose-800 block mb-0.5">
            Cancelled
          </span>
          <span className="text-lg font-bold text-rose-900">{summary.cancelled}</span>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Controls Bar: Search, Status Filter & Add Action */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
          <input
            id="invitee-search-input"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or company..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-brand-border focus:border-brand-black focus:ring-1 focus:ring-brand-black outline-hidden"
          />
        </div>

        {/* Filter & Add Actions */}
        <div className="flex items-center gap-2">
          <select
            id="invitee-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-xl border border-brand-border bg-white text-neutral-700 font-medium focus:border-brand-black outline-hidden cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value={InviteeStatus.INVITED}>Pending Access</option>
            <option value={InviteeStatus.ACCESS_ISSUED}>Access Issued</option>
            <option value={InviteeStatus.CANCELLED}>Cancelled</option>
          </select>

          {isApproved && (
            <button
              id="open-add-invitee-btn"
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Invitee</span>
            </button>
          )}
        </div>
      </div>

      {/* Invitee List */}
      <div className="border border-brand-border rounded-xl overflow-hidden divide-y divide-brand-border bg-white">
        {loading ? (
          <div className="p-8 text-center text-xs text-neutral-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
            <span>Loading invitees...</span>
          </div>
        ) : invitees.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 space-y-2">
            <Users className="w-8 h-8 text-neutral-300 mx-auto" />
            <p className="text-xs font-medium">No invitees found</p>
            <p className="text-[11px] text-neutral-400">
              {search || statusFilter !== 'ALL'
                ? 'Try adjusting your search query or filter.'
                : isApproved
                ? 'Add guests or delegates to generate individual QR access cards.'
                : 'Invitees can be added after event approval.'}
            </p>
          </div>
        ) : (
          invitees.map((invitee) => {
            const isProcessing = processingId === invitee.id;
            const isCancelled = invitee.status === InviteeStatus.CANCELLED;
            const hasPass = !!invitee.accessPassId && !!invitee.accessPass;

            return (
              <div
                key={invitee.id}
                className="p-3.5 hover:bg-neutral-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                {/* Invitee Info */}
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-brand-black">{invitee.fullName}</span>
                    {invitee.organization && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 font-medium">
                        {invitee.organization}
                      </span>
                    )}

                    {/* Status Pill */}
                    {invitee.status === InviteeStatus.ACCESS_ISSUED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Access Issued
                      </span>
                    )}
                    {invitee.status === InviteeStatus.INVITED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                        Pending Access
                      </span>
                    )}
                    {invitee.status === InviteeStatus.CANCELLED && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                        Cancelled
                      </span>
                    )}
                  </div>

                  {/* Contact row */}
                  <div className="flex items-center gap-3 text-[11px] text-neutral-500 flex-wrap">
                    {invitee.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3 text-neutral-400" /> {invitee.email}
                      </span>
                    )}
                    {invitee.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-neutral-400" /> {invitee.phone}
                      </span>
                    )}
                    {invitee.accessPass && (
                      <span className="flex items-center gap-1 font-mono text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                        <Ticket className="w-3 h-3 text-amber-600" />
                        Code: {invitee.accessPass.displayCode}
                      </span>
                    )}
                  </div>
                </div>

                {/* Row Action Controls */}
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  {/* Action: Generate Access */}
                  {invitee.status === InviteeStatus.INVITED && isApproved && (
                    <button
                      id={`generate-access-btn-${invitee.id}`}
                      onClick={() => handleGenerateAccess(invitee)}
                      disabled={isProcessing}
                      className="px-2.5 py-1 text-xs font-semibold bg-neutral-900 text-brand-yellow hover:bg-neutral-800 rounded-lg transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      title="Issue QR Access Card"
                    >
                      {isProcessing ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Ticket className="w-3 h-3" />
                      )}
                      <span>Generate Access</span>
                    </button>
                  )}

                  {/* Action: View Card (if access issued) */}
                  {hasPass && (
                    <button
                      id={`view-card-btn-${invitee.id}`}
                      onClick={() => handleViewCard(invitee)}
                      className="px-2.5 py-1 text-xs font-semibold bg-white border border-brand-border text-brand-black hover:bg-neutral-100 rounded-lg transition cursor-pointer flex items-center gap-1 shadow-xs"
                      title="View Access Pass"
                    >
                      <Eye className="w-3 h-3 text-neutral-600" />
                      <span>Access Card</span>
                    </button>
                  )}

                  {/* Action: Revoke Access (if pass is active) */}
                  {hasPass && invitee.accessPass?.status === 'ACTIVE' && (
                    <button
                      id={`revoke-access-btn-${invitee.id}`}
                      onClick={() => handleRevokeAccess(invitee.id)}
                      disabled={isProcessing}
                      className="p-1 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                      title="Revoke Access Pass"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Action: Cancel Invitee */}
                  {!isCancelled && (
                    <button
                      id={`cancel-invitee-btn-${invitee.id}`}
                      onClick={() => handleCancelInvitee(invitee)}
                      disabled={isProcessing}
                      className="p-1 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                      title="Cancel Invitee"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Invitee Modal */}
      <AddInviteeModal
        isOpen={showAddModal}
        event={event}
        onClose={() => setShowAddModal(false)}
        onSuccess={(newInvitee, generatedPass) => {
          setShowAddModal(false);
          fetchInvitees();
          if (generatedPass) {
            setViewingCardInvitee(newInvitee);
            setViewingPass(generatedPass);
          }
        }}
      />

      {/* Invitee Access Card Display Modal */}
      <InviteeAccessCardModal
        isOpen={!!viewingCardInvitee && !!viewingPass}
        event={event}
        invitee={viewingCardInvitee}
        pass={viewingPass}
        onClose={() => {
          setViewingCardInvitee(null);
          setViewingPass(null);
        }}
        onRevoke={(inviteeId) => handleRevokeAccess(inviteeId)}
      />
    </div>
  );
};
