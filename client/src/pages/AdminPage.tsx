/**
 * AdminPage — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const API = import.meta.env.VITE_API_URL ?? '/api';

interface User {
  id: string;
  username: string;
  displayName: string;
  userType: string;
  isAdmin: boolean;
  canTriggerAI: boolean;
  isActive: boolean;
  createdAt: string;
}

interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export const AdminPage: React.FC = () => {
  const { token } = useAuthStore();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [tab, setTab] = useState<'users' | 'invites'>('invites');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New invite form state
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/users`, { headers });
      if (res.status === 403) { navigate('/'); return; }
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch { setError('Failed to load users'); }
  }, [token]);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch(`${API}/admin/invite-codes`, { headers });
      if (res.status === 403) { navigate('/'); return; }
      const data = await res.json();
      setCodes(data.codes ?? []);
    } catch { setError('Failed to load invite codes'); }
  }, [token]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchCodes()]);
      setLoading(false);
    };
    load();
  }, [fetchUsers, fetchCodes]);

  const toggleAITrigger = async (username: string, current: boolean) => {
    try {
      await fetch(`${API}/admin/users/${username}/ai-trigger`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ canTriggerAI: !current }),
      });
      setUsers(u => u.map(x => x.username === username ? { ...x, canTriggerAI: !current } : x));
    } catch { setError('Failed to update user'); }
  };

  const createCode = async () => {
    setCreating(true);
    try {
      const res = await fetch(`${API}/admin/invite-codes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ maxUses, expiresInDays: expiresInDays || undefined }),
      });
      const data = await res.json();
      if (data.invite) setCodes(c => [data.invite, ...c]);
    } catch { setError('Failed to create code'); }
    setCreating(false);
  };

  const deleteCode = async (code: string) => {
    try {
      await fetch(`${API}/admin/invite-codes/${code}`, { method: 'DELETE', headers });
      setCodes(c => c.filter(x => x.code !== code));
    } catch { setError('Failed to delete code'); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const getShareUrl = (code: string) =>
    `${window.location.origin}/register?invite=${code}`;

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
      Loading admin panel...
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white text-sm">← Back</button>
          <h1 className="text-2xl font-bold">🔧 Admin Panel</h1>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-600 rounded-lg text-red-200 text-sm">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['invites', 'users'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {t === 'invites' ? '🎟️ Invite Codes' : '👥 Users'}
            </button>
          ))}
        </div>

        {/* Invite Codes Tab */}
        {tab === 'invites' && (
          <div className="space-y-6">
            {/* Create New */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <h2 className="font-semibold mb-3 text-gray-200">Create Invite Code</h2>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Uses</label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={e => setMaxUses(Number(e.target.value))}
                    className="w-24 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Expires (days, optional)</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Never"
                    value={expiresInDays}
                    onChange={e => setExpiresInDays(e.target.value ? Number(e.target.value) : '')}
                    className="w-28 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={createCode}
                  disabled={creating}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : '+ Generate Code'}
                </button>
              </div>
            </div>

            {/* Code List */}
            <div className="space-y-2">
              {codes.length === 0 ? (
                <p className="text-gray-400 text-sm">No invite codes yet. Create one above.</p>
              ) : codes.map(c => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                const exhausted = c.useCount >= c.maxUses;
                const active = !expired && !exhausted;
                return (
                  <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
                    active ? 'bg-gray-800 border-gray-700' : 'bg-gray-800/50 border-gray-700/50 opacity-60'
                  }`}>
                    {/* Code */}
                    <span className="font-mono font-bold text-sm tracking-wider text-blue-300 min-w-[7rem] flex-shrink-0">
                      {c.code}
                    </span>
                    {/* Status */}
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      active ? 'bg-green-900/40 text-green-300' :
                      expired ? 'bg-red-900/40 text-red-300' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {expired ? 'Expired' : exhausted ? 'Used up' : 'Active'}
                    </span>
                    {/* Uses */}
                    <span className="text-xs text-gray-400">{c.useCount}/{c.maxUses} uses</span>
                    {/* Expiry */}
                    {c.expiresAt && (
                      <span className="text-xs text-gray-500 hidden sm:block">
                        Expires {new Date(c.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                    {/* Actions */}
                    <div className="ml-auto flex gap-2">
                      {active && (
                        <button
                          onClick={() => copyCode(getShareUrl(c.code))}
                          className="text-xs px-2 py-1 bg-blue-800/50 hover:bg-blue-700/50 rounded text-blue-300 transition-colors"
                        >
                          {copied === c.code ? '✓ Copied!' : '🔗 Copy Link'}
                        </button>
                      )}
                      <button
                        onClick={() => deleteCode(c.code)}
                        className="text-xs px-2 py-1 bg-red-900/30 hover:bg-red-800/50 rounded text-red-400 transition-colors"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Users Tab */}
        {tab === 'users' && (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg border border-gray-700">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm flex-shrink-0">
                  {u.userType === 'HUMAN' ? '👨‍💻' : u.userType === 'AI_LAVA' ? '🌋' : u.userType === 'AI_ICE' ? '🧊' : '🤖'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {u.displayName}
                    {u.isAdmin && <span className="text-xs bg-yellow-900/40 text-yellow-300 px-1.5 rounded">admin</span>}
                  </div>
                  <div className="text-xs text-gray-400">@{u.username} · {u.userType}</div>
                </div>
                {/* canTriggerAI toggle */}
                {u.userType === 'HUMAN' && (
                  <button
                    onClick={() => toggleAITrigger(u.username, u.canTriggerAI)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      u.canTriggerAI
                        ? 'bg-green-900/40 text-green-300 hover:bg-red-900/40 hover:text-red-300'
                        : 'bg-gray-700 text-gray-400 hover:bg-green-900/40 hover:text-green-300'
                    }`}
                    title={u.canTriggerAI ? 'Click to disable AI trigger' : 'Click to enable AI trigger'}
                  >
                    <span>{u.canTriggerAI ? '✅' : '🚫'}</span>
                    <span>@AI {u.canTriggerAI ? 'ON' : 'OFF'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
