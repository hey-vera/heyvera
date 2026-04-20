import { useState, useEffect } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import {
  getRegistrationOptions,
  verifyRegistration,
  getRoster,
  type RosterEntry,
} from '../lib/api';

const ECOSYSTEMS = ['apple', 'google', 'yubikey', 'other'] as const;
const ROLES = ['primary', 'backup'] as const;

export default function Enroll() {
  const [ecosystem, setEcosystem] = useState<string>('apple');
  const [role, setRole] = useState<string>('primary');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  useEffect(() => {
    getRoster().then((r) => setRoster(r.roster)).catch(() => {});
  }, []);

  async function handleEnroll() {
    setStatus({ type: 'loading', message: 'Starting enrollment…' });
    try {
      const { options, challengeKey } = await getRegistrationOptions(ecosystem, role);
      const credential = await startRegistration({ optionsJSON: options });
      await verifyRegistration(credential, challengeKey, ecosystem, role);
      setStatus({ type: 'success', message: 'Credential enrolled successfully.' });
      const r = await getRoster();
      setRoster(r.roster);
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Enrollment failed' });
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-xl font-semibold text-white mb-4">Enroll Credential</h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Ecosystem</label>
            <select
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
            >
              {ECOSYSTEMS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleEnroll}
          disabled={status.type === 'loading'}
          className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded font-medium"
        >
          {status.type === 'loading' ? 'Enrolling…' : 'Enroll Credential'}
        </button>

        {status.type === 'success' && (
          <p className="mt-3 text-green-400 text-sm">{status.message}</p>
        )}
        {status.type === 'error' && (
          <p className="mt-3 text-red-400 text-sm">{status.message}</p>
        )}
      </div>

      <div className="bg-neutral-900 rounded-lg p-6 border border-neutral-800">
        <h2 className="text-xl font-semibold text-white mb-4">Current Roster</h2>
        {roster.length === 0 ? (
          <p className="text-neutral-500 text-sm">No credentials enrolled yet.</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="text-neutral-400 border-b border-neutral-700">
              <tr>
                <th className="py-2 pr-4">Ecosystem</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Credential ID</th>
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
                  <td className="py-2 font-mono text-xs">{c.credential_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
