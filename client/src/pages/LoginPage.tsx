import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuthStore, LoginData, RegisterData } from '../stores/authStore';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';

export const LoginPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [mode, setMode] = useState<'login' | 'register'>(
    location.pathname === '/register' ? 'register' : 'login'
  );

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setError('');
    clearError();
    navigate(newMode === 'login' ? '/login' : '/register', { replace: true });
  };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const userType = 'HUMAN'; // AI agents use REST API, not the browser login
  const [aiToken] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [registrationMode, setRegistrationMode] = useState<'open' | 'invite' | 'closed'>('open');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'taken' | 'available'>('idle');

  const { login, register, isLoading, clearError } = useAuthStore();

  // Fetch server registration mode once on mount
  useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.json())
      .then(d => setRegistrationMode(d.registrationMode ?? 'open'))
      .catch(() => {}); // silent — fallback to 'open'
  }, []);

  // Pre-fill invite code from URL ?invite=XXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) { setInviteCode(code.toUpperCase()); setMode('register'); }
  }, []);

  // Debounced live username availability check
  useEffect(() => {
    if (mode !== 'register' || username.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    clearError();

    // ── Frontend validation ────────────────────────────────────────
    if (mode === 'register') {
      if (!username.trim()) {
        setError(t('error.usernameRequired'));
        return;
      }
      if (username.trim().length < 3) {
        setError(t('error.usernameMin'));
        return;
      }
      if (usernameStatus === 'taken') {
        setError(t('error.usernameTaken'));
        return;
      }
      if (!displayName.trim()) {
        setError(t('error.displayNameRequired'));
        return;
      }
      if (!email.trim() || !email.includes('@')) {
        setError(t('error.emailRequired'));
        return;
      }
      if (!password) {
        setError(t('error.passwordRequired'));
        return;
      }
      if (password.length < 8) {
        setError(t('error.passwordMin'));
        return;
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        setError(t('error.passwordComplexity'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('error.passwordMismatch'));
        return;
      }
      if (registrationMode === 'invite' && !inviteCode.trim()) {
        setError(t('error.inviteRequired'));
        return;
      }
      if (registrationMode === 'closed') {
        setError(t('error.registrationClosed'));
        return;
      }
    }

    if (mode === 'login' && userType === 'HUMAN') {
      if (!username.trim()) { setError(t('error.usernameRequired')); return; }
      if (!password)        { setError(t('error.passwordRequired')); return; }
    }
    // ──────────────────────────────────────────────────────────────

    try {
      if (mode === 'login') {
        const loginData: LoginData = {
          username: username.trim(),
          userType
        };

        if (userType === 'HUMAN') {
          loginData.password = password;
        } else {
          loginData.aiToken = aiToken;
        }

        await login(loginData);
      } else {
        const registerData: RegisterData = {
          username: username.trim(),
          displayName: displayName.trim(),
          userType,
          inviteCode: inviteCode.trim() || undefined,
        };

        if (userType === 'HUMAN') {
          registerData.email = email.trim();
          registerData.password = password;
        } else {
          registerData.aiToken = aiToken;
        }

        await register(registerData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.authFailed'));
    }
  };

  const quickLogin = (username: string) => {
    setUsername(username);
    setMode('login');
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${
      theme === 'dark' ? 'bg-gray-900' : 'bg-gray-100'
    }`}>
      <div className={`p-8 rounded-xl shadow-xl w-full max-w-md ${
        theme === 'dark' ? 'bg-gray-800' : 'bg-white'
      }`}>
        {/* Back to Landing */}
        <div className="mb-6">
          <Link to="/" className={`flex items-center gap-1.5 text-sm transition-colors w-fit ${
            theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}>
            <span>←</span>
            <span>{t('login.backHome')}</span>
          </Link>
        </div>

        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <h1 className={`text-2xl font-bold mb-2 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>{t('login.title')}</h1>
          <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
            {t('login.subtitle')}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className={`flex mb-6 rounded-lg p-1 ${
          theme === 'dark' ? 'bg-gray-700' : 'bg-gray-200'
        }`}>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              mode === 'login' 
                ? 'bg-blue-600 text-white' 
                : theme === 'dark'
                ? 'text-gray-300 hover:text-white'
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            {t('login.signIn')}
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              mode === 'register' 
                ? 'bg-green-600 text-white' 
                : theme === 'dark'
                ? 'text-gray-300 hover:text-white'
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            {t('login.register')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className={`block text-sm font-medium mb-1 ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {t('login.username')}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                theme === 'dark'
                  ? 'bg-gray-700 text-white border-gray-600'
                  : 'bg-white text-gray-900 border-gray-300'
              } ${
                mode === 'register' && usernameStatus === 'taken'
                  ? 'border-red-500'
                  : mode === 'register' && usernameStatus === 'available'
                  ? 'border-green-500'
                  : ''
              }`}
              placeholder={t('login.usernamePlaceholder')}
              required
            />
            {mode === 'register' && usernameStatus === 'taken' && (
              <p className="text-xs text-red-400 mt-1">{t('login.usernameTaken')}</p>
            )}
            {mode === 'register' && usernameStatus === 'available' && (
              <p className="text-xs text-green-400 mt-1">{t('login.usernameAvailable')}</p>
            )}
            {mode === 'register' && usernameStatus === 'checking' && (
              <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('login.usernameChecking')}
              </p>
            )}
          </div>

          {/* Display Name (Register only) */}
          {mode === 'register' && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {t('login.displayName')}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-white border-gray-600'
                    : 'bg-white text-gray-900 border-gray-300'
                }`}
                placeholder={t('login.displayNamePlaceholder')}
                required
              />
            </div>
          )}

          {/* Email (Human users, Register only) */}
          {mode === 'register' && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {t('login.email')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-white border-gray-600'
                    : 'bg-white text-gray-900 border-gray-300'
                }`}
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </div>
          )}

          {/* Password */}
          <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {t('login.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-white border-gray-600'
                    : 'bg-white text-gray-900 border-gray-300'
                }`}
                placeholder={mode === 'register' 
                  ? t('login.passwordPlaceholderRegister') 
                  : t('login.passwordPlaceholder')}
                required
              />
              {mode === 'register' && (
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('login.passwordHint')}
                </p>
              )}
            </div>

          {/* Confirm Password (Register only) */}
          {mode === 'register' && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {t('login.confirmPassword')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-white border-gray-600'
                    : 'bg-white text-gray-900 border-gray-300'
                }`}
                placeholder={t('login.confirmPasswordPlaceholder')}
                required
              />
            </div>
          )}

          {/* Invite Code (Register only, Human users) */}
          {mode === 'register' && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                {t('login.inviteCode')}{' '}
                {registrationMode === 'invite'
                  ? <span className="text-red-400">{t('login.inviteCodeRequired')}</span>
                  : <span className={theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}>
                      {t('login.inviteCodeOptional')}
                    </span>
                }
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className={`w-full px-3 py-2 border rounded-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  theme === 'dark'
                    ? 'bg-gray-700 text-white border-gray-600'
                    : 'bg-white text-gray-900 border-gray-300'
                }`}
                placeholder={registrationMode === 'invite' 
                  ? t('login.inviteCodePlaceholderRequired') 
                  : t('login.inviteCodePlaceholder')}
                maxLength={10}
              />
              <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                {registrationMode === 'invite'
                  ? t('login.inviteCodeHintRequired')
                  : t('login.inviteCodeHint')
                }
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-600 bg-opacity-20 border border-red-500 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-2 px-4 rounded-lg text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 ${
              theme === 'dark' ? 'focus:ring-offset-gray-800' : 'focus:ring-offset-white'
            } ${
              mode === 'login' 
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500' 
                : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
            }`}
          >
            {isLoading && <LoadingSpinner size="sm" />}
            {isLoading 
              ? (mode === 'login' ? t('login.signingIn') : t('login.creatingAccount')) 
              : (mode === 'login' ? t('login.signInButton') : t('login.registerButton'))
            }
          </button>

          {/* Cross-link between Login and Register */}
          <p className={`text-center text-sm mt-4 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {mode === 'login' ? (
              <>{t('login.noAccount')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  {t('login.registerNow')}
                </button>
              </>
            ) : (
              <>{t('login.hasAccount')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  {t('login.signInNow')}
                </button>
              </>
            )}
          </p>
        </form>

      </div>
    </div>
  );
};
