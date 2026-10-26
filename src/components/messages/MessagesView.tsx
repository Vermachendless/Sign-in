import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  ConversationSummaryItem,
  DirectMessageRecord,
  ConversationParticipant,
  ConversationListResponse,
  DirectMessageListResponse,
} from '../../types/index.ts';
import { ConversationList } from './ConversationList.tsx';
import { MessageThread } from './MessageThread.tsx';
import { NewConversationModal } from './NewConversationModal.tsx';
import { AlertCircle } from 'lucide-react';

export const AUTH_REQUIRED_MSG = 'Your session could not be authenticated for messaging. Please refresh the page or sign in again.';

export const MessagesView: React.FC = () => {
  const { user } = useAuth();

  // Conversations list state
  const [conversations, setConversations] = useState<ConversationSummaryItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadTotal, setUnreadTotal] = useState<number>(0);

  // Messages thread state
  const [messages, setMessages] = useState<DirectMessageRecord[]>([]);
  const [messagesPage, setMessagesPage] = useState<number>(1);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);

  // Loading & operation states
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState<boolean>(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);

  // Errors
  const [threadError, setThreadError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // References to prevent stale responses & coordinate polling
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  const authErrorRef = useRef<string | null>(null);
  authErrorRef.current = authError;

  const messagesAbortControllerRef = useRef<AbortController | null>(null);
  const isPollingRef = useRef<boolean>(false);

  /**
   * Fetch unread count from /api/messages/unread-count
   */
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/messages/unread-count', {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 401) {
        setAuthError(AUTH_REQUIRED_MSG);
        return;
      }
      if (res.ok) {
        setAuthError(null);
        const json = await res.json();
        if (json.success && typeof json.data?.unreadCount === 'number') {
          setUnreadTotal(json.data.unreadCount);
          window.dispatchEvent(
            new CustomEvent('messages-unread-updated', {
              detail: { unreadCount: json.data.unreadCount },
            })
          );
        }
      }
    } catch (err) {
      // Non-fatal background fetch
      console.warn('[MessagesView] fetchUnreadCount error:', err);
    }
  }, [user]);

  /**
   * Fetch conversations list from /api/messages/conversations
   */
  const fetchConversations = useCallback(
    async (isBackground = false) => {
      if (!user) return;
      if (!isBackground) setIsLoadingConversations(true);

      try {
        const res = await fetch('/api/messages/conversations?page=1&limit=50', {
          headers: { Accept: 'application/json' },
        });

        if (res.status === 401) {
          setAuthError(AUTH_REQUIRED_MSG);
          return;
        }

        if (res.ok) {
          setAuthError(null);
          const json = await res.json();
          if (json.success && json.data) {
            const data = json.data as ConversationListResponse;
            setConversations(data.conversations || []);

            // Calculate total unread from list
            const totalUnread = (data.conversations || []).reduce(
              (acc, item) => acc + (item.unreadCount || 0),
              0
            );
            setUnreadTotal(totalUnread);
            window.dispatchEvent(
              new CustomEvent('messages-unread-updated', {
                detail: { unreadCount: totalUnread },
              })
            );
          }
        } else {
          const json = await res.json().catch(() => null);
          setThreadError(json?.message || 'Failed to load conversations.');
        }
      } catch (err) {
        console.error('[MessagesView] fetchConversations error:', err);
      } finally {
        if (!isBackground) setIsLoadingConversations(false);
      }
    },
    [user]
  );

  /**
   * Mark active conversation as read
   */
  const markAsRead = useCallback(
    async (conversationId: string) => {
      if (!user || !conversationId) return;
      try {
        const res = await fetch(`/api/messages/conversations/${conversationId}/read`, {
          method: 'PATCH',
          headers: { Accept: 'application/json' },
        });

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            // Update local conversation item
            setConversations((prev) =>
              prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
            );

            // Update unread total
            const refreshedTotal = json.data.unreadCount ?? 0;
            setUnreadTotal(refreshedTotal);
            window.dispatchEvent(
              new CustomEvent('messages-unread-updated', {
                detail: { unreadCount: refreshedTotal },
              })
            );
          }
        }
      } catch (err) {
        console.warn('[MessagesView] markAsRead error:', err);
      }
    },
    [user]
  );

  /**
   * Fetch messages for active conversation
   */
  const fetchMessages = useCallback(
    async (conversationId: string, page = 1, isBackground = false) => {
      if (!user || !conversationId) return;

      // Abort previous in-flight request if user switched conversations
      if (!isBackground && page === 1) {
        messagesAbortControllerRef.current?.abort();
        const controller = new AbortController();
        messagesAbortControllerRef.current = controller;
      }

      if (!isBackground) {
        if (page === 1) setIsLoadingMessages(true);
        else setIsLoadingEarlier(true);
        setThreadError(null);
      }

      try {
        const res = await fetch(
          `/api/messages/conversations/${conversationId}/messages?page=${page}&limit=30`,
          {
            signal: messagesAbortControllerRef.current?.signal,
            headers: { Accept: 'application/json' },
          }
        );

        // Guard against stale response if user switched away
        if (activeConversationIdRef.current !== conversationId) {
          return;
        }

        if (res.status === 401) {
          setThreadError(AUTH_REQUIRED_MSG);
          setAuthError(AUTH_REQUIRED_MSG);
          return;
        }

        if (res.status === 404) {
          setThreadError('This conversation is no longer accessible.');
          return;
        }

        if (res.ok) {
          setAuthError(null);
          const json = await res.json();
          if (json.success && json.data) {
            const data = json.data as DirectMessageListResponse;
            const newMessages = data.messages || [];

            if (page === 1) {
              setMessages(newMessages);
            } else {
              // Prepend earlier messages without duplicates
              setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const uniqueEarlier = newMessages.filter((m) => !existingIds.has(m.id));
                return [...uniqueEarlier, ...prev];
              });
            }

            setMessagesPage(page);
            setHasMoreMessages(data.hasMore);

            // If incoming messages were loaded successfully and conversation has unread items, mark as read
            const currentConv = conversations.find((c) => c.id === conversationId);
            if (currentConv && currentConv.unreadCount > 0) {
              markAsRead(conversationId);
            }
          }
        } else {
          const json = await res.json().catch(() => null);
          setThreadError(json?.message || 'Failed to load messages.');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[MessagesView] fetchMessages error:', err);
          if (!isBackground) {
            setThreadError('Network error loading messages. Please retry.');
          }
        }
      } finally {
        if (!isBackground) {
          setIsLoadingMessages(false);
          setIsLoadingEarlier(false);
        }
      }
    },
    [user, markAsRead, conversations]
  );

  // Initial load of conversations list and unread count
  useEffect(() => {
    fetchConversations(false);
    fetchUnreadCount();
  }, [fetchConversations, fetchUnreadCount]);

  // When active conversation changes, load page 1
  useEffect(() => {
    if (activeConversationId) {
      setMessages([]);
      setMessagesPage(1);
      setHasMoreMessages(false);
      setThreadError(null);
      fetchMessages(activeConversationId, 1, false);
    } else {
      setMessages([]);
      messagesAbortControllerRef.current?.abort();
    }
  }, [activeConversationId]);

  /**
   * Modest Polling Engine with Page Visibility Support
   * - Active thread: every 5 seconds
   * - Conversations list: every 15 seconds
   * - Pauses when document.hidden === true
   * - Resumes immediately on tab focus/visibility
   */
  useEffect(() => {
    if (!user) return;

    let threadIntervalId: NodeJS.Timeout | null = null;
    let listIntervalId: NodeJS.Timeout | null = null;

    const startPolling = () => {
      // 1. Thread polling (every 5 seconds)
      if (threadIntervalId) clearInterval(threadIntervalId);
      threadIntervalId = setInterval(() => {
        if (document.hidden) return;
        if (authErrorRef.current) return;
        const currentActiveId = activeConversationIdRef.current;
        if (currentActiveId && !isPollingRef.current) {
          isPollingRef.current = true;
          fetchMessages(currentActiveId, 1, true).finally(() => {
            isPollingRef.current = false;
          });
        }
      }, 5000);

      // 2. Conversation list polling (every 15 seconds)
      if (listIntervalId) clearInterval(listIntervalId);
      listIntervalId = setInterval(() => {
        if (document.hidden) return;
        if (authErrorRef.current) return;
        fetchConversations(true);
      }, 15000);
    };

    const stopPolling = () => {
      if (threadIntervalId) clearInterval(threadIntervalId);
      if (listIntervalId) clearInterval(listIntervalId);
      threadIntervalId = null;
      listIntervalId = null;
    };

    // Start polling initially if page is visible
    if (!document.hidden) {
      startPolling();
    }

    // Visibility API change handler
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Immediate refresh when tab becomes visible
        if (activeConversationIdRef.current) {
          fetchMessages(activeConversationIdRef.current, 1, true);
        }
        fetchConversations(true);
        fetchUnreadCount();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      messagesAbortControllerRef.current?.abort();
    };
  }, [user, fetchMessages, fetchConversations, fetchUnreadCount]);

  /**
   * Send Message Action
   */
  const handleSendMessage = async (text: string): Promise<boolean> => {
    if (!user || !activeConversationId || isSending) return false;

    setIsSending(true);
    setThreadError(null);

    try {
      const res = await fetch(`/api/messages/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ content: text }),
      });

      if (res.status === 401) {
        setThreadError('Your message could not be sent because your session could not be authenticated. Your draft has been preserved.');
        setAuthError(AUTH_REQUIRED_MSG);
        return false;
      }

      const json = await res.json();

      if (res.ok && json.success && json.data?.message) {
        setAuthError(null);
        const newMsg = json.data.message as DirectMessageRecord;

        // Append to current messages stream
        setMessages((prev) => [...prev, newMsg]);

        // Update conversation summary in list
        setConversations((prev) => {
          const updated = prev.map((c) => {
            if (c.id === activeConversationId) {
              return {
                ...c,
                lastMessage: {
                  id: newMsg.id,
                  senderId: newMsg.senderId,
                  content: newMsg.content,
                  createdAt: newMsg.createdAt,
                },
                updatedAt: newMsg.createdAt,
              };
            }
            return c;
          });

          // Move the active conversation to the top
          return [
            ...updated.filter((c) => c.id === activeConversationId),
            ...updated.filter((c) => c.id !== activeConversationId),
          ];
        });

        return true;
      } else {
        setThreadError(json?.message || 'Failed to deliver message.');
        return false;
      }
    } catch (err) {
      console.error('[MessagesView] handleSendMessage error:', err);
      setThreadError('Network error while delivering message. Please retry.');
      return false;
    } finally {
      setIsSending(false);
    }
  };

  /**
   * Load earlier messages (pagination)
   */
  const handleLoadEarlier = () => {
    if (!activeConversationId || !hasMoreMessages || isLoadingEarlier) return;
    fetchMessages(activeConversationId, messagesPage + 1, false);
  };

  /**
   * Initiate new conversation with selected colleague
   */
  const handleSelectContact = async (contact: ConversationParticipant) => {
    if (!user || isCreatingConversation) return;

    setIsCreatingConversation(true);
    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ recipientId: contact.id }),
      });

      if (res.status === 401) {
        setAuthError(AUTH_REQUIRED_MSG);
        alert('Your session could not be authenticated. Please refresh the page or sign in again.');
        return;
      }

      const json = await res.json();
      if (res.ok && json.success && json.data?.conversation) {
        setAuthError(null);
        const convId = json.data.conversation.id;

        // Close modal and set active conversation
        setIsNewModalOpen(false);
        setActiveConversationId(convId);

        // Refresh conversation list to include the newly created or fetched conversation
        await fetchConversations(true);
      } else {
        alert(json?.message || 'Could not start conversation with this colleague.');
      }
    } catch (err) {
      console.error('[MessagesView] handleSelectContact error:', err);
      alert('Network error while creating conversation. Please try again.');
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl border border-brand-border shadow-xs overflow-hidden">
      {/* Inline Authentication Error Banner */}
      {authError && (
        <div
          id="messages-auth-error-banner"
          className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between gap-3 text-amber-900 text-xs shrink-0"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium">{authError}</span>
          </div>
          <button
            onClick={() => {
              setAuthError(null);
              fetchConversations(false);
              fetchUnreadCount();
              if (activeConversationId) {
                fetchMessages(activeConversationId, 1, false);
              }
            }}
            className="px-3 py-1 rounded-lg bg-amber-200/70 hover:bg-amber-200 text-amber-900 font-semibold transition cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Pane: Conversation List */}
        {/* On desktop: always visible (w-80 md:w-96). On mobile: hidden if a thread is active */}
        <div
          className={`h-full flex-col shrink-0 md:flex md:w-80 lg:w-96 ${
            activeConversationId ? 'hidden md:flex' : 'flex w-full'
          }`}
        >
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => setActiveConversationId(id)}
            onOpenNewModal={() => setIsNewModalOpen(true)}
            isLoading={isLoadingConversations}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onRefresh={() => fetchConversations(false)}
            unreadTotal={unreadTotal}
          />
        </div>

        {/* Right Pane: Message Thread */}
        {/* On desktop: always visible (flex-1). On mobile: hidden if no conversation is active */}
        <div
          className={`h-full flex-1 flex-col ${
            activeConversationId ? 'flex' : 'hidden md:flex'
          }`}
        >
          <MessageThread
            key={activeConversation?.id || 'no-conversation-selected'}
            conversation={activeConversation}
            messages={messages}
            currentUserId={user?.id || ''}
            isLoadingMessages={isLoadingMessages}
            isSending={isSending}
            hasMore={hasMoreMessages}
            isLoadingEarlier={isLoadingEarlier}
            onLoadEarlier={handleLoadEarlier}
            onSendMessage={handleSendMessage}
            onBackToList={() => setActiveConversationId(null)}
            threadError={threadError}
            onClearError={() => setThreadError(null)}
          />
        </div>
      </div>

      {/* New Conversation Colleague Picker Modal */}
      <NewConversationModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSelectContact={handleSelectContact}
        isCreating={isCreatingConversation}
      />
    </div>
  );
};
