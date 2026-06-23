import { useEffect, Component, ErrorInfo, ReactNode } from "react";
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
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
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
import { ProjectActivityPage } from "./pages/ProjectActivityPage";
import { ProjectEditPage } from "./pages/ProjectEditPage";
import { SecretsPage } from "./pages/SecretsPage";
import { SecretCreatePage } from "./pages/SecretCreatePage";
import { SecretDetailPage } from "./pages/SecretDetailPage";
import { SecretEditPage } from "./pages/SecretEditPage";
import { DocsPage } from "./pages/DocsPage";
import { InboxPage } from "./pages/InboxPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AgentMemoryPage } from "./pages/AgentMemoryPage";
import { AgentMemoryCreatePage } from "./pages/AgentMemoryCreatePage";
import { AgentMemoryDetailPage } from "./pages/AgentMemoryDetailPage";
import { AgentMemoryEditPage } from "./pages/AgentMemoryEditPage";
import { PluginWorkspacePage } from "./pages/PluginWorkspacePage";
import { PluginDocsPage } from "./pages/PluginDocsPage";
import { AgentConfigPage } from "./pages/AgentConfigPage";
import { UserConnectionsPage } from "./pages/UserConnectionsPage";
import { FilesPage } from "./pages/FilesPage";
import { LoadingSpinner } from "./components/ui/LoadingSpinner";
import { BrandMark } from "./components/ui/BrandMark";
import { Button } from "./components/ui/primitives/Button";
import { NotificationCenter } from "./components/ui/NotificationCenter";
import { useNotificationStore } from "./stores/notificationStore";

// Error Boundary — prevents black screen on React crashes
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    title: string;
    reloadLabel: string;
    message: string;
    detailsLabel: string;
    theme: "light" | "dark";
  },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: {
    children: ReactNode;
    title: string;
    reloadLabel: string;
    message: string;
    detailsLabel: string;
    theme: "light" | "dark";
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
        <div
          className={`flex items-center justify-center min-h-screen ${
            this.props.theme === "dark"
              ? "bg-dark-base text-white"
              : "bg-gray-50 text-gray-900"
          }`}
        >
          <div className="text-center max-w-md p-8">
            <BrandMark className="w-12 h-12 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">{this.props.title}</h1>
            <p className="mb-6 text-sm opacity-80">{this.props.message}</p>
            {this.state.error?.message && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm opacity-70 hover:opacity-100">
                  {this.props.detailsLabel}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs opacity-60">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <Button
              variant="primary"
              onClick={() => window.location.reload()}
            >
              {this.props.reloadLabel}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { t } = useLanguage();
  const { theme } = useTheme();
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
      message={t("app.error.message")}
      detailsLabel={t("app.error.details")}
      theme={theme}
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
              <Route
                path="/settings/connections"
                element={user ? <UserConnectionsPage /> : <Navigate to="/login" />}
              />
              <Route
                path="/files"
                element={user ? <FilesPage /> : <Navigate to="/login" />}
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
                path="/projects/:projectId/activity"
                element={
                  user ? <ProjectActivityPage /> : <Navigate to="/login" />
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
                path="/approvals"
                element={user ? <ApprovalsPage /> : <Navigate to="/login" />}
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
