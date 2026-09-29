import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Copy,
  Check,
  CalendarDays,
  MapPin,
  Clock,
  ShieldCheck,
  Ban,
  AlertTriangle,
  Printer,
} from 'lucide-react';
import { AccessPassRecord, AccessPassStatus } from '../../types/index.ts';
import { generateQrDataUrl, buildVerificationUrl } from '../../utils/qr.ts';

interface AccessPassCardProps {
  pass: AccessPassRecord;
  onRevoke?: (passId: string) => void;
  canRevoke?: boolean;
}

export const AccessPassCard: React.FC<AccessPassCardProps> = ({
  pass,
  onRevoke,
  canRevoke = false,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const dataToEncode = buildVerificationUrl({
      token: pass.rawToken,
      code: pass.displayCode,
    });

    generateQrDataUrl(dataToEncode)
      .then((url) => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate QR data URL:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [pass.rawToken, pass.displayCode]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(pass.displayCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = (status: AccessPassStatus) => {
    switch (status) {
      case AccessPassStatus.ACTIVE:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        );
      case AccessPassStatus.REVOKED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
            <Ban className="w-3 h-3 text-rose-600" />
            Revoked
          </span>
        );
      case AccessPassStatus.EXPIRED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Expired
          </span>
        );
      case AccessPassStatus.EXHAUSTED:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-neutral-200 text-neutral-800 border border-neutral-300">
            Exhausted
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="bg-white rounded-2xl border border-brand-border overflow-hidden shadow-xs text-brand-black flex flex-col justify-between"
      id={`access-pass-card-${pass.displayCode}`}
    >
      {/* Top Banner */}
      <div className="bg-neutral-900 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-yellow text-brand-black flex items-center justify-center font-bold text-xs">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-brand-yellow tracking-wider uppercase block">
              Corporate Access Pass
            </span>
            <span className="text-xs font-semibold text-neutral-200 block truncate max-w-[200px]">
              {pass.eventTitle || 'Event Access'}
            </span>
          </div>
        </div>

        {getStatusBadge(pass.status)}
      </div>

      {/* Middle: Code & QR */}
      <div className="p-5 flex flex-col items-center text-center space-y-4">
        {/* Display Code */}
        <div className="w-full bg-brand-bg rounded-xl p-3 border border-brand-border flex items-center justify-between">
          <div className="text-left">
            <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider block">
              Access Code
            </span>
            <span className="font-mono text-base font-extrabold tracking-widest text-brand-black select-all">
              {pass.displayCode}
            </span>
          </div>

          <button
            onClick={handleCopyCode}
            className="p-2 rounded-lg bg-white border border-brand-border hover:bg-neutral-100 transition cursor-pointer text-neutral-600 hover:text-brand-black"
            title="Copy Access Code"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* QR Code Container */}
        <div className="p-3 bg-white border border-neutral-200 rounded-xl shadow-xs inline-block">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR Code for ${pass.displayCode}`}
              className="w-40 h-40 object-contain mx-auto"
            />
          ) : (
            <div className="w-40 h-40 flex items-center justify-center text-neutral-400">
              <QrCode className="w-12 h-12 animate-pulse" />
            </div>
          )}
        </div>

        {/* Schedule & Venue Metadata */}
        <div className="w-full text-xs text-left space-y-2 border-t border-brand-border pt-3">
          {pass.eventLocation && (
            <div className="flex items-center gap-2 text-neutral-700">
              <MapPin className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
              <span className="truncate">{pass.eventLocation}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-neutral-700">
            <Clock className="w-3.5 h-3.5 text-brand-yellow shrink-0" />
            <span className="font-mono text-[11px] truncate">
              {pass.formattedValidFrom || pass.validFrom} &rarr; {pass.formattedValidUntil || pass.validUntil}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-brand-muted pt-1">
            <span>
              Usage: <strong className="text-brand-black">{pass.useCount}</strong>
              {pass.maxUses ? ` / ${pass.maxUses} uses` : ' (Unlimited)'}
            </span>
            {pass.creatorName && (
              <span>Issued by: {pass.creatorName}</span>
            )}
          </div>

          {pass.revokeReason && (
            <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
              <strong>Revoked:</strong> {pass.revokeReason}
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-3 border-t border-brand-border bg-neutral-50/60 flex items-center justify-between">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:text-brand-black rounded-lg hover:bg-neutral-100 transition cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print Pass</span>
        </button>

        {canRevoke && pass.status === AccessPassStatus.ACTIVE && onRevoke && (
          <button
            onClick={() => onRevoke(pass.id)}
            className="px-3 py-1.5 text-xs font-bold text-rose-700 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition cursor-pointer"
          >
            Revoke Pass
          </button>
        )}
      </div>
    </div>
  );
};
