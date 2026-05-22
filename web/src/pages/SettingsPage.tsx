import { useState } from 'react';

type Section = 'account' | 'privacy' | 'notifications' | 'display' | 'about';

interface SectionMeta {
  id: Section;
  label: string;
  icon: React.ReactNode;
  items: string[];
}

const ChevronRight = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#71767B">
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </svg>
);

const SECTIONS: SectionMeta[] = [
  {
    id: 'account',
    label: 'Your account',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 11.816c-3.307 0-6-2.695-6-6.008 0-3.316 2.693-6.008 6-6.008s6 2.692 6 6.008c0 3.313-2.693 6.008-6 6.008zm0-10.816c-2.69 0-4.878 2.191-4.878 4.808 0 2.616 2.189 4.808 4.878 4.808s4.878-2.192 4.878-4.808c0-2.617-2.189-4.808-4.878-4.808zm7.129 20.016l-.07-.59c-.451-4.001-3.905-7.006-7.955-7.006-4.055 0-7.512 3.006-7.962 7.006l-.069.59H3l.069-.691C3.584 15.343 7.454 12.02 12 12.02c4.551 0 8.418 3.322 8.931 7.305l.069.691h-1.871z" />
      </svg>
    ),
    items: [
      'Change display name',
      'Change username',
      'Change email',
      'Change password',
      'Deactivate account',
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy and safety',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 4l7 3.11V11c0 4.25-2.89 8.22-7 9.43-4.11-1.21-7-5.18-7-9.43V8.11L12 5z" />
      </svg>
    ),
    items: [
      'Protected posts',
      'Blocked accounts',
      'Muted accounts',
      'Direct Messages',
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.996 2c-5.514 0-9.996 4.48-9.996 10s4.482 10 9.996 10C17.514 22 22 17.52 22 12S17.514 2 11.996 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-.75-13h1.5v5.25l4.5 2.67-.75 1.23L11.25 13V7z" />
      </svg>
    ),
    items: [
      'Push notifications',
      'Email notifications',
      'Filters',
    ],
  },
  {
    id: 'display',
    label: 'Display',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5.5A3.5 3.5 0 0 0 4.5 9h-1a4.5 4.5 0 0 1 7.764-3.088A4.5 4.5 0 0 1 19.5 9h-1A3.5 3.5 0 0 0 15 5.5c-.95 0-1.813.38-2.445 1h-2.11A3.484 3.484 0 0 0 8 5.5z" />
      </svg>
    ),
    items: [
      'Dark mode',
      'Font size',
      'Color theme',
    ],
  },
  {
    id: 'about',
    label: 'About',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1.75C6.34 1.75 1.75 6.34 1.75 12S6.34 22.25 12 22.25 22.25 17.66 22.25 12 17.66 1.75 12 1.75zm0 18.5c-4.549 0-8.25-3.701-8.25-8.25S7.451 3.75 12 3.75 20.25 7.451 20.25 12 16.549 20.25 12 20.25zM11 10.5h2v7h-2v-7zm0-3.5h2v2h-2V7z" />
      </svg>
    ),
    items: [
      'Terms of Service',
      'Privacy Policy',
      'Cookie Policy',
      'Version',
    ],
  },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section | null>(null);

  const currentSection = SECTIONS.find((s) => s.id === activeSection);

  return (
    <div className="min-h-screen bg-black text-[#E7E9EA]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#2F3336] bg-black/80 backdrop-blur-md px-4 py-3">
        <h1 className="text-[20px] font-bold text-[#E7E9EA]">Settings</h1>
      </div>

      <div className="flex">
        {/* Left sidebar — always visible on desktop, toggleable on mobile */}
        <aside
          className={`flex-shrink-0 border-r border-[#2F3336] ${
            activeSection ? 'hidden md:flex md:flex-col md:w-[280px]' : 'flex flex-col w-full md:w-[280px]'
          }`}
        >
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={`flex w-full items-center gap-4 border-b border-[#2F3336] px-4 py-4 text-left transition-colors hover:bg-white/5 ${
                activeSection === section.id ? 'bg-white/5' : ''
              }`}
            >
              <span className="text-[#71767B]">{section.icon}</span>
              <span className="flex-1 text-[15px] text-[#E7E9EA] font-medium">{section.label}</span>
              <ChevronRight />
            </button>
          ))}
        </aside>

        {/* Right content area */}
        <main className={`flex-1 ${activeSection ? 'block' : 'hidden md:block'}`}>
          {currentSection ? (
            <div>
              {/* Section header with back button on mobile */}
              <div className="flex items-center gap-4 border-b border-[#2F3336] px-4 py-3 md:hidden">
                <button
                  type="button"
                  onClick={() => setActiveSection(null)}
                  className="text-[#E7E9EA] hover:opacity-70 transition-opacity"
                  aria-label="Back"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" />
                  </svg>
                </button>
                <h2 className="text-[20px] font-bold text-[#E7E9EA]">{currentSection.label}</h2>
              </div>

              <div className="hidden border-b border-[#2F3336] px-4 py-3 md:block">
                <h2 className="text-[20px] font-bold text-[#E7E9EA]">{currentSection.label}</h2>
              </div>

              {currentSection.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="flex w-full items-center justify-between border-b border-[#2F3336] px-4 py-4 text-left transition-colors hover:bg-white/5"
                >
                  <span className="text-[15px] text-[#E7E9EA]">{item}</span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          ) : (
            <div className="hidden items-center justify-center py-20 text-[#71767B] md:flex">
              <p className="text-[15px]">Select a setting to get started</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default SettingsPage;
