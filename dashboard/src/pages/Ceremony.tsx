import { useState, useEffect } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  getPendingCeremonies,
  getCeremonyApprovalOptions,
  verifyCeremonyApproval,
  createCeremonyRequest,
  type CeremonyEntry,
} from '../lib/api';

export default function Ceremony() {
  const [ceremonies, setCeremonies] = useState<CeremonyEntry[]>([]);
  const [approving, setApproving] = useState<string | null>(null);
  const [approveStatus, setApproveStatus] = useState<Record<string, { type: 'success' | 'error'; message: string }>>({});
  const [formStatus, setFormStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });

  const [pkg, setPkg] = useState('soma-heart');
  const [version, setVersion] = useState('');
  const [tarball, setTarball] = useState('');
  const [commit, setCommit] = useState('');

  async function loadCeremonies() {
    try {
      const r = await getPendingCeremonies();
      setCeremonies(r.ceremonies);
    } catch { /* empty */ }
  }

  useEffect(() => { loadCeremonies(); }, []);

  async function handleApprove(id: string) {
    setApproving(id);
    setApproveStatus((s) => { const next = { ...s }; delete next[id]; return next; });
    try {
      const { options, challengeKey } = await getCeremonyApprovalOptions(id);
      const credential = await startAuthentication({ optionsJSON: options });
      await verifyCeremonyApproval(id, credential, challengeKey);
      setApproveStatus((s) => ({ ...s, [id]: { type: 'success', message: 'Approved' } }));
      await loadCeremonies();
    } catch (err) {
      setApproveStatus((s) => ({
        ...s,
        [id]: { type: 'error', message: err instanceof Error ? err.message : 'Approval failed' },
      }));
    } finally {
      setApproving(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormStatus({ type: 'loading' });
    try {
      await createCeremonyRequest({
        package: pkg,
        targetVersion: version,
        tarballSha256: tarball,
        gitCommit: commit,
      });
      setFormStatus({ type: 'success', message: 'Ceremony request created.' });
      setVersion('');
      setTarball('');
      setCommit('');
      await loadCeremonies();
    } catch (err) {
      setFormStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to create request' });
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-xl font-semibold text-white mb-4">Pending Ceremonies</h2>
        {ceremonies.length === 0 ? (
          <p className="text-neutral-500 text-sm">No pending ceremonies.</p>
        ) : (
          <div className="space-y-4">
            {ceremonies.map((c) => (
              <div key={c.id} className="bg-neutral-800 rounded p-4 border border-neutral-700">
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-neutral-400">Package: </span>
                    <span className="text-white">{c.package_name}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Version: </span>
                    <span className="text-white">{c.target_version}</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Tarball SHA256: </span>
                    <span className="text-white font-mono text-xs">{c.tarball_sha256.slice(0, 16)}…</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Git Commit: </span>
                    <span className="text-white font-mono text-xs">{c.git_commit.slice(0, 12)}…</span>
                  </div>
                  <div>
                    <span className="text-neutral-400">Expires: </span>
                    <span className="text-white">{new Date(c.expires_at).toLocaleString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleApprove(c.id)}
                  disabled={approving === c.id}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium"
                >
                  {approving === c.id ? 'Authenticating…' : 'Approve'}
                </button>
                {approveStatus[c.id]?.type === 'success' && (
                  <span className="ml-3 text-green-400 text-sm">{approveStatus[c.id].message}</span>
                )}
                {approveStatus[c.id]?.type === 'error' && (
                  <span className="ml-3 text-red-400 text-sm">{approveStatus[c.id].message}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-xl font-semibold text-white mb-4">Create Test Ceremony</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-400 mb-1">Package</label>
              <input
                value={pkg}
                onChange={(e) => setPkg(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-400 mb-1">Version</label>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="0.9.0"
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Tarball SHA256 (64-char hex)</label>
            <input
              value={tarball}
              onChange={(e) => setTarball(e.target.value)}
              placeholder={"a".repeat(64)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white font-mono text-sm"
              pattern="[a-f0-9]{64}"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Git Commit (40-char hex)</label>
            <input
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder={"b".repeat(40)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white font-mono text-sm"
              pattern="[a-f0-9]{40}"
              required
            />
          </div>
          <button
            type="submit"
            disabled={formStatus.type === 'loading'}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium"
          >
            {formStatus.type === 'loading' ? 'Creating…' : 'Create Ceremony Request'}
          </button>
          {formStatus.type === 'success' && (
            <p className="text-green-400 text-sm">{formStatus.message}</p>
          )}
          {formStatus.type === 'error' && (
            <p className="text-red-400 text-sm">{formStatus.message}</p>
          )}
        </form>
      </div>
    </div>
  );
}
