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
  Input,
} from "../components/ui/primitives";
import {
  ConnectorInfo,
  McpConnection,
  fetchConnectors,
  fetchMcpConnections,
  createMcpConnection,
  deleteMcpConnection,
  rediscoverMcpTools,
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
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpApiKey, setMcpApiKey] = useState("");
  const [mcpCreating, setMcpCreating] = useState(false);
  const [mcpDeleting, setMcpDeleting] = useState<string | null>(null);
  const [mcpScanning, setMcpScanning] = useState<string | null>(null);

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
  const loadMcpConnections = useCallback(async () => {
    if (!token) return;
    try {
      setMcpLoading(true);
      const items = await fetchMcpConnections(token);
      setMcpConnections(items);
    } catch (err) {
      console.error("Failed to load MCP connections:", err);
    } finally {
      setMcpLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMcpConnections();
  }, [loadMcpConnections]);

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
    window.location.href = `${API_BASE}/admin/integrations/oauth/start?provider=${connector.provider}&scope=${scope}&token=${token}`;
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
  const handleCreateMcp = async () => {
    if (!token || !mcpName.trim() || !mcpUrl.trim()) return;
    try {
      setMcpCreating(true);
      await createMcpConnection(
        {
          name: mcpName.trim(),
          url: mcpUrl.trim(),
          apiKey: mcpApiKey.trim() || undefined,
        },
        token,
      );
      setMcpName("");
      setMcpUrl("");
      setMcpApiKey("");
      await loadMcpConnections();
    } catch (err) {
      console.error("Failed to create MCP connection:", err);
      setRuntimeError(
        err instanceof Error
          ? err.message
          : "MCP-Verbindung konnte nicht erstellt werden.",
      );
    } finally {
      setMcpCreating(false);
    }
  };

  const handleDeleteMcp = async (id: string) => {
    if (!token) return;
    try {
      setMcpDeleting(id);
      await deleteMcpConnection(id, token);
      await loadMcpConnections();
    } catch (err) {
      console.error("Failed to delete MCP connection:", err);
    } finally {
      setMcpDeleting(null);
    }
  };

  const handleRediscover = async (id: string) => {
    if (!token) return;
    try {
      setMcpScanning(id);
      await rediscoverMcpTools(id, token);
      await loadMcpConnections();
    } catch (err) {
      console.error("Failed to rediscover tools:", err);
    } finally {
      setMcpScanning(null);
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

        <SectionHeader title="Custom Connectors (MCP)" className="mt-6" />

        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                Name
              </label>
              <Input
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder="z.B. Internes Wiki"
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                URL
              </label>
              <Input
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="http://wiki-mcp:3000/mcp"
              />
            </div>
            <div>
              <label
                className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                API Key (optional)
              </label>
              <Input
                type="password"
                value={mcpApiKey}
                onChange={(e) => setMcpApiKey(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleCreateMcp}
            disabled={mcpCreating || !mcpName.trim() || !mcpUrl.trim()}
          >
            {mcpCreating ? "Verbinden..." : "Verbinden & Tools entdecken"}
          </Button>
        </Card>

        {mcpLoading ? (
          <Card tone="muted" className="p-4 text-sm">
            Laden...
          </Card>
        ) : mcpConnections.length === 0 ? (
          <EmptyState
            icon="🔧"
            title="Keine MCP-Verbindungen"
            description="Füge einen MCP-Server hinzu, um externe Tools zu verbinden."
          />
        ) : (
          <div className="space-y-3">
            {mcpConnections.map((conn) => {
              const tools = Array.isArray(conn.discoveredTools)
                ? conn.discoveredTools
                : [];
              const isActive = conn.status === "active";
              return (
                <Card key={conn.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}
                        >
                          {conn.name}
                        </span>
                        <Badge variant={isActive ? "success" : "danger"}>
                          {isActive ? "Aktiv" : "Fehler"}
                        </Badge>
                        <span
                          className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                        >
                          {tools.length} Tools
                        </span>
                      </div>
                      <div
                        className={`text-xs mt-0.5 truncate ${isDark ? "text-gray-400" : "text-gray-600"}`}
                      >
                        {conn.url}
                      </div>
                      {conn.lastHealthCheck && (
                        <div
                          className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-500"}`}
                        >
                          Letzter Check: {new Date(conn.lastHealthCheck).toLocaleString("de-DE")}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRediscover(conn.id)}
                        disabled={mcpScanning === conn.id}
                      >
                        {mcpScanning === conn.id ? "..." : "Neu scannen"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleDeleteMcp(conn.id)}
                        disabled={mcpDeleting === conn.id}
                      >
                        {mcpDeleting === conn.id ? "..." : "Löschen"}
                      </Button>
                    </div>
                  </div>
                  {tools.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {tools.map((tool) => (
                        <div
                          key={tool.name}
                          className={`text-xs px-2 py-1 rounded ${isDark ? "bg-gray-800 text-gray-300" : "bg-gray-50 text-gray-700"}`}
                        >
                          <span className="font-medium">{tool.name}</span>
                          {tool.description && (
                            <span
                              className={isDark ? " text-gray-500" : " text-gray-400"}
                            >
                              {" — "}
                              {tool.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
};
