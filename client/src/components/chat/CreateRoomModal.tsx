import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button, Input } from '../ui/primitives';

interface CreateRoomModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string, roomType: string, isPrivate: boolean) => Promise<void>;
}

const DEFAULT_ROOM_TYPE = 'TRIOLOGUE';

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ onClose, onCreate }) => {
  const { user } = useAuthStore();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isAdmin = user?.isAdmin ?? false;
  const [name, setName] = useState('');

  // B1: ESC closes modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const [description, setDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) { setError(t('chat.roomNameRequired')); return; }

    setLoading(true);
    setError('');
    try {
      await onCreate(name.trim(), description.trim(), DEFAULT_ROOM_TYPE, isPrivate);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-modal-title"
    >
      <div className={`border rounded-xl shadow-elevated w-full max-w-md mx-4 ${
        isDark ? 'bg-gray-800 border-gray-700/50' : 'bg-white border-gray-200/60'
      }`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`flex items-center justify-between p-5 border-b ${
          isDark ? 'border-gray-700/50' : 'border-gray-200/60'
        }`}>
          <h2 id="create-room-modal-title" className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {t('chat.createRoom')}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label={t('chat.cancel')}
          >
            <XMarkIcon className="w-5 h-5" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="create-room-name" className={`block text-sm font-medium mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {t('chat.roomName')} <span className="text-red-400">*</span>
            </label>
            <Input
              id="create-room-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('chat.roomNamePlaceholder')}
              maxLength={50}
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="create-room-description" className={`block text-sm font-medium mb-1 ${
              isDark ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {t('chat.description')}
            </label>
            <Input
              id="create-room-description"
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder={t('chat.descriptionPlaceholder')}
              maxLength={200}
            />
          </div>

          {/* Private toggle */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${
            isAdmin
              ? theme === 'dark' ? 'bg-gray-700/50' : 'bg-gray-50'
              : 'opacity-60'
          }`}>
            <div>
              <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {t('chat.privateRoom')}
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {isAdmin
                  ? t('chat.onlyInvited')
                  : t('chat.publicNotAvailable')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => isAdmin && setIsPrivate(!isPrivate)}
              disabled={!isAdmin}
              aria-pressed={isPrivate}
              aria-label={t('chat.privateRoom')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
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
            <div className={`text-sm rounded-lg p-2 border ${isDark ? 'text-red-300 bg-red-900/30 border-red-700/40' : 'text-red-700 bg-red-50 border-red-200/60'}`}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
            >
              {t('chat.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex-1"
            >
              {loading ? t('chat.creating') : t('chat.createRoomButton')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
