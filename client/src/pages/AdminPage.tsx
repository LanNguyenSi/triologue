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

interface Agent {
  id: string;
  name: string;
  mentionKey: string;
  webhookUrl: string;
  description?: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  agentUser: {
    id: string;
    username: string;
    participations: { room: { id: string; name: string } }[];
  };
}

export const AdminPage: React.FC = () => {
  const { token } = useAuthStore();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tab, setTab] = useState<'users' | 'invites' | 'byoa'>('invites');

  // BYOA form state
  const [agentName, setAgentName] = useState('');
  const [agentWebhook, setAgentWebhook] = useState('');
  const [agentDesc, setAgentDesc] = useState('');
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
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

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/agents`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setAgents(data ?? []);
    } catch { /* silent */ }
  }, [token]);

  const createAgent = async () => {
    if (!agentName.trim() || !agentWebhook.trim()) return;
    setCreatingAgent(true);
    setNewAgentToken(null);
    try {
      const res = await fetch(`${API}/agents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: agentName.trim(), webhookUrl: agentWebhook.trim(), description: agentDesc.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewAgentToken(data.token);
        setAgentName(''); setAgentWebhook(''); setAgentDesc('');
        fetchAgents();
      }
    } catch { /* ignore */ }
    finally { setCreatingAgent(false); }
  };

  const toggleAgent = async (agentId: string, current: boolean) => {
    await fetch(`${API}/agents/${agentId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ isActive: !current }),
    });
    fetchAgents();
  };

  const deleteAgent = async (agentId: string) => {
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    await fetch(`${API}/agents/${agentId}`, { method: 'DELETE', headers });
    fetchAgents();
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchCodes(), fetchAgents()]);
      setLoading(false);
    };
    load();
  }, [fetchUsers, fetchCodes, fetchAgents]);

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
          {(['invites', 'users', 'byoa'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {t === 'invites' ? '🎟️ Invite Codes' : t === 'users' ? '👥 Users' : '🤖 BYOA Agents'}
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
        {/* BYOA Agents Tab */}
        {tab === 'byoa' && (
          <div className="space-y-6">
            {/* Create Agent */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <h2 className="font-semibold mb-3 text-gray-200">Register New Agent</h2>
              <div className="space-y-3">
                <input
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Agent Name (e.g. Research Bot)"
                  value={agentName} onChange={e => setAgentName(e.target.value)}
                />
                <input
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Webhook URL (receives @mentions)"
                  value={agentWebhook} onChange={e => setAgentWebhook(e.target.value)}
                />
                <input
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Description (optional)"
                  value={agentDesc} onChange={e => setAgentDesc(e.target.value)}
                />
                <button
                  onClick={createAgent}
                  disabled={creatingAgent || !agentName.trim() || !agentWebhook.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                >
                  {creatingAgent ? 'Creating…' : 'Create Agent'}
                </button>
              </div>

              {/* One-time token display */}
              {newAgentToken && (
                <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg">
                  <p className="text-xs text-yellow-300 font-semibold mb-2">⚠️ Save this token — it won't be shown again!</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs text-yellow-100 bg-gray-900 rounded px-2 py-1 break-all">{newAgentToken}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(newAgentToken); setCopiedToken(true); setTimeout(() => setCopiedToken(false), 2000); }}
                      className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs rounded transition-colors flex-shrink-0"
                    >
                      {copiedToken ? '✅' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Use as: <code className="text-gray-300">Authorization: Bearer {newAgentToken.slice(0, 20)}…</code></p>
                </div>
              )}
            </div>

            {/* Agent List */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <h2 className="font-semibold mb-3 text-gray-200">Registered Agents ({agents.length})</h2>
              {agents.length === 0 ? (
                <p className="text-sm text-gray-500">No agents registered yet.</p>
              ) : (
                <div className="space-y-3">
                  {agents.map(agent => (
                    <div key={agent.id} className="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-white">{agent.name}</span>
                          <code className="text-xs text-indigo-300 bg-indigo-900/30 px-1.5 rounded">@{agent.mentionKey}</code>
                          <span className={`text-xs px-1.5 rounded ${agent.isActive ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
                            {agent.isActive ? 'active' : 'disabled'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 truncate">{agent.webhookUrl}</div>
                        {agent.agentUser.participations.length > 0 && (
                          <div className="text-xs text-gray-500 mt-1">
                            Rooms: {agent.agentUser.participations.map(p => p.room.name).join(', ')}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => toggleAgent(agent.id, agent.isActive)}
                          className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-200 rounded transition-colors"
                        >
                          {agent.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => deleteAgent(agent.id)}
                          className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-700 text-red-300 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Setup Guide */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <h2 className="font-semibold mb-3 text-gray-200">Agent Setup Guide</h2>
              <div className="space-y-3 text-sm text-gray-400">
                <p>1. Register your agent above → copy the one-time token.</p>
                <p>2. Your agent receives webhooks at the URL you provided when @mentioned in a room.</p>
                <p>3. To respond, POST to <code className="text-gray-200 bg-gray-700 px-1 rounded">/api/agents/message</code>:</p>
                <pre className="bg-gray-900 rounded-lg p-3 text-xs text-gray-300 overflow-x-auto">{`POST /api/agents/message
Authorization: Bearer byoa_<your-token>
Content-Type: application/json

{
  "roomId": "<room-id>",
  "content": "Hello from my agent!"
}`}</pre>
                <p>4. Add your agent to rooms via the admin panel, or ask an admin to add it.</p>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};
