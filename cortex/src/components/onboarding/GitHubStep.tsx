import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, GitBranch, Loader2 } from 'lucide-react';
import { getGitHubStatus, selectRepos, type GitHubRepo } from '../../lib/cortexApi';
import RepoImport from './RepoImport';

interface GitHubStepProps {
  onNext: () => void;
  onBack: () => void;
}

export default function GitHubStep({ onNext, onBack }: GitHubStepProps) {
  const [linked, setLinked] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const checkGitHub = useCallback(async () => {
    try {
      const status = await getGitHubStatus();
      setLinked(status.linked);
      setUsername(status.username);
      if (status.repos) setRepos(status.repos);
    } catch {
      // GitHub check failed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkGitHub();
  }, [checkGitHub]);

  const toggleRepo = (id: number) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveAndContinue = async () => {
    if (selectedRepos.size > 0) {
      try {
        await selectRepos(Array.from(selectedRepos));
      } catch {
        // non-critical
      }
    }
    onNext();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking GitHub...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-medium text-white">Import a repository</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Import a GitHub repo into your Cortex container and start coding with
          AI right away.
        </p>
      </div>

      {linked && (
        <RepoImport />
      )}

      {!linked ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-white/8 bg-white/4 px-6 py-8">
          <GitBranch className="h-10 w-10 text-[var(--muted)]" />
          <p className="text-center text-sm text-[var(--muted)]">
            Link your GitHub account through your profile settings to let Cortex
            work on your repos. You can do this later.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle className="h-3.5 w-3.5" />
            GitHub connected{username ? ` as ${username}` : ''}
          </div>

          {repos.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-white/8">
              {repos.map((repo) => (
                <label
                  key={repo.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-white/6 px-4 py-3 last:border-0 hover:bg-white/4"
                >
                  <input
                    type="checkbox"
                    checked={selectedRepos.has(repo.id)}
                    onChange={() => toggleRepo(repo.id)}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[var(--accent)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {repo.full_name}
                      </span>
                      {repo.private && (
                        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                          private
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="truncate text-xs text-[var(--muted)]">
                        {repo.description}
                      </p>
                    )}
                  </div>
                  {repo.language && (
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {repo.language}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No repositories found.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-[var(--muted)] transition hover:text-white"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={onNext}
            className="text-xs text-[var(--muted)] transition hover:text-white"
          >
            Skip
          </button>
          <button
            onClick={handleSaveAndContinue}
            className="rounded-lg bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/20"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
