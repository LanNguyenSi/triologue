import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import {
  Card,
  Badge,
  Button,
  SectionHeader,
  EmptyState,
} from "../components/ui/primitives";
import {
  ConnectorInfo,
  fetchConnectors,
  revokeIntegration,
} from "../services/connectorApi";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

const STATUS_CONFIG: Record<
  ConnectorInfo["status"],
  { variant: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  connected: { variant: "success", label: "Verbunden" },
  expiring: { variant: "warning", label: "Läuft bald ab" },
  expired: { variant: "danger", label: "Abgelaufen" },
  error: { variant: "danger", label: "Fehler" },
  disconnected: { variant: "neutral", label: "Nicht verbunden" },
};

function getCategoryIcon(connector: ConnectorInfo): string {
  if (connector.icon) return connector.icon;
  if (connector.category === "storage") return "📁";
  if (connector.category === "project") return "📋";
  return "🔌";
}

function getProviderScope(connector: ConnectorInfo): string {
  if (connector.provider === "microsoft") return "graph";
  if (connector.provider === "atlassian") return "jira";
  return connector.actions.length > 0 ? "graph" : "default";
}

export const ConnectorAdminPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token } = useAuthStore();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const loadConnectors = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const items = await fetchConnectors(token);
      setConnectors(items);
      setRuntimeError(null);
    } catch (error) {
      console.error("Failed to load connectors:", error);
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Connectoren konnten nicht geladen werden.",
      );
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    void loadConnectors();
  }, [token, navigate, loadConnectors]);

  const successMessage = searchParams.get("success") === "1";
  const oauthError = searchParams.get("error");

  const oauthErrorMessage = useMemo(() => {
    if (!oauthError) return null;
    if (oauthError === "invalid_state") {
      return "Ungültiger OAuth-State. Bitte versuche es erneut.";
    }
    if (oauthError === "token_exchange_failed") {
      return "Token-Austausch fehlgeschlagen. Bitte versuche es erneut.";
    }
    if (oauthError === "oauth_failed") {
      return "OAuth-Verbindung fehlgeschlagen. Bitte versuche es erneut.";
    }
    return "OAuth-Verbindung fehlgeschlagen. Bitte versuche es erneut.";
  }, [oauthError]);

  useEffect(() => {
    if (!successMessage && !oauthError) return;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [successMessage, oauthError]);

  const handleConnect = (connector: ConnectorInfo) => {
    const scope = getProviderScope(connector);
    window.location.href = `${API_BASE}/admin/integrations/oauth/start?provider=${connector.provider}&scope=${scope}`;
  };

  const handleDisconnect = async (connector: ConnectorInfo) => {
    if (!token || !connector.integrationId) return;
    try {
      setRevoking(connector.id);
      await revokeIntegration(connector.integrationId, token);
      await loadConnectors();
    } catch (error) {
      console.error("Failed to revoke integration:", error);
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Integration konnte nicht getrennt werden.",
      );
    } finally {
      setRevoking(null);
    }
  };

  return (
    <PageShell
      maxWidth="5xl"
      title="🔌 Connector-Verwaltung"
      subtitle="Externe Dienste verbinden und verwalten"
    >
      <div className="space-y-4 sm:space-y-5">
        <div>
          <Link
            to="/admin"
            className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
          >
            &larr; Zurück zur Administration
          </Link>
        </div>

        {successMessage && (
          <Card
            tone="muted"
            className={`p-3 text-sm border ${
              isDark
                ? "border-emerald-700/60 text-emerald-300"
                : "border-emerald-200 text-emerald-700"
            }`}
          >
            Connector erfolgreich verbunden!
          </Card>
        )}

        {oauthErrorMessage && (
          <Card
            tone="muted"
            className={`p-3 text-sm border ${
              isDark
                ? "border-red-700/60 text-red-300"
                : "border-red-200 text-red-700"
            }`}
          >
            {oauthErrorMessage}
          </Card>
        )}

        {runtimeError && (
          <Card
            tone="muted"
            className={`p-3 text-sm border ${
              isDark
                ? "border-red-700/60 text-red-300"
                : "border-red-200 text-red-700"
            }`}
          >
            {runtimeError}
          </Card>
        )}

        <SectionHeader title="Verfügbare Connectoren" />

        {loading ? (
          <Card tone="muted" className="p-4 text-sm">
            Laden...
          </Card>
        ) : connectors.length === 0 ? (
          <EmptyState
            icon="🔌"
            title="Keine Connectoren verfügbar"
            description="Aktuell wurden keine Connectoren gefunden."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {connectors.map((connector) => {
              const status = STATUS_CONFIG[connector.status];
              const showConnectButton =
                connector.status === "disconnected" ||
                connector.status === "expired" ||
                connector.status === "error";
              const showDisconnectButton =
                connector.status === "connected" ||
                connector.status === "expiring" ||
                connector.status === "expired" ||
                connector.status === "error";
              const isRevoking = revoking === connector.id;

              return (
                <Card key={connector.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-2xl leading-none">
                      {getCategoryIcon(connector)}
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>

                  <div>
                    <p
                      className={`font-semibold ${
                        isDark ? "text-white" : "text-gray-900"
                      }`}
                    >
                      {connector.name}
                    </p>
                    <p
                      className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {connector.category}
                    </p>
                  </div>

                  <p
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {connector.actions.length} Aktionen verfügbar
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {showConnectButton && (
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={() => handleConnect(connector)}
                      >
                        Verbinden
                      </Button>
                    )}
                    {showDisconnectButton && (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => handleDisconnect(connector)}
                        disabled={isRevoking || !connector.integrationId}
                      >
                        {isRevoking ? "Trennen..." : "Trennen"}
                      </Button>
                    )}
                    {connector.status !== "disconnected" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/admin/connectors/${connector.id}/test`)}
                      >
                        Testen
                      </Button>
                    )}

                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
};
