import React, { useState, useEffect } from 'react';
import {
  X,
  Ticket,
  Copy,
  Check,
  Ban,
  Clock,
  CalendarDays,
  MapPin,
  User,
  ShieldCheck,
  AlertTriangle,
  QrCode,
  Building2,
} from 'lucide-react';
import { EventInviteeRecord, EventRecord, AccessPassStatus } from '../../types/index.ts';
import { generateQrDataUrl, buildVerificationUrl } from '../../utils/qr.ts';

interface InviteeAccessPassModalProps {
  isOpen: boolean;
  event: EventRecord;
  invitee: EventInviteeRecord | null;
  onClose: () => void;
  onRevoke: (inviteeId: string, reason: string) => Promise<void>;
}

export const InviteeAccessPassModal: React.FC<InviteeAccessPassModalProps> = ({
  isOpen,
  event,
  invitee,
  onClose,
  onRevoke,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !invitee) {
      setQrDataUrl(null);
      setIsRevoking(false);
      setRevokeReason('');
      setError(null);
      return;
    }

    const payload = invitee.rawToken
      ? buildVerificationUrl({ token: invitee.rawToken })
      : invitee.displayCode
      ? buildVerificationUrl({ code: invitee.displayCode })
      : null;

    if (payload) {
      generateQrDataUrl(payload)
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('Failed to generate QR:', err));
    }
  }, [isOpen, invitee]);

  if (!isOpen || !invitee) return null;

  const displayCode = invitee.displayCode || 'NO-PASS-ISSUED';
  const verificationUrl = invitee.rawToken
    ? buildVerificationUrl({ token: invitee.rawToken })
    : invitee.displayCode
    ? buildVerificationUrl({ code: invitee.displayCode })
    : '';

  const handleCopyCode = async () => {
    if (!displayCode) return;
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyLink = async () => {
    if (!verificationUrl) return;
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleRevokeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeReason.trim() || revokeReason.trim().length < 3) {
      setError('Please provide a revocation reason (at least 3 characters).');
      return;
    }

    setRevokeLoading(true);
    setError(null);
    try {
      await onRevoke(invitee.id, revokeReason.trim());
      setIsRevoking(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access pass.');
    } finally {
      setRevokeLoading(false);
    }
  };

  const isPassActive = invitee.passStatus === AccessPassStatus.ACTIVE || (!invitee.passStatus && invitee.accessPassId);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-xs z-70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-md w-full shadow-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-neutral-900 text-brand-yellow">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-brand-black">Invitee Access Credential</h3>
              <p className="text-xs text-brand-muted">{event.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Invitee Card */}
          <div className="p-4 rounded-xl bg-brand-bg border border-brand-border space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-bold text-sm text-brand-black block">{invitee.fullName}</span>
                {invitee.organization && (
                  <span className="text-brand-muted flex items-center gap-1 mt-0.5">
                    <Building2 className="w-3 h-3 text-brand-yellow" />
                    <span>{invitee.organization}</span>
                  </span>
                )}
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Single-Use Pass
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-brand-border text-[11px] text-brand-muted">
              <div>
                <span className="block font-medium text-brand-black">Location</span>
                <span className="truncate block">{event.location}</span>
              </div>
              <div>
                <span className="block font-medium text-brand-black">Valid Time</span>
                <span className="truncate block">Africa/Lagos (GMT+1)</span>
              </div>
            </div>
          </div>

          {/* QR Code Container */}
          <div className="p-5 rounded-2xl bg-neutral-900 border border-neutral-800 text-center flex flex-col items-center">
            {qrDataUrl ? (
              <div className="p-3 bg-white rounded-xl shadow-lg inline-block">
                <img src={qrDataUrl} alt="Access Pass QR Code" className="w-48 h-48 rounded" />
              </div>
            ) : (
              <div className="w-48 h-48 bg-neutral-800 rounded-xl flex items-center justify-center text-neutral-500">
                <QrCode className="w-12 h-12" />
              </div>
            )}

            <div className="mt-4 w-full">
              <span className="text-[11px] font-medium text-neutral-400 block mb-1">
                Human-Readable Access Code
              </span>
              <div className="flex items-center justify-center gap-2">
                <span className="font-mono text-lg font-bold tracking-wider text-brand-yellow bg-neutral-800/80 px-4 py-1.5 rounded-xl border border-neutral-700">
                  {displayCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition cursor-pointer"
                  title="Copy Access Code"
                >
                  {copiedCode ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {verificationUrl && (
              <div className="mt-3 w-full pt-3 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="w-full py-2 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Verification Link Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copy Verification Link</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Revoke Section */}
          {isPassActive && !isRevoking && (
            <div className="pt-2 flex justify-between items-center">
              <span className="text-neutral-500 text-[11px]">Pass is currently active</span>
              <button
                type="button"
                onClick={() => setIsRevoking(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-700 hover:bg-rose-50 border border-rose-200 transition cursor-pointer flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Revoke Pass</span>
              </button>
            </div>
          )}

          {isRevoking && (
            <form onSubmit={handleRevokeSubmit} className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200 space-y-3">
              <div className="flex items-center gap-1.5 text-rose-900 font-semibold">
                <Ban className="w-4 h-4 text-rose-600" />
                <span>Confirm Pass Revocation</span>
              </div>
              <p className="text-[11px] text-rose-800">
                Please provide an audit justification for revoking {invitee.fullName}&apos;s access pass.
              </p>
              <textarea
                required
                rows={2}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Reason for revocation (e.g. Invitee cancelled attendance)..."
                className="w-full px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-brand-black text-xs focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRevoking(false)}
                  disabled={revokeLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-600 hover:text-brand-black cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={revokeLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer disabled:opacity-50"
                >
                  {revokeLoading ? 'Revoking...' : 'Confirm Revoke'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="p-4 border-t border-brand-border bg-neutral-50/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:text-brand-black transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
