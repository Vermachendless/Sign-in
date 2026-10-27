import React from 'react';
import { FeedPostItem } from './types.ts';
import { UserRole } from '../../types/index.ts';
import { FeedPostCard } from './FeedPostCard.tsx';
import { Megaphone, Loader2, ArrowDown } from 'lucide-react';

interface FeedPostListProps {
  posts: FeedPostItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onPostDeleted: (postId: string) => void;
  onPostUpdated: (updatedPost: FeedPostItem) => void;
  currentUserId: string;
  currentUserRole: UserRole;
  onError?: (msg: string) => void;
}

export const FeedPostList: React.FC<FeedPostListProps> = ({
  posts,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onPostDeleted,
  onPostUpdated,
  currentUserId,
  currentUserRole,
  onError,
}) => {
  if (isLoading && posts.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="bg-white rounded-xl border border-neutral-200 p-5 space-y-3 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-neutral-200" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 bg-neutral-200 rounded w-1/4" />
                <div className="h-3 bg-neutral-100 rounded w-1/6" />
              </div>
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-3.5 bg-neutral-100 rounded w-full" />
              <div className="h-3.5 bg-neutral-100 rounded w-5/6" />
              <div className="h-3.5 bg-neutral-100 rounded w-2/3" />
            </div>
            <div className="pt-2 flex gap-2">
              <div className="h-7 bg-neutral-100 rounded-full w-16" />
              <div className="h-7 bg-neutral-100 rounded-full w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-10 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-brand-yellow flex items-center justify-center mx-auto">
          <Megaphone className="w-6 h-6 text-amber-600" />
        </div>
        <h3 className="text-base font-bold text-neutral-900">No Announcements Yet</h3>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
          The feed is currently empty. Use the box above to publish the first company-wide announcement or team update.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <FeedPostCard
          key={post.id}
          post={post}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onPostDeleted={onPostDeleted}
          onPostUpdated={onPostUpdated}
          onError={onError}
        />
      ))}

      {/* Pagination controls */}
      {hasMore ? (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-neutral-50 active:bg-neutral-100 border border-neutral-300 text-neutral-700 text-xs font-semibold rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isLoadingMore ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-neutral-500" />
            )}
            <span>{isLoadingMore ? 'Loading earlier updates...' : 'Load More Updates'}</span>
          </button>
        </div>
      ) : (
        posts.length > 0 && (
          <div className="py-4 text-center">
            <p className="text-xs text-neutral-400 font-medium">
              You&apos;re all caught up with the latest announcements.
            </p>
          </div>
        )
      )}
    </div>
  );
};
