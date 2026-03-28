import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  FolderIcon,
  ClipboardDocumentListIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "../stores/authStore";
import { useTheme } from "../contexts/ThemeContext";
import { PageShell } from "../components/ui/PageShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SectionHeader,
} from "../components/ui/primitives";
import {
  ConnectorInfo,
  fetchUserConnectors,
  revokeUserIntegration,
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

function getCategoryIcon(connector: ConnectorInfo): React.ReactNode {
  if (connector.icon) return connector.icon;
  if (connector.category === "storage") return <FolderIcon className="w-5 h-5" />;
  if (connector.category === "project") return <ClipboardDocumentListIcon className="w-5 h-5" />;
  return <BoltIcon className="w-5 h-5" />;
}

export const UserConnectionsPage: React.FC = () => {
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
      setConnectors(await fetchUserConnectors(token));
      setRuntimeError(null);
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Verbindungen konnten nicht geladen werden.",
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
    window.location.href = `${API_BASE}/integrations/oauth/start?provider=${connector.provider}&scope=${connector.scope}&token=${token}`;
  };

  const handleDisconnect = async (connector: ConnectorInfo) => {
    if (!token || !connector.integrationId) return;
    try {
      setRevoking(connector.id);
      await revokeUserIntegration(connector.integrationId, token);
      await loadConnectors();
    } catch (error) {
      setRuntimeError(
        error instanceof Error
          ? error.message
          : "Verbindung konnte nicht getrennt werden.",
      );
    } finally {
      setRevoking(null);
    }
  };

  return (
    <PageShell
      maxWidth="5xl"
      title="Meine Verbindungen"
      subtitle="Persönliche OAuth-Verbindungen für Connector-Aktionen pro Task"
    >
      <div className="space-y-4 sm:space-y-5">
        <div>
          <Link
            to="/settings"
            className={`text-sm hover:underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
          >
            ← Zurück zu den Einstellungen
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
            Verbindung erfolgreich gespeichert.
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

        <SectionHeader title="Connectoren" />

        {loading ? (
          <Card tone="muted" className="p-4 text-sm">
            Laden...
          </Card>
        ) : connectors.length === 0 ? (
          <EmptyState
            icon={<BoltIcon className="w-8 h-8" />}
            title="Keine Connectoren verfügbar"
            description="Aktuell wurden keine OAuth-Connectoren gefunden."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {connectors.map((connector) => {
              const status = STATUS_CONFIG[connector.status];
              const isUsingGlobalFallback = connector.connectionScope === "global";
              const canDisconnect = Boolean(connector.integrationId);
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

                  <div className="flex flex-wrap gap-2">
                    {connector.connectionScope === "user" && (
                      <Badge variant="info">Persönlich</Badge>
                    )}
                    {isUsingGlobalFallback && (
                      <Badge variant="warning">Globaler Fallback</Badge>
                    )}
                    {connector.hasGlobalFallback && !isUsingGlobalFallback && (
                      <Badge variant="neutral">Global verfügbar</Badge>
                    )}
                  </div>

                  <p
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {connector.hasPersonalConnection
                      ? "Agenten nutzen für neue Tasks deine persönliche Verbindung."
                      : isUsingGlobalFallback
                        ? "Aktuell wird der globale Admin-Token als Fallback verwendet."
                        : "Lege eine eigene Verbindung an, damit Agents in deinem Berechtigungskontext arbeiten."}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => handleConnect(connector)}
                    >
                      {connector.hasPersonalConnection ? "Neu verbinden" : "Verbinden"}
                    </Button>
                    {canDisconnect && (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => handleDisconnect(connector)}
                        disabled={isRevoking}
                      >
                        {isRevoking ? "Trennen..." : "Trennen"}
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
