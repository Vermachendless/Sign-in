import React, { useState, useEffect, useCallback, FormEvent } from 'react';
import { FeedCommentItem } from './types.ts';
import { UserRole } from '../../types/index.ts';
import { MessageSquare, Send, Trash2, AlertCircle, Loader2 } from 'lucide-react';

interface FeedCommentThreadProps {
  postId: string;
  commentCount: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onCommentAdded: () => void;
  onCommentDeleted: () => void;
  currentUserId: string;
  currentUserRole: UserRole;
  onError?: (msg: string) => void;
}

const MAX_COMMENT_LENGTH = 1000;

function formatCommentDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Recently';
  }
}

export const FeedCommentThread: React.FC<FeedCommentThreadProps> = ({
  postId,
  commentCount,
  isOpen,
  onToggleOpen,
  onCommentAdded,
  onCommentDeleted,
  currentUserId,
  currentUserRole,
  onError,
}) => {
  const [comments, setComments] = useState<FeedCommentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [composerDraft, setComposerDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    setIsLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/feed/posts/${encodeURIComponent(postId)}/comments?limit=50&offset=0`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 401) {
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }
        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to load comments.';
        setSubmitError(errorMsg);
        return;
      }

      const json = await res.json();
      if (json.success && json.data?.comments) {
        setComments(json.data.comments);
        setHasLoaded(true);
      }
    } catch {
      setSubmitError('Network error while loading comments.');
    } finally {
      setIsLoading(false);
    }
  }, [postId, onError]);

  useEffect(() => {
    if (isOpen && !hasLoaded && !isLoading) {
      fetchComments();
    }
  }, [isOpen, hasLoaded, isLoading, fetchComments]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = composerDraft.trim();
    if (!trimmed || isSubmitting) return;

    if (trimmed.length > MAX_COMMENT_LENGTH) {
      setSubmitError(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters.`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/feed/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setSubmitError('Authentication required. Your draft has been kept safe.');
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }

        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to submit comment.';
        setSubmitError(errorMsg);
        // DRAFT PRESERVATION: We do not clear composerDraft!
        return;
      }

      const json = await res.json();
      if (json.success && json.data?.comment) {
        setComments((prev) => [...prev, json.data.comment]);
        setComposerDraft(''); // Only clear on success
        onCommentAdded();
      }
    } catch {
      setSubmitError('Network failure. Your draft has been preserved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    setDeletingCommentId(commentId);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/feed/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 401) {
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }
        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to delete comment.';
        setSubmitError(errorMsg);
        return;
      }

      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setConfirmDeleteId(null);
      onCommentDeleted();
    } catch {
      setSubmitError('Network failure while deleting comment.');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
            Super Admin
          </span>
        );
      case UserRole.ADMIN:
        return (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
            Admin
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
            Staff
          </span>
        );
    }
  };

  const getInitials = (author: FeedCommentItem['author']) => {
    const f = author.firstName ? author.firstName[0].toUpperCase() : '';
    const l = author.lastName ? author.lastName[0].toUpperCase() : '';
    return `${f}${l}` || 'U';
  };

  const charCount = composerDraft.length;
  const isOverLimit = charCount > MAX_COMMENT_LENGTH;
  const isNearLimit = charCount >= MAX_COMMENT_LENGTH * 0.9;

  return (
    <div className="pt-3 border-t border-neutral-100">
      {/* Thread toggle header */}
      <button
        type="button"
        onClick={onToggleOpen}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 transition-colors py-1 cursor-pointer"
        aria-expanded={isOpen}
      >
        <MessageSquare className="w-3.5 h-3.5 text-neutral-500" />
        <span>
          {commentCount === 0
            ? 'Add a comment'
            : `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
        </span>
      </button>

      {/* Expanded comments section */}
      {isOpen && (
        <div className="mt-3 space-y-3 pl-2 sm:pl-4 border-l-2 border-neutral-200">
          {/* Comment list */}
          {isLoading && !hasLoaded ? (
            <div className="py-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span>Loading comments...</span>
            </div>
          ) : comments.length === 0 ? (
            <p className="text-xs text-neutral-400 italic py-1">
              No comments yet. Start the conversation!
            </p>
          ) : (
            <div className="space-y-2.5">
              {comments.map((comment) => {
                const canDelete =
                  comment.author.id === currentUserId ||
                  currentUserRole === UserRole.ADMIN ||
                  currentUserRole === UserRole.SUPER_ADMIN;
                const isDeleting = deletingCommentId === comment.id;
                const isConfirmingDelete = confirmDeleteId === comment.id;

                return (
                  <div
                    key={comment.id}
                    className="group bg-neutral-50/80 hover:bg-neutral-50 p-2.5 rounded-lg border border-neutral-200/80 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* Avatar */}
                        <div className="w-6 h-6 rounded-full bg-neutral-900 text-brand-yellow font-bold text-[10px] flex items-center justify-center shrink-0">
                          {getInitials(comment.author)}
                        </div>
                        {/* Author info */}
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span className="text-xs font-semibold text-neutral-900">
                            {comment.author.firstName} {comment.author.lastName}
                          </span>
                          {getRoleBadge(comment.author.role)}
                          {comment.author.department && (
                            <span className="text-[10px] text-neutral-400">
                              • {comment.author.department}
                            </span>
                          )}
                          <span className="text-[11px] text-neutral-400">
                            • {formatCommentDate(comment.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Delete action */}
                      {canDelete && (
                        <div>
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-rose-600 font-medium">Delete?</span>
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(comment.id)}
                                disabled={isDeleting}
                                className="px-1.5 py-0.5 text-[10px] font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50"
                              >
                                {isDeleting ? '...' : 'Yes'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-0.5 text-[10px] font-medium bg-neutral-200 text-neutral-700 rounded hover:bg-neutral-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(comment.id)}
                              title="Delete comment"
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-neutral-400 hover:text-rose-600 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Plain-text comment content - strictly no dangerouslySetInnerHTML */}
                    <p className="mt-1.5 text-xs text-neutral-800 whitespace-pre-wrap break-words leading-relaxed pl-8">
                      {comment.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Submission error alert */}
          {submitError && (
            <div className="flex items-center gap-1.5 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Comment composer */}
          <form onSubmit={handleSubmit} className="pt-2">
            <div className="relative">
              <textarea
                value={composerDraft}
                onChange={(e) => setComposerDraft(e.target.value)}
                placeholder="Write a comment..."
                rows={2}
                maxLength={MAX_COMMENT_LENGTH}
                disabled={isSubmitting}
                className="w-full text-xs p-2.5 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 bg-white placeholder-neutral-400 resize-y min-h-[50px] transition-all"
              />
            </div>

            <div className="flex items-center justify-between mt-1 px-0.5">
              <span
                className={`text-[11px] font-medium ${
                  isOverLimit
                    ? 'text-rose-600 font-bold'
                    : isNearLimit
                    ? 'text-amber-600'
                    : 'text-neutral-400'
                }`}
              >
                {charCount.toLocaleString()} / {MAX_COMMENT_LENGTH.toLocaleString()}
              </span>

              <button
                type="submit"
                disabled={isSubmitting || !composerDraft.trim() || isOverLimit}
                className="inline-flex items-center gap-1 px-3 py-1 bg-brand-black hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md transition-colors cursor-pointer"
              >
                {isSubmitting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3 text-brand-yellow" />
                )}
                <span>Reply</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
