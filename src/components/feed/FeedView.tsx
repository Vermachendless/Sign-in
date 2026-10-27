import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import { FeedPostItem } from './types.ts';
import { FeedComposer } from './FeedComposer.tsx';
import { FeedPostList } from './FeedPostList.tsx';
import { RotateCw, AlertCircle, ShieldAlert } from 'lucide-react';

export const FEED_AUTH_REQUIRED_MSG =
  'Your session could not be authenticated for feed access. Please refresh the page or sign in again.';

export const FeedView: React.FC = () => {
  const { user } = useAuth();

  const [posts, setPosts] = useState<FeedPostItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchInitialPosts = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setFeedError(null);
    setAuthError(null);

    try {
      const res = await fetch('/api/feed/posts?limit=20', {
        headers: { Accept: 'application/json' },
      });

      if (!isMountedRef.current) return;

      if (!res.ok) {
        if (res.status === 401) {
          // SAFE 401 HANDLING: Do not call logout() or setUser(null)!
          setAuthError(FEED_AUTH_REQUIRED_MSG);
          return;
        }

        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to retrieve feed announcements.';
        setFeedError(errorMsg);
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        setPosts(json.data.posts || []);
        setNextCursor(json.data.nextCursor || null);
        setHasMore(Boolean(json.data.hasMore));
      }
    } catch {
      if (isMountedRef.current) {
        setFeedError('Unable to connect to the server. Please check your connection.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    fetchInitialPosts();
  }, [fetchInitialPosts]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const res = await fetch(
        `/api/feed/posts?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (!isMountedRef.current) return;

      if (!res.ok) {
        if (res.status === 401) {
          setAuthError(FEED_AUTH_REQUIRED_MSG);
          return;
        }
        const data = await res.json().catch(() => null);
        setFeedError(data?.error?.message || 'Failed to load earlier posts.');
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        const newPosts: FeedPostItem[] = json.data.posts || [];
        setPosts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
          return [...prev, ...uniqueNew];
        });
        setNextCursor(json.data.nextCursor || null);
        setHasMore(Boolean(json.data.hasMore));
      }
    } catch {
      if (isMountedRef.current) {
        setFeedError('Network error while loading more posts.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  const handlePostCreated = (newPost: FeedPostItem) => {
    setPosts((prev) => [newPost, ...prev.filter((p) => p.id !== newPost.id)]);
  };

  const handlePostDeleted = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const handlePostUpdated = (updatedPost: FeedPostItem) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
    );
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-neutral-200">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
            Staff Feed & Announcements
          </h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Company-wide announcements, team updates, and workplace discussion.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchInitialPosts}
          disabled={isLoading}
          title="Refresh feed"
          aria-label="Refresh feed"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-50 active:bg-neutral-100 border border-neutral-300 text-neutral-700 text-xs font-semibold rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-600' : 'text-neutral-500'}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Safe Session Auth Warning (without logging out) */}
      {authError && (
        <div className="flex items-start justify-between gap-3 p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs shadow-2xs">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Authentication Warning</p>
              <p className="text-amber-800 mt-0.5">{authError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchInitialPosts}
            className="px-2.5 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md shrink-0 cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* General Feed Error Banner */}
      {feedError && (
        <div className="flex items-center justify-between gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{feedError}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedError(null)}
            className="text-xs text-rose-500 hover:text-rose-700 font-medium cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Post Composer */}
      <FeedComposer
        onPostCreated={handlePostCreated}
        onError={(msg) => setFeedError(msg)}
      />

      {/* Post List */}
      <FeedPostList
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        onPostDeleted={handlePostDeleted}
        onPostUpdated={handlePostUpdated}
        currentUserId={user.id}
        currentUserRole={user.role}
        onError={(msg) => setFeedError(msg)}
      />
    </div>
  );
};
