import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  MapPin,
  User,
  Building,
  CheckCircle,
  Copy,
  Printer,
  ShieldCheck,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { EventRecord, EventInviteeRecord, AccessPassRecord, AccessPassStatus } from '../../types/index.ts';
import { generateQrDataUrl, buildVerificationUrl } from '../../utils/qr.ts';

interface InviteeAccessCardModalProps {
  isOpen: boolean;
  event: EventRecord | null;
  invitee: EventInviteeRecord | null;
  pass: AccessPassRecord | null;
  onClose: () => void;
  onRevoke?: (inviteeId: string) => void;
}

export const InviteeAccessCardModal: React.FC<InviteeAccessCardModalProps> = ({
  isOpen,
  event,
  invitee,
  pass,
  onClose,
  onRevoke,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (!isOpen || !pass) {
      setQrDataUrl(null);
      return;
    }

    // Build opaque verification URL strictly without personal data
    const verifyUrl = buildVerificationUrl({
      token: pass.rawToken,
      code: pass.displayCode,
    });

    generateQrDataUrl(verifyUrl)
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR:', err));
  }, [isOpen, pass]);

  if (!isOpen || !event || !invitee || !pass) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(pass.displayCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const isRevoked = pass.status === AccessPassStatus.REVOKED;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-xs z-70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-brand-border max-w-md w-full shadow-2xl overflow-hidden my-6 print:m-0 print:border-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-brand-border flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-sm text-brand-black">Official Event Access Pass</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-brand-muted hover:text-brand-black hover:bg-neutral-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Pass Card Body */}
        <div className="p-6 space-y-5 bg-gradient-to-b from-neutral-50 to-white">
          {/* Status Badge & Header */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono tracking-wider uppercase font-semibold text-neutral-500">
              Pass ID: {pass.id.slice(0, 8)}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                isRevoked
                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              }`}
            >
              {isRevoked ? 'REVOKED' : 'ACCESS ACTIVE'}
            </span>
          </div>

          {/* Event & Invitee Title Header */}
          <div className="border-b border-neutral-200 pb-4">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-amber-600 block mb-0.5">
              Event Invitation
            </span>
            <h2 className="text-lg font-extrabold text-brand-black leading-tight">
              {event.title}
            </h2>
            <div className="mt-2.5 flex items-center gap-2 text-neutral-800">
              <User className="w-4 h-4 text-neutral-500 shrink-0" />
              <span className="font-bold text-sm">{invitee.fullName}</span>
              {invitee.organization && (
                <span className="text-xs text-neutral-500 font-medium">
                  ({invitee.organization})
                </span>
              )}
            </div>
          </div>

          {/* QR Code Presentation */}
          <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-neutral-200 shadow-xs">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Secure Access QR Code"
                className="w-44 h-44 object-contain"
              />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center bg-neutral-100 text-neutral-400 text-xs rounded-lg">
                Generating QR...
              </div>
            )}

            {/* Human Readable Display Code */}
            <div className="mt-3 text-center">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold block mb-1">
                Access Code
              </span>
              <div className="flex items-center gap-2">
                <span
                  id="invitee-pass-display-code"
                  className="font-mono text-base font-extrabold tracking-wider px-3 py-1 bg-amber-50 text-amber-950 border border-amber-300 rounded-lg select-all"
                >
                  {pass.displayCode}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="p-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-100 text-neutral-600 transition cursor-pointer print:hidden"
                  title="Copy Access Code"
                >
                  {copiedCode ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Event Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[10px] text-neutral-500 font-semibold flex items-center gap-1 mb-0.5">
                <MapPin className="w-3 h-3 text-amber-500" /> Location
              </span>
              <span className="font-semibold text-neutral-800 block truncate">
                {event.location}
              </span>
            </div>

            <div className="p-3 bg-white rounded-xl border border-neutral-200">
              <span className="text-[10px] text-neutral-500 font-semibold flex items-center gap-1 mb-0.5">
                <Clock className="w-3 h-3 text-amber-500" /> Single Use
              </span>
              <span className="font-semibold text-neutral-800 block">
                {pass.useCount} / {pass.maxUses || 1} Used
              </span>
            </div>

            <div className="p-3 bg-white rounded-xl border border-neutral-200 sm:col-span-2">
              <span className="text-[10px] text-neutral-500 font-semibold flex items-center gap-1 mb-0.5">
                <Calendar className="w-3 h-3 text-amber-500" /> Authorized Schedule
              </span>
              <div className="space-y-0.5 font-mono text-[11px] text-neutral-800">
                <div>Start: {event.formattedStart || event.startAt}</div>
                <div>End: {event.formattedEnd || event.endAt}</div>
              </div>
            </div>
          </div>

          {/* Security Note */}
          <div className="p-3 bg-neutral-100 rounded-xl text-[11px] text-neutral-600 leading-relaxed border border-neutral-200">
            <span className="font-semibold text-neutral-800 block mb-0.5">
              Checkpoint Security Instructions:
            </span>
            Present this QR code or the 12-character access code upon arrival at the security entrance. Access is valid strictly during event hours.
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 px-6 border-t border-brand-border bg-white flex items-center justify-between gap-2 print:hidden">
          <div>
            {!isRevoked && onRevoke && (
              <button
                onClick={() => {
                  if (confirm(`Revoke access pass for ${invitee.fullName}?`)) {
                    onRevoke(invitee.id);
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-lg transition cursor-pointer"
              >
                Revoke Pass
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold text-brand-black bg-white hover:bg-neutral-100 border border-neutral-300 rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Pass</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 rounded-lg transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
