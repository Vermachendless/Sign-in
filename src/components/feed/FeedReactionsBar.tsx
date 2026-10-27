import React, { useState } from 'react';
import { FeedReactionType } from './types.ts';

interface ReactionOption {
  type: FeedReactionType;
  emoji: string;
  label: string;
}

const REACTION_OPTIONS: readonly ReactionOption[] = [
  { type: 'LIKE', emoji: '👍', label: 'Like' },
  { type: 'CELEBRATE', emoji: '🎉', label: 'Celebrate' },
  { type: 'SUPPORT', emoji: '❤️', label: 'Support' },
  { type: 'INSIGHTFUL', emoji: '💡', label: 'Insightful' },
];

interface FeedReactionsBarProps {
  postId: string;
  reactions: Record<FeedReactionType, number>;
  totalReactions: number;
  currentUserReaction: FeedReactionType | null;
  onReactionChange: (
    newReactionType: FeedReactionType | null,
    newReactions: Record<FeedReactionType, number>,
    newTotal: number
  ) => void;
  onError?: (message: string) => void;
}

export const FeedReactionsBar: React.FC<FeedReactionsBarProps> = ({
  postId,
  reactions,
  totalReactions,
  currentUserReaction,
  onReactionChange,
  onError,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleToggle = async (type: FeedReactionType) => {
    if (isSubmitting) return;

    // Snapshot current state for rollback
    const prevReaction = currentUserReaction;
    const prevReactions = { ...reactions };
    const prevTotal = totalReactions;

    // Compute optimistic state
    const isRemoving = prevReaction === type;
    const nextReaction: FeedReactionType | null = isRemoving ? null : type;
    const nextReactions = { ...prevReactions };

    if (isRemoving) {
      nextReactions[type] = Math.max(0, (nextReactions[type] || 1) - 1);
    } else {
      if (prevReaction) {
        nextReactions[prevReaction] = Math.max(0, (nextReactions[prevReaction] || 1) - 1);
      }
      nextReactions[type] = (nextReactions[type] || 0) + 1;
    }

    const nextTotal = Object.values(nextReactions).reduce((a, b) => a + b, 0);

    // Apply optimistic update immediately
    onReactionChange(nextReaction, nextReactions, nextTotal);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/feed/posts/${encodeURIComponent(postId)}/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ reactionType: type }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Rollback on auth error
          onReactionChange(prevReaction, prevReactions, prevTotal);
          onError?.('Authentication required. Please refresh or sign in again.');
          return;
        }

        const data = await res.json().catch(() => null);
        const errorMsg = data?.error?.message || 'Failed to update reaction.';
        // Rollback
        onReactionChange(prevReaction, prevReactions, prevTotal);
        onError?.(errorMsg);
        return;
      }

      const json = await res.json();
      if (json.success && json.data) {
        onReactionChange(
          json.data.reactionType,
          json.data.reactions,
          json.data.totalReactions
        );
      }
    } catch {
      // Rollback on network failure
      onReactionChange(prevReaction, prevReactions, prevTotal);
      onError?.('Network error while toggling reaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {REACTION_OPTIONS.map((opt) => {
        const count = reactions[opt.type] || 0;
        const isSelected = currentUserReaction === opt.type;

        return (
          <button
            key={opt.type}
            type="button"
            onClick={() => handleToggle(opt.type)}
            disabled={isSubmitting}
            aria-label={`${opt.label} reaction, ${count} total`}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              isSelected
                ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                : 'bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200'
            } ${isSubmitting ? 'opacity-80 cursor-wait' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
          >
            <span className="text-sm leading-none" role="img" aria-hidden="true">
              {opt.emoji}
            </span>
            <span className="hidden sm:inline text-xs">{opt.label}</span>
            {count > 0 && (
              <span
                className={`ml-0.5 text-[11px] font-semibold ${
                  isSelected ? 'text-amber-800' : 'text-neutral-500'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}

      {totalReactions > 0 && (
        <span className="ml-auto text-xs text-neutral-400 font-medium hidden sm:inline">
          {totalReactions} {totalReactions === 1 ? 'reaction' : 'reactions'}
        </span>
      )}
    </div>
  );
};
