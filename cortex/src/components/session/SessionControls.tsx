import { Bot, Brain, Gauge } from 'lucide-react';
import type {
  ChatSessionControls,
  SessionAutonomy,
  SessionIntelligence,
  SessionSpeed,
} from '../../types';

interface SessionControlsProps {
  value: ChatSessionControls;
  onChange: (next: ChatSessionControls) => void;
}

interface ControlConfig<TValue extends string> {
  label: string;
  icon: typeof Gauge;
  values: readonly TValue[];
  labels: Record<TValue, string>;
}

const SPEED_LABELS: Record<SessionSpeed, string> = {
  steady: 'Steady',
  balanced: 'Balanced',
  rapid: 'Rapid',
};

const INTELLIGENCE_LABELS: Record<SessionIntelligence, string> = {
  focused: 'Focused',
  balanced: 'Balanced',
  deep: 'Deep',
};

const AUTONOMY_LABELS: Record<SessionAutonomy, string> = {
  manual: 'Manual',
  guided: 'Guided',
  smart_auto: 'Smart Auto',
  full_auto: 'Full Auto',
  custom: 'Custom',
};

const CONTROL_CONFIGS: [
  ControlConfig<SessionSpeed>,
  ControlConfig<SessionIntelligence>,
  ControlConfig<SessionAutonomy>,
] = [
  {
    label: 'Speed',
    icon: Gauge,
    values: ['steady', 'balanced', 'rapid'],
    labels: SPEED_LABELS,
  },
  {
    label: 'Intelligence',
    icon: Brain,
    values: ['focused', 'balanced', 'deep'],
    labels: INTELLIGENCE_LABELS,
  },
  {
    label: 'Autonomy',
    icon: Bot,
    values: ['manual', 'guided', 'smart_auto', 'full_auto', 'custom'],
    labels: AUTONOMY_LABELS,
  },
];

const spendOrder = ['lean', 'balanced', 'elevated', 'high'] as const;
type SpendLevel = (typeof spendOrder)[number];

const usageLabels: Record<SpendLevel, string> = {
  lean: 'Lean',
  balanced: 'Balanced',
  elevated: 'Elevated',
  high: 'High',
};

function clampIndex(index: number, max: number) {
  return Math.min(Math.max(index, 0), max);
}

function stepValue<TValue extends string>(values: readonly TValue[], current: TValue, delta: -1 | 1) {
  const currentIndex = values.indexOf(current);
  const nextIndex = clampIndex(currentIndex + delta, values.length - 1);
  return values[nextIndex];
}

function getSpendLevel(value: ChatSessionControls): SpendLevel {
  const speedWeight = { steady: 0, balanced: 1, rapid: 2 }[value.speed];
  const intelligenceWeight = { focused: 0, balanced: 1, deep: 2 }[value.intelligence];
  const autonomyWeight = { manual: 0, guided: 1, smart_auto: 2, full_auto: 3, custom: 2 }[
    value.autonomy
  ];
  const score = speedWeight + intelligenceWeight + autonomyWeight;
  if (score <= 1) return 'lean';
  if (score <= 3) return 'balanced';
  if (score <= 5) return 'elevated';
  return 'high';
}

function getSummary(value: ChatSessionControls, spendLevel: SpendLevel) {
  const speed = SPEED_LABELS[value.speed].toLowerCase();
  const intelligence = INTELLIGENCE_LABELS[value.intelligence].toLowerCase();
  const autonomy = AUTONOMY_LABELS[value.autonomy];
  return `${autonomy} mode, ${speed} pace, ${intelligence} reasoning. Estimated usage: ${usageLabels[spendLevel].toLowerCase()}.`;
}

function Stepper<TValue extends string>({
  config,
  value,
  onChange,
}: {
  config: ControlConfig<TValue>;
  value: TValue;
  onChange: (next: TValue) => void;
}) {
  const currentIndex = config.values.indexOf(value);
  const canStepDown = currentIndex > 0;
  const canStepUp = currentIndex < config.values.length - 1;
  const Icon = config.icon;

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[var(--muted)]">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            {config.label}
          </div>
          <div className="truncate text-sm text-white">{config.labels[value]}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center rounded-lg border border-white/8 bg-black/10">
        <button
          type="button"
          aria-label={`Lower ${config.label}`}
          disabled={!canStepDown}
          onClick={() => onChange(stepValue(config.values, value, -1))}
          className="inline-flex h-8 w-8 items-center justify-center text-sm text-[var(--muted-strong)] transition hover:bg-white/6 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          -
        </button>
        <div className="h-4 w-px bg-white/8" />
        <button
          type="button"
          aria-label={`Raise ${config.label}`}
          disabled={!canStepUp}
          onClick={() => onChange(stepValue(config.values, value, 1))}
          className="inline-flex h-8 w-8 items-center justify-center text-sm text-[var(--muted-strong)] transition hover:bg-white/6 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function SessionControls({ value, onChange }: SessionControlsProps) {
  const spendLevel = getSpendLevel(value);
  const [speedConfig, intelligenceConfig, autonomyConfig] = CONTROL_CONFIGS;

  return (
    <section className="border-t border-white/6 px-3 py-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-[13rem]">
            <Stepper
              config={speedConfig}
              value={value.speed}
              onChange={(next) => onChange({ ...value, speed: next })}
            />
          </div>
          <div className="min-w-0 flex-1 basis-[13rem]">
            <Stepper
              config={intelligenceConfig}
              value={value.intelligence}
              onChange={(next) => onChange({ ...value, intelligence: next })}
            />
          </div>
          <div className="min-w-0 flex-1 basis-[13rem]">
            <Stepper
              config={autonomyConfig}
              value={value.autonomy}
              onChange={(next) => onChange({ ...value, autonomy: next })}
            />
          </div>
          <div className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 text-sm text-[var(--muted-strong)]">
            <Gauge className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Usage
            </span>
            <span className="text-white">{usageLabels[spendLevel]}</span>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {getSummary(value, spendLevel)} Estimate only; backend limits are not wired to these controls yet.
        </p>
      </div>
    </section>
  );
}
