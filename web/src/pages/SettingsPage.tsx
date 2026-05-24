import { useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  Lock,
  Mail,
  MessageCircle,
  Monitor,
  Palette,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Type,
  User,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Section = 'account' | 'privacy' | 'notifications' | 'billing' | 'display' | 'data';

interface SectionMeta {
  id: Section;
  label: string;
  description: string;
  Icon: LucideIcon;
  controls: SettingControl[];
}

interface BaseControl {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
}

interface ToggleControl extends BaseControl {
  kind: 'toggle';
  enabled: boolean;
}

interface ChoiceControl extends BaseControl {
  kind: 'choice';
  options: string[];
  selected: string;
}

interface ActionControl extends BaseControl {
  kind: 'action';
  actionLabel: string;
  tone?: 'danger' | 'premium';
}

type SettingControl = ToggleControl | ChoiceControl | ActionControl;

const SECTIONS: SectionMeta[] = [
  {
    id: 'account',
    label: 'Account',
    description: 'Manage identity, sign-in, and account lifecycle settings.',
    Icon: User,
    controls: [
      {
        id: 'profile-visibility',
        kind: 'choice',
        label: 'Profile visibility',
        description: 'Choose how much of your profile appears to people who are not signed in.',
        Icon: User,
        options: ['Public', 'Signed-in users', 'Followers only'],
        selected: 'Public',
      },
      {
        id: 'two-factor',
        kind: 'toggle',
        label: 'Two-step verification',
        description: 'Require a second verification step for new sign-ins.',
        Icon: Lock,
        enabled: true,
      },
      {
        id: 'login-alerts',
        kind: 'toggle',
        label: 'Login alerts',
        description: 'Send an alert when your account signs in from a new device.',
        Icon: Mail,
        enabled: true,
      },
      {
        id: 'deactivate',
        kind: 'action',
        label: 'Deactivate account',
        description: 'Temporarily hide your profile and pause posting access.',
        Icon: Trash2,
        actionLabel: 'Review',
        tone: 'danger',
      },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Control discoverability, messages, and safety defaults.',
    Icon: Shield,
    controls: [
      {
        id: 'protected-posts',
        kind: 'toggle',
        label: 'Protected posts',
        description: 'Only approved followers can view posts you publish after this is enabled.',
        Icon: Shield,
        enabled: false,
      },
      {
        id: 'message-requests',
        kind: 'choice',
        label: 'Direct message requests',
        description: 'Decide who can start a new conversation with you.',
        Icon: MessageCircle,
        options: ['Everyone', 'Verified users', 'People you follow'],
        selected: 'Verified users',
      },
      {
        id: 'discoverability',
        kind: 'toggle',
        label: 'Find me by email or phone',
        description: 'Allow people with your contact info to discover your account.',
        Icon: Smartphone,
        enabled: false,
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Tune push, email, and conversation signal quality.',
    Icon: Bell,
    controls: [
      {
        id: 'push-notifications',
        kind: 'toggle',
        label: 'Push notifications',
        description: 'Receive important alerts on this device.',
        Icon: Smartphone,
        enabled: true,
      },
      {
        id: 'email-digest',
        kind: 'choice',
        label: 'Email digest',
        description: 'Get a summary of activity from posts, mentions, and communities.',
        Icon: Mail,
        options: ['Off', 'Daily', 'Weekly'],
        selected: 'Weekly',
      },
      {
        id: 'conversation-quality',
        kind: 'toggle',
        label: 'Quality filter',
        description: 'Filter repetitive or low-confidence notifications from the main tab.',
        Icon: Zap,
        enabled: true,
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing & Premium',
    description: 'Review subscription status, usage, and payment preferences.',
    Icon: CreditCard,
    controls: [
      {
        id: 'premium-plan',
        kind: 'choice',
        label: 'Premium plan',
        description: 'Your current Premium billing cadence.',
        Icon: Star,
        options: ['Monthly $6.99', 'Annual $69'],
        selected: 'Annual $69',
      },
      {
        id: 'usage-alerts',
        kind: 'toggle',
        label: 'Usage alerts',
        description: 'Notify me before premium AI usage reaches the monthly limit.',
        Icon: Bell,
        enabled: true,
      },
      {
        id: 'manage-billing',
        kind: 'action',
        label: 'Payment methods',
        description: 'Update saved payment methods and download billing history.',
        Icon: CreditCard,
        actionLabel: 'Manage',
        tone: 'premium',
      },
    ],
  },
  {
    id: 'display',
    label: 'Display',
    description: 'Adjust density, typography, and motion for the dark interface.',
    Icon: Monitor,
    controls: [
      {
        id: 'text-size',
        kind: 'choice',
        label: 'Text size',
        description: 'Set the default reading size across timelines and panels.',
        Icon: Type,
        options: ['Compact', 'Default', 'Large'],
        selected: 'Default',
      },
      {
        id: 'timeline-density',
        kind: 'choice',
        label: 'Timeline density',
        description: 'Control spacing between posts and secondary metadata.',
        Icon: Palette,
        options: ['Comfortable', 'Balanced', 'Dense'],
        selected: 'Balanced',
      },
      {
        id: 'reduce-motion',
        kind: 'toggle',
        label: 'Reduce motion',
        description: 'Limit animated transitions while keeping core feedback visible.',
        Icon: Monitor,
        enabled: false,
      },
    ],
  },
  {
    id: 'data',
    label: 'AI & Data',
    description: 'Set AI personalization, memory, and export preferences.',
    Icon: Sparkles,
    controls: [
      {
        id: 'ai-personalization',
        kind: 'toggle',
        label: 'Personalized AI assistance',
        description: 'Use your activity and preferences to improve assistant responses.',
        Icon: Sparkles,
        enabled: true,
      },
      {
        id: 'memory-retention',
        kind: 'choice',
        label: 'AI memory retention',
        description: 'Choose how long helpful assistant context remains available.',
        Icon: Database,
        options: ['Off', '30 days', 'Until deleted'],
        selected: '30 days',
      },
      {
        id: 'export-data',
        kind: 'action',
        label: 'Download account data',
        description: 'Prepare an archive of your posts, profile, and AI settings.',
        Icon: Database,
        actionLabel: 'Request',
      },
    ],
  },
];

const INITIAL_TOGGLES = SECTIONS.reduce<Record<string, boolean>>((settings, section) => {
  section.controls.forEach((control) => {
    if (control.kind === 'toggle') {
      settings[control.id] = control.enabled;
    }
  });
  return settings;
}, {});

const INITIAL_CHOICES = SECTIONS.reduce<Record<string, string>>((settings, section) => {
  section.controls.forEach((control) => {
    if (control.kind === 'choice') {
      settings[control.id] = control.selected;
    }
  });
  return settings;
}, {});

function ToggleSwitch({ checked }: { checked: boolean }) {
  return (
    <span
      className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--border-secondary)] bg-[var(--bg-elevated)]'
      }`}
      aria-hidden="true"
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[var(--text-primary)] transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </span>
  );
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>('account');
  const [showPanelOnMobile, setShowPanelOnMobile] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>(INITIAL_TOGGLES);
  const [choices, setChoices] = useState<Record<string, string>>(INITIAL_CHOICES);

  const currentSection = SECTIONS.find((section) => section.id === activeSection) ?? SECTIONS[0];

  const selectSection = (section: Section) => {
    setActiveSection(section);
    setShowPanelOnMobile(true);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="sticky top-[var(--top-bar-height)] z-10 border-b border-[var(--border-primary)] bg-[color-mix(in_srgb,var(--bg-primary)_82%,transparent)] px-4 py-3 backdrop-blur-md lg:top-0">
        <h1 className="text-[20px] font-bold">Settings</h1>
      </div>

      <div className="flex min-h-[calc(100vh-53px)]">
        <aside
          className={`flex-shrink-0 border-r border-[var(--border-primary)] ${
            showPanelOnMobile ? 'hidden md:flex md:w-[280px] md:flex-col' : 'flex w-full flex-col md:w-[280px]'
          }`}
        >
          {SECTIONS.map((section) => {
            const isActive = section.id === activeSection;
            const Icon = section.Icon;

            return (
              <button
                key={section.id}
                type="button"
                onClick={() => selectSection(section.id)}
                className={`flex w-full items-center gap-3 border-b border-[var(--border-primary)] px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)] ${
                  isActive ? 'bg-[var(--bg-elevated)]' : ''
                }`}
              >
                <span
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                    isActive
                      ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon size={19} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold">{section.label}</span>
                  <span className="block truncate text-[13px] text-[var(--text-secondary)]">{section.description}</span>
                </span>
                {isActive ? (
                  <Check className="hidden flex-shrink-0 text-[var(--accent)] md:block" size={18} />
                ) : (
                  <ChevronRight className="flex-shrink-0 text-[var(--text-secondary)]" size={18} />
                )}
              </button>
            );
          })}
        </aside>

        <main className={`flex-1 ${showPanelOnMobile ? 'block' : 'hidden md:block'}`}>
          <div className="flex items-center gap-3 border-b border-[var(--border-primary)] px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setShowPanelOnMobile(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
              aria-label="Back to settings sections"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-[20px] font-bold">{currentSection.label}</h2>
              <p className="text-[13px] text-[var(--text-secondary)]">Settings</p>
            </div>
          </div>

          <div className="hidden border-b border-[var(--border-primary)] px-4 py-4 md:block">
            <h2 className="text-[20px] font-bold">{currentSection.label}</h2>
            <p className="mt-1 text-[15px] text-[var(--text-secondary)]">{currentSection.description}</p>
          </div>

          <div className="divide-y divide-[var(--border-primary)]">
            {currentSection.controls.map((control) => {
              const Icon = control.Icon;

              if (control.kind === 'toggle') {
                const checked = toggles[control.id] ?? false;

                return (
                  <button
                    key={control.id}
                    type="button"
                    onClick={() => setToggles((current) => ({ ...current, [control.id]: !checked }))}
                    className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    aria-pressed={checked}
                  >
                    <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{control.label}</span>
                      <span className="mt-1 block text-[13px] leading-5 text-[var(--text-secondary)]">
                        {control.description}
                      </span>
                    </span>
                    <ToggleSwitch checked={checked} />
                  </button>
                );
              }

              if (control.kind === 'choice') {
                const selected = choices[control.id] ?? control.selected;

                return (
                  <div key={control.id} className="px-4 py-4">
                    <div className="flex gap-3">
                      <Icon className="mt-0.5 flex-shrink-0 text-[var(--text-secondary)]" size={20} />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold">{control.label}</h3>
                        <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{control.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {control.options.map((option) => {
                            const isSelected = option === selected;

                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => setChoices((current) => ({ ...current, [control.id]: option }))}
                                className={`min-h-9 rounded-full border px-3 text-[13px] font-bold transition-colors ${
                                  isSelected
                                    ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                                    : 'border-[var(--border-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                                }`}
                              >
                                {option}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={control.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <Icon
                    className={`mt-0.5 flex-shrink-0 ${
                      control.tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--text-secondary)]'
                    }`}
                    size={20}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">{control.label}</span>
                    <span className="mt-1 block text-[13px] leading-5 text-[var(--text-secondary)]">
                      {control.description}
                    </span>
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-bold ${
                      control.tone === 'danger'
                        ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
                        : 'border-[var(--border-secondary)] text-[var(--text-primary)]'
                    }`}
                  >
                    {control.actionLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
