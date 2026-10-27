import React, { useState } from 'react';
import { FeedPostItem, FeedReactionType } from './types.ts';
import { UserRole } from '../../types/index.ts';
import { FeedReactionsBar } from './FeedReactionsBar.tsx';
import { FeedCommentThread } from './FeedCommentThread.tsx';
import { Trash2, AlertCircle } from 'lucide-react';

interface FeedPostCardProps {
  post: FeedPostItem;
  currentUserId: string;
  currentUserRole: UserRole;
  onPostDeleted: (postId: string) => void;
  onPostUpdated: (updatedPost: FeedPostItem) => void;
  onError?: (msg: string) => void;
}

function formatPostDate(isoString: string): string {
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
    if (diffDays === 1) {
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Yesterday at ${timeStr}`;
    }
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return 'Recently';
  }
}

export const FeedPostCard: React.FC<FeedPostCardProps> = ({
  post,
  currentUserId,
  currentUserRole,
  onPostDeleted,
  onPostUpdated,
  onError,
}) => {
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const canDelete =
    post.author.id === currentUserId ||
    currentUserRole === UserRole.ADMIN ||
    currentUserRole === UserRole.SUPER_ADMIN;

  const handleDeletePost = async () => {
    setIsDeleting(true);
    setCardError(null);
    try {
      const res = await fetch(`/api/feed/posts/${encodeURIComponent(post.id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        if (res.status === 401) {
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }
        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to delete post.';
        setCardError(errorMsg);
        return;
      }

      onPostDeleted(post.id);
    } catch {
      setCardError('Network error while deleting post.');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleReactionChange = (
    newReactionType: FeedReactionType | null,
    newReactions: Record<FeedReactionType, number>,
    newTotal: number
  ) => {
    const updated: FeedPostItem = {
      ...post,
      currentUserReaction: newReactionType,
      stats: {
        ...post.stats,
        reactions: newReactions,
        reactionsCount: newTotal,
      },
    };
    onPostUpdated(updated);
  };

  const handleCommentAdded = () => {
    const updated: FeedPostItem = {
      ...post,
      stats: {
        ...post.stats,
        commentsCount: (post.stats.commentsCount || 0) + 1,
      },
    };
    onPostUpdated(updated);
  };

  const handleCommentDeleted = () => {
    const updated: FeedPostItem = {
      ...post,
      stats: {
        ...post.stats,
        commentsCount: Math.max(0, (post.stats.commentsCount || 0) - 1),
      },
    };
    onPostUpdated(updated);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
            Super Admin
          </span>
        );
      case UserRole.ADMIN:
        return (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300">
            Admin
          </span>
        );
      default:
        return (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 border border-neutral-200">
            Staff
          </span>
        );
    }
  };

  const getInitials = (author: FeedPostItem['author']) => {
    const f = author.firstName ? author.firstName[0].toUpperCase() : '';
    const l = author.lastName ? author.lastName[0].toUpperCase() : '';
    return `${f}${l}` || 'U';
  };

  return (
    <article className="bg-white rounded-xl border border-neutral-200 shadow-xs p-4 sm:p-5 transition-shadow hover:shadow-sm space-y-3">
      {/* Post Author Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Avatar with brand colors */}
          <div className="w-10 h-10 rounded-full bg-brand-black text-brand-yellow font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
            {getInitials(post.author)}
          </div>

          <div>
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-sm font-bold text-neutral-900">
                {post.author.firstName} {post.author.lastName}
              </span>
              {getRoleBadge(post.author.role)}
              {post.author.department && (
                <span className="text-xs text-neutral-500 font-medium">
                  • {post.author.department}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {formatPostDate(post.createdAt)}
            </p>
          </div>
        </div>

        {/* Delete post action if permitted */}
        {canDelete && (
          <div className="relative">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 p-1.5 rounded-lg">
                <span className="text-xs text-rose-700 font-medium">Delete post?</span>
                <button
                  type="button"
                  onClick={handleDeletePost}
                  disabled={isDeleting}
                  className="px-2 py-0.5 text-xs font-semibold bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                >
                  {isDeleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2 py-0.5 text-xs font-medium bg-neutral-200 text-neutral-700 rounded hover:bg-neutral-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete this announcement"
                aria-label="Delete this announcement"
                className="p-1.5 text-neutral-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Card error banner if deletion failed */}
      {cardError && (
        <div className="flex items-center gap-1.5 p-2 bg-rose-50 border border-rose-200 rounded-md text-rose-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{cardError}</span>
        </div>
      )}

      {/* Post Content - Safe plain text rendering, strictly NO dangerouslySetInnerHTML */}
      <div className="text-neutral-800 text-sm whitespace-pre-wrap break-words leading-relaxed pt-1">
        {post.content}
      </div>

      {/* Reactions Bar */}
      <FeedReactionsBar
        postId={post.id}
        reactions={post.stats.reactions}
        totalReactions={post.stats.reactionsCount}
        currentUserReaction={post.currentUserReaction}
        onReactionChange={handleReactionChange}
        onError={onError}
      />

      {/* Comment Thread (collapsible) */}
      <FeedCommentThread
        postId={post.id}
        commentCount={post.stats.commentsCount || 0}
        isOpen={isCommentsOpen}
        onToggleOpen={() => setIsCommentsOpen(!isCommentsOpen)}
        onCommentAdded={handleCommentAdded}
        onCommentDeleted={handleCommentDeleted}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        onError={onError}
      />
    </article>
  );
};
