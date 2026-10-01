import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Users,
  UserPlus,
  Search,
  Filter,
  RefreshCw,
  Ticket,
  Mail,
  Phone,
  Building2,
  CalendarDays,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Ban,
  QrCode,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';
import {
  EventRecord,
  EventInviteeRecord,
  EventInviteesSummary,
  InviteeStatus,
  AccessPassStatus,
} from '../../types/index.ts';
import { InviteeBadge } from './InviteeBadge.tsx';
import { AddInviteeModal } from './AddInviteeModal.tsx';
import { InviteeAccessPassModal } from './InviteeAccessPassModal.tsx';

interface EventInviteesModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  onClose: () => void;
}

export const EventInviteesModal: React.FC<EventInviteesModalProps> = ({
  isOpen,
  event,
  onClose,
}) => {
  const [invitees, setInvitees] = useState<EventInviteeRecord[]>([]);
  const [summary, setSummary] = useState<EventInviteesSummary>({
    total: 0,
    invited: 0,
    accessIssued: 0,
    checkedIn: 0,
    checkedOut: 0,
    cancelled: 0,
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Sub-modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedInviteeForPass, setSelectedInviteeForPass] = useState<EventInviteeRecord | null>(null);
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);

  const fetchInvitees = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/events/${event.id}/invitees?${params.toString()}`);
      const json = await res.json();

      if (res.ok && json.success && json.data) {
        setInvitees(json.data.invitees || []);
        if (json.data.summary) {
          setSummary(json.data.summary);
        }
      } else {
        throw new Error(json.message || 'Failed to load invitees.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading event invitees.');
    } finally {
      setLoading(false);
    }
  }, [event, statusFilter, search]);

  useEffect(() => {
    if (isOpen && event) {
      fetchInvitees();
    }
  }, [isOpen, event, fetchInvitees]);

  if (!isOpen || !event) return null;

  // Handle generating a pass for an existing invitee
  const handleGeneratePass = async (invitee: EventInviteeRecord) => {
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/events/${event.id}/invitees/${invitee.id}/pass`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to generate access pass.');
      }

      setFeedback(`Access pass generated for ${invitee.fullName}!`);
      // Update local invitee with new pass details (including rawToken for immediate QR)
      const updatedInvitee: EventInviteeRecord = {
        ...json.data.invitee,
        rawToken: json.data.pass?.rawToken,
        displayCode: json.data.pass?.displayCode,
        passStatus: json.data.pass?.status,
      };

      setSelectedInviteeForPass(updatedInvitee);
      setIsPassModalOpen(true);
      fetchInvitees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating pass.');
    }
  };

  // Handle revoking a pass
  const handleRevokePass = async (inviteeId: string, reason: string) => {
    const res = await fetch(`/api/events/${event.id}/invitees/${inviteeId}/revoke-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Failed to revoke access pass.');
    }

    setFeedback('Access pass revoked successfully.');
    setIsPassModalOpen(false);
    fetchInvitees();
  };

  // Handle cancelling an invitee
  const handleCancelInvitee = async (invitee: EventInviteeRecord) => {
    if (!confirm(`Are you sure you want to cancel invitee "${invitee.fullName}"? Any active access pass will be revoked.`)) {
      return;
    }

    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/events/${event.id}/invitees/${invitee.id}/cancel`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to cancel invitee.');
      }

      setFeedback(`Invitee "${invitee.fullName}" cancelled.`);
      fetchInvitees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cancelling invitee.');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-4xl w-full shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-brand-border flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-yellow/20 text-brand-black flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-brand-yellow" />
                <span>Event Invitees &amp; Access</span>
              </span>
              <span className="text-[11px] font-mono text-brand-muted">ID: {event.id.slice(0, 8)}</span>
            </div>
            <h2 className="text-xl font-bold text-brand-black">{event.title}</h2>
            <div className="flex items-center gap-4 text-xs text-brand-muted mt-1">
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-brand-yellow" />
                <span>{event.location}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-brand-yellow" />
                <span>{event.formattedStart || event.startAt}</span>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notices */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {feedback && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {/* Summary Metrics Banner */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-brand-bg border border-brand-border">
              <span className="text-[11px] font-medium text-brand-muted block">Total Invitees</span>
              <span className="text-xl font-bold text-brand-black">{summary.total}</span>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <span className="text-[11px] font-medium text-emerald-700 block">Passes Issued</span>
              <span className="text-xl font-bold text-emerald-900">{summary.accessIssued}</span>
            </div>
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200">
              <span className="text-[11px] font-medium text-blue-700 block">Checked In</span>
              <span className="text-xl font-bold text-blue-900">{summary.checkedIn}</span>
            </div>
            <div className="p-3 rounded-xl bg-neutral-100/70 border border-neutral-200">
              <span className="text-[11px] font-medium text-neutral-600 block">Pending Pass</span>
              <span className="text-xl font-bold text-neutral-800">{summary.invited}</span>
            </div>
          </div>
        </div>

        {/* Action & Filter Toolbar */}
        <div className="p-6 pb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, org, code..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-brand-muted" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-xl border border-brand-border bg-white text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-yellow cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value={InviteeStatus.INVITED}>Invited</option>
                <option value={InviteeStatus.ACCESS_ISSUED}>Pass Issued</option>
                <option value={InviteeStatus.CHECKED_IN}>Checked In</option>
                <option value={InviteeStatus.CANCELLED}>Cancelled</option>
              </select>
            </div>

            <button
              onClick={() => fetchInvitees()}
              disabled={loading}
              className="p-2 rounded-xl border border-brand-border text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
              title="Refresh list"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Add Invitee Button */}
          <button
            id="add-invitee-btn"
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black transition shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Invitee</span>
          </button>
        </div>

        {/* Invitees Table View */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="border border-brand-border rounded-xl overflow-hidden bg-white shadow-xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50/80 border-b border-brand-border text-brand-muted font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Invitee Details</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Access Pass</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {invitees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-brand-muted">
                      {loading ? (
                        <div className="flex items-center justify-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-brand-yellow" />
                          <span>Loading invitees...</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <Users className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
                          <p className="font-semibold text-brand-black">No invitees found</p>
                          <p className="text-[11px] text-brand-muted">
                            Add invitees to this event to issue secure QR access passes.
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  invitees.map((inv) => {
                    const hasPass = !!inv.accessPassId;
                    const isCancelled = inv.status === InviteeStatus.CANCELLED;

                    return (
                      <tr key={inv.id} className="hover:bg-neutral-50/50 transition">
                        {/* Name & Org */}
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-brand-black">{inv.fullName}</div>
                          {inv.organization ? (
                            <div className="text-[11px] text-brand-muted flex items-center gap-1 mt-0.5">
                              <Building2 className="w-3 h-3 text-brand-yellow" />
                              <span>{inv.organization}</span>
                            </div>
                          ) : (
                            <div className="text-[11px] text-neutral-400">Independent Guest</div>
                          )}
                          {inv.notes && (
                            <div className="text-[10px] text-neutral-500 italic mt-0.5 line-clamp-1">
                              Note: {inv.notes}
                            </div>
                          )}
                        </td>

                        {/* Contact */}
                        <td className="px-4 py-3.5 space-y-0.5 text-[11px]">
                          {inv.email && (
                            <div className="text-brand-black flex items-center gap-1">
                              <Mail className="w-3 h-3 text-neutral-400" />
                              <span className="truncate max-w-[150px]">{inv.email}</span>
                            </div>
                          )}
                          {inv.phone && (
                            <div className="text-brand-muted flex items-center gap-1">
                              <Phone className="w-3 h-3 text-neutral-400" />
                              <span>{inv.phone}</span>
                            </div>
                          )}
                          {!inv.email && !inv.phone && (
                            <span className="text-neutral-400">--</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5">
                          <InviteeBadge status={inv.status} />
                        </td>

                        {/* Access Pass Info */}
                        <td className="px-4 py-3.5">
                          {hasPass && inv.displayCode ? (
                            <div className="space-y-0.5">
                              <span className="font-mono font-bold text-xs text-brand-black bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200">
                                {inv.displayCode}
                              </span>
                              <div className="text-[10px] text-brand-muted mt-0.5">
                                Uses: {inv.passUseCount || 0}/{inv.passMaxUses || 1}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-neutral-400 italic">No pass issued</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {/* If no pass issued yet and not cancelled: Issue Pass */}
                            {!hasPass && !isCancelled && (
                              <button
                                onClick={() => handleGeneratePass(inv)}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black transition cursor-pointer flex items-center gap-1"
                                title="Issue individual access pass"
                              >
                                <Ticket className="w-3 h-3" />
                                <span>Issue Pass</span>
                              </button>
                            )}

                            {/* If pass exists: View QR */}
                            {hasPass && (
                              <button
                                onClick={() => {
                                  setSelectedInviteeForPass(inv);
                                  setIsPassModalOpen(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-brand-yellow transition cursor-pointer flex items-center gap-1"
                                title="View pass & QR code"
                              >
                                <QrCode className="w-3 h-3" />
                                <span>QR Pass</span>
                              </button>
                            )}

                            {/* Cancel Invitee Button */}
                            {!isCancelled && (
                              <button
                                onClick={() => handleCancelInvitee(inv)}
                                className="p-1 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                title="Cancel Invitee"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-brand-border bg-neutral-50/50 flex items-center justify-between">
          <span className="text-xs text-brand-muted">
            Showing {invitees.length} {invitees.length === 1 ? 'invitee' : 'invitees'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:text-brand-black transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Sub-Modal: Add Invitee */}
      {isAddModalOpen && (
        <AddInviteeModal
          isOpen={isAddModalOpen}
          event={event}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={(data) => {
            setFeedback(`Invitee "${data.invitee?.fullName}" added successfully.`);
            fetchInvitees();
            if (data.pass) {
              const invWithPass = {
                ...data.invitee,
                rawToken: data.pass.rawToken,
                displayCode: data.pass.displayCode,
                passStatus: data.pass.status,
              };
              setSelectedInviteeForPass(invWithPass);
              setIsPassModalOpen(true);
            }
          }}
        />
      )}

      {/* Sub-Modal: Invitee QR & Pass */}
      {isPassModalOpen && selectedInviteeForPass && (
        <InviteeAccessPassModal
          isOpen={isPassModalOpen}
          event={event}
          invitee={selectedInviteeForPass}
          onClose={() => setIsPassModalOpen(false)}
          onRevoke={handleRevokePass}
        />
      )}
    </div>
  );
};
