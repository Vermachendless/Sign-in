import React, { useState, FormEvent } from 'react';
import { FeedPostItem } from './types.ts';
import { Megaphone, Send, Loader2, AlertCircle } from 'lucide-react';

interface FeedComposerProps {
  onPostCreated: (post: FeedPostItem) => void;
  onError?: (msg: string) => void;
}

const MAX_POST_LENGTH = 3000;

export const FeedComposer: React.FC<FeedComposerProps> = ({ onPostCreated, onError }) => {
  const [draft, setDraft] = useState('');
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

    try {
      const res = await fetch('/api/feed/posts', {
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
        const errorMsg = data?.error?.message || 'Failed to publish post.';
        setSubmitError(errorMsg);
        // DRAFT PRESERVATION: We do NOT clear draft!
        return;
      }

      const json = await res.json();
      if (json.success && json.data?.post) {
        onPostCreated(json.data.post);
        setDraft(''); // Cleared only on successful creation
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
          <h2 className="text-sm font-bold text-neutral-900">Post Announcement</h2>
          <p className="text-xs text-neutral-500">Share news, updates, or alerts with colleagues</p>
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
            placeholder="What's happening? Share an update or announcement with the team..."
            rows={3}
            maxLength={MAX_POST_LENGTH}
            disabled={isSubmitting}
            className="w-full text-sm p-3 rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-yellow/40 focus:border-brand-yellow bg-neutral-50/50 hover:bg-white focus:bg-white placeholder-neutral-400 resize-y min-h-[85px] transition-all"
          />
        </div>

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
            <span>{isSubmitting ? 'Publishing...' : 'Publish'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
