import React, { useState } from 'react';
import {
  X,
  CalendarDays,
  MapPin,
  Clock,
  User,
  ShieldCheck,
  AlertTriangle,
  Send,
  RotateCcw,
  Edit,
  Ban,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Ticket,
} from 'lucide-react';
import { EventRecord, EventStatus, UserRole } from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { EventBadge } from './EventBadge.tsx';

interface EventDetailsModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  onClose: () => void;
  onEdit: (event: EventRecord) => void;
  onOpenApproval: (event: EventRecord, mode: 'APPROVE' | 'REJECT') => void;
  onRefresh: () => void;
  onManagePasses?: (event: EventRecord) => void;
}

export const EventDetailsModal: React.FC<EventDetailsModalProps> = ({
  isOpen,
  event,
  onClose,
  onEdit,
  onOpenApproval,
  onRefresh,
  onManagePasses,
}) => {
  const { user } = useAuth();
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen || !event || !user) return null;

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;
  const isCreator = event.createdBy === user.id;
  const canManage = isCreator || isSuperAdmin;

  // Submit draft for approval
  const handleSubmitForApproval = async () => {
    setActionLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/events/${event.id}/submit`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to submit event.');
      }
      setFeedback('Event submitted for Super Admin approval successfully.');
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error submitting event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Withdraw pending event back to draft
  const handleWithdrawToDraft = async () => {
    setActionLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/events/${event.id}/withdraw`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to withdraw event.');
      }
      setFeedback('Event withdrawn back to Draft status.');
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error withdrawing event.');
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel event
  const handleCancelEvent = async () => {
    if (!confirm(`Are you sure you want to cancel event "${event.title}"?`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/events/${event.id}/cancel`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to cancel event.');
      }
      setFeedback('Event has been cancelled.');
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error cancelling event.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-xl w-full shadow-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-brand-border flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <EventBadge status={event.status} size="md" />
              <span className="text-[11px] font-mono text-brand-muted">ID: {event.id.slice(0, 8)}</span>
            </div>
            <h2 className="text-xl font-bold text-brand-black">{event.title}</h2>
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

        {/* Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Rejection Banner */}
          {event.status === EventStatus.REJECTED && event.rejectionReason && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
              <span className="font-bold flex items-center gap-1.5 text-xs">
                <XCircle className="w-4 h-4 text-rose-600" /> Rejection Notice
              </span>
              <p className="text-xs text-rose-800 italic">
                &ldquo;{event.rejectionReason}&rdquo;
              </p>
              {event.approvedAt && (
                <p className="text-[10px] text-rose-600">
                  Reviewed on: {event.approvedAt}
                </p>
              )}
            </div>
          )}

          {/* Pending Approval Notice for Admin */}
          {event.status === EventStatus.PENDING_APPROVAL && !isSuperAdmin && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Awaiting Super Admin Approval</span>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  This event is currently locked under root governance review. You can withdraw the event to make edits if needed.
                </p>
              </div>
            </div>
          )}

          {/* Schedule & Location Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
              <span className="text-brand-muted font-medium text-[11px] flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 text-brand-yellow" /> Location
              </span>
              <span className="font-semibold text-brand-black text-sm block">
                {event.location}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
              <span className="text-brand-muted font-medium text-[11px] flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5 text-brand-yellow" /> Company Timezone
              </span>
              <span className="font-semibold text-brand-black text-sm block">
                Africa/Lagos (GMT+1)
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border sm:col-span-2">
              <span className="text-brand-muted font-medium text-[11px] flex items-center gap-1.5 mb-1">
                <CalendarDays className="w-3.5 h-3.5 text-brand-yellow" /> Event Schedule
              </span>
              <div className="space-y-0.5">
                <div className="font-mono text-xs text-brand-black">
                  <strong>Start:</strong> {event.formattedStart || event.startAt}
                </div>
                <div className="font-mono text-xs text-brand-black">
                  <strong>End:</strong> {event.formattedEnd || event.endAt}
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {event.description && (
            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border">
              <span className="text-brand-muted font-medium text-[11px] block mb-1">
                Event Description &amp; Notes
              </span>
              <p className="text-xs text-brand-black whitespace-pre-line leading-relaxed">
                {event.description}
              </p>
            </div>
          )}

          {/* Ownership & Approval Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-brand-border">
            <div>
              <span className="text-brand-muted block text-[11px]">Created By</span>
              <span className="font-semibold text-brand-black">
                {event.creatorName || event.creatorEmail}
              </span>
              <span className="text-[10px] text-brand-muted block mt-0.5">
                {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : '--'}
              </span>
            </div>

            {event.approvedBy && (
              <div>
                <span className="text-brand-muted block text-[11px]">
                  {event.status === EventStatus.REJECTED ? 'Reviewed By' : 'Approved By'}
                </span>
                <span className="font-semibold text-brand-black">
                  {event.approverName || event.approverEmail}
                </span>
                {event.approvedAt && (
                  <span className="text-[10px] text-brand-muted block mt-0.5">
                    {new Date(event.approvedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Controls Footer */}
        <div className="p-6 border-t border-brand-border bg-neutral-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {event.status !== EventStatus.CANCELLED &&
              event.status !== EventStatus.COMPLETED &&
              canManage && (
                <button
                  id="event-detail-cancel-btn"
                  onClick={handleCancelEvent}
                  disabled={actionLoading}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel Event
                </button>
              )}
          </div>

          <div className="flex items-center gap-2">
            {/* DRAFT Actions */}
            {event.status === EventStatus.DRAFT && (
              <>
                {canManage && (
                  <button
                    id="event-detail-edit-btn"
                    onClick={() => {
                      onClose();
                      onEdit(event);
                    }}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-brand-black bg-white hover:bg-neutral-100 border border-brand-border transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                )}

                {canManage && (
                  <button
                    id="event-detail-submit-btn"
                    onClick={handleSubmitForApproval}
                    disabled={actionLoading}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Submit for Approval</span>
                  </button>
                )}
              </>
            )}

            {/* PENDING_APPROVAL Actions */}
            {event.status === EventStatus.PENDING_APPROVAL && (
              <>
                {/* Creator can withdraw */}
                {canManage && !isSuperAdmin && (
                  <button
                    id="event-detail-withdraw-btn"
                    onClick={handleWithdrawToDraft}
                    disabled={actionLoading}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-brand-black bg-white hover:bg-neutral-100 border border-brand-border transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>Withdraw to Draft</span>
                  </button>
                )}

                {/* Super Admin can approve / reject */}
                {isSuperAdmin && (
                  <>
                    <button
                      id="event-detail-reject-btn"
                      onClick={() => onOpenApproval(event, 'REJECT')}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      id="event-detail-approve-btn"
                      onClick={() => onOpenApproval(event, 'APPROVE')}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                  </>
                )}
              </>
            )}

            {/* APPROVED Actions */}
            {event.status === EventStatus.APPROVED && onManagePasses && (
              <button
                id="event-detail-access-passes-btn"
                onClick={() => {
                  onClose();
                  onManagePasses(event);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-neutral-900 text-brand-yellow hover:bg-neutral-800 transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <Ticket className="w-3.5 h-3.5" />
                <span>Access Passes &amp; QR</span>
              </button>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:text-brand-black transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
