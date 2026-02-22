import React, { useEffect, Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './stores/authStore';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ChatLayout } from './components/layout/ChatLayout';
import { LoginPage } from './pages/LoginPage';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { AppShell } from './components/layout/AppShell';
import { PrivacyPage } from './pages/PrivacyPage';
import { BYOADocsPage } from './pages/BYOADocsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SecretsPage } from './pages/SecretsPage';
import { LoadingSpinner } from './components/ui/LoadingSpinner';
import { NotificationCenter } from './components/ui/NotificationCenter';

// Error Boundary — prevents black screen on React crashes
class ErrorBoundary extends Component<{ children: ReactNode; title: string; reloadLabel: string }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; title: string; reloadLabel: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('OpenTriologue crash:', error, info);
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
          <div className="text-center max-w-md p-8">
            <div className="text-5xl mb-4">🧊💥</div>
            <h1 className="text-2xl font-bold mb-2">{this.props.title}</h1>
            <p className="text-gray-400 mb-6 text-sm font-mono">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
            >
              {this.props.reloadLabel}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { t } = useLanguage();
  const { user, isLoading, initializeAuth } = useAuthStore();

  useEffect(() => {
    initializeAuth();
    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [initializeAuth]);

  useEffect(() => {
    if (!user) return;
    // Load agent info (emoji, colors) only for authenticated sessions
    import('./stores/agentStore').then(({ useAgentStore }) => {
      useAgentStore.getState().loadAgents();
    });
  }, [user?.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <ErrorBoundary title={t('app.error.title')} reloadLabel={t('app.error.reload')}>
      <div className="App">
      <Router>
        <AppShell>
        <Routes>
        <Route
          path="/"
          element={user ? <DashboardPage /> : <LandingPage />}
        />
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <LoginPage />}
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
        <Route path="/byoa" element={<BYOADocsPage />} />
        <Route path="/projects" element={user ? <ProjectsPage /> : <Navigate to="/login" />} />
        <Route path="/projects/:projectId" element={user ? <ProjectDetailPage /> : <Navigate to="/login" />} />
        <Route path="/secrets" element={user ? <SecretsPage /> : <Navigate to="/login" />} />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </AppShell>
        {user && <NotificationCenter className="hidden md:block" />}
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

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AppContent />
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
