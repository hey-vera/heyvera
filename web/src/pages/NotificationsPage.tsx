import { useState } from 'react';

const TABS = ['All', 'Verified'] as const;
type Tab = typeof TABS[number];

interface Notification {
  id: string;
  type: 'like' | 'repost' | 'follow' | 'mention';
  icon: string;
  avatars: string[];
  text: string;
  preview?: string;
}

const NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    type: 'like',
    icon: '♥',
    avatars: ['A', 'B', 'C'],
    text: 'vera_agent, somaprotocol, and 2 others liked your post',
    preview: 'The future of distributed identity is here — and it runs on Soma...',
  },
  {
    id: '2',
    type: 'repost',
    icon: '🔁',
    avatars: ['D'],
    text: 'rustdev reposted your post',
    preview: 'One Rust binary to rule them all — Cortex backend architecture...',
  },
  {
    id: '3',
    type: 'follow',
    icon: '👤',
    avatars: ['E', 'F'],
    text: 'heyvera_official and veranetwork followed you',
  },
  {
    id: '4',
    type: 'mention',
    icon: '💬',
    avatars: ['G'],
    text: 'agent_zero mentioned you in a post',
    preview: 'Hey @you — check out what we built with the Vera Network last week...',
  },
];

const ICON_BG: Record<Notification['type'], string> = {
  like: 'text-pink-500',
  repost: 'text-[#00BA7C]',
  follow: 'text-[#00BA7C]',
  mention: 'text-blue-400',
};

const AVATAR_COLORS = ['bg-[#2F3336]', 'bg-[#3a3f45]', 'bg-[#454b52]', 'bg-[#505860]'];

export function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('All');

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md">
        <div className="px-4 py-3">
          <h1 className="text-[20px] font-bold text-[#E7E9EA]">Notifications</h1>
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

      {/* Notification items */}
      {NOTIFICATIONS.length > 0 ? (
        <div>
          {NOTIFICATIONS.map((notif) => (
            <div
              key={notif.id}
              className="flex gap-3 border-b border-[#2F3336] px-4 py-3 transition-colors hover:bg-white/5 cursor-pointer"
            >
              {/* Type icon */}
              <div className={`flex-shrink-0 w-10 text-center text-xl pt-1 ${ICON_BG[notif.type]}`}>
                {notif.icon}
              </div>

              <div className="flex-1 min-w-0">
                {/* Stacked avatars */}
                <div className="flex gap-1 mb-2">
                  {notif.avatars.map((label, i) => (
                    <div
                      key={`${notif.id}-avatar-${i}`}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-[#E7E9EA] ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                    >
                      {label}
                    </div>
                  ))}
                </div>

                {/* Description */}
                <p className="text-[15px] text-[#E7E9EA] leading-snug">{notif.text}</p>

                {/* Post preview */}
                {notif.preview && (
                  <p className="mt-1 text-[13px] text-[#71767B] truncate">{notif.preview}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-[#71767B]">
          <p className="text-[15px]">Nothing yet</p>
        </div>
      )}
    </div>
  );
}

export default NotificationsPage;
