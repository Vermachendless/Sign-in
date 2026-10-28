import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { NotificationRecord, NotificationType, NotificationListResponse } from '../../types/index.ts';
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
  UserCheck,
  X,
  RefreshCw,
  Inbox,
  Loader2,
} from 'lucide-react';

/**
 * Format ISO date string into human-friendly relative time
 */
function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 45) return 'Just now';
    if (diffSecs < 3600) {
      const mins = Math.max(1, Math.floor(diffSecs / 60));
      return `${mins}m ago`;
    }
    if (diffSecs < 86400) {
      const hours = Math.floor(diffSecs / 3600);
      return `${hours}h ago`;
    }
    if (diffSecs < 604800) {
      const days = Math.floor(diffSecs / 86400);
      return `${days}d ago`;
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return 'Recently';
  }
}

/**
 * Render appropriate iconography based on notification type
 */
const NotificationTypeIcon: React.FC<{ type: NotificationType | string }> = ({ type }) => {
  switch (type) {
    case NotificationType.VISITOR_CHECKED_IN:
      return (
        <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 shrink-0">
          <UserCheck className="w-4 h-4" />
        </div>
      );
    case NotificationType.EVENT_APPROVED:
      return (
        <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
      );
    case NotificationType.EVENT_REJECTED:
      return (
        <div className="p-2 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-700 shrink-0">
          <AlertCircle className="w-4 h-4" />
        </div>
      );
    case NotificationType.EVENT_SUBMITTED:
      return (
        <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-200/70 text-indigo-700 shrink-0">
          <Calendar className="w-4 h-4" />
        </div>
      );
    case NotificationType.ATTENDANCE_OVERRIDE:
      return (
        <div className="p-2 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-700 shrink-0">
          <Clock className="w-4 h-4" />
        </div>
      );
    case NotificationType.ANNOUNCEMENT:
      return (
        <div className="p-2 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-700 shrink-0">
          <BellRing className="w-4 h-4" />
        </div>
      );
    case NotificationType.SYSTEM:
    default:
      return (
        <div className="p-2 rounded-xl bg-neutral-100 border border-neutral-200/80 text-neutral-700 shrink-0">
          <Bell className="w-4 h-4" />
        </div>
      );
  }
};

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'ALL' | 'UNREAD'>('ALL');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Fetch unread notification count
   */
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && typeof json.data?.unreadCount === 'number') {
          setUnreadCount(json.data.unreadCount);
        }
      }
    } catch (err) {
      // Non-fatal background refresh failure
      console.warn('[NotificationBell] Failed to refresh unread count:', err);
    }
  }, [user]);

  /**
   * Fetch notification list
   */
  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setIsLoadingList(true);
    setListError(null);
    try {
      const res = await fetch('/api/notifications?page=1&limit=25', {
        headers: { Accept: 'application/json' },
      });
      const json = await res.json();

      if (res.ok && json.success && json.data) {
        const data = json.data as NotificationListResponse;
        setNotifications(data.notifications || []);
        if (typeof data.unreadCount === 'number') {
          setUnreadCount(data.unreadCount);
        }
      } else {
        setListError(json.message || 'Unable to load notifications.');
      }
    } catch (err) {
      console.error('[NotificationBell] fetchNotifications error:', err);
      setListError('Network error loading notifications. Please retry.');
    } finally {
      setIsLoadingList(false);
    }
  }, [user]);

  /**
   * 60-second polling for unread count & window focus refresh
   * Cleans up on unmount or when user becomes unauthenticated.
   */
  useEffect(() => {
    if (!user) {
      // Clear all state when logged out
      setUnreadCount(0);
      setNotifications([]);
      setIsOpen(false);
      return;
    }

    // Initial unread fetch
    fetchUnreadCount();

    // 60-second periodic poll
    const intervalId = setInterval(() => {
      fetchUnreadCount();
    }, 60000);

    // Immediate refresh on window focus
    const handleFocus = () => {
      fetchUnreadCount();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, fetchUnreadCount]);

  /**
   * Handle dropdown open / close
   */
  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      fetchNotifications();
      fetchUnreadCount();
    } else {
      setIsOpen(false);
    }
  };

  /**
   * Close on outside click
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerButtonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  /**
   * Mark individual notification as read
   */
  const handleMarkAsRead = async (notificationId: string) => {
    if (!user || markingIds.has(notificationId)) return;

    setMarkingIds((prev) => new Set(prev).add(notificationId));

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      const json = await res.json();

      if (res.ok && json.success && json.data?.notification) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? json.data.notification : n))
        );
      } else {
        // Revert on unexpected failure
        console.warn('[NotificationBell] Mark as read failed:', json);
        fetchNotifications();
        fetchUnreadCount();
      }
    } catch (err) {
      console.error('[NotificationBell] handleMarkAsRead network error:', err);
      fetchNotifications();
      fetchUnreadCount();
    } finally {
      setMarkingIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }
  };

  /**
   * Mark all notifications as read
   */
  const handleMarkAllAsRead = async () => {
    if (!user || isMarkingAll || unreadCount === 0) return;

    setIsMarkingAll(true);

    // Optimistic update
    const previousNotifications = [...notifications];
    const previousUnread = unreadCount;
    const nowIso = new Date().toISOString();

    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        isRead: true,
        readAt: n.readAt || nowIso,
      }))
    );
    setUnreadCount(0);

    try {
      const res = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        // Revert on failure
        console.warn('[NotificationBell] Mark all as read failed:', json);
        setNotifications(previousNotifications);
        setUnreadCount(previousUnread);
      }
    } catch (err) {
      console.error('[NotificationBell] handleMarkAllAsRead network error:', err);
      setNotifications(previousNotifications);
      setUnreadCount(previousUnread);
    } finally {
      setIsMarkingAll(false);
    }
  };

  if (!user) return null;

  const displayCount = unreadCount > 99 ? '99+' : unreadCount.toString();
  const filteredNotifications =
    activeTab === 'UNREAD' ? notifications.filter((n) => !n.isRead) : notifications;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Trigger Button */}
      <button
        ref={triggerButtonRef}
        id="notification-bell-btn"
        type="button"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        className={`relative p-2 sm:px-2.5 sm:py-2 rounded-xl transition-all cursor-pointer shrink-0 flex items-center justify-center focus:outline-hidden focus:ring-2 focus:ring-neutral-900 ${
          isOpen
            ? 'bg-neutral-200 text-neutral-950 border border-neutral-300 ring-2 ring-neutral-900/10'
            : 'bg-neutral-100 hover:bg-neutral-200/80 text-neutral-700 hover:text-neutral-950 border border-neutral-200'
        }`}
      >
        {unreadCount > 0 ? (
          <BellRing className="w-4 h-4 text-[#F5C400]" />
        ) : (
          <Bell className="w-4 h-4 text-[#F5C400]" />
        )}

        {/* Compact Unread Badge */}
        {unreadCount > 0 && (
          <span
            id="notification-unread-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white font-bold text-[10px] rounded-full flex items-center justify-center border-2 border-white shadow-xs leading-none"
          >
            {displayCount}
          </span>
        )}
      </button>

      {/* Accessible Dropdown Popover */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
          className="absolute right-0 top-full mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-[24rem] bg-white rounded-2xl shadow-2xl border border-neutral-200 z-50 overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[32rem] animate-in fade-in-0 duration-150"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50/80 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-bold text-sm text-neutral-900 tracking-tight">Notifications</h2>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                  {unreadCount} unread
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  disabled={isMarkingAll}
                  className="px-2 py-1 rounded-lg text-xs font-semibold text-neutral-700 hover:text-neutral-950 hover:bg-neutral-200/80 transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                  title="Mark all notifications as read"
                >
                  {isMarkingAll ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5 text-neutral-600" />
                  )}
                  <span className="text-[11px]">Mark all read</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerButtonRef.current?.focus();
                }}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 transition cursor-pointer"
                aria-label="Close notification panel"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="px-4 pt-2.5 pb-2 border-b border-neutral-100 bg-white flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('ALL')}
                className={`px-2.5 py-1 rounded-lg font-semibold text-xs transition cursor-pointer ${
                  activeTab === 'ALL'
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100'
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('UNREAD')}
                className={`px-2.5 py-1 rounded-lg font-semibold text-xs transition cursor-pointer ${
                  activeTab === 'UNREAD'
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100'
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                fetchNotifications();
                fetchUnreadCount();
              }}
              disabled={isLoadingList}
              className="p-1.5 text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition cursor-pointer"
              title="Refresh notifications"
              aria-label="Refresh notifications"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 overscroll-contain">
            {isLoadingList && notifications.length === 0 ? (
              <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-6 h-6 animate-spin text-neutral-400 mb-2" />
                <p className="text-xs text-neutral-500 font-medium">Loading notifications...</p>
              </div>
            ) : listError ? (
              <div className="py-8 px-4 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-8 h-8 text-rose-500 mb-2" />
                <p className="text-xs font-semibold text-neutral-900 mb-1">Failed to load</p>
                <p className="text-[11px] text-neutral-500 mb-3 max-w-xs">{listError}</p>
                <button
                  type="button"
                  onClick={fetchNotifications}
                  className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold transition cursor-pointer"
                >
                  Try Again
                </button>
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
                <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-400 mb-2.5">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-neutral-800 mb-0.5">
                  {activeTab === 'UNREAD' ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-[11px] text-neutral-500 max-w-[220px]">
                  {activeTab === 'UNREAD'
                    ? "You're all caught up! Check back later."
                    : 'System alerts, visitor check-ins, and event updates will appear here.'}
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => {
                const isMarkingThis = markingIds.has(notification.id);

                return (
                  <div
                    key={notification.id}
                    className={`p-3.5 transition-colors flex items-start gap-3 relative group ${
                      !notification.isRead
                        ? 'bg-amber-50/40 hover:bg-amber-50/70'
                        : 'bg-white hover:bg-neutral-50/80'
                    }`}
                  >
                    {/* Unread indicator dot */}
                    {!notification.isRead && (
                      <span
                        className="absolute left-1.5 top-5 w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"
                        title="Unread"
                      />
                    )}

                    {/* Type Icon */}
                    <NotificationTypeIcon type={notification.type} />

                    {/* Content Details */}
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-start justify-between gap-1.5">
                        <h3
                          className={`text-xs leading-snug break-words ${
                            !notification.isRead ? 'font-bold text-neutral-950' : 'font-medium text-neutral-800'
                          }`}
                        >
                          {notification.title}
                        </h3>

                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => handleMarkAsRead(notification.id)}
                            disabled={isMarkingThis}
                            className="shrink-0 p-1 rounded-md text-neutral-400 hover:text-neutral-950 hover:bg-neutral-200/60 transition cursor-pointer"
                            title="Mark as read"
                            aria-label={`Mark "${notification.title}" as read`}
                          >
                            {isMarkingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed break-words">
                        {notification.message}
                      </p>

                      <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3 text-neutral-400 shrink-0" />
                          <span title={new Date(notification.createdAt).toLocaleString()}>
                            {formatRelativeTime(notification.createdAt)}
                          </span>
                        </span>

                        {!notification.isRead ? (
                          <span className="font-semibold text-rose-600 text-[10px]">Unread</span>
                        ) : (
                          <span className="text-neutral-400 text-[10px]">Read</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 bg-neutral-50/60 border-t border-neutral-100 text-[10px] text-neutral-400 text-center shrink-0">
              Showing latest {notifications.length} notification{notifications.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
