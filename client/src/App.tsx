import React, { useEffect, Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./stores/authStore";
import { LanguageProvider, useLanguage } from "./contexts/LanguageContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ChatLayout } from "./components/layout/ChatLayout";
import { LoginPage } from "./pages/LoginPage";
import { AdminPage } from "./pages/AdminPage";
import { LandingPage } from "./pages/LandingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AppShell } from "./components/layout/AppShell";
import { PrivacyPage } from "./pages/PrivacyPage";
import { BYOADocsPage } from "./pages/BYOADocsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectCreatePage } from "./pages/ProjectCreatePage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectEditPage } from "./pages/ProjectEditPage";
import { SecretsPage } from "./pages/SecretsPage";
import { SecretCreatePage } from "./pages/SecretCreatePage";
import { SecretDetailPage } from "./pages/SecretDetailPage";
import { SecretEditPage } from "./pages/SecretEditPage";
import { DocsPage } from "./pages/DocsPage";
import { InboxPage } from "./pages/InboxPage";
import { AgentMemoryPage } from "./pages/AgentMemoryPage";
import { AgentMemoryCreatePage } from "./pages/AgentMemoryCreatePage";
import { AgentMemoryDetailPage } from "./pages/AgentMemoryDetailPage";
import { AgentMemoryEditPage } from "./pages/AgentMemoryEditPage";
import { PluginWorkspacePage } from "./pages/PluginWorkspacePage";
import { PluginDocsPage } from "./pages/PluginDocsPage";
import { AgentConfigPage } from "./pages/AgentConfigPage";
import { LoadingSpinner } from "./components/ui/LoadingSpinner";
import { NotificationCenter } from "./components/ui/NotificationCenter";
import { useNotificationStore } from "./stores/notificationStore";

// Error Boundary — prevents black screen on React crashes
class ErrorBoundary extends Component<
  { children: ReactNode; title: string; reloadLabel: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: {
    children: ReactNode;
    title: string;
    reloadLabel: string;
  }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("OpenTriologue crash:", error, info);
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-dark-base text-white">
          <div className="text-center max-w-md p-8">
            <div className="text-5xl mb-4">🧊💥</div>
            <h1 className="text-2xl font-bold mb-2">{this.props.title}</h1>
            <p className="text-gray-400 mb-6 text-sm font-mono">
              {this.state.error?.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-all duration-200"
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
  const { user, isInitializing, initializeAuth } = useAuthStore();
  const loadInbox = useNotificationStore((state) => state.loadInbox);
  const resetInbox = useNotificationStore((state) => state.reset);

  useEffect(() => {
    initializeAuth();
    // Request browser notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [initializeAuth]);

  useEffect(() => {
    if (!user) return;
    // Load agent info (emoji, colors) only for authenticated sessions
    import("./stores/agentStore").then(({ useAgentStore }) => {
      useAgentStore.getState().loadAgents();
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      resetInbox();
      return;
    }
    void loadInbox();
  }, [user?.id, loadInbox, resetInbox]);

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-dark-base">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <ErrorBoundary
      title={t("app.error.title")}
      reloadLabel={t("app.error.reload")}
    >
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
                path="/admin/agents/:agentTokenId/config"
                element={user ? <AgentConfigPage /> : <Navigate to="/login" />}
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
              <Route path="/plugin-dev" element={<PluginDocsPage />} />
              <Route path="/plugins/docs" element={<PluginDocsPage />} />
              <Route
                path="/projects"
                element={user ? <ProjectsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/projects/new"
                element={
                  user ? <ProjectCreatePage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/projects/:projectId"
                element={
                  user ? <ProjectDetailPage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/projects/:projectId/edit"
                element={user ? <ProjectEditPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/secrets"
                element={user ? <SecretsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/secrets/new"
                element={user ? <SecretCreatePage /> : <Navigate to="/login" />}
              />
              <Route
                path="/secrets/:secretId"
                element={user ? <SecretDetailPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/secrets/:secretId/edit"
                element={user ? <SecretEditPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/inbox"
                element={user ? <InboxPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/memory"
                element={user ? <AgentMemoryPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/memory/new"
                element={
                  user ? <AgentMemoryCreatePage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/memory/:memoryId"
                element={
                  user ? <AgentMemoryDetailPage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/memory/:memoryId/edit"
                element={
                  user ? <AgentMemoryEditPage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/docs"
                element={user ? <DocsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/plugins/:pluginId"
                element={
                  user ? <PluginWorkspacePage /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/admin/agents/:agentTokenId/config"
                element={user ? <AgentConfigPage /> : <Navigate to="/login" />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppShell>
          {user && (
            <NotificationCenter className="hidden md:block" hideInChat />
          )}
        </Router>

        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#1f2937",
              color: "#f9fafb",
              border: "1px solid #374151",
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
