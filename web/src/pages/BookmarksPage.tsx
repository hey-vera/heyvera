export function BookmarksPage() {
  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
        <h1 className="text-[20px] font-bold text-[#E7E9EA]">Bookmarks</h1>
        <p className="text-[13px] text-[#71767B]">@yourhandle</p>
      </div>

      {/* Search bar */}
      <div className="border-b border-[#2F3336] px-4 py-3">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71767B]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.82 5.262l4.529 4.528-1.414 1.414-4.529-4.529A8.457 8.457 0 0 1 10.25 18.75c-4.694 0-8.5-3.806-8.5-8.5z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search bookmarks"
            className="w-full rounded-full border border-[#2F3336] bg-[#16181C] py-2.5 pl-10 pr-4 text-[15px] text-[#E7E9EA] placeholder-[#71767B] outline-none focus:border-[#00BA7C] transition-colors"
          />
        </div>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
        <div className="mb-5 text-5xl text-[#71767B]">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" className="mx-auto text-[#71767B]">
            <path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" />
          </svg>
        </div>
        <h2 className="text-[20px] font-bold text-[#E7E9EA] mb-2">Save posts for later</h2>
        <p className="text-[15px] text-[#71767B] max-w-xs leading-normal">
          Don't lose track of posts you love. Bookmark them and revisit anytime.
        </p>
      </div>
    </div>
  );
}

export default BookmarksPage;
