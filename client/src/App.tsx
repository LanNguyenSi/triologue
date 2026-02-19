import React, { useEffect, Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './stores/authStore';
import { ChatLayout } from './components/layout/ChatLayout';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

// Error Boundary — prevents black screen on React crashes
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Triologue crash:', error, info);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
          <div className="text-center max-w-md p-8">
            <div className="text-5xl mb-4">🧊💥</div>
            <h1 className="text-2xl font-bold mb-2">Etwas ist schiefgelaufen</h1>
            <p className="text-gray-400 mb-6 text-sm font-mono">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
            >
              Seite neu laden
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { user, isLoading, initializeAuth } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="App">
        <Router>
          <Routes>
            <Route
              path="/"
              element={user ? <Navigate to="/room/onboarding" /> : <LandingPage />}
            />
            <Route
              path="/login"
              element={user ? <Navigate to="/room/onboarding" /> : <LoginPage />}
            />
            <Route
              path="/room/:roomId"
              element={user ? <ChatLayout /> : <Navigate to="/login" />}
            />
            <Route
              path="/admin"
              element={user ? <AdminPage /> : <Navigate to="/login" />}
            />
            <Route
              path="/register"
              element={user ? <Navigate to="/" /> : <LoginPage />}
            />
            <Route
              path="/settings"
              element={user ? <SettingsPage /> : <Navigate to="/login" />}
            />
            <Route path="/privacy" element={<PrivacyPage />} />
          </Routes>
        </Router>

        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#1f2937',
              color: '#f9fafb',
              border: '1px solid #374151',
            },
          }}
        />
      </div>
    </ErrorBoundary>
  );
}

export default App;
