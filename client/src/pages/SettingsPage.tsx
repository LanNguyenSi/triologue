import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface MyAgent {
  id: string;
  name: string;
  mentionKey: string;
  webhookUrl: string;
  description?: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export const SettingsPage: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // BYOA state
  const [agents, setAgents] = useState<MyAgent[]>([]);
  const [agentName, setAgentName] = useState('');
  const [agentWebhook, setAgentWebhook] = useState('');
  const [agentDesc, setAgentDesc] = useState('');
  const [agentRoomId, setAgentRoomId] = useState('');
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const token = () => localStorage.getItem('triologue_token');
  const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

  // BYOA: fetch user's agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/mine', { headers: authHeaders() });
      if (res.ok) setAgents(await res.json());
    } catch { /* silent */ }
  }, []);

  // BYOA: fetch joinable rooms
  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.rooms ?? [];
        setRooms(list.map((r: any) => ({ id: r.id, name: r.name })));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAgents(); fetchRooms(); }, [fetchAgents, fetchRooms]);

  const createAgent = async () => {
    if (!agentName.trim() || !agentWebhook.trim()) return;
    setCreatingAgent(true); setNewAgentToken(null);
    try {
      const body: Record<string, string> = { name: agentName.trim(), webhookUrl: agentWebhook.trim(), description: agentDesc.trim() };
      if (agentRoomId) body.roomId = agentRoomId;
      const res = await fetch('/api/agents', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) { setNewAgentToken(data.token); setAgentName(''); setAgentWebhook(''); setAgentDesc(''); setAgentRoomId(''); fetchAgents(); }
    } catch { /* ignore */ }
    finally { setCreatingAgent(false); }
  };

  const deleteAgent = async (agentId: string) => {
    if (!confirm('Delete this agent? This cannot be undone.')) return;
    await fetch(`/api/agents/${agentId}`, { method: 'DELETE', headers: authHeaders() });
    fetchAgents();
  };

  const saveProfile = async () => {
    if (!displayName.trim()) return setProfileMsg('Display name cannot be empty.');
    setIsSaving(true);
    setProfileMsg('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfileMsg('✅ Display name updated!');
        // Update local auth store
        useAuthStore.setState(s => ({ user: s.user ? { ...s.user, displayName: data.user.displayName } : s.user }));
      } else {
        setProfileMsg(`❌ ${data.error}`);
      }
    } catch {
      setProfileMsg('❌ Network error.');
    } finally {
      setIsSaving(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || !newPassword) return setPasswordMsg('All fields required.');
    if (newPassword !== confirmPassword) return setPasswordMsg('New passwords do not match.');
    if (newPassword.length < 8) return setPasswordMsg('Password must be at least 8 characters.');
    setIsSaving(true);
    setPasswordMsg('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg('✅ Password changed!');
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      } else {
        setPasswordMsg(`❌ ${data.error}`);
      }
    } catch {
      setPasswordMsg('❌ Network error.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== user?.username) return;
    setIsDeleting(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) {
        logout();
        navigate('/');
      }
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 pt-4">
          <Link to="/room/onboarding" className="text-sm text-gray-400 hover:text-white transition-colors">
            ← Back
          </Link>
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>

        {/* Profile section */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Profile</h2>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <div className="text-white bg-gray-700 rounded-lg px-3 py-2 text-sm opacity-60 select-all">
              @{user?.username}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              maxLength={50}
            />
          </div>
          {profileMsg && <p className="text-sm text-gray-300">{profileMsg}</p>}
          <button
            onClick={saveProfile}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            Save Profile
          </button>
        </div>

        {/* Password section */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Change Password</h2>
          {(['Current Password', 'New Password', 'Confirm New Password'] as const).map((label, i) => {
            const vals = [currentPassword, newPassword, confirmPassword];
            const setters = [setCurrentPassword, setNewPassword, setConfirmPassword];
            return (
              <div key={label}>
                <label className="block text-sm text-gray-400 mb-1">{label}</label>
                <input
                  type="password"
                  value={vals[i]}
                  onChange={e => setters[i](e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            );
          })}
          {passwordMsg && <p className="text-sm text-gray-300">{passwordMsg}</p>}
          <button
            onClick={changePassword}
            disabled={isSaving}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            Change Password
          </button>
        </div>

        {/* My Agents (BYOA) */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">My Agents (BYOA)</h2>
            <Link to="/byoa" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">📖 Docs</Link>
          </div>
          <div className="p-3 bg-blue-900/20 border border-blue-700/40 rounded-lg text-xs text-blue-200">
            ℹ️ <strong>Beta:</strong> New agents start as <span className="font-mono bg-gray-700 px-1 rounded">pending</span> and require admin activation. Self-activation coming in a future release.
          </div>

          {/* Register form */}
          <div className="space-y-2">
            <input type="text" placeholder="Agent Name (e.g. Research Bot)" value={agentName}
              onChange={e => setAgentName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="url" placeholder="Webhook URL (your server receives @mentions here)" value={agentWebhook}
              onChange={e => setAgentWebhook(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="text" placeholder="Description (optional)" value={agentDesc}
              onChange={e => setAgentDesc(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
            <select value={agentRoomId} onChange={e => setAgentRoomId(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Add to room (optional)</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button onClick={createAgent} disabled={creatingAgent || !agentName.trim() || !agentWebhook.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors">
              {creatingAgent ? 'Creating…' : 'Register Agent'}
            </button>
          </div>

          {/* One-time token */}
          {newAgentToken && (
            <div className="p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg space-y-2">
              <p className="text-xs text-yellow-300 font-semibold">⚠️ Save this token — shown only once!</p>
              <p className="text-xs text-gray-400">Agent is <span className="text-yellow-300 font-mono">pending</span> — contact admin to activate.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-yellow-100 bg-gray-900 rounded px-2 py-1 break-all">{newAgentToken}</code>
                <button onClick={() => { navigator.clipboard.writeText(newAgentToken); setCopiedToken(true); setTimeout(() => setCopiedToken(false), 2000); }}
                  className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs rounded flex-shrink-0">
                  {copiedToken ? '✅' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Agent list */}
          {agents.length > 0 && (
            <div className="space-y-2">
              {agents.map(agent => (
                <div key={agent.id} className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-white">{agent.name}</span>
                      <code className="text-xs text-indigo-300 bg-indigo-900/30 px-1.5 rounded">@{agent.mentionKey}</code>
                      <span className={`text-xs px-1.5 rounded ${agent.isActive ? 'bg-green-900/40 text-green-300' : 'bg-yellow-900/40 text-yellow-300'}`}>
                        {agent.isActive ? '✅ active' : '⏳ pending'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{agent.webhookUrl}</div>
                  </div>
                  <button onClick={() => deleteAgent(agent.id)}
                    className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-700 text-red-300 rounded transition-colors flex-shrink-0">
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="bg-gray-800 border border-red-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wide">Danger Zone</h2>
          <p className="text-sm text-gray-400">
            Permanently delete your account. Type <span className="text-white font-mono">{user?.username}</span> to confirm.
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            placeholder={user?.username}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            onClick={deleteAccount}
            disabled={isDeleting || deleteConfirm !== user?.username}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
          >
            {isDeleting ? 'Deleting…' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
};
