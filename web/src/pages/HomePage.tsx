import { useState } from 'react';

const TABS = ['For you', 'Following'] as const;
type Tab = typeof TABS[number];

export function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('For you');

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Tab bar */}
      <div className="sticky top-0 z-10 flex border-b border-[#2F3336] bg-black/80 backdrop-blur-md">
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

      {/* Compose box */}
      <div className="border-b border-[#2F3336] px-4 py-3">
        <div className="flex gap-3">
          {/* Avatar */}
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-[#2F3336]" />

          <div className="flex-1">
            <textarea
              placeholder="What's happening?"
              rows={2}
              className="w-full resize-none bg-transparent text-[#E7E9EA] placeholder-[#71767B] text-[20px] outline-none leading-normal"
            />

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between pt-2 border-t border-[#2F3336] mt-2">
              <div className="flex items-center gap-1">
                {/* Image */}
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#00BA7C] transition-colors hover:bg-[#00BA7C]/10"
                  aria-label="Add image"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.783 7 8 7.783 8 8.75s.783 1.75 1.75 1.75 1.75-.783 1.75-1.75S10.717 7 9.75 7z" />
                  </svg>
                </button>
                {/* GIF */}
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#00BA7C] transition-colors hover:bg-[#00BA7C]/10"
                  aria-label="Add GIF"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v13c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-13c0-.276-.224-.5-.5-.5h-13zm3.2 4H7v6h1.5v-2.5h2V11h-2V10.5H11V9H8.7zm6.3 0h-3v6h1.5v-2h1.5v-1.5H14V10.5h1.5v-.5H15V9zm3 0h-1.5v6H18V9z" />
                  </svg>
                </button>
                {/* Poll */}
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#00BA7C] transition-colors hover:bg-[#00BA7C]/10"
                  aria-label="Add poll"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12zm10-8c-4.418 0-8 3.582-8 8s3.582 8 8 8 8-3.582 8-8-3.582-8-8-8zm4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9.5 15a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                className="rounded-full bg-[#00BA7C] px-4 py-1.5 text-[15px] font-bold text-black transition-opacity hover:opacity-90"
              >
                Post
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed placeholder */}
      <div className="flex flex-col items-center justify-center py-20 text-[#71767B]">
        <p className="text-[15px]">Your feed will appear here</p>
      </div>
    </div>
  );
}

export default HomePage;
