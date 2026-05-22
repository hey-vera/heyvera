import { useState } from 'react';

const TABS = ['For you', 'Trending', 'News', 'Tech', 'AI'] as const;
type Tab = typeof TABS[number];

const TRENDING_ITEMS = [
  { category: 'Technology', topic: '#VeraNetwork', postCount: '12.4K posts' },
  { category: 'AI & Machine Learning', topic: 'Agentic AI', postCount: '8.1K posts' },
  { category: 'Crypto & Web3', topic: '$SOMA', postCount: '5.9K posts' },
  { category: 'Open Source', topic: 'Rust 2025', postCount: '3.7K posts' },
  { category: 'HeyVera', topic: 'Secure Rooms', postCount: '2.2K posts' },
];

export function ExplorePage() {
  const [activeTab, setActiveTab] = useState<Tab>('For you');

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Search bar */}
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md px-4 py-3">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71767B]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.82 5.262l4.529 4.528-1.414 1.414-4.529-4.529A8.457 8.457 0 0 1 10.25 18.75c-4.694 0-8.5-3.806-8.5-8.5z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search HeyVera"
            className="w-full rounded-full border border-[#2F3336] bg-[#16181C] py-3 pl-11 pr-4 text-[15px] text-[#E7E9EA] placeholder-[#71767B] outline-none focus:border-[#00BA7C] transition-colors"
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-[#2F3336] scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-5 py-4 text-[15px] font-medium transition-colors hover:bg-white/5 ${
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

      {/* Trending section */}
      <div className="mt-4 rounded-2xl mx-4 border border-[#2F3336] bg-[#16181C] overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-[20px] font-bold text-[#E7E9EA]">
          Trending
        </h2>
        {TRENDING_ITEMS.map((item, i) => (
          <button
            key={item.topic}
            type="button"
            className={`w-full text-left px-4 py-3 transition-colors hover:bg-white/5 ${
              i < TRENDING_ITEMS.length - 1 ? 'border-b border-[#2F3336]' : ''
            }`}
          >
            <p className="text-xs text-[#71767B] mb-0.5">{item.category}</p>
            <p className="text-[15px] font-bold text-[#E7E9EA] leading-tight">{item.topic}</p>
            <p className="text-xs text-[#71767B] mt-0.5">{item.postCount}</p>
          </button>
        ))}
        <div className="px-4 py-3">
          <button
            type="button"
            className="text-[15px] text-[#00BA7C] transition-opacity hover:opacity-80"
          >
            Show more
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExplorePage;
