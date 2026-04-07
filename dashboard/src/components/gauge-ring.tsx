/**
 * Circular gauge ring — pure SVG.
 * Shows a percentage as a partial ring with a centered label.
 */
interface GaugeRingProps {
  value: number; // 0-100
  label: string;
  sublabel?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function GaugeRing({
  value,
  label,
  sublabel,
  size = 100,
  strokeWidth = 8,
  className,
}: GaugeRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={strokeWidth}
        />
        {/* Value arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-bold leading-none">{label}</span>
        {sublabel && (
          <span className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</span>
        )}
      </div>
    </div>
  );
}
