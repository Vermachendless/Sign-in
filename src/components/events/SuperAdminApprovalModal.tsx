import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  X,
  CalendarDays,
  MapPin,
  Clock,
} from 'lucide-react';
import { EventRecord } from '../../types/index.ts';

interface SuperAdminApprovalModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  mode: 'APPROVE' | 'REJECT';
  onClose: () => void;
  onSuccess: (updatedEvent: EventRecord) => void;
}

export const SuperAdminApprovalModal: React.FC<SuperAdminApprovalModalProps> = ({
  isOpen,
  event,
  mode,
  onClose,
  onSuccess,
}) => {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !event) return null;

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'REJECT') {
      const trimmed = reason.trim();
      if (!trimmed || trimmed.length < 3) {
        setError('A rejection reason is required and must be at least 3 characters.');
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = mode === 'APPROVE' ? `/api/events/${event.id}/approve` : `/api/events/${event.id}/reject`;
      const body = mode === 'REJECT' ? JSON.stringify({ reason: reason.trim() }) : undefined;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || `Failed to ${mode.toLowerCase()} event.`);
      }

      onSuccess(json.data);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error executing governance decision.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-lg w-full shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                mode === 'APPROVE'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {mode === 'APPROVE' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-700" />
              )}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-brand-black">
                {mode === 'APPROVE' ? 'Approve Event for Access' : 'Reject Event Proposal'}
              </h2>
              <p className="text-xs text-brand-muted">
                Super Admin Root Governance • Authoritative Decision
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content & Form */}
        <form onSubmit={handleAction} className="p-6 space-y-4 text-xs">
          {/* Event Context Card */}
          <div className="p-4 rounded-xl bg-brand-bg border border-brand-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-brand-black text-sm">{event.title}</span>
              <span className="text-[11px] font-semibold text-brand-muted">
                By: {event.creatorName || event.creatorEmail}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-neutral-600 text-xs">
              <MapPin className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
              <span>{event.location}</span>
            </div>

            <div className="flex items-center gap-1.5 text-neutral-600 text-xs font-mono">
              <Clock className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
              <span>
                {event.formattedStart || event.startAt} &rarr; {event.formattedEnd || event.endAt}
              </span>
            </div>
          </div>

          {mode === 'APPROVE' ? (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Confirm Event Approval
              </p>
              <p className="text-[11px] text-emerald-800 leading-relaxed">
                By approving, this event transitions to <strong>APPROVED</strong> status and becomes active for employee access and calendar management.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="rejection-reason-input" className="block font-semibold text-brand-black">
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="rejection-reason-input"
                rows={3}
                required
                placeholder="Explain why this event cannot be approved (e.g. Venue double-booked, schedule conflicts, requires clarification)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-white text-brand-black text-xs focus:outline-hidden focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
              <p className="text-[11px] text-brand-muted">
                The reason will be permanently recorded in the event history and audit logs.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-3 border-t border-brand-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-brand-black hover:bg-neutral-100 transition cursor-pointer"
            >
              Cancel
            </button>

            {mode === 'APPROVE' ? (
              <button
                id="confirm-approve-event-btn"
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>{loading ? 'Approving...' : 'Confirm Approval'}</span>
              </button>
            ) : (
              <button
                id="confirm-reject-event-btn"
                type="submit"
                disabled={loading || !reason.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <span>{loading ? 'Rejecting...' : 'Reject Event'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
