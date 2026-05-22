const FEATURES = [
  'Unlimited projects',
  'AI orchestration',
  'Priority support',
  'Verified badge',
  'Extended uploads',
];

interface TierCardProps {
  label: string;
  price: string;
  period: string;
  badge: string;
  badgeHighlight?: boolean;
}

function TierCard({ label, price, period, badge, badgeHighlight }: TierCardProps) {
  return (
    <div className="flex-1 rounded-2xl border border-[#2F3336] bg-[#16181C] p-6 flex flex-col">
      <div className="mb-4">
        <h3 className="text-[15px] font-bold text-[#71767B] uppercase tracking-wide">{label}</h3>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-[36px] font-bold text-[#E7E9EA]">{price}</span>
          <span className="text-[15px] text-[#71767B]">/{period}</span>
        </div>
        <span
          className={`mt-2 inline-block rounded-full px-3 py-0.5 text-[13px] font-medium ${
            badgeHighlight
              ? 'bg-[#00BA7C]/20 text-[#00BA7C]'
              : 'bg-[#2F3336] text-[#71767B]'
          }`}
        >
          {badge}
        </span>
      </div>

      <ul className="flex-1 space-y-3 mb-6">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-center gap-3 text-[15px] text-[#E7E9EA]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00BA7C"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="w-full rounded-full bg-[#00BA7C] py-3 text-[15px] font-bold text-black transition-opacity hover:opacity-90"
      >
        Subscribe
      </button>
    </div>
  );
}

export function PremiumPage() {
  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
        <h1 className="text-[20px] font-bold text-[#E7E9EA]">HeyVera Premium</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Description */}
        <p className="text-[15px] text-[#71767B] leading-relaxed mb-8">
          Unlock the full HeyVera experience. Get a verified badge, AI orchestration, unlimited
          projects, and priority support — all included with your subscription. Cancel any time.
        </p>

        {/* Tier cards */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <TierCard
            label="Monthly"
            price="$6.99"
            period="mo"
            badge="7-day free trial"
          />
          <TierCard
            label="Annual"
            price="$69"
            period="yr"
            badge="Save 17%"
            badgeHighlight
          />
        </div>

        {/* Fine print */}
        <p className="mt-6 text-center text-[13px] text-[#71767B]">
          No credits, no limits. One flat price. By subscribing you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}

export default PremiumPage;
