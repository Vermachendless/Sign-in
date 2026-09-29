import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Plus,
  RefreshCw,
  QrCode,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Ticket,
} from 'lucide-react';
import { AccessPassRecord, EventRecord, AccessPassStatus } from '../../types/index.ts';
import { AccessPassCard } from './AccessPassCard.tsx';

interface EventAccessPassModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  onClose: () => void;
}

export const EventAccessPassModal: React.FC<EventAccessPassModalProps> = ({
  isOpen,
  event,
  onClose,
}) => {
  const [passes, setPasses] = useState<AccessPassRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Creation form state
  const [maxUsesOption, setMaxUsesOption] = useState<'1' | '5' | '10' | 'unlimited'>('1');
  const [newlyCreatedPass, setNewlyCreatedPass] = useState<AccessPassRecord | null>(null);

  // Revocation state
  const [revokingPassId, setRevokingPassId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const fetchPasses = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/access-passes`);
      const json = await res.json();
      if (res.ok && json.success) {
        setPasses(json.data.passes || []);
      }
    } catch {
      setError('Failed to load event access passes.');
    } finally {
      setLoading(false);
    }
  }, [event]);

  useEffect(() => {
    if (isOpen && event) {
      setNewlyCreatedPass(null);
      fetchPasses();
    }
  }, [isOpen, event, fetchPasses]);

  if (!isOpen || !event) return null;

  const handleGeneratePass = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);

    const maxUses = maxUsesOption === 'unlimited' ? null : parseInt(maxUsesOption, 10);

    try {
      const res = await fetch(`/api/events/${event.id}/access-passes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxUses,
          validFrom: event.startAt,
          validUntil: event.endAt,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to generate access pass.');
      }

      setNewlyCreatedPass(json.data);
      setSuccessMsg(`Access Pass ${json.data.displayCode} generated successfully.`);
      fetchPasses();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating pass.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingPassId) return;

    if (!revokeReason.trim() || revokeReason.trim().length < 3) {
      setError('Revocation reason must be at least 3 characters.');
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/passes/${revokingPassId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: revokeReason.trim() }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to revoke access pass.');
      }

      setSuccessMsg('Access pass has been revoked.');
      setRevokingPassId(null);
      setRevokeReason('');
      fetchPasses();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error revoking pass.');
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
        className="bg-white rounded-2xl border border-brand-border max-w-3xl w-full shadow-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-neutral-900 text-brand-yellow flex items-center justify-center font-bold">
              <Ticket className="w-5 h-5 text-brand-yellow" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-brand-black">Event Access Pass Management</h2>
              <p className="text-xs text-brand-muted truncate max-w-md">
                Event: <strong className="text-brand-black">{event.title}</strong> &bull; {event.location}
              </p>
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

        {successMsg && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="p-6 space-y-6 text-xs max-h-[75vh] overflow-y-auto">
          {/* Section 1: Generate New Pass Bar */}
          <div className="p-4 rounded-xl bg-brand-bg border border-brand-border">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-brand-black text-sm flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-brand-yellow" /> Generate Access Pass
              </span>
              <span className="text-[11px] text-brand-muted">
                Pre-configured to event schedule window
              </span>
            </div>

            <form onSubmit={handleGeneratePass} className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 w-full flex items-center gap-2">
                <label className="text-xs font-semibold text-brand-black whitespace-nowrap">
                  Allowed Uses:
                </label>
                <select
                  value={maxUsesOption}
                  onChange={(e) => setMaxUsesOption(e.target.value as any)}
                  className="px-3 py-2 bg-white border border-brand-border rounded-xl text-xs font-semibold text-brand-black cursor-pointer"
                >
                  <option value="1">Single Use (1 check-in)</option>
                  <option value="5">Up to 5 Uses</option>
                  <option value="10">Up to 10 Uses</option>
                  <option value="unlimited">Unlimited Uses</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full sm:w-auto px-4 py-2 bg-brand-yellow hover:bg-brand-yellow-hover text-brand-black font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {actionLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-brand-black" />
                ) : (
                  <QrCode className="w-4 h-4 text-brand-black" />
                )}
                <span>Generate Pass</span>
              </button>
            </form>
          </div>

          {/* Section 2: Newly Created Pass Showcase */}
          {newlyCreatedPass && (
            <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-300">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Newly Issued Pass &amp; QR
                </span>
                <span className="text-[10px] text-emerald-800">
                  Save or print before closing
                </span>
              </div>
              <div className="max-w-md mx-auto">
                <AccessPassCard
                  pass={newlyCreatedPass}
                  canRevoke={true}
                  onRevoke={(id) => setRevokingPassId(id)}
                />
              </div>
            </div>
          )}

          {/* Section 3: Revocation Dialog if triggered */}
          {revokingPassId && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-900 text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" /> Revoke Access Pass
                </span>
                <button
                  type="button"
                  onClick={() => setRevokingPassId(null)}
                  className="text-rose-600 hover:text-rose-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmRevoke} className="space-y-2">
                <label className="block text-[11px] font-semibold text-rose-900">
                  Reason for Revocation *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lost badge, security flag, attendee cancelled..."
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-rose-200 rounded-lg text-xs text-brand-black focus:outline-hidden focus:ring-2 focus:ring-rose-500"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setRevokingPassId(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading || !revokeReason.trim()}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                  >
                    Confirm Revoke
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Section 4: All Issued Passes for this Event */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-brand-black text-sm">
                Issued Access Passes ({passes.length})
              </span>
              <button
                type="button"
                onClick={fetchPasses}
                disabled={loading}
                className="text-[11px] text-brand-muted hover:text-brand-black flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {loading && passes.length === 0 ? (
              <div className="py-8 text-center text-xs text-brand-muted">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-brand-yellow" />
                Loading access passes...
              </div>
            ) : passes.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-muted">
                No access passes have been generated for this event yet. Use the generator above to create one.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {passes.map((pass) => (
                  <AccessPassCard
                    key={pass.id}
                    pass={pass}
                    canRevoke={pass.status === AccessPassStatus.ACTIVE}
                    onRevoke={(id) => setRevokingPassId(id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-brand-border bg-neutral-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
