import React, { useState, useEffect, useRef } from 'react';
import { ConversationParticipant, UserRole } from '../../types/index.ts';
import { Search, X, Loader2, UserCheck, MessageSquarePlus, Building, Mail } from 'lucide-react';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectContact: (contact: ConversationParticipant) => Promise<void>;
  isCreating: boolean;
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  isOpen,
  onClose,
  onSelectContact,
  isCreating,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [contacts, setContacts] = useState<ConversationParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Focus input and load initial eligible contacts when opened
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setError(null);
      fetchContacts('');
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      abortControllerRef.current?.abort();
    }
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch eligible active colleagues from /api/messages/contacts
  const fetchContacts = async (query: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const url = query.trim()
        ? `/api/messages/contacts?search=${encodeURIComponent(query.trim())}`
        : '/api/messages/contacts';

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        throw new Error('Failed to load colleagues.');
      }

      const json = await res.json();
      if (json.success && Array.isArray(json.data?.contacts)) {
        setContacts(json.data.contacts);
      } else {
        setContacts([]);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[NewConversationModal] fetchContacts error:', err);
        setError('Unable to load colleagues. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);
    fetchContacts(val);
  };

  if (!isOpen) return null;

  const getInitials = (contact: ConversationParticipant) => {
    const f = contact.firstName ? contact.firstName[0].toUpperCase() : '';
    const l = contact.lastName ? contact.lastName[0].toUpperCase() : '';
    return `${f}${l}` || 'U';
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case UserRole.SUPER_ADMIN:
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-900/10 text-purple-700 border border-purple-200">
            Super Admin
          </span>
        );
      case UserRole.ADMIN:
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-900/10 text-amber-700 border border-amber-200">
            Admin
          </span>
        );
      case UserRole.STAFF:
      default:
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-900/10 text-emerald-700 border border-emerald-200">
            Staff
          </span>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-message-modal-title"
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-yellow/20 text-brand-black flex items-center justify-center font-bold">
              <MessageSquarePlus className="w-4 h-4 text-slate-900" />
            </div>
            <div>
              <h2 id="new-message-modal-title" className="text-sm font-bold text-slate-900 tracking-tight">
                New Direct Conversation
              </h2>
              <p className="text-xs text-slate-500">Select an active colleague to start chatting</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-neutral-100 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-neutral-200 bg-white shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by name, email, or department..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow transition"
            />
            {isLoading && (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>

        {/* Colleagues List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 divide-y divide-neutral-100">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 mb-2">
              {error}
            </div>
          )}

          {!isLoading && contacts.length === 0 && (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                <UserCheck className="w-6 h-6" />
              </div>
              <p className="text-xs font-semibold text-slate-800 mb-1">No active colleagues found</p>
              <p className="text-[11px] text-slate-500">
                {searchTerm ? 'Try a different search term or check spelling.' : 'No eligible colleagues are available.'}
              </p>
            </div>
          )}

          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => onSelectContact(contact)}
              disabled={isCreating}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-neutral-50 transition text-left cursor-pointer group disabled:opacity-50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs group-hover:bg-brand-black">
                  {getInitials(contact)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {contact.firstName} {contact.lastName}
                    </span>
                    {getRoleBadge(contact.role)}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                    <span className="flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                      {contact.email}
                    </span>
                    {contact.department && (
                      <span className="flex items-center gap-1 shrink-0 text-slate-600 font-medium">
                        <Building className="w-3 h-3 text-slate-400 shrink-0" />
                        {contact.department}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 pl-2">
                <span className="text-xs font-semibold text-slate-700 bg-neutral-100 group-hover:bg-brand-yellow group-hover:text-brand-black px-3 py-1.5 rounded-lg transition">
                  Chat
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span>Only active personnel can be messaged.</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white text-slate-700 font-semibold hover:bg-neutral-50 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
