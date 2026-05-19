import { useState } from 'react';
import Enroll from './pages/Enroll';
import Ceremony from './pages/Ceremony';
import Roster from './pages/Roster';

type Page = 'enroll' | 'ceremonies' | 'roster';

const NAV: { key: Page; label: string }[] = [
  { key: 'enroll', label: 'Enroll' },
  { key: 'ceremonies', label: 'Ceremonies' },
  { key: 'roster', label: 'Roster' },
];

export default function App() {
  const [page, setPage] = useState<Page>('enroll');

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800 bg-neutral-950">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">Soma Signing Authority</h1>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <button
                key={n.key}
                onClick={() => setPage(n.key)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  page === n.key
                    ? 'bg-purple-600 text-white'
                    : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {page === 'enroll' && <Enroll />}
        {page === 'ceremonies' && <Ceremony />}
        {page === 'roster' && <Roster />}
      </main>
    </div>
  );
}
