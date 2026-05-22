import { useState } from 'react';

const TABS = ['Your Communities', 'Discover'] as const;
type Tab = typeof TABS[number];

interface Community {
  id: string;
  name: string;
  members: string;
  description: string;
  joined: boolean;
}

const COMMUNITIES: Community[] = [
  {
    id: '1',
    name: 'Vera Network Builders',
    members: '4.2K members',
    description: 'Builders working on the Vera Network protocol — agents, secure rooms, and identity.',
    joined: true,
  },
  {
    id: '2',
    name: 'Rust Systems',
    members: '18.7K members',
    description: 'Rust programmers building systems software, embedded, and WebAssembly.',
    joined: false,
  },
  {
    id: '3',
    name: 'Agentic AI',
    members: '9.1K members',
    description: 'Discussions on autonomous agents, LLM orchestration, and multi-agent systems.',
    joined: false,
  },
];

export function CommunitiesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Your Communities');
  const [joinedIds, setJoinedIds] = useState<Set<string>>(
    new Set(COMMUNITIES.filter((c) => c.joined).map((c) => c.id))
  );

  const toggle = (id: string) => {
    setJoinedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md">
        <div className="px-4 py-3">
          <h1 className="text-[20px] font-bold text-[#E7E9EA]">Communities</h1>
        </div>
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-[15px] font-medium transition-colors hover:bg-white/5 ${
                activeTab === tab ? 'text-[#E7E9EA]' : 'text-[#71767B]'
              }`}
            >
              <span className="relative inline-block">
                {tab}
                {activeTab === tab && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[4px] rounded-full bg-[#00BA7C]" />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Community grid */}
      <div className="p-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {COMMUNITIES.map((community) => (
          <div
            key={community.id}
            className="overflow-hidden rounded-2xl border border-[#2F3336] bg-[#16181C]"
          >
            {/* Banner placeholder */}
            <div className="h-24 bg-gradient-to-br from-[#2F3336] to-[#1a1d21]" />

            <div className="p-4">
              <h3 className="text-[15px] font-bold text-[#E7E9EA] leading-tight">{community.name}</h3>
              <p className="mt-0.5 text-[13px] text-[#71767B]">{community.members}</p>
              <p className="mt-2 text-[13px] text-[#E7E9EA] leading-snug">{community.description}</p>

              <button
                type="button"
                onClick={() => toggle(community.id)}
                className={`mt-3 rounded-full px-5 py-1.5 text-[14px] font-bold transition-all ${
                  joinedIds.has(community.id)
                    ? 'border border-[#2F3336] bg-transparent text-[#E7E9EA] hover:border-red-500 hover:text-red-500'
                    : 'bg-[#00BA7C] text-black hover:opacity-90'
                }`}
              >
                {joinedIds.has(community.id) ? 'Joined' : 'Join'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CommunitiesPage;
