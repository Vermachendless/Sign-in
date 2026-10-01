import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { EventRecord, EventStatus, UserRole } from '../types/index.ts';
import {
  CalendarDays,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  FileEdit,
  Eye,
  Send,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  Ticket,
  Users,
} from 'lucide-react';
import { EventBadge } from './events/EventBadge.tsx';
import { CreateEventModal } from './events/CreateEventModal.tsx';
import { EventDetailsModal } from './events/EventDetailsModal.tsx';
import { SuperAdminApprovalModal } from './events/SuperAdminApprovalModal.tsx';
import { EventAccessPassModal } from './access/EventAccessPassModal.tsx';
import { EventInviteesModal } from './events/EventInviteesModal.tsx';

export const EventsManagement: React.FC = () => {
  const { user } = useAuth();

  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);
  const [viewingEvent, setViewingEvent] = useState<EventRecord | null>(null);
  const [passModalEvent, setPassModalEvent] = useState<EventRecord | null>(null);
  const [inviteesModalEvent, setInviteesModalEvent] = useState<EventRecord | null>(null);
  const [approvalModalState, setApprovalModalState] = useState<{
    isOpen: boolean;
    event: EventRecord | null;
    mode: 'APPROVE' | 'REJECT';
  }>({
    isOpen: false,
    event: null,
    mode: 'APPROVE',
  });

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  if (!user) return null;

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
  const isAdmin = user.role === UserRole.ADMIN;
  const canCreate = isSuperAdmin || isAdmin;

  // Fetch events from API
  const fetchEvents = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', targetPage.toString());
      params.set('limit', '15');
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      if (search.trim()) {
        params.set('search', search.trim());
      }

      const res = await fetch(`/api/events?${params.toString()}`);
      const json = await res.json();

      if (res.ok && json.success && json.data) {
        setEvents(json.data.events || []);
        setTotal(json.data.total || 0);
        setPage(json.data.page || 1);
        setTotalPages(json.data.totalPages || 1);
      }
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchEvents(page);
  }, [fetchEvents, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchEvents(1);
  };

  // Quick submit from table row
  const handleQuickSubmit = async (event: EventRecord) => {
    try {
      const res = await fetch(`/api/events/${event.id}/submit`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        setActionFeedback(`Event "${event.title}" submitted for approval.`);
        fetchEvents(page);
      } else {
        alert(json.message || 'Failed to submit event.');
      }
    } catch (err) {
      console.error('Quick submit error:', err);
    }
  };

  // Compute counts for metrics
  const pendingCount = events.filter((e) => e.status === EventStatus.PENDING_APPROVAL).length;
  const approvedCount = events.filter((e) => e.status === EventStatus.APPROVED).length;
  const draftCount = events.filter((e) => e.status === EventStatus.DRAFT).length;

  return (
    <div className="space-y-6" id="events-management-page">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-brand-border p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-neutral-900 text-brand-yellow mb-2 border border-brand-yellow/30">
              <CalendarDays className="w-3.5 h-3.5 text-brand-yellow" />
              Access &amp; Events • Phase 6B Event Governance
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-brand-black tracking-tight">
              Event Management &amp; Approvals
            </h1>
            <p className="mt-1 text-sm text-brand-muted max-w-2xl">
              {isSuperAdmin
                ? 'Review submitted corporate event proposals, evaluate venue schedules, and authorize executive approvals.'
                : 'Create and submit events for executive approval, monitor review status, and prepare event schedules.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <button
              id="refresh-events-btn"
              onClick={() => fetchEvents(page)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-brand-black bg-brand-bg hover:bg-neutral-200/80 border border-brand-border rounded-xl transition disabled:opacity-50 cursor-pointer"
              title="Refresh Event List"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {canCreate && (
              <button
                id="create-event-modal-trigger-btn"
                onClick={() => {
                  setEditingEvent(null);
                  setIsCreateModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-brand-black bg-brand-yellow hover:bg-brand-yellow-hover rounded-xl shadow-xs transition cursor-pointer"
              >
                <Plus className="w-4 h-4 text-brand-black" />
                <span>Create Event</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-brand-border shadow-xs">
          <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider block mb-1">
            Total In Scope
          </span>
          <div className="text-2xl font-bold font-mono text-brand-black">{total}</div>
          <span className="text-[11px] text-brand-muted mt-0.5 block">Managed events</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('PENDING_APPROVAL');
            setPage(1);
          }}
          className={`p-4 rounded-2xl border shadow-xs transition cursor-pointer ${
            statusFilter === 'PENDING_APPROVAL'
              ? 'bg-amber-100/60 border-amber-300'
              : 'bg-white border-brand-border hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-900 uppercase tracking-wider block mb-1">
              Pending Approval
            </span>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-900">{pendingCount}</div>
          <span className="text-[11px] text-amber-800 mt-0.5 block">
            {isSuperAdmin ? 'Requires your decision' : 'Under Super Admin review'}
          </span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('APPROVED');
            setPage(1);
          }}
          className={`p-4 rounded-2xl border shadow-xs transition cursor-pointer ${
            statusFilter === 'APPROVED'
              ? 'bg-emerald-50 border-emerald-300'
              : 'bg-white border-brand-border hover:border-emerald-300'
          }`}
        >
          <span className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wider block mb-1">
            Approved Active
          </span>
          <div className="text-2xl font-bold font-mono text-emerald-900">{approvedCount}</div>
          <span className="text-[11px] text-emerald-700 mt-0.5 block">Live authorized events</span>
        </div>

        <div
          onClick={() => {
            setStatusFilter('DRAFT');
            setPage(1);
          }}
          className={`p-4 rounded-2xl border shadow-xs transition cursor-pointer ${
            statusFilter === 'DRAFT'
              ? 'bg-neutral-100 border-neutral-400'
              : 'bg-white border-brand-border hover:border-neutral-400'
          }`}
        >
          <span className="text-[11px] font-semibold text-neutral-700 uppercase tracking-wider block mb-1">
            Draft Events
          </span>
          <div className="text-2xl font-bold font-mono text-brand-black">{draftCount}</div>
          <span className="text-[11px] text-neutral-500 mt-0.5 block">Awaiting submission</span>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionFeedback && (
        <div
          id="event-action-feedback"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{actionFeedback}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-emerald-700 hover:text-emerald-900 font-bold px-2 py-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-brand-border p-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-brand-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="search-events-input"
              type="text"
              placeholder="Search by event title, location, or agenda..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-brand-bg border border-brand-border rounded-xl text-brand-black focus:outline-hidden focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-brand-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="filter-events-status-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="pl-8 pr-8 py-2 text-xs bg-brand-bg border border-brand-border rounded-xl text-brand-black font-semibold focus:outline-hidden focus:ring-2 focus:ring-brand-yellow cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING_APPROVAL">Pending Approval</option>
                <option value="APPROVED">Approved</option>
                <option value="DRAFT">Draft</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="COMPLETED">Completed</option>
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

      {/* Events Table Container */}
      <div className="bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-brand-border flex items-center justify-between">
          <div className="text-xs font-bold text-brand-black">
            Corporate Events <span className="font-normal text-brand-muted">({total} events found)</span>
          </div>
          <div className="text-xs text-brand-muted">
            Page {page} of {totalPages}
          </div>
        </div>

        {loading && events.length === 0 ? (
          <div className="py-16 text-center text-xs text-brand-muted">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-yellow" />
            Loading events directory...
          </div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center text-xs text-brand-muted">
            <CalendarDays className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
            <p className="font-semibold text-brand-black text-sm">No Events Found</p>
            <p className="mt-1 text-brand-muted">
              {search || statusFilter !== 'ALL'
                ? 'No events match your current filter parameters.'
                : 'Create your first event proposal to begin the approval process.'}
            </p>
            {canCreate && !search && statusFilter === 'ALL' && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-brand-yellow text-brand-black hover:bg-brand-yellow-hover transition cursor-pointer shadow-xs inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Create Event Now</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table id="events-directory-table" className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg text-neutral-700 uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">Event Details</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4">Created By</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {events.map((ev) => {
                  const isCreator = ev.createdBy === user.id;

                  return (
                    <tr
                      key={ev.id}
                      className="hover:bg-amber-50/40 transition"
                      id={`event-row-${ev.id}`}
                    >
                      {/* Event Title & Description */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-brand-black text-sm">{ev.title}</div>
                        {ev.description ? (
                          <p className="text-[11px] text-brand-muted truncate max-w-xs mt-0.5">
                            {ev.description}
                          </p>
                        ) : (
                          <span className="text-[10px] text-neutral-400 italic">No description</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-neutral-700 font-medium">
                          <MapPin className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
                          <span>{ev.location}</span>
                        </div>
                      </td>

                      {/* Schedule */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-neutral-700">
                        <div>
                          <strong>Start:</strong> {ev.formattedStart || ev.startAt}
                        </div>
                        <div>
                          <strong>End:</strong> {ev.formattedEnd || ev.endAt}
                        </div>
                      </td>

                      {/* Creator */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-semibold text-brand-black">
                          {ev.creatorName || ev.creatorEmail}
                        </div>
                        <div className="text-[10px] text-brand-muted">{ev.creatorRole || 'Admin'}</div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <EventBadge status={ev.status} size="sm" />
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Super Admin Quick Approve / Reject for Pending Events */}
                          {isSuperAdmin && ev.status === EventStatus.PENDING_APPROVAL && (
                            <>
                              <button
                                id={`quick-approve-btn-${ev.id}`}
                                onClick={() =>
                                  setApprovalModalState({
                                    isOpen: true,
                                    event: ev,
                                    mode: 'APPROVE',
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer"
                                title="Approve Event"
                              >
                                Approve
                              </button>

                              <button
                                id={`quick-reject-btn-${ev.id}`}
                                onClick={() =>
                                  setApprovalModalState({
                                    isOpen: true,
                                    event: ev,
                                    mode: 'REJECT',
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer"
                                title="Reject Event"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {/* Quick Submit for Draft Events */}
                          {ev.status === EventStatus.DRAFT && (isCreator || isSuperAdmin) && (
                            <button
                              id={`quick-submit-btn-${ev.id}`}
                              onClick={() => handleQuickSubmit(ev)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black transition cursor-pointer shadow-2xs"
                              title="Submit for Approval"
                            >
                              Submit
                            </button>
                          )}

                          {/* Quick Access Passes button for Approved Events */}
                          {ev.status === EventStatus.APPROVED && canCreate && (
                            <button
                              id={`manage-passes-btn-${ev.id}`}
                              onClick={() => setPassModalEvent(ev)}
                              className="p-1.5 rounded-lg text-neutral-600 hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
                              title="Access Passes & QR"
                            >
                              <Ticket className="w-4 h-4 text-neutral-700" />
                            </button>
                          )}

                          {/* View Details */}
                          <button
                            id={`view-event-btn-${ev.id}`}
                            onClick={() => setViewingEvent(ev)}
                            className="p-1.5 rounded-lg text-neutral-600 hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
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

      {/* Modals */}
      <CreateEventModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingEvent(null);
        }}
        initialEvent={editingEvent}
        onSuccess={() => {
          fetchEvents(page);
          setActionFeedback('Event saved successfully.');
        }}
      />

      <EventDetailsModal
        isOpen={!!viewingEvent}
        event={viewingEvent}
        onClose={() => setViewingEvent(null)}
        onEdit={(eventToEdit) => {
          setViewingEvent(null);
          setEditingEvent(eventToEdit);
          setIsCreateModalOpen(true);
        }}
        onOpenApproval={(eventToApprove, mode) => {
          setViewingEvent(null);
          setApprovalModalState({
            isOpen: true,
            event: eventToApprove,
            mode,
          });
        }}
        onManagePasses={(eventForPasses) => {
          setViewingEvent(null);
          setPassModalEvent(eventForPasses);
        }}
        onRefresh={() => {
          fetchEvents(page);
          setViewingEvent(null);
        }}
      />

      <EventAccessPassModal
        isOpen={!!passModalEvent}
        event={passModalEvent}
        onClose={() => setPassModalEvent(null)}
      />

      <SuperAdminApprovalModal
        isOpen={approvalModalState.isOpen}
        event={approvalModalState.event}
        mode={approvalModalState.mode}
        onClose={() =>
          setApprovalModalState({
            isOpen: false,
            event: null,
            mode: 'APPROVE',
          })
        }
        onSuccess={(updated) => {
          fetchEvents(page);
          setActionFeedback(
            approvalModalState.mode === 'APPROVE'
              ? `Event "${updated.title}" approved successfully.`
              : `Event "${updated.title}" rejected.`
          );
        }}
      />
    </div>
  );
};
