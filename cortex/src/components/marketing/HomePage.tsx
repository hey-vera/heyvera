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

      {/* Social Proof */}
      <section className="border-t border-white/6 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-white lg:text-4xl">
            What Teams Are Saying
          </h2>
          <p className="mt-4 text-center text-zinc-400">
            Trusted by teams building the future of software development.
          </p>
          <div className="mt-12 grid gap-6 grid-cols-1 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-6">
              <p className="text-[var(--muted)] leading-relaxed">
                &ldquo;Cortex replaced three tools for us. We describe what we need in plain English
                and it handles the rest — task breakdown, code changes, even the PRs. Our sprint
                velocity doubled in the first month.&rdquo;
              </p>
              <div className="mt-5 border-t border-zinc-700 pt-4">
                <p className="font-semibold text-white">Sarah Chen</p>
                <p className="text-sm text-zinc-400">Engineering Lead, Arcline AI</p>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-6">
              <p className="text-[var(--muted)] leading-relaxed">
                &ldquo;The operations room is a game-changer. Watching agents work through tasks in
                real-time gives us confidence we never had with other automation tools. It feels like
                having a senior engineer on call 24/7.&rdquo;
              </p>
              <div className="mt-5 border-t border-zinc-700 pt-4">
                <p className="font-semibold text-white">Marcus Rivera</p>
                <p className="text-sm text-zinc-400">CTO, Steadyship</p>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-6">
              <p className="text-[var(--muted)] leading-relaxed">
                &ldquo;We were skeptical about AI task managers, but Cortex won us over with
                sovereignty. Our keys, our models, our data — no compromises. It fits into our
                existing workflow instead of replacing it.&rdquo;
              </p>
              <div className="mt-5 border-t border-zinc-700 pt-4">
                <p className="font-semibold text-white">Priya Anand</p>
                <p className="text-sm text-zinc-400">VP of Engineering, NovaBuild</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Details */}
      <section className="border-t border-white/6 px-6 py-24">
        <div className="mx-auto max-w-6xl space-y-24">
          {/* Feature 1: Text left, image right */}
          <div className="grid items-center gap-12 grid-cols-1 lg:grid-cols-2">
            <div>
              <div className="mb-4 text-4xl">💬</div>
              <h3 className="text-2xl font-bold text-white lg:text-3xl">
                Delegate with Natural Language
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
                Stop writing tickets and start talking to your codebase. Describe what you need in
                plain English and Cortex breaks it into executable tasks, assigns the right AI agents,
                and delivers working code.
              </p>
              <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">
                From &ldquo;add dark mode to settings&rdquo; to a deployed feature — no prompt
                engineering required.
              </p>
            </div>
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-800 p-16">
              <p className="text-sm text-zinc-500">Screenshot coming soon</p>
            </div>
          </div>

          {/* Feature 2: Image left, text right */}
          <div className="grid items-center gap-12 grid-cols-1 lg:grid-cols-2">
            <div className="order-2 lg:order-1 flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-800 p-16">
              <p className="text-sm text-zinc-500">Screenshot coming soon</p>
            </div>
            <div className="order-1 lg:order-2">
              <div className="mb-4 text-4xl">👁️</div>
              <h3 className="text-2xl font-bold text-white lg:text-3xl">
                Watch Work Happen in Real-Time
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
                The Operations Room gives you a live view of every agent, every task, and every line
                of code being written. No more black-box automation — see exactly what is happening
                and why.
              </p>
              <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">
                Pause, redirect, or approve work as it flows through your pipeline with full
                transparency.
              </p>
            </div>
          </div>

          {/* Feature 3: Text left, image right */}
          <div className="grid items-center gap-12 grid-cols-1 lg:grid-cols-2">
            <div>
              <div className="mb-4 text-4xl">🚀</div>
              <h3 className="text-2xl font-bold text-white lg:text-3xl">
                Built for Teams That Ship
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">
                Cortex fits into your team&apos;s workflow, not the other way around. Shared task
                boards, collaborative agent sessions, and unified history mean everyone stays aligned
                without extra meetings.
              </p>
              <p className="mt-3 text-lg leading-relaxed text-[var(--muted)]">
                From solo developers to distributed teams — scale your output without scaling your
                headcount.
              </p>
            </div>
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-800 p-16">
              <p className="text-sm text-zinc-500">Screenshot coming soon</p>
            </div>
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
