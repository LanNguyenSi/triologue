import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

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

  const token = () => localStorage.getItem('triologue_token');

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
