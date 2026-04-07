/**
 * Tiny inline sparkline — pure SVG, no dependencies.
 * Shows a 7-point line with a subtle area fill.
 */
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ data, width = 80, height = 24, className }: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1); // avoid division by zero
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * innerW;
    const y = padding + innerH - ((v - min) / range) * innerH;
    return `${x},${y}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${padding + innerW},${padding + innerH} L ${padding},${padding + innerH} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <path
        d={areaPath}
        fill="var(--color-primary)"
        fillOpacity={0.1}
      />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      {data.length > 0 && (
        <circle
          cx={padding + innerW}
          cy={padding + innerH - ((data[data.length - 1] - min) / range) * innerH}
          r={2}
          fill="var(--color-primary)"
        />
      )}
    </svg>
  );
}
