import React from 'react';
import { ConversationSummaryItem } from '../../types/index.ts';
import { Search, Plus, RefreshCw, MessageSquare, Building2, CheckCheck } from 'lucide-react';

interface ConversationListProps {
  conversations: ConversationSummaryItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onOpenNewModal: () => void;
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  unreadTotal: number;
}

function formatRelativeTime(isoDate?: string | null): string {
  if (!isoDate) return '';
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
    });
  } catch {
    return '';
  }
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onOpenNewModal,
  isLoading,
  searchQuery,
  onSearchChange,
  onRefresh,
  unreadTotal,
}) => {
  // Filter conversations locally based on search query
  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    const name = `${c.otherParticipant.firstName} ${c.otherParticipant.lastName}`.toLowerCase();
    const email = c.otherParticipant.email.toLowerCase();
    const dept = (c.otherParticipant.department || '').toLowerCase();
    const lastMsg = (c.lastMessage?.content || '').toLowerCase();
    return name.includes(term) || email.includes(term) || dept.includes(term) || lastMsg.includes(term);
  });

  const getInitials = (firstName: string, lastName: string) => {
    const f = firstName ? firstName[0].toUpperCase() : '';
    const l = lastName ? lastName[0].toUpperCase() : '';
    return `${f}${l}` || 'U';
  };

  return (
    <div className="h-full flex flex-col bg-white border-r border-brand-border select-none">
      {/* Pane Header */}
      <div className="p-4 border-b border-brand-border shrink-0 bg-neutral-50/60">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">Direct Messages</h1>
            {unreadTotal > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-yellow text-brand-black shadow-xs">
                {unreadTotal > 99 ? '99+' : unreadTotal} unread
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-neutral-100 transition cursor-pointer"
              title="Refresh conversations"
              aria-label="Refresh conversations"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-black' : ''}`} />
            </button>

            <button
              id="new-direct-message-btn"
              onClick={onOpenNewModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition shadow-xs cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5 text-brand-yellow" />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* Filter Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-neutral-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow transition"
          />
        </div>
      </div>

      {/* Conversations Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 p-2 space-y-1 scrollbar-thin">
        {isLoading && conversations.length === 0 && (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="flex items-center gap-3 p-3 rounded-xl animate-pulse bg-neutral-50">
                <div className="w-10 h-10 rounded-full bg-neutral-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="w-1/2 h-3 bg-neutral-200 rounded" />
                  <div className="w-3/4 h-2.5 bg-neutral-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div className="py-16 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-xs font-bold text-slate-800 mb-1">No conversations yet</p>
            <p className="text-[11px] text-slate-500 max-w-[200px] mx-auto mb-4">
              Connect directly with colleagues across engineering, security, and administration.
            </p>
            <button
              onClick={onOpenNewModal}
              className="px-3.5 py-1.5 rounded-xl bg-brand-yellow text-brand-black text-xs font-bold hover:bg-yellow-400 transition cursor-pointer shadow-xs"
            >
              Start Conversation
            </button>
          </div>
        )}

        {!isLoading && conversations.length > 0 && filteredConversations.length === 0 && (
          <div className="py-12 px-4 text-center">
            <p className="text-xs font-semibold text-slate-700">No matching conversations</p>
            <p className="text-[11px] text-slate-400 mt-1">Try searching a different colleague or keyword.</p>
          </div>
        )}

        {filteredConversations.map((conv) => {
          const isSelected = activeConversationId === conv.id;
          const other = conv.otherParticipant;
          const lastMsg = conv.lastMessage;
          const hasUnread = conv.unreadCount > 0;

          return (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition cursor-pointer border ${
                isSelected
                  ? 'bg-neutral-900 text-white border-neutral-900 shadow-xs'
                  : hasUnread
                  ? 'bg-amber-50/50 border-amber-200/80 hover:bg-amber-50'
                  : 'bg-white border-transparent hover:bg-neutral-50'
              }`}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className={`w-10 h-10 rounded-full font-bold text-xs flex items-center justify-center shadow-xs ${
                    isSelected
                      ? 'bg-brand-yellow text-brand-black'
                      : 'bg-slate-800 text-white'
                  }`}
                >
                  {getInitials(other.firstName, other.lastName)}
                </div>
                {hasUnread && !isSelected && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-yellow border-2 border-white ring-1 ring-black/10" />
                )}
              </div>

              {/* Information */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span
                    className={`text-xs font-bold truncate ${
                      isSelected ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    {other.firstName} {other.lastName}
                  </span>
                  <span
                    className={`text-[10px] shrink-0 font-medium ${
                      isSelected ? 'text-neutral-400' : hasUnread ? 'text-amber-800 font-bold' : 'text-slate-400'
                    }`}
                  >
                    {formatRelativeTime(lastMsg?.createdAt || conv.updatedAt)}
                  </span>
                </div>

                {/* Subtitle / Department */}
                {other.department && (
                  <div
                    className={`text-[10px] flex items-center gap-1 truncate mb-1 ${
                      isSelected ? 'text-neutral-300' : 'text-slate-500'
                    }`}
                  >
                    <Building2 className="w-2.5 h-2.5 shrink-0 opacity-70" />
                    <span>{other.department}</span>
                  </div>
                )}

                {/* Last Message Snippet */}
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-[11px] truncate flex-1 ${
                      isSelected
                        ? 'text-neutral-300'
                        : hasUnread
                        ? 'font-bold text-slate-900'
                        : 'text-slate-500'
                    }`}
                  >
                    {lastMsg?.content ? lastMsg.content : <span className="italic">No messages yet</span>}
                  </p>

                  {hasUnread && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full shrink-0 ${
                        isSelected
                          ? 'bg-brand-yellow text-brand-black'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
