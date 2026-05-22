import { ArrowRight, Brain, Code, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Header */}
      <header className="border-b border-white/6 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-black">
              <Brain className="h-5 w-5" />
            </div>
            <span className="text-xl font-semibold text-white">Cortex</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/app" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/6">
              Launch App
            </Link>
            <Link to="/app" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black transition hover:brightness-110">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-5xl font-bold text-white lg:text-6xl">
            Your AI Task Manager
            <span className="block text-[var(--accent)]">That Actually Codes</span>
          </h1>
          <p className="mt-6 text-xl text-[var(--muted)] lg:text-2xl">
            Cortex orchestrates your entire development workflow. Natural language commands become
            running code, deployed features, and managed repositories.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/app" className="inline-flex h-12 items-center gap-2 rounded-lg bg-[var(--accent)] px-6 text-base font-medium text-black transition hover:brightness-110">
              Start Building
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/10 px-6 text-base text-white transition hover:bg-white/6">
              Watch Demo
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/6 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-white lg:text-4xl">
            Development at the Speed of Thought
          </h2>
          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Brain className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <h3 className="mb-3 text-xl font-semibold text-white">Intelligent Task Management</h3>
              <p className="text-[var(--muted)]">
                Natural language commands automatically create, assign, and track tasks across your team.
                Cortex understands context and dependencies.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Code className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <h3 className="mb-3 text-xl font-semibold text-white">Code Orchestration</h3>
              <p className="text-[var(--muted)]">
                From "fix the login bug" to deployed code. Cortex reads your codebase, writes fixes,
                runs tests, and creates pull requests automatically.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Zap className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <h3 className="mb-3 text-xl font-semibold text-white">Sovereignty First</h3>
              <p className="text-[var(--muted)]">
                Your keys, your models, your data. Cortex works with your existing tools and
                subscriptions. No vendor lock-in, no data extraction.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/6 px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-3xl font-bold text-white lg:text-4xl">
            Ready to 10x Your Development Speed?
          </h2>
          <p className="mt-4 text-lg text-[var(--muted)]">
            Join developers who ship faster with AI-powered task management.
          </p>
          <Link to="/app" className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-[var(--accent)] px-8 text-base font-medium text-black transition hover:brightness-110">
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/6 px-6 py-12">
        <div className="mx-auto max-w-6xl text-center text-sm text-[var(--muted)]">
          <p>© 2026 HeyVera. Built with Soma × C² = Vera.</p>
        </div>
      </footer>
    </div>
  );
}