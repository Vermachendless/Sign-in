import React from 'react';
import { EventStatus } from '../../types/index.ts';
import {
  FileEdit,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  CalendarCheck,
} from 'lucide-react';

interface EventBadgeProps {
  status: EventStatus | string;
  size?: 'sm' | 'md';
}

export const EventBadge: React.FC<EventBadgeProps> = ({ status, size = 'md' }) => {
  const padClass = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';
  const iconClass = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  switch (status) {
    case EventStatus.DRAFT:
      return (
        <span
          id="event-status-badge-draft"
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-neutral-100 text-neutral-800 border border-neutral-300 ${padClass}`}
        >
          <FileEdit className={`${iconClass} text-neutral-600`} />
          <span>Draft</span>
        </span>
      );

    case EventStatus.PENDING_APPROVAL:
      return (
        <span
          id="event-status-badge-pending"
          className={`inline-flex items-center gap-1.5 font-bold rounded-full bg-amber-100 text-amber-900 border border-amber-300 shadow-xs ${padClass}`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <Clock className={`${iconClass} text-amber-700`} />
          <span>Pending Approval</span>
        </span>
      );

    case EventStatus.APPROVED:
      return (
        <span
          id="event-status-badge-approved"
          className={`inline-flex items-center gap-1.5 font-bold rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-xs ${padClass}`}
        >
          <CheckCircle2 className={`${iconClass} text-emerald-600`} />
          <span>Approved</span>
        </span>
      );

    case EventStatus.REJECTED:
      return (
        <span
          id="event-status-badge-rejected"
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-rose-100 text-rose-900 border border-rose-300 ${padClass}`}
        >
          <XCircle className={`${iconClass} text-rose-600`} />
          <span>Rejected</span>
        </span>
      );

    case EventStatus.CANCELLED:
      return (
        <span
          id="event-status-badge-cancelled"
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-neutral-200 text-neutral-700 border border-neutral-400 ${padClass}`}
        >
          <Ban className={`${iconClass} text-neutral-500`} />
          <span>Cancelled</span>
        </span>
      );

    case EventStatus.COMPLETED:
      return (
        <span
          id="event-status-badge-completed"
          className={`inline-flex items-center gap-1.5 font-semibold rounded-full bg-blue-100 text-blue-900 border border-blue-300 ${padClass}`}
        >
          <CalendarCheck className={`${iconClass} text-blue-600`} />
          <span>Completed</span>
        </span>
      );

    default:
      return (
        <span className={`inline-flex items-center gap-1 font-semibold rounded-full bg-neutral-100 text-neutral-800 ${padClass}`}>
          {status}
        </span>
      );
  }
};
