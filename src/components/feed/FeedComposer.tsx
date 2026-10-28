import React, { useState, FormEvent } from 'react';
import { FeedPostItem, AnnouncementPriority } from './types.ts';
import { UserRole } from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { Megaphone, Send, Loader2, AlertCircle, Pin, ShieldCheck } from 'lucide-react';

interface FeedComposerProps {
  onPostCreated: (post: FeedPostItem) => void;
  onError?: (msg: string) => void;
  userRole?: UserRole;
}

const MAX_POST_LENGTH = 3000;

export const FeedComposer: React.FC<FeedComposerProps> = ({
  onPostCreated,
  onError,
  userRole,
}) => {
  let userRoleFromAuth: UserRole | undefined;
  try {
    const auth = useAuth();
    userRoleFromAuth = auth.user?.role;
  } catch {
    // Graceful fallback when rendered outside AuthProvider (such as isolated tests)
  }
  const effectiveRole = userRole || userRoleFromAuth;
  const isAdmin =
    effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.SUPER_ADMIN;

  const [draft, setDraft] = useState('');
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [priority, setPriority] = useState<AnnouncementPriority>('NORMAL');
  const [isPinned, setIsPinned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isSubmitting) return;

    if (trimmed.length > MAX_POST_LENGTH) {
      setSubmitError(`Post cannot exceed ${MAX_POST_LENGTH} characters.`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    // Build payload: only administrators submitting an announcement include privileged fields
    const payload: {
      content: string;
      isAnnouncement?: boolean;
      priority?: AnnouncementPriority;
      isPinned?: boolean;
    } = {
      content: trimmed,
    };

    if (isAdmin && isAnnouncement) {
      payload.isAnnouncement = true;
      payload.priority = priority;
      payload.isPinned = isPinned;
    }

    try {
      const res = await fetch('/api/feed/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setSubmitError('Authentication required. Your draft has been kept safe.');
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }

        const data = await res.json().catch(() => null);
        const errorMsg =
          data?.message || data?.error?.message || 'Failed to publish post.';
        setSubmitError(errorMsg);
        // DRAFT PRESERVATION: We do NOT clear draft or announcement options on error!
        return;
      }

      const json = await res.json();
      if (json.success && json.data?.post) {
        onPostCreated(json.data.post);
        setDraft(''); // Cleared only on successful creation
        setIsAnnouncement(false);
        setPriority('NORMAL');
        setIsPinned(false);
      }
    } catch {
      setSubmitError('Network failure. Your draft has been preserved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const charCount = draft.length;
  const isOverLimit = charCount > MAX_POST_LENGTH;
  const isNearLimit = charCount >= MAX_POST_LENGTH * 0.9;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 shadow-xs p-4 sm:p-5 transition-shadow">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-brand-yellow/20 text-brand-black flex items-center justify-center">
          <Megaphone className="w-4 h-4 text-neutral-900" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-neutral-900">
            {isAdmin && isAnnouncement
              ? 'Publish Official Announcement'
              : 'Post Update'}
          </h2>
          <p className="text-xs text-neutral-500">
            {isAdmin && isAnnouncement
              ? 'Broadcast an official company notice to all active staff'
              : 'Share news, updates, or alerts with colleagues'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {submitError && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span className="flex-1">{submitError}</span>
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              className="text-rose-500 hover:text-rose-700 font-semibold cursor-pointer text-[11px]"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isAdmin && isAnnouncement
                ? 'Compose official announcement (Important and Urgent will notify all staff)...'
                : "What's happening? Share an update or announcement with the team..."
            }
            rows={3}
            maxLength={MAX_POST_LENGTH}
            disabled={isSubmitting}
            className="w-full text-sm p-3 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-yellow/40 focus:border-brand-yellow bg-neutral-50/50 hover:bg-white focus:bg-white placeholder-neutral-400 resize-y min-h-[85px] transition-all"
          />
        </div>

        {/* Administrator-Only Announcement Controls */}
        {isAdmin && (
          <div className="p-3 bg-neutral-50/80 rounded-lg border border-neutral-200/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-neutral-800">
                <input
                  type="checkbox"
                  name="isAnnouncement"
                  checked={isAnnouncement}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsAnnouncement(checked);
                    if (!checked) {
                      setPriority('NORMAL');
                      setIsPinned(false);
                    }
                  }}
                  className="w-4 h-4 rounded border-neutral-300 text-brand-black focus:ring-brand-yellow/50 accent-amber-500 cursor-pointer"
                />
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                  Official Announcement
                </span>
              </label>

              {isAnnouncement && (
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-xs text-neutral-700 font-medium hover:text-neutral-900">
                  <input
                    type="checkbox"
                    name="isPinned"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-black focus:ring-brand-yellow/50 accent-amber-500 cursor-pointer"
                  />
                  <Pin className="w-3.5 h-3.5 text-amber-700" />
                  <span>Pin announcement to top</span>
                </label>
              )}
            </div>

            {isAnnouncement && (
              <div className="pt-2 border-t border-neutral-200/60 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-neutral-500 font-medium">Priority level:</span>
                <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 bg-white text-xs">
                  <button
                    type="button"
                    onClick={() => setPriority('NORMAL')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      priority === 'NORMAL'
                        ? 'bg-neutral-900 text-white shadow-2xs font-semibold'
                        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
                    }`}
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriority('IMPORTANT')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      priority === 'IMPORTANT'
                        ? 'bg-amber-600 text-white shadow-2xs font-semibold'
                        : 'text-neutral-600 hover:text-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    Important
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriority('URGENT')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      priority === 'URGENT'
                        ? 'bg-rose-600 text-white shadow-2xs font-semibold'
                        : 'text-neutral-600 hover:text-rose-800 hover:bg-rose-50'
                    }`}
                  >
                    Urgent
                  </button>
                </div>

                <span className="text-[11px] text-neutral-400 ml-1">
                  {priority === 'URGENT'
                    ? '• Mass notification with [URGENT] alert'
                    : priority === 'IMPORTANT'
                    ? '• In-app notification to all active staff'
                    : '• Silent in-feed broadcast'}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          {/* Character Counter */}
          <span
            className={`text-xs font-medium ${
              isOverLimit
                ? 'text-rose-600 font-bold'
                : isNearLimit
                ? 'text-amber-600'
                : 'text-neutral-400'
            }`}
          >
            {charCount.toLocaleString()} / {MAX_POST_LENGTH.toLocaleString()}
          </span>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !draft.trim() || isOverLimit}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-black hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin text-brand-yellow" />
            ) : (
              <Send className="w-3.5 h-3.5 text-brand-yellow" />
            )}
            <span>
              {isSubmitting
                ? 'Publishing...'
                : isAdmin && isAnnouncement
                ? 'Publish Announcement'
                : 'Publish'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
