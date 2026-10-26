import React, { useState, useEffect, useRef } from 'react';
import { ConversationSummaryItem, DirectMessageRecord, UserRole } from '../../types/index.ts';
import {
  ArrowLeft,
  Send,
  Loader2,
  Check,
  CheckCheck,
  Building,
  Mail,
  AlertCircle,
  MessageSquare,
  Clock,
} from 'lucide-react';

interface MessageThreadProps {
  conversation: ConversationSummaryItem | null;
  messages: DirectMessageRecord[];
  currentUserId: string;
  isLoadingMessages: boolean;
  isSending: boolean;
  hasMore: boolean;
  isLoadingEarlier: boolean;
  onLoadEarlier: () => void;
  onSendMessage: (content: string) => Promise<boolean>;
  onBackToList?: () => void;
  threadError?: string | null;
  onClearError?: () => void;
}

function formatMessageTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function formatMessageDateSeparator(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '';
  }
}

export const MessageThread: React.FC<MessageThreadProps> = ({
  conversation,
  messages,
  currentUserId,
  isLoadingMessages,
  isSending,
  hasMore,
  isLoadingEarlier,
  onLoadEarlier,
  onSendMessage,
  onBackToList,
  threadError,
  onClearError,
}) => {
  const [content, setContent] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  // Reset composer draft and local error state whenever switching conversations to prevent cross-conversation draft leakage
  useEffect(() => {
    setContent('');
    setSendError(null);
  }, [conversation?.id]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on initial message load or new message sent
  useEffect(() => {
    if (!isLoadingEarlier) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isLoadingEarlier]);

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    if (!isLoadingEarlier && previousScrollHeightRef.current > 0 && scrollContainerRef.current) {
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      const heightDelta = newScrollHeight - previousScrollHeightRef.current;
      scrollContainerRef.current.scrollTop += heightDelta;
      previousScrollHeightRef.current = 0;
    }
  }, [isLoadingEarlier]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [content]);

  // Handle send message
  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length === 0 || trimmed.length > 2000 || isSending) {
      return;
    }

    setSendError(null);
    if (onClearError) onClearError();

    const success = await onSendMessage(trimmed);
    if (success) {
      setContent('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    } else {
      // Draft is safely preserved in content state on failure
      setSendError('Failed to deliver message. Your draft has been preserved.');
    }
  };

  // Keyboard shortcut: Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLoadEarlierClick = () => {
    if (scrollContainerRef.current) {
      previousScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
    }
    onLoadEarlier();
  };

  if (!conversation) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 bg-neutral-50/50 text-center select-none">
        <div className="w-16 h-16 rounded-3xl bg-neutral-100 border border-neutral-200 text-slate-400 flex items-center justify-center mb-4 shadow-xs">
          <MessageSquare className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-sm font-bold text-slate-800 mb-1">Select a Conversation</h2>
        <p className="text-xs text-slate-500 max-w-sm mb-4">
          Choose an existing conversation from the list or start a new direct chat with any active staff colleague.
        </p>
      </div>
    );
  }

  const other = conversation.otherParticipant;
  const isOverLimit = content.length > 2000;
  const canSend = content.trim().length > 0 && !isOverLimit && !isSending;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Thread Header */}
      <div className="px-4 py-3 border-b border-brand-border bg-white flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile Back Button */}
          {onBackToList && (
            <button
              onClick={onBackToList}
              className="md:hidden p-1.5 -ml-1 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-neutral-100 transition cursor-pointer"
              title="Back to conversations list"
              aria-label="Back to conversations list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          {/* Colleague Details */}
          <div className="w-10 h-10 rounded-full bg-slate-900 text-brand-yellow font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
            {other.firstName ? other.firstName[0].toUpperCase() : ''}
            {other.lastName ? other.lastName[0].toUpperCase() : ''}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 truncate">
                {other.firstName} {other.lastName}
              </h2>
              <span className="text-[10px] font-semibold px-2 py-0.2 rounded bg-neutral-100 text-slate-600 border border-neutral-200">
                {other.role}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1 truncate">
                <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                {other.email}
              </span>
              {other.department && (
                <span className="hidden sm:flex items-center gap-1 text-slate-600 font-medium truncate">
                  <Building className="w-3 h-3 text-slate-400 shrink-0" />
                  {other.department}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Banners */}
      {(threadError || sendError) && (
        <div className="p-3 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-2 text-xs text-rose-800 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{sendError || threadError}</span>
          </div>
          <button
            onClick={() => {
              setSendError(null);
              if (onClearError) onClearError();
            }}
            className="text-[11px] font-bold underline hover:text-rose-950 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Message History Stream */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-neutral-50/50 scrollbar-thin"
      >
        {/* Load Earlier Messages Button */}
        {hasMore && (
          <div className="text-center py-2">
            <button
              onClick={handleLoadEarlierClick}
              disabled={isLoadingEarlier}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-xs font-semibold text-slate-700 hover:bg-neutral-50 transition shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isLoadingEarlier ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
                  <span>Loading history...</span>
                </>
              ) : (
                <span>Load earlier messages</span>
              )}
            </button>
          </div>
        )}

        {/* Initial Loading Indicator */}
        {isLoadingMessages && messages.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-brand-black mb-2" />
            <p className="text-xs font-medium">Retrieving messages...</p>
          </div>
        )}

        {/* Empty Conversation State */}
        {!isLoadingMessages && messages.length === 0 && (
          <div className="py-20 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white border border-neutral-200 text-slate-400 flex items-center justify-center mx-auto mb-3 shadow-xs">
              <MessageSquare className="w-6 h-6 text-brand-yellow" />
            </div>
            <p className="text-xs font-bold text-slate-800 mb-1">Start the conversation</p>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Send a direct message to {other.firstName}. All direct staff messages are private and encrypted.
            </p>
          </div>
        )}

        {/* Messages List */}
        {messages.map((msg, index) => {
          const isMe = msg.senderId === currentUserId;
          const showDateSeparator =
            index === 0 ||
            formatMessageDateSeparator(messages[index - 1].createdAt) !==
              formatMessageDateSeparator(msg.createdAt);

          return (
            <React.Fragment key={msg.id}>
              {/* Date Group Divider */}
              {showDateSeparator && (
                <div className="flex items-center justify-center my-4">
                  <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-neutral-200 text-slate-600">
                    {formatMessageDateSeparator(msg.createdAt)}
                  </span>
                </div>
              )}

              {/* Message Bubble Container */}
              <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-xs shadow-xs transition ${
                    isMe
                      ? 'bg-slate-900 text-white rounded-tr-xs'
                      : 'bg-white text-slate-900 border border-neutral-200/80 rounded-tl-xs'
                  }`}
                >
                  {/* Message Content rendered as ordinary React text (immune to HTML injection) */}
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>

                  {/* Metadata: Time and Read Receipt */}
                  <div
                    className={`flex items-center justify-end gap-1 text-[10px] mt-1 font-medium select-none ${
                      isMe ? 'text-neutral-400' : 'text-slate-400'
                    }`}
                  >
                    <span>{formatMessageTime(msg.createdAt)}</span>
                    {isMe && (
                      <span className="inline-flex items-center ml-0.5" title={msg.isRead ? 'Read' : 'Delivered'}>
                        {msg.isRead ? (
                          <CheckCheck className="w-3.5 h-3.5 text-brand-yellow" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-neutral-400" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer */}
      <div className="p-3 sm:p-4 border-t border-brand-border bg-white shrink-0">
        <div className="relative flex flex-col bg-neutral-50 rounded-2xl border border-neutral-200 focus-within:border-brand-yellow focus-within:ring-2 focus-within:ring-brand-yellow/30 transition p-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${other.firstName}... (Enter to send, Shift+Enter for new line)`}
            disabled={isSending}
            maxLength={2000}
            className="w-full bg-transparent resize-none text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none px-2 py-1 max-h-32 scrollbar-thin"
          />

          <div className="flex items-center justify-between pt-2 px-1 border-t border-neutral-200/50 mt-1">
            {/* Character Counter */}
            <span
              className={`text-[10px] font-mono ${
                content.length > 2000
                  ? 'text-rose-600 font-bold'
                  : content.length > 1800
                  ? 'text-amber-600 font-semibold'
                  : 'text-slate-400'
              }`}
            >
              {content.length} / 2000
            </span>

            {/* Send Button */}
            <button
              id="send-message-btn"
              onClick={handleSend}
              disabled={!canSend}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                canSend
                  ? 'bg-slate-900 text-brand-yellow hover:bg-slate-800 active:scale-95'
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
              }`}
              title="Send message"
              aria-label="Send message"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
