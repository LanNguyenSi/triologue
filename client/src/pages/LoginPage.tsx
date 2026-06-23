import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuthStore, LoginData, RegisterData } from '../stores/authStore';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { BrandMark } from '../components/ui/BrandMark';
import { apiClient } from '../lib/apiClient';

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LoginPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { theme } = useTheme();
  
  const [mode, setMode] = useState<'login' | 'register'>(
    location.pathname === '/register' ? 'register' : 'login'
  );

  useEffect(() => {
    setMode(location.pathname === '/register' ? 'register' : 'login');
  }, [location.pathname]);

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setError('');
    setFieldErrors({});
    clearError();
    navigate(newMode === 'login' ? '/login' : '/register', { replace: true });
  };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const userType = 'HUMAN'; // Browser login is always human
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  // Optimistic default matches the server's secure default (REGISTRATION_MODE
  // defaults to 'invite'), so the first paint before /api/auth/config resolves
  // does not flash the open-signup UI and then snap to invite-mode.
  const [registrationMode, setRegistrationMode] = useState<'open' | 'invite' | 'closed'>('invite');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'taken' | 'available'>('idle');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; email?: string }>({});
  const inviteContact = 'contact@lan-nguyen-si.de';

  const { login, register, isSubmitting, clearError } = useAuthStore();

  // Fetch server registration mode once on mount
  useEffect(() => {
    apiClient('/api/auth/config')
      .then(r => r.json())
      .then(d => setRegistrationMode(d.registrationMode ?? 'invite'))
      .catch(() => { /* ignore: best-effort config fetch, failure keeps the secure invite-only default */ });
  }, []);

  // Pre-fill invite code from URL ?invite=XXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) { setInviteCode(code.toUpperCase()); setMode('register'); }
  }, []);

  // Debounced live username availability check
  useEffect(() => {
    if (mode !== 'register' || username.length < 3 || !USERNAME_PATTERN.test(username.trim())) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await apiClient(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
        const data = await res.json();
        setUsernameStatus(data.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username, mode]);

  const localizeValidationDetailMessage = (field: string, message: string): string => {
    const normalizedField = field.trim();
    const normalizedMessage = message.trim();

    const exactMessageMap: Record<string, string> = {
      'Username can only contain letters, numbers, underscores, and hyphens (3-30 characters)': t('error.usernameFormat'),
      'Please provide a valid email address': t('error.emailRequired'),
      'Password must be at least 8 characters with uppercase, lowercase, and number': t('error.passwordComplexity'),
      'Display name can contain letters, numbers, spaces, underscores, and hyphens (2-50 characters)': t('error.displayNameFormat'),
    };
    if (exactMessageMap[normalizedMessage]) return exactMessageMap[normalizedMessage];

    if (normalizedMessage.includes('is required') || normalizedMessage.includes('is not allowed to be empty')) {
      if (normalizedField === 'username') return t('error.usernameRequired');
      if (normalizedField === 'email') return t('error.emailRequired');
      if (normalizedField === 'password') return t('error.passwordRequired');
      if (normalizedField === 'displayName') return t('error.displayNameRequired');
      if (normalizedField === 'inviteCode') return t('error.inviteRequired');
    }

    // Unmapped validation message: log the original for observability, then
    // show a localized generic fallback instead of raw English server copy.
    console.warn('[LoginPage] Unmapped validation message, using generic fallback:', { field: normalizedField, message: normalizedMessage });
    return t('error.validationFailed');
  };

  const localizeAuthError = (message: string): string => {
    const normalized = message.trim();
    if (!normalized) return t('error.authFailed');

    const exactMessageMap: Record<string, string> = {
      'Invalid credentials': t('error.invalidCredentials'),
      'Account is disabled': t('error.accountDisabled'),
      'Invalid user type': t('error.invalidUserType'),
      'AI token required for AI agents': t('error.aiTokenRequired'),
      'Invalid AI token': t('error.invalidAiToken'),
      'Agent token is not active': t('error.agentTokenInactive'),
      'Password required for human users': t('error.passwordRequired'),
      'Validation failed': t('error.validationFailed'),
      'Too many login attempts, please try again later.': t('error.tooManyLoginAttempts'),
      'Registration is currently closed.': t('error.registrationClosed'),
      'Username already taken.': t('error.usernameTaken'),
      'Email already registered.': t('error.emailAlreadyRegistered'),
      'An invite code is required (closed beta).': t('error.inviteRequired'),
      'Invalid or already used invite code.': t('error.inviteInvalidOrUsed'),
      'This invite code has expired.': t('error.inviteExpired'),
      'This invite code has already been used.': t('error.inviteAlreadyUsed'),
      'Registration failed': t('error.registrationFailed'),
      'Login failed': t('error.loginFailed'),
      'Authentication failed': t('error.authFailed'),
    };

    if (exactMessageMap[normalized]) return exactMessageMap[normalized];
    // Unmapped auth error: log the original for observability, then show a
    // localized generic fallback instead of raw English server copy.
    console.warn('[LoginPage] Unmapped auth error, using generic fallback:', normalized);
    return t('error.authFailed');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    clearError();

    // ── Frontend validation ────────────────────────────────────────
    if (mode === 'register') {
      const cleanUsername = username.trim();
      const cleanEmail = email.trim();

      if (!username.trim()) {
        setError(t('error.usernameRequired'));
        setFieldErrors({ username: t('error.usernameRequired') });
        return;
      }
      if (!USERNAME_PATTERN.test(cleanUsername)) {
        setError(t('error.usernameFormat'));
        setFieldErrors({ username: t('error.usernameFormat') });
        return;
      }
      if (usernameStatus === 'taken') {
        setError(t('error.usernameTaken'));
        setFieldErrors({ username: t('error.usernameTaken') });
        return;
      }
      if (!displayName.trim()) {
        setError(t('error.displayNameRequired'));
        return;
      }
      if (!cleanEmail || !EMAIL_PATTERN.test(cleanEmail)) {
        setError(t('error.emailRequired'));
        setFieldErrors({ email: t('error.emailRequired') });
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

    if (mode === 'login') {
      if (!username.trim()) { setError(t('error.usernameRequired')); return; }
      if (!password)        { setError(t('error.passwordRequired')); return; }
    }
    // ──────────────────────────────────────────────────────────────

    try {
      if (mode === 'login') {
        const loginData: LoginData = {
          username: username.trim(),
          userType,
          password,
        };

        await login(loginData);
      } else {
        const registerData: RegisterData = {
          username: username.trim(),
          displayName: displayName.trim(),
          userType,
          inviteCode: inviteCode.trim() || undefined,
          email: email.trim(),
          password,
        };

        await register(registerData);
      }
    } catch (err) {
      const fallback = err instanceof Error ? err.message : t('error.authFailed');
      const errRecord = (err instanceof Error && 'details' in err) ? err as Record<string, unknown> : null;
      const details: { field?: string; message?: string }[] =
        (errRecord !== null && Array.isArray(errRecord['details']))
          ? errRecord['details'] as { field?: string; message?: string }[]
          : [];
      if (details.length > 0) {
        const nextFieldErrors: { username?: string; email?: string } = {};
        const localizedMessages = new Set<string>();
        for (const detail of details) {
          const field = String(detail?.field || '').trim();
          const message = String(detail?.message || '').trim();
          if (!message) continue;
          const localizedMessage = localizeValidationDetailMessage(field, message);
          localizedMessages.add(localizedMessage);
          if (field === 'username') nextFieldErrors.username = localizedMessage;
          if (field === 'email') nextFieldErrors.email = localizedMessage;
        }
        if (nextFieldErrors.username || nextFieldErrors.email) {
          setFieldErrors(nextFieldErrors);
        }
        if (localizedMessages.size > 0) {
          setError(Array.from(localizedMessages).join('\n'));
          return;
        }
      }
      setError(localizeAuthError(fallback));
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${
      theme === 'dark' ? 'bg-dark-base' : 'bg-gray-50/80'
    }`}>
      <div className={`p-8 rounded-xl shadow-card w-full max-w-md ${
        theme === 'dark' ? 'bg-gray-900 border border-gray-800/60' : 'bg-white border border-gray-200/80'
      }`}>
        {/* Back to Landing */}
        <div className="mb-6">
          <Link to="/" className={`flex items-center gap-1.5 text-sm transition-colors duration-200 w-fit ${
            theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}>
            <span>←</span>
            <span>{t('login.backHome')}</span>
          </Link>
        </div>

        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <BrandMark className="w-14 h-14" />
          </div>
          <h1 className={`text-2xl font-semibold mb-2 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>{t('login.title')}</h1>
          <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
            {t('login.subtitle')}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className={`flex mb-6 rounded-lg p-1 ${
          theme === 'dark' ? 'bg-gray-800/80' : 'bg-gray-100'
        }`}>
          <button
            type="button"
            onClick={() => switchMode('login')}
            aria-pressed={mode === 'login'}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors duration-200 ${
              mode === 'login' 
                ? 'bg-blue-600 shadow-subtle text-white' 
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
            aria-pressed={mode === 'register'}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors duration-200 ${
              mode === 'register' 
                ? 'bg-blue-600 shadow-subtle text-white' 
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
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {t('login.username')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }}
              className={`w-full px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                theme === 'dark'
                  ? 'bg-gray-800/60 text-white border-gray-600/80'
                  : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
              } ${
                fieldErrors.username
                  ? 'border-red-500'
                  : mode === 'register' && usernameStatus === 'taken'
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
            {fieldErrors.username && (
              <p className="text-xs text-red-400 mt-1">{fieldErrors.username}</p>
            )}
          </div>

          {/* Display Name (Register only) */}
          {mode === 'register' && (
            <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {t('login.displayName')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`w-full px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                  theme === 'dark'
                    ? 'bg-gray-800/60 text-white border-gray-600/80'
                    : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
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
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {t('login.email')} <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                className={`w-full px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                  theme === 'dark'
                    ? 'bg-gray-800/60 text-white border-gray-600/80'
                    : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
                } ${
                  fieldErrors.email ? 'border-red-500' : ''
                }`}
                placeholder={t('login.emailPlaceholder')}
                required
              />
              {fieldErrors.email && (
                <p className="text-xs text-red-400 mt-1">{fieldErrors.email}</p>
              )}
            </div>
          )}

          {/* Password */}
          <div>
              <label className={`block text-sm font-medium mb-1 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {t('login.password')} <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                  theme === 'dark'
                    ? 'bg-gray-800/60 text-white border-gray-600/80'
                    : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
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
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {t('login.confirmPassword')} <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                  theme === 'dark'
                    ? 'bg-gray-800/60 text-white border-gray-600/80'
                    : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
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
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
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
                className={`w-full px-3.5 py-2.5 border rounded-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 transition-colors duration-200 ${
                  theme === 'dark'
                    ? 'bg-gray-800/60 text-white border-gray-600/80'
                    : 'bg-white text-gray-900 border-gray-200/60 shadow-subtle'
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
              <p className={`text-xs mt-1.5 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('login.inviteContactHint')}{' '}
                <a
                  href={`mailto:${inviteContact}`}
                  className={`underline underline-offset-2 ${
                    theme === 'dark' ? 'text-blue-300 hover:text-blue-200' : 'text-blue-700 hover:text-blue-600'
                  }`}
                >
                  {inviteContact}
                </a>
              </p>
            </div>
          )}

          {error && (
            <div
              className={`p-3 rounded-lg text-sm border ${
                theme === 'dark'
                  ? 'bg-red-950/30 border-red-800/40 text-red-200'
                  : 'bg-red-50 border-red-200 text-red-700'
              } whitespace-pre-line`}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2.5 px-5 rounded-lg text-white font-medium transition-colors duration-200 shadow-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 ${
              theme === 'dark' ? 'focus:ring-offset-gray-900' : 'focus:ring-offset-white'
            } bg-blue-600 hover:bg-blue-700 focus:ring-blue-500`}
          >
            {isSubmitting && <LoadingSpinner size="sm" />}
            {isSubmitting 
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
                  className={`font-medium transition-colors duration-200 ${
                    theme === 'dark'
                      ? 'text-blue-400 hover:text-blue-300'
                      : 'text-blue-600 hover:text-blue-700'
                  }`}
                >
                  {t('login.registerNow')}
                </button>
              </>
            ) : (
              <>{t('login.hasAccount')}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`font-medium transition-colors duration-200 ${
                    theme === 'dark'
                      ? 'text-blue-400 hover:text-blue-300'
                      : 'text-blue-600 hover:text-blue-700'
                  }`}
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
