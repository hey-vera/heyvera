import { useEffect, useState } from 'react';
import { MessageSquarePlus, Search, Settings, Trash2 } from 'lucide-react';
import {
  listConversations,
  deleteConversation,
  type ConversationSummary,
} from '../lib/cortexApi';

interface SidebarProps {
  userId: string;
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  userId,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onOpenSettings,
}: SidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState('');
  const [hoverDelete, setHoverDelete] = useState<string | null>(null);

  const fetchConversations = async () => {
    try {
      const list = await listConversations(userId);
      setConversations(list);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [userId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteConversation(id, userId);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) onNewChat();
  };

  const filtered = search
    ? conversations.filter(
        (c) =>
          c.title?.toLowerCase().includes(search.toLowerCase()) ||
          c.last_message_preview?.toLowerCase().includes(search.toLowerCase()),
      )
    : conversations;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-white/6 bg-[var(--bg)]">
      {/* New chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-sm text-white transition-all duration-150 hover:bg-white/8 active:scale-[0.98]"
        >
          <MessageSquarePlus className="h-4 w-4 text-[var(--accent)]" />
          New chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/4 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-white outline-none placeholder:text-[var(--muted)]"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2">
        {filtered.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-[var(--muted)]">
            {search ? 'No matches' : 'No conversations yet'}
          </p>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelectConversation(c.id)}
            onMouseEnter={() => setHoverDelete(c.id)}
            onMouseLeave={() => setHoverDelete(null)}
            className={`group relative mb-0.5 flex w-full flex-col rounded-lg px-3 py-2.5 text-left transition-all duration-100 ${
              activeConversationId === c.id
                ? 'bg-white/8 text-white'
                : 'text-[var(--muted-strong)] hover:bg-white/4'
            }`}
          >
            <span className="truncate text-sm font-medium">
              {c.title || 'New conversation'}
            </span>
            <span className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
              {c.last_message_preview || formatTime(c.updated_at)}
            </span>
            {hoverDelete === c.id && (
              <span
                onClick={(e) => handleDelete(e, c.id)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--muted)] transition hover:bg-red-500/20 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Settings */}
      <div className="border-t border-white/6 p-3">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-[var(--muted)] transition hover:bg-white/4 hover:text-white active:scale-[0.98]"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </div>
  );
}
