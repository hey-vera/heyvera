import { ArrowRight, Brain, Code, Check, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

export const HOMEPAGE_TITLE = 'Cortex — AI Task Manager That Actually Codes';
export const HOMEPAGE_DESCRIPTION =
  'Cortex orchestrates your entire development workflow. Natural language commands become running code, deployed features, and managed repositories.';

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
          <div className="flex items-center gap-3">
            <Link
              to="/app"
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/6"
            >
              Sign In
            </Link>
            <Link
              to="/app"
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black transition hover:brightness-110"
            >
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
            <Link
              to="/app"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-[var(--accent)] px-6 text-base font-medium text-black transition hover:brightness-110"
            >
              Start Building
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#pricing"
              className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/10 px-6 text-base text-white transition hover:bg-white/6"
            >
              View Pricing
            </a>
          </div>
          {/* Hero demo placeholder */}
          <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-white/10 bg-black/30 px-8 py-16 text-sm text-[var(--muted)]">
            Live demo coming soon
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
                Natural language commands automatically create, assign, and track tasks across your
                team. Cortex understands context and dependencies so nothing falls through the cracks.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Code className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <h3 className="mb-3 text-xl font-semibold text-white">Code Orchestration</h3>
              <p className="text-[var(--muted)]">
                From &ldquo;fix the login bug&rdquo; to deployed code. Cortex reads your codebase,
                writes fixes, runs tests, and creates pull requests — automatically.
              </p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)]/10">
                <Zap className="h-6 w-6 text-[var(--accent)]" />
              </div>
              <h3 className="mb-3 text-xl font-semibold text-white">Sovereignty First</h3>
              <p className="text-[var(--muted)]">
                Your keys, your models, your data. Cortex works with your existing tools and
                subscriptions. No vendor lock-in, no data extraction, no surprises.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-white/6 px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-3xl font-bold text-white lg:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-center text-[var(--muted)]">
            Start free. Upgrade when you need more power.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {/* Free plan */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <p className="text-sm font-medium uppercase tracking-wider text-[var(--muted)]">Free</p>
              <p className="mt-3 text-4xl font-bold text-white">$0</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Forever free</p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--muted)]">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Task Manager
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  1 team group
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Community support
                </li>
              </ul>
              <Link
                to="/app"
                className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg border border-white/10 text-sm font-medium text-white transition hover:bg-white/6"
              >
                Get Started Free
              </Link>
            </div>

            {/* Pro plan */}
            <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-8">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium uppercase tracking-wider text-[var(--accent)]">Pro</p>
                <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                  Save 17% annual
                </span>
              </div>
              <p className="mt-3 text-4xl font-bold text-white">$6.99</p>
              <p className="mt-1 text-sm text-[var(--muted)]">per month, or $69/yr</p>
              <ul className="mt-8 space-y-3 text-sm text-[var(--muted)]">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Unlimited team groups
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Code orchestration runs
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Priority support
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  Sovereignty controls
                </li>
              </ul>
              <Link
                to="/app"
                className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-medium text-black transition hover:brightness-110"
              >
                Start Pro Trial
              </Link>
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
          <Link
            to="/app"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-lg bg-[var(--accent)] px-8 text-base font-medium text-black transition hover:brightness-110"
          >
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/6 px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-[var(--muted)]">
              &copy; 2026 HeyVera. Built with Soma &times; C&sup2; = Vera.
            </p>
            <nav className="flex flex-wrap items-center justify-center gap-5 text-sm text-[var(--muted)]">
              <a href="/privacy" className="transition hover:text-white">
                Privacy Policy
              </a>
              <a href="/terms" className="transition hover:text-white">
                Terms of Service
              </a>
              <a href="mailto:support@heyvera.org" className="transition hover:text-white">
                Contact
              </a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
