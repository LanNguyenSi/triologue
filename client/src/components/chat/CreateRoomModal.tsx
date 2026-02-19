import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';

interface CreateRoomModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, roomType: string, isPrivate: boolean) => Promise<void>;
}

// Note: Only TRIOLOGUE is available until DB migration for other types is deployed
const ROOM_TYPES = [
  { value: 'TRIOLOGUE', label: '🧊🌋👨‍💻 Triologue', desc: 'Ice + Lava + Humans' },
];

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ onClose, onCreate }) => {
  const { user } = useAuthStore();
  const isAdmin = (user as any)?.isAdmin ?? false;
  const [name, setName]             = useState('');

  // B1: ESC closes modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const [description, setDesc]      = useState('');
  const [roomType, setRoomType]     = useState('TRIOLOGUE');
  const [isPrivate, setIsPrivate]   = useState(true);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Room name is required'); return; }

    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim(), description.trim(), roomType, isPrivate);
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Create New Room</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Room Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. research-consciousness"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              maxLength={50}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="What is this room for?"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              maxLength={200}
            />
          </div>

          {/* Room Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Room Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ROOM_TYPES.map(rt => (
                <button
                  key={rt.value}
                  type="button"
                  onClick={() => setRoomType(rt.value)}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    roomType === rt.value
                      ? 'border-blue-500 bg-blue-900/30 text-white'
                      : 'border-gray-600 bg-gray-700 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <div className="text-sm font-medium">{rt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{rt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Private toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${isAdmin ? 'bg-gray-700/50' : 'bg-gray-700/30 opacity-60'}`}>
            <div>
              <div className="text-sm font-medium text-white">Private Room</div>
              <div className="text-xs text-gray-400">
                {isAdmin
                  ? 'Only invited members can join'
                  : 'Public rooms are not available in beta'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => isAdmin && setIsPrivate(!isPrivate)}
              disabled={!isAdmin}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isPrivate ? 'bg-blue-600' : 'bg-gray-600'
              } ${!isAdmin ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isPrivate ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? 'Creating...' : 'Create Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
