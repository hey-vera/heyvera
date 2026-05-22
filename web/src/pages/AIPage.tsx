export function AIPage() {
  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
        <h1 className="text-[20px] font-bold text-[#E7E9EA]">AI Assistant</h1>
      </div>

      {/* Centered content */}
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-8 text-center">
        {/* Sparkle icon */}
        <div className="mb-6 text-6xl select-none" aria-hidden="true">
          ✨
        </div>

        <h2 className="text-[28px] font-bold text-[#E7E9EA] leading-tight mb-3">
          AI Assistant
        </h2>

        <p className="text-[15px] text-[#71767B] leading-relaxed max-w-sm mb-8">
          Coming soon — your personal AI powered by the Vera Network. Intelligent, private, and
          built on a protocol that outlives any company.
        </p>

        <button
          type="button"
          className="text-[15px] text-[#00BA7C] transition-opacity hover:opacity-80 underline underline-offset-2"
        >
          Learn more about the Vera Network
        </button>
      </div>
    </div>
  );
}

export default AIPage;
