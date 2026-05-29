import { useState, useEffect } from 'react';
import {
  getRoster,
  promoteCredential,
  revokeCredential,
  type RosterEntry,
} from '../lib/api';

export default function Roster() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await getRoster();
      setRoster(r.roster);
    } catch { /* empty */ }
  }

  useEffect(() => { load(); }, []);

  const activeCount = roster.filter((c) => c.status === 'active' && c.role !== 'recovery').length;

  async function handlePromote(id: string) {
    setActing(id);
    setError(null);
    try {
      const r = await promoteCredential(id);
      setRoster(r.roster);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setActing(null);
    }
  }

  async function handleRevoke(id: string) {
    setActing(id);
    setError(null);
    try {
      const r = await revokeCredential(id);
      setRoster(r.roster);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
      <h2 className="text-xl font-semibold text-white mb-4">Authenticator Roster</h2>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {roster.length === 0 ? (
        <p className="text-neutral-500 text-sm">No credentials registered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-neutral-400 border-b border-neutral-700">
              <tr>
                <th className="py-2 pr-4">Ecosystem</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Credential ID</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Last Used</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              {roster.map((c) => (
                <tr key={c.id} className="border-b border-neutral-800">
                  <td className="py-2 pr-4">{c.ecosystem}</td>
                  <td className="py-2 pr-4">{c.role}</td>
                  <td className="py-2 pr-4">
                    <span className={c.status === 'active' ? 'text-green-400' : 'text-red-400'}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{c.credential_id}</td>
                  <td className="py-2 pr-4 text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-4 text-xs">{c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : '—'}</td>
                  <td className="py-2 space-x-2">
                    {c.status === 'active' && c.role !== 'primary' && c.role !== 'recovery' && (
                      <button
                        onClick={() => handlePromote(c.id)}
                        disabled={acting === c.id}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2 py-1 rounded text-xs"
                      >
                        Promote
                      </button>
                    )}
                    {c.status === 'active' && activeCount > 1 && (
                      <button
                        onClick={() => handleRevoke(c.id)}
                        disabled={acting === c.id}
                        className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 rounded text-xs"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
