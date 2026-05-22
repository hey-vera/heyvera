import { useState } from 'react';
import { useParams } from 'react-router-dom';

const TABS = ['Posts', 'Replies', 'Media', 'Likes'] as const;
type Tab = typeof TABS[number];

export function ProfilePage() {
  const { handle } = useParams<{ handle?: string }>();
  const displayHandle = handle ?? 'yourhandle';
  const [activeTab, setActiveTab] = useState<Tab>('Posts');

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Top nav bar */}
      <div className="sticky top-0 z-10 flex items-center gap-6 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
        <button type="button" className="text-[#E7E9EA] hover:opacity-70 transition-opacity" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" />
          </svg>
        </button>
        <div>
          <h1 className="text-[20px] font-bold text-[#E7E9EA] leading-tight">
            {handle ? handle : 'Your Name'}
          </h1>
          <p className="text-[13px] text-[#71767B]">0 posts</p>
        </div>
      </div>

      {/* Banner */}
      <div className="relative">
        <div className="h-[200px] w-full bg-gradient-to-br from-[#2F3336] to-[#1a1d21]" />

        {/* Avatar overlapping banner */}
        <div className="absolute -bottom-16 left-4">
          <div className="h-[134px] w-[134px] rounded-full border-4 border-black bg-[#2F3336]" />
        </div>

        {/* Edit profile button */}
        <div className="absolute bottom-3 right-4">
          <button
            type="button"
            className="rounded-full border border-[#2F3336] px-4 py-1.5 text-[14px] font-bold text-[#E7E9EA] transition-colors hover:bg-white/5"
          >
            Edit profile
          </button>
        </div>
      </div>

      {/* Profile info */}
      <div className="mt-20 px-4 pb-4">
        <h2 className="text-[20px] font-bold text-[#E7E9EA] leading-tight">
          {handle ? handle : 'Your Name'}
        </h2>
        <p className="text-[15px] text-[#71767B]">@{displayHandle}</p>

        <p className="mt-3 text-[15px] text-[#E7E9EA] leading-relaxed">
          Building on the Vera Network. Rust enthusiast. Ships things that last.
        </p>

        <div className="mt-2 flex items-center gap-1 text-[#71767B]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4V3h2v1h6V3h2v1h1.5C19.881 4 21 5.119 21 6.5v14c0 1.381-1.119 2.5-2.5 2.5h-15C2.119 23 1 21.881 1 20.5v-14C1 5.119 2.119 4 3.5 4H5V3h2v1h0zm-2 2H3.5c-.276 0-.5.224-.5.5v14c0 .276.224.5.5.5h15c.276 0 .5-.224.5-.5v-14c0-.276-.224-.5-.5-.5H17v1h-2V6H9v1H7V6H5zm0 6h2v2H5v-2zm0 4h2v2H5v-2zm4-4h2v2H9v-2zm0 4h2v2H9v-2zm4-4h2v2h-2v-2zm0 4h2v2h-2v-2z" />
          </svg>
          <span className="text-[13px]">Joined May 2026</span>
        </div>

        {/* Following / Followers */}
        <div className="mt-3 flex gap-5">
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold text-[#E7E9EA]">142</span>
            <span className="text-[#71767B]">Following</span>
          </button>
          <button type="button" className="flex gap-1 text-[15px] transition-colors hover:underline">
            <span className="font-bold text-[#E7E9EA]">83</span>
            <span className="text-[#71767B]">Followers</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#2F3336]">
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

      {/* Posts placeholder */}
      <div className="flex flex-col items-center justify-center py-20 text-[#71767B]">
        <p className="text-[15px]">No posts yet</p>
      </div>
    </div>
  );
}

export default ProfilePage;
