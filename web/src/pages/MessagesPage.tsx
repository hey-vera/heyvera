import { useState } from 'react';

interface Conversation {
  id: string;
  name: string;
  handle: string;
  lastMessage: string;
  timestamp: string;
  unread?: boolean;
}

const CONVERSATIONS: Conversation[] = [
  {
    id: '1',
    name: 'Vera Network',
    handle: '@veranetwork',
    lastMessage: 'The secure room session is ready for review.',
    timestamp: '2h',
    unread: true,
  },
  {
    id: '2',
    name: 'Soma Protocol',
    handle: '@somaprotocol',
    lastMessage: 'Fixed the identity delegation bug — ready to merge.',
    timestamp: '5h',
  },
  {
    id: '3',
    name: 'agent_zero',
    handle: '@agent_zero',
    lastMessage: 'Running the orchestration benchmark now.',
    timestamp: '1d',
  },
];

export function MessagesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = CONVERSATIONS.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.handle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen bg-black text-[#E7E9EA]">
      {/* Conversation list */}
      <div className="flex w-full flex-col border-r border-[#2F3336] md:w-[360px]">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
          <h1 className="text-[20px] font-bold text-[#E7E9EA]">Messages</h1>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71767B]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.82 5.262l4.529 4.528-1.414 1.414-4.529-4.529A8.457 8.457 0 0 1 10.25 18.75c-4.694 0-8.5-3.806-8.5-8.5z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search Messages"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-full border border-[#2F3336] bg-[#16181C] py-2.5 pl-10 pr-4 text-[15px] text-[#E7E9EA] placeholder-[#71767B] outline-none focus:border-[#00BA7C] transition-colors"
            />
          </div>
        </div>

        {/* Conversation items */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((convo) => (
            <button
              key={convo.id}
              type="button"
              onClick={() => setSelectedId(convo.id)}
              className={`flex w-full gap-3 border-b border-[#2F3336] px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                selectedId === convo.id ? 'bg-white/5' : ''
              }`}
            >
              {/* Avatar */}
              <div className="h-10 w-10 flex-shrink-0 rounded-full bg-[#2F3336]" />

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[15px] font-bold truncate ${convo.unread ? 'text-[#E7E9EA]' : 'text-[#E7E9EA]'}`}>
                    {convo.name}
                  </span>
                  <span className="flex-shrink-0 text-xs text-[#71767B]">{convo.timestamp}</span>
                </div>
                <p className={`text-[14px] truncate ${convo.unread ? 'text-[#E7E9EA] font-medium' : 'text-[#71767B]'}`}>
                  {convo.lastMessage}
                </p>
              </div>

              {convo.unread && (
                <div className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-[#00BA7C] self-center" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Chat panel — hidden on mobile */}
      <div className="hidden flex-1 items-center justify-center md:flex">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#2F3336]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#71767B">
              <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
            </svg>
          </div>
          <p className="text-[20px] font-bold text-[#E7E9EA]">Select a conversation</p>
          <p className="mt-1 text-[15px] text-[#71767B]">Choose from your existing conversations or start a new one.</p>
        </div>
      </div>
    </div>
  );
}

export default MessagesPage;
