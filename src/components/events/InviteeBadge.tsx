import React from 'react';
import { InviteeStatus } from '../../types/index.ts';
import { Mail, ShieldCheck, CheckCircle2, LogOut, Ban } from 'lucide-react';

interface InviteeBadgeProps {
  status: InviteeStatus | string;
  size?: 'sm' | 'md';
}

export const InviteeBadge: React.FC<InviteeBadgeProps> = ({ status, size = 'sm' }) => {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'text-[11px] px-2 py-0.5 gap-1' : 'text-xs px-2.5 py-1 gap-1.5';
  const iconSize = isSm ? 'w-3 h-3' : 'w-3.5 h-3.5';

  switch (status) {
    case InviteeStatus.INVITED:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-sky-50 text-sky-700 border border-sky-200 ${sizeClasses}`}
        >
          <Mail className={iconSize} />
          <span>Invited</span>
        </span>
      );

    case InviteeStatus.ACCESS_ISSUED:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 ${sizeClasses}`}
        >
          <ShieldCheck className={iconSize} />
          <span>Pass Issued</span>
        </span>
      );

    case InviteeStatus.CHECKED_IN:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-green-50 text-green-700 border border-green-200 ${sizeClasses}`}
        >
          <CheckCircle2 className={iconSize} />
          <span>Checked In</span>
        </span>
      );

    case InviteeStatus.CHECKED_OUT:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-purple-50 text-purple-700 border border-purple-200 ${sizeClasses}`}
        >
          <LogOut className={iconSize} />
          <span>Checked Out</span>
        </span>
      );

    case InviteeStatus.CANCELLED:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200 line-through decoration-neutral-400 ${sizeClasses}`}
        >
          <Ban className={iconSize} />
          <span>Cancelled</span>
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center font-medium rounded-full bg-neutral-100 text-neutral-700 border border-neutral-200 ${sizeClasses}`}
        >
          <span>{status}</span>
        </span>
      );
  }
};
